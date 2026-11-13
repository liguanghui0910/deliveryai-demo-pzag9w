import { expect, test } from '@playwright/test'
import {
  COLLAB_SYNC_SLA_MS,
  DISH,
  MEMBER,
  TABLES,
  ackAllPendingItems,
  addDish,
  cartPanel,
  enterMenu,
} from './helpers/collab'

/**
 * REQ-003 加菜确认知悉（知悉式、非阻塞，技术 Spec 2.6 STATE-001、API-007）。
 * 桌台码 D03；文件内用例按声明顺序执行（先构造状态、最后验证「未确认不阻塞下单」）。
 */
test.describe('同桌协同 - 确认知悉（REQ-003）', () => {
  test('REQ-003.1: 加菜后条目标记为待确认知悉并对同桌其他成员可见', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      await addDish(pageA, { diner: MEMBER.a })

      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await expect(cartPanel(pageB).getByText(/待确认知悉/).first()).toBeVisible()
      await expect(cartPanel(pageB).getByRole('button', { name: /确认知悉/ }).first()).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-003.2: 其他成员确认知悉后展示确认人昵称', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      await addDish(pageA, { category: /牛羊肉|Beef & Lamb/, diner: MEMBER.a })
      const ackButton = cartPanel(pageB).getByRole('button', { name: /确认知悉/ }).first()
      await expect(ackButton).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await ackButton.click()

      await expect(cartPanel(pageA).getByText(/已确认知悉/).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await expect(cartPanel(pageA).getByText(MEMBER.b).first()).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-003.4: 加菜人本人无法把自己的条目标记为有效确认', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      await addDish(pageA, { category: /海鲜河鲜|Seafood/, diner: MEMBER.a })

      const ownRow = cartPanel(pageA).locator('div').filter({ hasText: DISH.shrimp }).last()
      await expect(ownRow.getByRole('button', { name: /确认知悉/ })).toHaveCount(0)
      await expect(cartPanel(pageA).getByText(/待确认知悉/).first()).toBeVisible()
      // 同桌其他成员仍可见并确认该条目
      await expect(cartPanel(pageB).getByRole('button', { name: /确认知悉/ }).first()).toBeVisible({
        timeout: COLLAB_SYNC_SLA_MS,
      })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-003.5: 同一成员重复确认保持幂等，不产生重复确认记录', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      await addDish(pageA, { diner: MEMBER.a })
      const ownRow = cartPanel(pageB).locator('div').filter({ hasText: DISH.tomatoPot }).last()
      const ackButton = ownRow.getByRole('button', { name: /确认知悉/ }).first()
      await expect(ackButton).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await ackButton.click()

      await expect(ownRow.getByText(/已确认知悉/).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await expect.poll(() => ownRow.getByText(/已确认知悉/).count(), { timeout: COLLAB_SYNC_SLA_MS }).toBe(1)
      await expect(ownRow.getByRole('button', { name: /确认知悉/ })).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-003.6: 全部条目被同桌其他成员确认后呈现全部已确认知悉', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      expect(await ackAllPendingItems(pageB)).toBe(0)
      expect(await ackAllPendingItems(pageA)).toBe(0)

      await expect(cartPanel(pageA).getByText(/全部已确认知悉/).first()).toBeVisible()
      await expect(cartPanel(pageB).getByText(/全部已确认知悉/).first()).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-003.3: 存在待确认知悉条目时不阻塞下单', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.window, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.window, MEMBER.b)

      await addDish(pageA, { category: /主食饮品|Staples & Drinks/, diner: MEMBER.a })
      await expect(cartPanel(pageB).getByText(/待确认知悉/).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })

      await cartPanel(pageB).getByRole('button', { name: /确认并提交订单|Confirm & Submit Order/ }).click()

      await expect(pageB).toHaveURL(/#\/order$/)
      await expect(pageB.getByRole('heading', { name: /这一锅，正在抵达|Your pot is on the way/ })).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
