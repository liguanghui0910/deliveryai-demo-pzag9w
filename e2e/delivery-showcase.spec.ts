import { expect, test } from '@playwright/test'
import { gotoShowcase } from './helpers/collab'

/**
 * REQ-007 交付过程展示页（技术 Spec 2.5-9、TD-4 页面内静态配置、DEP-003 后续回填链接）。
 * 展示范围仅本次需求（Q8）：需求澄清 / 产品 Spec / 技术 Spec / 自动化用例 / 测试报告 / 代码 Review-MR / 发布部署验证。
 */
const NODE_TITLES = [
  /需求澄清/,
  /产品\s?Spec/i,
  /技术\s?Spec/i,
  /自动化用例/,
  /测试报告/,
  /代码\s?Review|代码审查|Code Review/i,
  /发布部署验证|发布验证/,
]

const PENDING = /未产出|进行中|待产出|Pending/i

test.describe('交付过程展示页（REQ-007）', () => {
  test('REQ-007.2: #/showcase 深链接可直接访问（无需桌台上下文）', async ({ page }) => {
    await gotoShowcase(page)

    await expect(page).toHaveURL(/#\/showcase$/)
    await expect(page.getByText(NODE_TITLES[0]).first()).toBeVisible()
  })

  test('REQ-007.1: 展示页呈现本次需求的全部流程节点', async ({ page }) => {
    await gotoShowcase(page)

    for (const title of NODE_TITLES) {
      await expect(page.getByText(title).first()).toBeVisible()
    }
  })

  test('REQ-007.3: 未产出节点显示占位，且不渲染失效链接', async ({ page }) => {
    await gotoShowcase(page)

    const links = page.locator('a[href]')
    const count = await links.count()
    for (let i = 0; i < count; i += 1) {
      const href = await links.nth(i).getAttribute('href')
      expect(href).toBeTruthy()
      expect(href).not.toBe('#')
      expect(href).not.toContain('javascript:')
    }

    const pending = page.getByText(PENDING)
    if (await pending.count()) {
      await expect(pending.first()).toBeVisible()
    }
  })

  test('REQ-007.4: 产物入口在新窗口打开且保留当前展示页', async ({ page }) => {
    await gotoShowcase(page)

    const artifactLinks = page.locator('a[target="_blank"]')
    if (await artifactLinks.count()) {
      const firstLink = artifactLinks.first()
      await expect(firstLink).toHaveAttribute('rel', /noopener/)
      const [popup] = await Promise.all([page.waitForEvent('popup'), firstLink.click()])
      await expect(page).toHaveURL(/#\/showcase$/)
      await expect(page.getByText(NODE_TITLES[0]).first()).toBeVisible()
      if (!popup.isClosed()) await popup.close()
    } else {
      // 节点尚未产出链接时，必须以占位状态呈现而不是失效链接
      await expect(page.getByText(PENDING).first()).toBeVisible()
    }
  })

  test('REQ-007.7: 展示页支持中英文切换与老人模式', async ({ page }) => {
    await gotoShowcase(page)

    const langToggle = page.getByRole('button', { name: /切换语言|Switch language|语言|Language/i }).first()
    await expect(langToggle).toBeVisible()
    await langToggle.click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await langToggle.click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

    const elderlyToggle = page.getByRole('button', { name: /老人模式|Elderly/i }).first()
    await expect(elderlyToggle).toBeVisible()
    await elderlyToggle.click()
    await expect(page.locator('html')).toHaveClass(/elderly/)
  })
})
