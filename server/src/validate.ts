// 参数校验与错误码构造（技术 Spec 第 2.2 节字段校验表）。
// 服务端不重算价格、不校验售罄：加菜由前端沿用既有规则计算后提交，服务端只做结构与范围校验。

import {
  ApiError,
  MAX_NAME_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_PRICE,
  MAX_QUANTITY,
  MAX_SPEC_LENGTH,
  MIN_QUANTITY,
  ORDER_STAGES,
  TABLE_CODES,
  type OrderStage,
} from './types.js'

const isPlainString = (value: unknown): value is string => typeof value === 'string'

/** 按码点计数，避免把中文/emoji 误算为超长。 */
const codePointLength = (value: string): number => Array.from(value).length

export function parseTableCode(raw: unknown): string {
  if (!isPlainString(raw) || !TABLE_CODES.includes(raw)) {
    throw new ApiError('INVALID_TABLE', `未知桌台码：${String(raw)}`)
  }
  return raw
}

export function parseNickname(raw: unknown): string {
  if (!isPlainString(raw)) {
    throw new ApiError('INVALID_NICKNAME', '昵称必须是字符串')
  }
  const nickname = raw.trim()
  const length = codePointLength(nickname)
  if (length < 1 || length > MAX_NICKNAME_LENGTH) {
    throw new ApiError('INVALID_NICKNAME', `昵称长度必须为 1-${MAX_NICKNAME_LENGTH} 个字符`)
  }
  // 禁止换行与控制字符（含 U+0000-U+001F、U+007F）；用码点判断，避免正则字面量控制字符。
  const hasControlChar = [...nickname].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })
  if (hasControlChar) {
    throw new ApiError('INVALID_NICKNAME', '昵称不能包含换行或控制字符')
  }
  return nickname
}

export function parseClientMemberId(raw: unknown): string {
  if (!isPlainString(raw) || !raw.trim()) {
    throw new ApiError('UNKNOWN_MEMBER', '缺少 clientMemberId')
  }
  return raw.trim()
}

export function parseMemberId(raw: unknown): string {
  if (!isPlainString(raw) || !raw.trim()) {
    throw new ApiError('UNKNOWN_MEMBER', '缺少 memberId')
  }
  return raw.trim()
}

/** 路径参数中的条目 uid。 */
export function parseUid(raw: unknown): string {
  if (!isPlainString(raw) || !raw.trim()) {
    throw new ApiError('ITEM_NOT_FOUND', '缺少条目 uid')
  }
  return raw.trim()
}

export function parseQuantity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < MIN_QUANTITY || raw > MAX_QUANTITY) {
    throw new ApiError('INVALID_QUANTITY', `数量必须是 ${MIN_QUANTITY}-${MAX_QUANTITY} 的整数`)
  }
  return raw
}

export function parseDelta(raw: unknown): 1 | -1 {
  if (raw !== 1 && raw !== -1) {
    throw new ApiError('INVALID_QUANTITY', 'delta 只能是 1 或 -1')
  }
  return raw
}

export function parseStage(raw: unknown): OrderStage {
  if (!isPlainString(raw) || !ORDER_STAGES.includes(raw as OrderStage)) {
    throw new ApiError('INVALID_STAGE', `未知履约阶段：${String(raw)}`)
  }
  return raw as OrderStage
}

const requireBoundedString = (raw: unknown, max: number, label: string): string => {
  if (!isPlainString(raw) || !raw.trim()) {
    throw new ApiError('INVALID_ITEM', `${label} 不能为空`)
  }
  if (codePointLength(raw) > max) {
    throw new ApiError('INVALID_ITEM', `${label} 长度不能超过 ${max}`)
  }
  return raw
}

export interface CartItemInput {
  uid: string
  productId: string
  name: string
  price: number
  quantity: number
  image: string
  spec: string
}

/** 校验并归一化「加菜」请求体中的 item 字段。 */
export function parseCartItemInput(raw: unknown): CartItemInput {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('INVALID_ITEM', '缺少 item 字段')
  }
  const source = raw as Record<string, unknown>
  const uid = requireBoundedString(source.uid, 80, 'uid')
  const productId = requireBoundedString(source.productId, 80, 'productId')
  const name = requireBoundedString(source.name, MAX_NAME_LENGTH, 'name')
  const spec = requireBoundedString(source.spec, MAX_SPEC_LENGTH, 'spec')
  const price = source.price
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    throw new ApiError('INVALID_PRICE', `price 必须是 0-${MAX_PRICE} 的有限数`)
  }
  const quantity = parseQuantity(source.quantity)
  if (!isPlainString(source.image)) {
    throw new ApiError('INVALID_ITEM', 'image 必须是字符串')
  }
  return { uid, productId, name, price, quantity, image: source.image, spec }
}

/** 从 body / query 中读取可选字符串。 */
export function readOptionalString(value: unknown): string | undefined {
  return isPlainString(value) && value.trim() ? value.trim() : undefined
}
