import { useCallback, useEffect, useRef, useState } from 'react'
import i18next from 'i18next'
import { CollabError, collabApi } from '@/api/collabClient'
import { createCollabStream, type CollabStream } from '@/api/collabStream'
import { uid } from '@/lib/utils'
import type {
  AppAction,
  AppState,
  CartItem,
  Member,
  OrderItem,
  OrderStage,
  SessionSnapshot,
  SharedCartItem,
  SharedOrderItem,
  SyncState,
} from '@/types'

/** 轮询兜底间隔（= 多端同步时效阈值 2000ms）。 */
const POLL_MS = 2000
/** SSE 连续失败阈值，超过后降级为轮询。 */
const MAX_SSE_FAILURES = 3
const KEY_CLIENT_ID = 'collab:clientId'
const KEY_NICKNAME = 'collab:nickname'
const KEY_MEMBER_ID = 'collab:memberId'
const KEY_TABLE = 'collab:table'

function readSessionItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSessionItem(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // sessionStorage 不可用时降级为内存态，不报错不阻塞
  }
}

/** 稳定的 clientMemberId（标签页级），作为加入同桌的幂等键。 */
export function ensureClientMemberId(): string {
  const existing = readSessionItem(KEY_CLIENT_ID)
  if (existing) return existing
  const created = uid()
  writeSessionItem(KEY_CLIENT_ID, created)
  return created
}

/** 读取本端昵称身份（标签页级）；不可恢复时回退到传入的默认昵称。 */
export function readStoredNickname(fallback: string): string {
  return readSessionItem(KEY_NICKNAME) || fallback
}

/** 记住本端昵称身份，供刷新与深链接恢复（REQ-001.5）。 */
export function rememberNickname(nickname: string) {
  writeSessionItem(KEY_NICKNAME, nickname)
}

const toCartItem = (item: SharedCartItem): CartItem => ({
  uid: item.uid,
  productId: item.productId,
  name: item.name,
  price: item.price,
  quantity: item.quantity,
  image: item.image,
  spec: item.spec,
  orderedBy: item.orderedByName,
  orderedByMemberId: item.orderedBy,
  ack: item.ack,
})

const toOrderItem = (item: SharedOrderItem): OrderItem => ({
  ...toCartItem(item),
  stage: item.stage,
  cancelState: item.cancelState,
})

export interface CollabSessionController {
  syncState: SyncState
  /** 协同能力是否可用；不可用时所有动作退回既有本地单机行为。 */
  available: boolean
  selfMemberId: string | null
  selfNickname: string | null
  addItem: (item: CartItem) => void
  changeQuantity: (uid: string, delta: number) => void
  acknowledge: (uid: string) => void
  submitOrder: () => void
  cancelOrderItem: (uid: string) => void
  setStage: (stage: OrderStage) => void
  pay: () => void
  refresh: () => void
}

interface UseCollabSessionOptions {
  dispatch: React.Dispatch<AppAction>
  state: AppState
  /** 本端昵称；null 表示尚未加入同桌。 */
  nickname: string | null
}

/**
 * 协同会话状态机：标签页级身份、加入同桌、快照收敛、动作代理与同步状态。
 * 后端不可用时整条协同链路静默降级，主链路保持既有单机行为（REQ-008.5）。
 */
