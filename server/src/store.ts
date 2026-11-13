// 内存会话存储（技术 Spec 第 2.2 节 / 第 2.5 节）。
// 会话状态只存在于进程内存（演示级，无持久化）；服务重启即清空。

import { randomUUID } from 'node:crypto'
import {
  ApiError,
  MAX_QUANTITY,
  MIN_QUANTITY,
  type Member,
  type OrderStage,
  type SessionSnapshot,
  type SharedCartItem,
  type SharedOrderItem,
  type TableSession,
} from './types.js'
import type { CartItemInput } from './validate.js'

export type SessionListener = (snapshot: SessionSnapshot) => void

/** 每个桌台保留的 Idempotency-Key 数量上限（演示级，避免无界增长）。 */
const MAX_IDEMPOTENCY_KEYS = 50

export interface SessionStore {
  getSnapshot(tableCode: string): SessionSnapshot
  addMember(
    tableCode: string,
    nickname: string,
    clientMemberId: string,
  ): { member: Member; snapshot: SessionSnapshot }
  addCartItem(tableCode: string, memberId: string, input: CartItemInput): SessionSnapshot
  changeCartItemQuantity(
    tableCode: string,
    memberId: string,
    uid: string,
    delta: 1 | -1,
  ): SessionSnapshot
  removeCartItem(tableCode: string, memberId: string, uid: string): SessionSnapshot
  ackCartItem(tableCode: string, memberId: string, uid: string): SessionSnapshot
  submitOrder(tableCode: string, memberId: string, idempotencyKey?: string): SessionSnapshot
  requestCancelOrderItem(tableCode: string, memberId: string, uid: string): SessionSnapshot
  setOrderStage(tableCode: string, memberId: string, stage: OrderStage): SessionSnapshot
  payOrder(tableCode: string, memberId: string): SessionSnapshot
  subscribe(tableCode: string, listener: SessionListener): () => void
}

const nowIso = (): string => new Date().toISOString()

const createSession = (tableCode: string): TableSession => ({
  tableCode,
  rev: 0,
  members: [],
  cart: [],
  order: { items: [], stage: 'submitted', paid: false, submittedAt: null },
  updatedAt: nowIso(),
  processedOrderKeys: [],
})

