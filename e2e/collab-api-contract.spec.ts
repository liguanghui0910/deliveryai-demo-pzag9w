import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

/**
 * 同桌协同接口契约（技术 Spec 2.4 接口清单 API-001～API-012 + 2.2 字段校验表 + 错误码清单）。
 * 说明：前端与后端为同仓库内部契约，测试经 Vite `/api` 代理访问同一服务（技术 Spec 2.9 配置）。
 * 本文件使用桌台码 C06，且只创建/断言自己写入的数据（按 uid / memberId 限定）；
 * 本地复用已运行的 dev server 时，服务端内存态可能残留上一轮数据，此时需重启 dev server 后重跑。
 */
interface SessionSnapshot {
  rev: number
  members: Array<{ memberId: string; nickname: string }>
  cart: Array<{
    uid: string
    productId: string
    quantity: number
    orderedBy: string
    ack?: { byMemberId: string; byName: string; at: string } | null
  }>
  order: { items: Array<{ uid: string }>; stage: string; paid: boolean }
}

const TABLE = 'C06'
const base = (table: string) => `/api/v1/tables/${table}`

async function joinMember(request: APIRequestContext, nickname: string, clientMemberId: string) {
  const res = await request.post(`${base(TABLE)}/members`, { data: { nickname, clientMemberId } })
  await expectOk(res)
  return (await res.json()) as { member: { memberId: string; nickname: string }; session: SessionSnapshot }
}

async function session(request: APIRequestContext) {
  const res = await request.get(`${base(TABLE)}/session`)
  await expectOk(res)
  return (await res.json()) as SessionSnapshot
}

async function expectOk(res: APIResponse) {
  expect(res.status(), `期望 2xx，实际 ${res.status()}：${await res.text()}`).toBeLessThan(300)
}

async function expectError(res: APIResponse, status: number, code: string) {
  expect(res.status()).toBe(status)
  const body = (await res.json()) as { code?: string; message?: string; retryable?: boolean }
  expect(body.code).toBe(code)
  expect(typeof body.retryable).toBe('boolean')
}