export function useCollabSession({ dispatch, state, nickname }: UseCollabSessionOptions): CollabSessionController {
  const { table, view } = state
  const entered = view === 'menu' || view === 'order' || view === 'checkout'

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const [syncState, setSyncState] = useState<SyncState>('reconnecting')
  const [self, setSelf] = useState<Member | null>(null)
  const membersRef = useRef<Member[]>([])
  const joinedTableRef = useRef<string | null>(null)
  const inflightRef = useRef<string | null>(null)
  const streamRef = useRef<CollabStream | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)

  const applySnapshot = useCallback((snapshot: SessionSnapshot) => {
    membersRef.current = snapshot.members
    dispatch({
      type: 'HYDRATE_SHARED',
      cart: snapshot.cart.map(toCartItem),
      orderItems: snapshot.order.items.map(toOrderItem),
      orderStage: snapshot.order.stage,
      paid: snapshot.order.paid,
      members: snapshot.members,
    })
  }, [dispatch])

  const reportFailure = useCallback((error: unknown) => {
    const collabError = error as CollabError
    const message = collabError?.kind === 'validation'
      ? i18next.t(`collab.error.${collabError.code}`, { defaultValue: i18next.t('collab.error.generic') })
      : i18next.t('collab.sync_failed')
    dispatch({ type: 'SET_MESSAGE', message })
    streamRef.current?.refresh()
  }, [dispatch])

  // 加入同桌：进入点餐流程且已选定昵称后执行；clientMemberId 保证幂等（REQ-001.2 / REQ-001.4）。
  // 以 table 为在途标记，避免视图切换或 StrictMode 双调用造成的重复加入与状态卡死。
  useEffect(() => {
    if (!entered || !table || !nickname) return
    if (joinedTableRef.current === table || inflightRef.current === table) return
    inflightRef.current = table
    setSyncState('reconnecting')
    ;(async () => {
      try {
        const result = await collabApi.join(table, nickname, ensureClientMemberId())
        joinedTableRef.current = table
        writeSessionItem(KEY_MEMBER_ID, result.member.memberId)
        writeSessionItem(KEY_TABLE, table)
        setSelf(result.member)
        applySnapshot(result.session)
        setSyncState('connected')
      } catch (error) {
        joinedTableRef.current = table
        setSyncState('offline')
        if ((error as CollabError)?.kind === 'validation') reportFailure(error)
      } finally {
        if (inflightRef.current === table) inflightRef.current = null
      }
    })()
  }, [entered, table, nickname, applySnapshot, reportFailure])

  // 建立同步：SSE 全量快照推送 + 断线重连 + 轮询兜底（REQ-004）。
  useEffect(() => {
    const memberId = self?.memberId
    if (!entered || !table || !memberId) return
    const stream = createCollabStream({
      tableCode: table,
      memberId,
      pollMs: POLL_MS,
      maxSseFailures: MAX_SSE_FAILURES,
      onSnapshot: applySnapshot,
      onSyncState: setSyncState,
      onError: reportFailure,
    })
    streamRef.current = stream
    stream.refresh()
    return () => {
      stream.close()
      streamRef.current = null
    }
  }, [entered, table, self?.memberId, applySnapshot, reportFailure])

  // 回到首页时重置本端协同身份，下一次进入重新加入
  useEffect(() => {
    if (view !== 'home') return
    joinedTableRef.current = null
    inflightRef.current = null
    setSelf(null)
    setSyncState('reconnecting')
  }, [view])

  const available = !!self && syncState !== 'offline'
  const selfMemberId = self?.memberId ?? null
  const selfNickname = self?.nickname ?? null

  const addItem = useCallback((item: CartItem) => {
    if (!available || !selfMemberId) {
      dispatch({ type: 'ADD_CART', item })
      return
    }
    // 「谁点了」可能选中同桌其他成员：按其昵称解析 memberId 归属，解析不到时归属本人
    const picked = membersRef.current.find((member) => member.nickname === item.orderedBy)
    const memberId = picked?.memberId ?? selfMemberId
    const orderedBy = picked?.nickname ?? selfNickname ?? item.orderedBy
    const effective: CartItem = { ...item, orderedBy, orderedByMemberId: memberId, ack: null }
    const existing = stateRef.current.cart.find((entry) =>
      entry.orderedByMemberId && entry.productId === effective.productId && entry.spec === effective.spec && entry.orderedBy === effective.orderedBy)
    dispatch(existing
      ? { type: 'CHANGE_QTY', uid: existing.uid, delta: 1 }
      : { type: 'ADD_CART', item: effective })
    void (async () => {
      try {
        const response = existing
          ? await collabApi.changeQuantity(table!, existing.uid, memberId, 1)
          : await collabApi.addCartItem(table!, memberId, {
            uid: effective.uid,
            productId: effective.productId,
            name: effective.name,
            price: effective.price,
            quantity: effective.quantity,
            image: effective.image,
            spec: effective.spec,
          })
        applySnapshot(response.session)
        setSyncState('connected')
      } catch (error) {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        // 校验类失败：回滚本地乐观写入
        dispatch({ type: 'CHANGE_QTY', uid: existing ? existing.uid : effective.uid, delta: -1 })
        reportFailure(error)
      }
    })()
  }, [available, selfMemberId, selfNickname, dispatch, table, applySnapshot, reportFailure])

  const changeQuantity = useCallback((itemUid: string, delta: number) => {
    const item = stateRef.current.cart.find((entry) => entry.uid === itemUid)
    dispatch({ type: 'CHANGE_QTY', uid: itemUid, delta })
    if (!available || !selfMemberId || !item?.orderedByMemberId) return
    const memberId = selfMemberId
    void (async () => {
      try {
        const response = delta < 0 && item.quantity <= 1
          ? await collabApi.removeCartItem(table!, itemUid, memberId)
          : await collabApi.changeQuantity(table!, itemUid, memberId, delta)
        applySnapshot(response.session)
      } catch (error) {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      }
    })()
  }, [available, selfMemberId, dispatch, table, applySnapshot, reportFailure])

  const acknowledge = useCallback((itemUid: string) => {
    if (!available || !selfMemberId || !selfNickname) return
    dispatch({ type: 'ACK_CART_ITEM', uid: itemUid, ack: { byMemberId: selfMemberId, byName: selfNickname, at: new Date().toISOString() } })
    const memberId = selfMemberId
    void collabApi.ackCartItem(table!, itemUid, memberId)
      .then((response) => applySnapshot(response.session))
      .catch((error) => {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      })
  }, [available, selfMemberId, selfNickname, dispatch, table, applySnapshot, reportFailure])

  const submitOrder = useCallback(() => {
    const pending = stateRef.current.cart
    dispatch({ type: 'SUBMIT_ORDER' })
    if (!available || !selfMemberId || !pending.length) {
      idempotencyKeyRef.current = null
      return
    }
    const key = idempotencyKeyRef.current ?? uid()
    idempotencyKeyRef.current = key
    void collabApi.submitOrder(table!, selfMemberId, key)
      .then((response) => {
        idempotencyKeyRef.current = null
        applySnapshot(response.session)
      })
      .catch((error) => {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      })
  }, [available, selfMemberId, dispatch, table, applySnapshot, reportFailure])

  const cancelOrderItem = useCallback((itemUid: string) => {
    dispatch({ type: 'REQUEST_CANCEL', uid: itemUid })
    if (!available || !selfMemberId) return
    void collabApi.cancelOrderItem(table!, itemUid, selfMemberId)
      .then((response) => applySnapshot(response.session))
      .catch((error) => {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      })
  }, [available, selfMemberId, dispatch, table, applySnapshot, reportFailure])

  const setStage = useCallback((stage: OrderStage) => {
    dispatch({ type: 'SET_STAGE', stage })
    if (!available || !selfMemberId) return
    void collabApi.setStage(table!, selfMemberId, stage)
      .then((response) => applySnapshot(response.session))
      .catch((error) => {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      })
  }, [available, selfMemberId, dispatch, table, applySnapshot, reportFailure])

  const pay = useCallback(() => {
    dispatch({ type: 'PAY' })
    if (!available || !selfMemberId) return
    void collabApi.pay(table!, selfMemberId)
      .then((response) => applySnapshot(response.session))
      .catch((error) => {
        if ((error as CollabError)?.kind === 'unavailable') setSyncState('offline')
        reportFailure(error)
      })
  }, [available, selfMemberId, dispatch, table, applySnapshot, reportFailure])

  const refresh = useCallback(() => {
    streamRef.current?.refresh()
  }, [])

  return {
    syncState,
    available,
    selfMemberId,
    selfNickname,
    addItem,
    changeQuantity,
    acknowledge,
    submitOrder,
    cancelOrderItem,
    setStage,
    pay,
    refresh,
  }
}
