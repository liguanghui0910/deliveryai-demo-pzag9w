// 协同会话的服务端模型与错误码载体（技术 Spec 第 2.2 节 / 第 2.4 节）。
// 契约来源：artifacts/技术Spec设计/技术Spec/spec.md（design-demo-space-collab-ordering）。

export type OrderStage = 'submitted' | 'accepted' | 'cooking' | 'served'

/** 桌台白名单（与前端 src/data/menu.ts 的 tableAreas 保持一致）。 */
export const TABLE_CODES: readonly string[] = ['A08', 'B12', 'C06', 'D03']

/** 订单履约阶段枚举（与前端 OrderStage 完全一致）。 */
export const ORDER_STAGES: readonly OrderStage[] = ['submitted', 'accepted', 'cooking', 'served']

/** 条目数量约束。 */
export const MIN_QUANTITY = 1
export const MAX_QUANTITY = 20
/** 条目金额上限（可信客户端，仅做范围校验）。 */
export const MAX_PRICE = 10000
export const MAX_NICKNAME_LENGTH = 12
export const MAX_NAME_LENGTH = 40
export const MAX_SPEC_LENGTH = 120

export interface Ack {
  byMemberId: string
  byName: string
  at: string
}

export interface Member {
  memberId: string
  clientMemberId: string
  nickname: string
  joinedAt: string
}

export interface SharedCartItem {
  uid: string
  productId: string
  name: string
  price: number
  quantity: number
  image: string
  spec: string
  /** 下单成员的 memberId。 */
  orderedBy: string
  /** 冗余昵称，快照展示用。 */
  orderedByName: string
  /** null 表示待确认知悉。 */
  ack: Ack | null
}

export interface SharedOrderItem extends SharedCartItem {
  stage: OrderStage
  cancelState?: 'requested' | 'approved'
}

export interface SharedOrder {
  items: SharedOrderItem[]
  stage: OrderStage
  paid: boolean
  submittedAt: string | null
}

export interface TableSession {
  tableCode: string
  /** 单调递增版本号：任一共享状态变更 +1。 */
  rev: number
  members: Member[]
  cart: SharedCartItem[]
  order: SharedOrder
  updatedAt: string
  /** 已处理的 Idempotency-Key（下单幂等）。 */
  processedOrderKeys: string[]
}

/** 对外快照（不含服务端内部簿记字段）。 */
export interface SessionSnapshot {
  tableCode: string
  rev: number
  members: Member[]
  cart: SharedCartItem[]
  order: SharedOrder
  updatedAt: string
}

export type ErrorCode =
  | 'INVALID_TABLE'
  | 'INVALID_NICKNAME'
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'INVALID_ITEM'
  | 'INVALID_STAGE'
  | 'UNKNOWN_MEMBER'
  | 'NOT_ITEM_OWNER'
  | 'SELF_ACK_NOT_ALLOWED'
  | 'EMPTY_CART'
  | 'ITEM_NOT_FOUND'
  | 'ORDER_ALREADY_PAID'
  | 'INTERNAL'
  // 以下为契约之外的补充错误码：仅用于技术 Spec 未定义的场景（未定义的 API 路径、请求体解析失败）。
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'

/** 错误码 → HTTP 状态码。 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_TABLE: 400,
  INVALID_NICKNAME: 400,
  INVALID_QUANTITY: 400,
  INVALID_PRICE: 400,
  INVALID_ITEM: 400,
  INVALID_STAGE: 400,
  SELF_ACK_NOT_ALLOWED: 400,
  EMPTY_CART: 400,
  UNKNOWN_MEMBER: 403,
  NOT_ITEM_OWNER: 403,
  ITEM_NOT_FOUND: 404,
  ORDER_ALREADY_PAID: 409,
  INTERNAL: 500,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
}

/** 业务错误：携带错误码与 HTTP 状态，由统一错误响应处理。 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.retryable = code === 'INTERNAL'
  }
}

export interface ErrorBody {
  code: ErrorCode
  message: string
  retryable: boolean
}

export function toErrorBody(code: ErrorCode, message: string): ErrorBody {
  return { code, message, retryable: code === 'INTERNAL' }
}
