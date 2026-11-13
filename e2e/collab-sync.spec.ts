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
} from './helpers/collab'

/**
 * REQ-004 多端近实时同步（技术 Spec 2.5-2、2.7、TD-3，阈值 COLLAB_SYNC_SLA_MS = 2000ms）。
 * 桌台码 A08；同步机制为 SSE 推送 + 轮询兜底，用例只断言业务可见结果与时效，不断言实现细节。
 */
test.describe('同桌协同 - 多端近实时同步（REQ-004）', () => {
  test('REQ-004.1: 端 A 加菜后 2000ms 内端 B 无需刷新即可见', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      await pageA.goto('/')
      await enterMenu(pageA, TABLES.hall, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.hall, MEMBER.b)

      await addDish(pageA, { diner: MEMBER.a })

      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
      await expect(cartPanel(pageB).getByText(new RegExp(`${MEMBER.a} 点了`)).first()).toBeVisible({
        timeout: COLLAB_SYNC_SLA_MS,
      })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('REQ-004.2/004.3: 同步不可用时给出可感知提示与手动刷新，恢复后收敛到最新共享状态', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      await pageA.goto('/')
      await enterMenu(pageA, TABLES.hall, MEMBER.a)

      // 端 B 在接口不可达的情况下加入（模拟同步中断）
      await pageB.route('**/api/**', (route) => route.abort())
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.hall, MEMBER.b)
      await expectCollabUnavailable(pageB)
      await expectRetryEntry(pageB)

      await addDish(pageA, { diner: MEMBER.a })

      // 恢复连接后手动刷新，收敛到最新共享状态（不丢失已提交的加菜）
      await pageB.unroute('**/api/**')
      await pageB.getByRole('button', { name: /重试|刷新|重新连接|重新加入/ }).first().click()

      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
