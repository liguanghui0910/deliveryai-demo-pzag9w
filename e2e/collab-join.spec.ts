import { expect, test } from '@playwright/test'
import {
  COLLAB_SYNC_SLA_MS,
  DISH,
  MEMBER,
  TABLES,
  addDish,
  bindTable,
  cartPanel,
  clickEnterMenu,
  enterMenu,
  fillNickname,
  nicknameInput,
  submitTableCode,
} from './helpers/collab'

/**
 * REQ-001 桌台码 + 昵称加入同桌（技术 Spec 2.5-1、TD-5、OQ-006）。
 * 本文件使用桌台码 C06 做加入相关断言，另外复用默认桌台 A08 验证深链接自动加入。
 */
test.describe('同桌协同 - 加入同桌（REQ-001）', () => {
  test('REQ-001.1/001.2: 选择桌台码并填写昵称即可加入同桌并在点餐页显示本人昵称', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/home$/)
    await bindTable(page, TABLES.room)
    await fillNickname(page, MEMBER.a)
    await clickEnterMenu(page)

    await expect(page).toHaveURL(/#\/menu$/)
    await expect(page.getByText(MEMBER.a).first()).toBeVisible()
  })

  test('REQ-001.3: 昵称为空时阻止加入、停留加入流程并保留已输入内容', async ({ page }) => {
    await page.goto('/')
    await bindTable(page, TABLES.room)
    const input = await nicknameInput(page)
    await input.fill('')

    await clickEnterMenu(page)

    await expect(page.getByText(/请填写昵称|昵称不能为空|请输入昵称/).first()).toBeVisible()
    await expect(page).toHaveURL(/#\/welcome$/)
    await expect(input).toHaveValue('')
  })

  test('REQ-001.3: 非法桌台码被拦截、停留首页并保留已输入内容', async ({ page }) => {
    await page.goto('/')
    await submitTableCode(page, 'Z99')
    // 兜底：部分实现以按钮提交桌台码（而 Enter 不触发提交）
    const error = page.getByText(/桌台码无效|无效的桌台码|桌台码不存在|请检查桌台码/)
    if ((await error.count()) === 0) {
      await page.getByRole('button', { name: /进入点餐|确认|校验|绑定|加入/ }).last().click()
    }

    await expect(error.first()).toBeVisible()
    await expect(page).toHaveURL(/#\/home$/)
    await expect(page.getByPlaceholder(/桌台码|table code|table/i).first()).toHaveValue('Z99')
  })

  test('REQ-001.4: 深链接 #/menu 自动以默认桌台与默认昵称加入且菜单立即可用', async ({ page }) => {
    await page.goto('/#/menu')

    await expect(page).toHaveURL(/#\/menu$/)
    await expect(page.getByRole('heading', { name: DISH.tomatoPot })).toBeVisible()
  })

  test('REQ-001.5: 刷新后维持本端昵称身份', async ({ page }) => {
    await page.goto('/')
    await enterMenu(page, TABLES.room, MEMBER.b)
    await expect(page.getByText(MEMBER.b).first()).toBeVisible()

    await page.reload()

    await expect(page).toHaveURL(/#\/menu$/)
    await expect(page.getByText(MEMBER.b).first()).toBeVisible()
  })

  test('REQ-001.6: 同一桌台重复昵称可并存且双方条目均可区分', async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      await pageA.goto('/')
      await enterMenu(pageA, TABLES.room, MEMBER.a)
      await pageB.goto('/')
      await enterMenu(pageB, TABLES.room, MEMBER.a)

      await addDish(pageA, { diner: MEMBER.a })
      await expect(cartPanel(pageA).getByText(DISH.tomatoPot).first()).toBeVisible()
      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible({ timeout: COLLAB_SYNC_SLA_MS })

      await addDish(pageB, { category: /牛羊肉|Beef & Lamb/, diner: MEMBER.a })

      // 同名成员的条目并存、未被覆盖
      await expect(cartPanel(pageB).getByText(DISH.beef).first()).toBeVisible()
      await expect(cartPanel(pageB).getByText(DISH.tomatoPot).first()).toBeVisible()
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
