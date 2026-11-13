import { expect, test } from '@playwright/test'
import {
  TABLES,
  addDish,
  cartPanel,
  enterMenu,
  expectCollabUnavailable,
  expectRetryEntry,
  openCategory,
  openProductSpec,
} from './helpers/collab'

/**
 * REQ-008.5 后端服务不可用时的降级（技术 Spec 2.5-10、TD-6）。
 * 用 Playwright 路由拦截 `/api/**` 全部请求并 abort，模拟后端不可达（对应技术 Spec 第 6 章测试要点）。
 * 桌台码 A08；断言既有主链路（菜单/加菜/下单/结账/超级辣提示）单机可用，且协同能力明确标注不可用。
 */
test.describe('同桌协同 - 后端不可用降级与既有能力保护（REQ-008）', () => {
  test('REQ-008.5: 后端不可达时仍可完成加菜、下单与结账，协同能力标注不可用并可重试', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/')
    await enterMenu(page, TABLES.hall)

    await expectCollabUnavailable(page)
    await expectRetryEntry(page)

    await addDish(page)
    await expect(cartPanel(page).getByText(/^\s*¥[\d.,]+\s*$/).first()).toBeVisible()

    await cartPanel(page).getByRole('button', { name: /确认并提交订单|Confirm & Submit Order/ }).click()
    await expect(page).toHaveURL(/#\/order$/)

    await page.getByRole('button', { name: /去结账|Checkout/ }).click()
    await page.getByRole('button', { name: /确认支付|Confirm Payment/ }).click()
    await expect(page.getByText(/付款完成|Payment Complete/).first()).toBeVisible()
  })

  test('REQ-008.2: 后端不可达时超级辣风险提示与既有下单路径保持可用', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort())
    await page.goto('/')
    await enterMenu(page, TABLES.hall)

    await openCategory(page, /锅底|Broth/)
    await openProductSpec(page, 0)
    await page.getByRole('button', { name: '超级辣' }).click()
    await expect(page.getByText('风险提示')).toBeVisible()
    await page.getByRole('button', { name: '我已了解，继续下单' }).click()
    await expect(page.getByRole('button', { name: '超级辣' })).toHaveClass(/border-chili-500/)

    await page.getByRole('button', { name: '加入本桌购物车' }).click()
    await expect(cartPanel(page).getByText('超级辣').first()).toBeVisible()
  })
})
