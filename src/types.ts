export type OrderStage = 'submitted' | 'accepted' | 'cooking' | 'served'
export type ViewName = 'home' | 'welcome' | 'menu' | 'order' | 'checkout' | 'showcase'

/** 协同同步状态机（仅前端，不落库）。 */
export type SyncState = 'connected' | 'reconnecting' | 'offline'

export interface Product {
  id: string
  name: string
  description: string
  category: string
  price: number
  image: string
  badge?: string
  orderedCount?: number
  options?: {
    portion?: string[]
    flavor?: string[]
    spicy?: string[]
  }
}

/** 条目确认知悉信息；null 表示尚待确认知悉。 */
export interface AckInfo {
  byMemberId: string
  byName: string
  at: string
}

/** 同桌成员（与服务端模型一致）。 */
export interface Member {
  memberId: string
  clientMemberId: string
  nickname: string
  joinedAt: string
}

export interface CartItem {
  uid: string
  productId: string
  name: string
  price: number
  quantity: number
  image: string
  spec: string
  /** 展示用下单人昵称（既有语义）。 */
  orderedBy: string
  /** 协同：添加者 memberId，用于跨端条目权限判断；本地单机条目为空。 */
  orderedByMemberId?: string
  /** 协同：确认知悉信息；null/undefined 表示待确认知悉。 */
  ack?: AckInfo | null
}

export interface OrderItem extends CartItem {
  stage: OrderStage
  cancelState?: 'requested' | 'approved'
}

export interface ServiceRequest {
  id: string
  type: string
  createdAt: string
  status: 'waiting' | 'responded'
}

// —— 协同接口模型：字段与服务端契约一致，前端只消费快照 ——

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
  /** 冗余昵称，用于快照展示。 */
  orderedByName: string
  ack: AckInfo | null
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

export interface SessionSnapshot {
  tableCode: string
  rev: number
  members: Member[]
  cart: SharedCartItem[]
  order: SharedOrder
  updatedAt: string
}

export interface AppState {
  view: ViewName
  table: string | null
  diners: string[]
  cart: CartItem[]
  orderItems: OrderItem[]
  orderStage: OrderStage
  soldOut: string[]
  services: ServiceRequest[]
  paid: boolean
  lastMessage: string
}

export type AppAction =
  | { type: 'BIND_TABLE'; table: string }
  | { type: 'SET_VIEW'; view: ViewName }
  | { type: 'ADD_CART'; item: CartItem }
  | { type: 'CHANGE_QTY'; uid: string; delta: number }
  | { type: 'SUBMIT_ORDER' }
  | { type: 'SET_STAGE'; stage: OrderStage }
  | { type: 'TOGGLE_SOLD_OUT'; productId: string }
  | { type: 'CALL_SERVICE'; service: string }
  | { type: 'RESPOND_SERVICES' }
  | { type: 'REQUEST_CANCEL'; uid: string }
  | { type: 'PAY' }
  | { type: 'RESET' }
  | { type: 'SET_MESSAGE'; message: string }
  | { type: 'SET_MEMBERS'; diners: string[] }
  | { type: 'ACK_CART_ITEM'; uid: string; ack: AckInfo }
  | { type: 'HYDRATE_SHARED'; cart: CartItem[]; orderItems: OrderItem[]; orderStage: OrderStage; paid: boolean; members?: Member[] }
