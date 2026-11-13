// /api/v1 协同接口族（技术 Spec 第 2.4 节 API-001～API-012）。
// 前后端同源单服务，请求/响应字段严格对齐技术 Spec。

import { Router, type Request, type Response } from 'express'
import type { SessionStore } from './store.js'
import type { SseHub } from './sse.js'
import { ApiError, toErrorBody } from './types.js'
import {
  parseCartItemInput,
  parseDelta,
  parseMemberId,
  parseNickname,
  parseClientMemberId,
  parseStage,
  parseTableCode,
  parseUid,
  readOptionalString,
} from './validate.js'

type Handler = (req: Request, res: Response) => void

/** 统一错误响应：{ code, message, retryable }。 */
const sendError = (res: Response, error: unknown): void => {
  if (error instanceof ApiError) {
    res.status(error.status).json(toErrorBody(error.code, error.message))
    return
  }
  console.error('[api] unexpected error:', error)
  res.status(500).json(toErrorBody('INTERNAL', '服务内部错误，请稍后重试'))
}

const guard =
  (handler: Handler): Handler =>
  (req, res) => {
    try {
      handler(req, res)
    } catch (error) {
      sendError(res, error)
    }
  }

export function createApiRouter(store: SessionStore, hub: SseHub): Router {
  const router = Router()

  // API-012
  router.get(
    '/health',
    guard((_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() })
    }),
  )

  // API-001
  router.post(
    '/tables/:tableCode/members',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const nickname = parseNickname(req.body?.nickname)
      const clientMemberId = parseClientMemberId(req.body?.clientMemberId)
      const { member, snapshot } = store.addMember(tableCode, nickname, clientMemberId)
      res.json({ member, session: snapshot })
    }),
  )

  // API-002
  router.get(
    '/tables/:tableCode/session',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      res.json(store.getSnapshot(tableCode))
    }),
  )

  // API-003
  router.get(
    '/tables/:tableCode/events',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      hub.open(req, res, tableCode, store)
    }),
  )

  // API-004
  router.post(
    '/tables/:tableCode/cart/items',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      const input = parseCartItemInput(req.body?.item)
      res.json({ session: store.addCartItem(tableCode, memberId, input) })
    }),
  )

  // API-005
  router.patch(
    '/tables/:tableCode/cart/items/:uid',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      const delta = parseDelta(req.body?.delta)
      res.json({
        session: store.changeCartItemQuantity(tableCode, memberId, parseUid(req.params.uid), delta),
      })
    }),
  )

  // API-006
  router.delete(
    '/tables/:tableCode/cart/items/:uid',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(readOptionalString(req.query.memberId))
      res.json({ session: store.removeCartItem(tableCode, memberId, parseUid(req.params.uid)) })
    }),
  )

  // API-007
  router.post(
    '/tables/:tableCode/cart/items/:uid/ack',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      res.json({ session: store.ackCartItem(tableCode, memberId, parseUid(req.params.uid)) })
    }),
  )

  // API-008
  router.post(
    '/tables/:tableCode/order',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      const idempotencyKey = readOptionalString(req.header('Idempotency-Key'))
      res.json({ session: store.submitOrder(tableCode, memberId, idempotencyKey) })
    }),
  )

  // API-009
  router.post(
    '/tables/:tableCode/order/items/:uid/cancel',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      res.json({ session: store.requestCancelOrderItem(tableCode, memberId, parseUid(req.params.uid)) })
    }),
  )

  // API-010
  router.patch(
    '/tables/:tableCode/order/stage',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      const stage = parseStage(req.body?.stage)
      res.json({ session: store.setOrderStage(tableCode, memberId, stage) })
    }),
  )

  // API-011
  router.post(
    '/tables/:tableCode/order/pay',
    guard((req, res) => {
      const tableCode = parseTableCode(req.params.tableCode)
      const memberId = parseMemberId(req.body?.memberId)
      res.json({ session: store.payOrder(tableCode, memberId) })
    }),
  )

  // 未定义的 /api/v1 路径：统一 JSON 404（契约之外的补充错误码 NOT_FOUND）。
  router.use((_req, res) => {
    res.status(404).json(toErrorBody('NOT_FOUND', '接口不存在'))
  })

  return router
}