test.describe('同桌协同 - 接口契约与幂等（REQ-001/002/003/005/006）', () => {
  test('API-012: /ping 与 /api/v1/health 探活可用', async ({ request }) => {
    const ping = await request.get('/ping')
    await expectOk(ping)
    expect((await ping.json()) as { message: string }).toMatchObject({ message: 'pong' })

    const health = await request.get('/api/v1/health')
    await expectOk(health)
    expect((await health.json()) as { status: string }).toMatchObject({ status: 'ok' })
  })

  test('REQ-001.3: 非法桌台码、空昵称与超长昵称返回校验类错误码', async ({ request }) => {
    const invalidTable = await request.post('/api/v1/tables/Z99/members', {
      data: { nickname: '阿光', clientMemberId: 'e2e-invalid-table' },
    })
    await expectError(invalidTable, 400, 'INVALID_TABLE')

    const blankNickname = await request.post(`${base(TABLE)}/members`, {
      data: { nickname: '   ', clientMemberId: 'e2e-blank-nickname' },
    })
    await expectError(blankNickname, 400, 'INVALID_NICKNAME')

    const tooLongNickname = await request.post(`${base(TABLE)}/members`, {
      data: { nickname: '一二三四五六七八九十十一十二十三', clientMemberId: 'e2e-long-nickname' },
    })
    await expectError(tooLongNickname, 400, 'INVALID_NICKNAME')
  })

  test('REQ-001.5/STATE-005: 相同 clientMemberId 重复加入保持幂等', async ({ request }) => {
    const first = await joinMember(request, '契约成员A', 'e2e-contract-a')
    const second = await joinMember(request, '契约成员A', 'e2e-contract-a')

    expect(second.member.memberId).toBe(first.member.memberId)
    expect(second.session.members.filter((member) => member.memberId === first.member.memberId)).toHaveLength(1)
  })

  test('REQ-002.2: 同一 uid 重复加菜保持幂等，不重复计数', async ({ request }) => {
    const { member } = await joinMember(request, '契约成员A', 'e2e-contract-a')
    const item = {
      uid: 'e2e-uid-idempotent-1',
      productId: 'p9',
      name: '手工宽粉',
      price: 16,
      quantity: 1,
      image: '',
      spec: '整份',
    }
    const payload = { memberId: member.memberId, item }

    const first = await request.post(`${base(TABLE)}/cart/items`, { data: payload })
    await expectOk(first)
    const second = await request.post(`${base(TABLE)}/cart/items`, { data: payload })
    await expectOk(second)

    const snap = await session(request)
    expect(snap.cart.filter((entry) => entry.uid === item.uid)).toHaveLength(1)
  })

  test('REQ-001.3/OQ-006: 数量与价格越界返回校验类错误码', async ({ request }) => {
    const { member } = await joinMember(request, '契约成员A', 'e2e-contract-a')
    const invalidQuantity = await request.post(`${base(TABLE)}/cart/items`, {
      data: {
        memberId: member.memberId,
        item: { uid: 'e2e-uid-bad-qty', productId: 'p9', name: '手工宽粉', price: 16, quantity: 21, image: '', spec: '整份' },
      },
    })
    await expectError(invalidQuantity, 400, 'INVALID_QUANTITY')

    const invalidPrice = await request.post(`${base(TABLE)}/cart/items`, {
      data: {
        memberId: member.memberId,
        item: { uid: 'e2e-uid-bad-price', productId: 'p9', name: '手工宽粉', price: -1, quantity: 1, image: '', spec: '整份' },
      },
    })
    await expectError(invalidPrice, 400, 'INVALID_PRICE')
  })

  test('REQ-005.2: 非归属成员修改或删除他人条目被拒绝', async ({ request }) => {
    const { member: owner } = await joinMember(request, '契约成员A', 'e2e-contract-a')
    const { member: other } = await joinMember(request, '契约成员B', 'e2e-contract-b')
    const uid = 'e2e-uid-idempotent-1'

    const patch = await request.patch(`${base(TABLE)}/cart/items/${uid}`, {
      data: { memberId: other.memberId, delta: 1 },
    })
    await expectError(patch, 403, 'NOT_ITEM_OWNER')

    const remove = await request.delete(`${base(TABLE)}/cart/items/${uid}?memberId=${other.memberId}`)
    await expectError(remove, 403, 'NOT_ITEM_OWNER')

    // 归属校验的鉴权顺序：未知成员优先返回 403 UNKNOWN_MEMBER
    const unknown = await request.patch(`${base(TABLE)}/cart/items/${uid}`, {
      data: { memberId: 'm-not-exists', delta: 1 },
    })
    await expectError(unknown, 403, 'UNKNOWN_MEMBER')

    const snap = await session(request)
    expect(snap.cart.some((entry) => entry.uid === uid)).toBe(true)
    expect(owner.memberId).not.toBe(other.memberId)
  })

  test('REQ-003.4/003.5: 本人确认被拒绝、他人重复确认幂等', async ({ request }) => {
    const { member: owner } = await joinMember(request, '契约成员A', 'e2e-contract-a')
    const { member: other } = await joinMember(request, '契约成员B', 'e2e-contract-b')
    const uid = 'e2e-uid-idempotent-1'

    const selfAck = await request.post(`${base(TABLE)}/cart/items/${uid}/ack`, { data: { memberId: owner.memberId } })
    await expectError(selfAck, 400, 'SELF_ACK_NOT_ALLOWED')

    const ack = await request.post(`${base(TABLE)}/cart/items/${uid}/ack`, { data: { memberId: other.memberId } })
    await expectOk(ack)
    const afterFirst = ((await ack.json()) as { session: SessionSnapshot }).session
    const firstAck = afterFirst.cart.find((entry) => entry.uid === uid)?.ack
    expect(firstAck?.byName).toBe('契约成员B')

    const repeat = await request.post(`${base(TABLE)}/cart/items/${uid}/ack`, { data: { memberId: other.memberId } })
    await expectOk(repeat)
    const afterRepeat = ((await repeat.json()) as { session: SessionSnapshot }).session
    const repeatAck = afterRepeat.cart.find((entry) => entry.uid === uid)?.ack
    expect(repeatAck?.at).toBe(firstAck?.at)
    expect(repeatAck?.byMemberId).toBe(firstAck?.byMemberId)
  })

  test('REQ-006.1/006.4: 下单合并条目，空购物车下单被拒绝并返回 EMPTY_CART', async ({ request }) => {
    const { member } = await joinMember(request, '契约成员A', 'e2e-contract-a')

    const order = await request.post(`${base(TABLE)}/order`, {
      data: { memberId: member.memberId },
      headers: { 'Idempotency-Key': 'e2e-idem-order-1' },
    })
    await expectOk(order)
    const ordered = ((await order.json()) as { session: SessionSnapshot }).session
    expect(ordered.order.items.some((entry) => entry.uid === 'e2e-uid-idempotent-1')).toBe(true)
    expect(ordered.cart.some((entry) => entry.uid === 'e2e-uid-idempotent-1')).toBe(false)
    expect(ordered.order.items.filter((entry) => entry.uid === 'e2e-uid-idempotent-1')).toHaveLength(1)

    const emptyOrder = await request.post(`${base(TABLE)}/order`, { data: { memberId: member.memberId } })
    await expectError(emptyOrder, 400, 'EMPTY_CART')
  })
})
