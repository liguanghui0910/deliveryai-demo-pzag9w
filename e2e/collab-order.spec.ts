import { expect, test } from '@playwright/test'
import {
  COLLAB_SYNC_SLA_MS,
  DISH,
  MEMBER,
  TABLES,
  addDish,
  cartPanel,
  enterMenu,
  readOrderTotal,
} from './helpers/collab'

/**
 * REQ-006 协同条件下的下单、履约可见性与结账（技术 Spec 2.5-6/7/8、STATE-002/003）。
 * 桌台码 A08；菜品使用「牛油麻辣锅 / 鲜虾滑」（该桌台其它 spec 未使用这两个菜品，便于按菜品名断言）。
 * 用例按声明顺序执行：先下单，再推进履约阶段，最后结账。
 */
test.describe('同桌协同 - 下单、履约与结账（REQ-006）', () => {
  test('REQ-006.1/006.3: 任一成员下单后两端共享同一订单、合计一致且购物车移除已提交条目', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.hall, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.hall, MEMBER.b)

      await addDish(pageA, { index: 1, diner: MEMBER.a })
      await expect(cartPanel(pageB).getByText(DISH.spicyPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await addDish(pageB, { category: /海鲜河鲜|Seafood/, diner: MEMBER.b })
      await expect(cartPanel(pageA).getByText(DISH.shrimp).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })

      // 端 B 发起下单（任一成员均可）
      await cartPanel(pageB).getByRole('button', { name: /确认并提交订单|Confirm & Submit Order/ }).click()
      await expect(pageB).toHaveURL(/#\/order$/)

      // 各端清除已提交的购物车条目
      await expect.poll(() => cartPanel(pageA).getByText(DISH.spicyPot).count(), { timeout: COLLAB_SYNC_SLA_MS }).toBe(0)
      await expect.poll(() => cartPanel(pageA).getByText(DISH.shrimp).count(), { timeout: COLLAB_SYNC_SLA_MS }).toBe(0)

      // 端 A 进入订单视图：两端同一订单、同一合计
      await pageA.getByRole('button', { name: /订单|Orders/ }).first().click()
      await expect(pageA).toHaveURL(/#\/order$/)
      await expect(pageA.getByText(DISH.spicyPot).first()).toBeVisible()
      await expect(pageB.getByText(DISH.shrimp).first()).toBeVisible()
      expect(await readOrderTotal(pageA)).toBe(await readOrderTotal(pageB))
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-006.2: 门店侧推进履约阶段后各端一致更新', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.hall, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.hall, MEMBER.b)

      await pageB.getByRole('button', { name: /订单|Orders/ }).first().click()
      await expect(pageB).toHaveURL(/#\/order$/)

      await pageA.getByRole('button', { name: /演示控制台|Demo Console/ }).first().click()
      await pageA.getByRole('button', { name: /后厨接单|Accepted/ }).first().click()

      await expect(pageB.getByText(/后厨已接单/).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-006.5: 结账后各端一致呈现支付结果', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.hall, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.hall, MEMBER.b)

      await pageA.getByRole('button', { name: /订单|Orders/ }).first().click()
      await pageA.getByRole('button', { name: /去结账|Checkout/ }).click()
      await pageA.getByRole('button', { name: /确认支付|Confirm Payment/ }).click()

      await expect(pageA.getByText(/付款完成|Payment Complete/).first()).toBeVisible()

      await pageB.getByRole('button', { name: /订单|Orders/ }).first().click()
      await pageB.getByRole('button', { name: /去结账|Checkout/ }).click()
      await expect(pageB.getByText(/付款完成|Payment Complete/).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