const toSnapshot = (session: TableSession): SessionSnapshot => ({
  tableCode: session.tableCode,
  rev: session.rev,
  members: session.members,
  cart: session.cart,
  order: session.order,
  updatedAt: session.updatedAt,
})

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, TableSession>()
  const listeners = new Map<string, Set<SessionListener>>()

  const ensureSession = (tableCode: string): TableSession => {
    const existing = sessions.get(tableCode)
    if (existing) return existing
    const created = createSession(tableCode)
    sessions.set(tableCode, created)
    return created
  }

  const broadcast = (session: TableSession): void => {
    const subscribers = listeners.get(session.tableCode)
    if (!subscribers || subscribers.size === 0) return
    const snapshot = toSnapshot(session)
    for (const listener of subscribers) {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('[store] SSE listener failed:', error)
      }
    }
  }

  /** 共享状态变更提交：rev +1、刷新时间并广播全量快照。 */
  const commit = (session: TableSession): SessionSnapshot => {
    session.rev += 1
    session.updatedAt = nowIso()
    broadcast(session)
    return toSnapshot(session)
  }

  const requireMember = (session: TableSession, memberId: string): Member => {
    const member = session.members.find((candidate) => candidate.memberId === memberId)
    if (!member) {
      throw new ApiError('UNKNOWN_MEMBER', '成员不属于该桌台，请重新加入')
    }
    return member
  }

  const findCartItem = (session: TableSession, uid: string): SharedCartItem => {
    const item = session.cart.find((candidate) => candidate.uid === uid)
    if (!item) {
      throw new ApiError('ITEM_NOT_FOUND', `购物车条目不存在：${uid}`)
    }
    return item
  }

  return {
    getSnapshot(tableCode) {
      return toSnapshot(ensureSession(tableCode))
    },

    addMember(tableCode, nickname, clientMemberId) {
      const session = ensureSession(tableCode)
      // 幂等：同一 clientMemberId 重复加入返回既有成员，不产生新状态。
      const existing = session.members.find(
        (candidate) => candidate.clientMemberId === clientMemberId,
      )
      if (existing) {
        return { member: existing, snapshot: toSnapshot(session) }
      }
      const member: Member = {
        memberId: `m-${randomUUID()}`,
        clientMemberId,
        nickname,
        joinedAt: nowIso(),
      }
      session.members = [...session.members, member]
      return { member, snapshot: commit(session) }
    },

    addCartItem(tableCode, memberId, input) {
      const session = ensureSession(tableCode)
      const member = requireMember(session, memberId)
      // 幂等：同一 uid 重复提交返回当前快照，不重复计数。
      if (session.cart.some((item) => item.uid === input.uid)) {
        return toSnapshot(session)
      }
      const item: SharedCartItem = {
        ...input,
        orderedBy: member.memberId,
        orderedByName: member.nickname,
        ack: null,
      }
      session.cart = [...session.cart, item]
      return commit(session)
    },

    changeCartItemQuantity(tableCode, memberId, uid, delta) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      const item = findCartItem(session, uid)
      if (item.orderedBy !== memberId) {
        throw new ApiError('NOT_ITEM_OWNER', '只能修改自己添加的条目')
      }
      const quantity = item.quantity + delta
      if (quantity > MAX_QUANTITY) {
        throw new ApiError('INVALID_QUANTITY', `数量不能超过 ${MAX_QUANTITY}`)
      }
      if (quantity < MIN_QUANTITY) {
        session.cart = session.cart.filter((candidate) => candidate.uid !== uid)
        return commit(session)
      }
      session.cart = session.cart.map((candidate) =>
        candidate.uid === uid ? { ...candidate, quantity } : candidate,
      )
      return commit(session)
    },

    removeCartItem(tableCode, memberId, uid) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      const item = findCartItem(session, uid)
      if (item.orderedBy !== memberId) {
        throw new ApiError('NOT_ITEM_OWNER', '只能删除自己添加的条目')
      }
      session.cart = session.cart.filter((candidate) => candidate.uid !== uid)
      return commit(session)
    },

    ackCartItem(tableCode, memberId, uid) {
      const session = ensureSession(tableCode)
      const member = requireMember(session, memberId)
      const item = findCartItem(session, uid)
      if (item.orderedBy === memberId) {
        throw new ApiError('SELF_ACK_NOT_ALLOWED', '不能确认自己添加的条目')
      }
      // 幂等：已确认知悉返回当前快照。
      if (item.ack) {
        return toSnapshot(session)
      }
      session.cart = session.cart.map((candidate) =>
        candidate.uid === uid
          ? {
              ...candidate,
              ack: { byMemberId: member.memberId, byName: member.nickname, at: nowIso() },
            }
          : candidate,
      )
      return commit(session)
    },

    submitOrder(tableCode, memberId, idempotencyKey) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      // 幂等：同一 Idempotency-Key 重复提交返回当前快照（须先于空购物车判定）。
      if (idempotencyKey && session.processedOrderKeys.includes(idempotencyKey)) {
        return toSnapshot(session)
      }
      if (session.cart.length === 0) {
        throw new ApiError('EMPTY_CART', '购物车为空，无法下单')
      }
      const additions: SharedOrderItem[] = session.cart.map((item) => ({
        ...item,
        stage: 'submitted' as const,
      }))
      session.order = {
        ...session.order,
        items: [...session.order.items, ...additions],
        stage: 'submitted',
        submittedAt: nowIso(),
      }
      session.cart = []
      if (idempotencyKey) {
        session.processedOrderKeys = [
          ...session.processedOrderKeys,
          idempotencyKey,
        ].slice(-MAX_IDEMPOTENCY_KEYS)
      }
      return commit(session)
    },

    requestCancelOrderItem(tableCode, memberId, uid) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      const item = session.order.items.find((candidate) => candidate.uid === uid)
      if (!item) {
        throw new ApiError('ITEM_NOT_FOUND', `订单条目不存在：${uid}`)
      }
      if (item.cancelState === 'requested') {
        return toSnapshot(session)
      }
      session.order = {
        ...session.order,
        items: session.order.items.map((candidate) =>
          candidate.uid === uid ? { ...candidate, cancelState: 'requested' } : candidate,
        ),
      }
      return commit(session)
    },

    setOrderStage(tableCode, memberId, stage) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      const unchanged =
        session.order.stage === stage &&
        session.order.items.every((item) => item.stage === stage)
      if (unchanged) {
        return toSnapshot(session)
      }
      session.order = {
        ...session.order,
        stage,
        items: session.order.items.map((item) => ({ ...item, stage })),
      }
      return commit(session)
    },

    payOrder(tableCode, memberId) {
      const session = ensureSession(tableCode)
      requireMember(session, memberId)
      if (session.order.paid) {
        throw new ApiError('ORDER_ALREADY_PAID', '该桌台订单已支付')
      }
      session.order = { ...session.order, paid: true }
      return commit(session)
    },

    subscribe(tableCode, listener) {
      const subscribers = listeners.get(tableCode) ?? new Set<SessionListener>()
      subscribers.add(listener)
      listeners.set(tableCode, subscribers)
      return () => {
        subscribers.delete(listener)
        if (subscribers.size === 0) {
          listeners.delete(tableCode)
        }
      }
    },
  }
}
