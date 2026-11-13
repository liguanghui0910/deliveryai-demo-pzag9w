import type { Member, OrderStage, SessionSnapshot, SharedCartItem } from '@/types'

// 接口基址：同源部署时 VITE_API_BASE 留空，请求相对路径 /api/v1/...。
// 开发态由 vite.config.ts 的 /api 代理指向本地协同服务。
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')
const REQUEST_TIMEOUT_MS = 8000

/** 错误归类：校验类（用户可纠正）与不可用类（服务/网络不可用，可重试）。 */
export type CollabErrorKind = 'validation' | 'unavailable'

export class CollabError extends Error {
  readonly kind: CollabErrorKind
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(kind: CollabErrorKind, code: string, message: string, status = 0, retryable = false) {
    super(message)
    this.name = 'CollabError'
    this.kind = kind
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const isValidationStatus = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { code?: string; message?: string; retryable?: boolean } | null
      // 只有携带契约错误码的响应才是「校验类」；非契约响应（如静态/代理返回的 404 页面）视为服务不可用
      const contractCode = payload && typeof payload.code === 'string' ? payload.code : null
      const message = payload?.message ?? response.statusText
      if (contractCode && isValidationStatus(response.status)) {
        throw new CollabError('validation', contractCode, message, response.status, false)
      }
      throw new CollabError('unavailable', contractCode ?? `HTTP_${response.status}`, message, response.status, payload?.retryable ?? true)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof CollabError) throw error
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    throw new CollabError(
      'unavailable',
      aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      aborted ? 'request timeout' : (error as Error).message,
      0,
      true,
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/** 协同接口封装（技术 Spec 2.4 的内部契约）。 */
export const collabApi = {
  baseUrl: () => API_BASE,
  health: () => request<{ status: string; rev?: number; uptime: number }>('/api/v1/health'),
  join: (tableCode: string, nickname: string, clientMemberId: string) =>
    request<{ member: Member; session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/members`, {
      method: 'POST',
      body: { nickname, clientMemberId },
    }),
  session: (tableCode: string, memberId: string) =>
    request<SessionSnapshot>(`/api/v1/tables/${encodeURIComponent(tableCode)}/session?memberId=${encodeURIComponent(memberId)}`),
  addCartItem: (tableCode: string, memberId: string, item: Pick<SharedCartItem, 'uid' | 'productId' | 'name' | 'price' | 'quantity' | 'image' | 'spec'>) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/cart/items`, {
      method: 'POST',
      body: { memberId, item },
    }),
  changeQuantity: (tableCode: string, uid: string, memberId: string, delta: number) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/cart/items/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body: { memberId, delta },
    }),
  removeCartItem: (tableCode: string, uid: string, memberId: string) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/cart/items/${encodeURIComponent(uid)}?memberId=${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),
  ackCartItem: (tableCode: string, uid: string, memberId: string) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/cart/items/${encodeURIComponent(uid)}/ack`, {
      method: 'POST',
      body: { memberId },
    }),
  submitOrder: (tableCode: string, memberId: string, idempotencyKey: string) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/order`, {
      method: 'POST',
      body: { memberId },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  cancelOrderItem: (tableCode: string, uid: string, memberId: string) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/order/items/${encodeURIComponent(uid)}/cancel`, {
      method: 'POST',
      body: { memberId },
    }),
  setStage: (tableCode: string, memberId: string, stage: OrderStage) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/order/stage`, {
      method: 'PATCH',
      body: { memberId, stage },
    }),
  /**
   * 演示会话重置：清空该桌台的共享购物车与订单，便于演示干净重跑。
   * 后端暂未提供该端点时请求失败，调用方静默忽略并保持既有本地重置行为。
   */
  resetSession: (tableCode: string) =>
    request<{ session?: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/reset`, { method: 'POST' }),
  pay: (tableCode: string, memberId: string) =>
    request<{ session: SessionSnapshot }>(`/api/v1/tables/${encodeURIComponent(tableCode)}/order/pay`, {
      method: 'POST',
      body: { memberId },
    }),
}

export const collabStreamUrl = (tableCode: string, memberId: string) =>
  `${API_BASE}/api/v1/tables/${encodeURIComponent(tableCode)}/events?memberId=${encodeURIComponent(memberId)}`
