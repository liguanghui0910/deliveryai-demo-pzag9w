import { expect, test } from '@playwright/test'
import {
  COLLAB_SYNC_SLA_MS,
  DISH,
  MEMBER,
  TABLES,
  addDish,
  cartPanel,
  enterMenu,
  expectCollabUnavailable,
  expectRetryEntry,
  expectSameCartTotal,
} from './helpers/collab'

/**
 * REQ-002 同桌共享购物车与成员加菜（技术 Spec 2.5-3、FIELD-006 幂等键、REQ-002.4 失败反馈）。
 * 桌台码 B12；文件内首个用例依赖「该桌台购物车尚未加入菜品」以验证空态（见 helpers/collab.ts 说明）。
 */
test.describe('同桌协同 - 共享购物车与加菜（REQ-002）', () => {
  test('REQ-006.4: 购物车为空时展示空态且不提供提交入口', async ({ page }) => {
    await page.goto('/')
    await enterMenu(page, TABLES.booth, MEMBER.a)

    await expect(page.getByText(/这一锅，还差点心动|Your pot needs a little more love/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /确认并提交订单|Confirm & Submit Order/ })).toHaveCount(0)
  })

  test('REQ-002.1/002.2: 两名成员分别加菜后两端共享购物车一致', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.booth, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.booth, MEMBER.b)

      await addDish(pageA, { diner: MEMBER.a })
      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })

      await addDish(pageB, { category: /牛羊肉|Beef & Lamb/, diner: MEMBER.b })
      await expect(cartPanel(pageA).getByText(DISH.beef).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })

      // 各端所见共享购物车一致（不出现条目丢失、重复计数或金额不一致）
      await expectSameCartTotal(pageA, pageB)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-002.1/002.3: 条目标注下单人昵称且他端可见', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.booth, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.booth, MEMBER.b)

      await addDish(pageA, { category: /海鲜河鲜|Seafood/, diner: MEMBER.a })

      await expect(cartPanel(pageB).getByText(new RegExp(`${MEMBER.a} 点了`)).first()).toBeVisible({
        timeout: COLLAB_SYNC_SLA_MS,
      })
      await expect(cartPanel(pageB).getByText(DISH.shrimp).first()).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-002.4: 加菜写入失败时给出可感知反馈与重试入口', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/')
    await enterMenu(page, TABLES.booth, MEMBER.a)

    // 后端不可达时不依赖共享成员列表，直接使用默认「谁点了」加菜
    await addDish(page)

    await expectCollabUnavailable(page)
    await expectRetryEntry(page)
  })
})
