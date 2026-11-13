import { expect, test } from '@playwright/test'
import { COLLAB_SYNC_SLA_MS, DISH, MEMBER, TABLES, addDish, cartPanel, enterMenu } from './helpers/collab'

/**
 * REQ-005 同桌可见性与条目操作权限（技术 Spec 2.5-4、7.3；Spec 阶段产品决策：他人条目本端只读）。
 * 桌台码 B12，菜品使用「牛油麻辣锅」（该桌台其它 spec 未使用该菜品，便于按条目行精确断言）。
 * 服务端侧拒绝写操作（NOT_ITEM_OWNER / UNKNOWN_MEMBER）由 collab-api-contract.spec.ts 覆盖。
 */
test.describe('同桌协同 - 条目操作权限（REQ-005）', () => {
  function itemRow(page: import('@playwright/test').Page, dish: string, diner: string) {
    return cartPanel(page)
      .locator('div')
      .filter({ hasText: dish })
      .filter({ hasText: diner })
      .last()
  }

  test('REQ-005.2: 他人条目在本端只读并标注归属人', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.booth, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.booth, MEMBER.b)

      await addDish(pageA, { index: 1, diner: MEMBER.a })

      const otherRow = itemRow(pageB, DISH.spicyPot, MEMBER.a)
      await expect(otherRow).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await expect(otherRow.getByText(new RegExp(`${MEMBER.a} 点了`)).first()).toBeVisible()
      await expect(otherRow.getByRole('button', { name: /增加|减少|Increase|Decrease/ })).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-005.1/005.2: 本人条目在本端提供改数量入口（与他端只读形成对照）', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.booth, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.booth, MEMBER.b)

      await addDish(pageA, { index: 1, diner: MEMBER.a })

      const ownRow = itemRow(pageA, DISH.spicyPot, MEMBER.a)
      await expect(ownRow.getByRole('button', { name: /增加|Increase/ }).first()).toBeVisible()
      await expect(ownRow.getByRole('button', { name: /减少|Decrease/ }).first()).toBeVisible()
      await expect(itemRow(pageB, DISH.spicyPot, MEMBER.a).getByRole('button', { name: /增加|减少|Increase|Decrease/ })).toHaveCount(0, {
        timeout: COLLAB_SYNC_SLA_MS,
      })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
