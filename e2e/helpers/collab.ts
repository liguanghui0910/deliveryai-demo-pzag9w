import { expect, type Page } from '@playwright/test'

/**
 * 同桌多人协同点餐 E2E 公共辅助。
 *
 * 契约来源：技术 Spec `design-demo-space-collab-ordering`（2.2 数据模型 / 2.4 接口 / 2.5 核心流程 / 2.6 状态变化）
 * 与产品 Spec `REQ-001`～`REQ-008`；用例命名沿用 `docs/agent-testing.md`（REQ-xxx + test.describe 标功能域）。
 *
 * 约定与前提（均为技术 Spec 已确认内容）：
 * - 视图地址沿用既有 hash 路由（`#/home`、`#/welcome`、`#/menu`、`#/order`、`#/checkout`），
 *   交付过程展示页为新增顶层视图 `#/showcase`（无需桌台上下文）。
 * - 身份为标签页级（`sessionStorage`），因此用多个 browser context 模拟同桌多位成员。
 * - 桌台码白名单 `A08 / B12 / C06 / D03`；协同状态由服务端内存态持有且无清理接口，
 *   故各 spec 通过「分桌台码 + 文件内前置顺序 + 按菜品名/昵称限定断言」降低相互影响。
 * - 视觉与组件沿用既有实现（Tailwind 类名 + Button/Dialog），断言只依赖业务可见结果（文案、可见性）。
 */

/** 多端近实时同步时效阈值（技术 Spec 2.9 COLLAB_SYNC_SLA_MS = 2000ms）。 */
export const COLLAB_SYNC_SLA_MS = 2000

/** 桌台码白名单（技术 Spec OQ-006，来源 `src/data/menu.ts` 的 tableAreas）。 */
export const TABLES = {
  hall: 'A08',
  booth: 'B12',
  room: 'C06',
  window: 'D03',
} as const

/** 演示用昵称（避免与既有默认同桌 `姚乾/林溪/陈默` 混淆）。 */
export const MEMBER = {
  a: '阿光',
  b: '小溪',
} as const

/** 演示用例引用的菜品名（中文为默认语言文案，见 `src/i18n.ts` menu.pX.name）。 */
export const DISH = {
  tomatoPot: '鎏金番茄鸳鸯锅',
  spicyPot: '牛油麻辣锅',
  beef: '琥珀嫩牛肉',
  shrimp: '鲜虾滑',
} as const

/** 首页：选择既有桌台卡并进入加入流程（welcome）。 */
export async function bindTable(page: Page, table: string = TABLES.hall) {
  await page.getByRole('button', { name: new RegExp(table) }).first().click()
  await expect(page).toHaveURL(/#\/welcome$/)
}

/** 加入流程中的昵称输入框（兼容 label / placeholder / 兜底首个 textbox 三种实现）。 */
export async function nicknameInput(page: Page) {
  const labelled = page.getByLabel(/昵称|nickname/i)
  if (await labelled.count()) return labelled.first()
  const placeholder = page.getByPlaceholder(/昵称|nickname/i)
  if (await placeholder.count()) return placeholder.first()
  return page.getByRole('textbox').first()
}

export async function fillNickname(page: Page, nickname: string) {
  const input = await nicknameInput(page)
  await input.fill(nickname)
}

export async function clickEnterMenu(page: Page) {
  await page.getByRole('button', { name: /进入点餐|Start Ordering/ }).click()
}

/** 首页 → 加入流程（填写昵称）→ 点餐视图（`#/menu`）。 */
export async function enterMenu(page: Page, table: string = TABLES.hall, nickname?: string) {
  await bindTable(page, table)
  if (nickname) await fillNickname(page, nickname)
  await clickEnterMenu(page)
  await expect(page).toHaveURL(/#\/menu$/)
}

/** 首页桌台码输入入口（技术 Spec 2.3：非法桌台码原地提示且保留输入）。 */
export async function submitTableCode(page: Page, code: string) {
  const input = page.getByPlaceholder(/桌台码|table code|table/i).first()
  await input.fill(code)
  await input.press('Enter')
}

/** 点餐页：切换菜品分类。 */
export async function openCategory(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name }).first().click()
}

/** 点餐页：打开第 index 个商品的规格弹窗（复用既有 super-spicy 用例的交互方式）。 */
export async function openProductSpec(page: Page, index = 0) {
  await page.locator('article').nth(index).locator('button').last().click()
}

/** 加入本桌购物车；`diner` 用于显式指定「谁点了」以避免依赖默认选中逻辑。 */
export async function addDish(
  page: Page,
  { category = /锅底|Broth/, index = 0, diner }: { category?: string | RegExp; index?: number; diner?: string } = {},
) {
  await openCategory(page, category)
  await openProductSpec(page, index)
  if (diner) await page.getByRole('button', { name: diner }).first().click()
  await page.getByRole('button', { name: /加入本桌购物车|Add to Table Cart/ }).click()
}

/** 桌面端购物车面板（既有 MenuView 布局将 CartPanel 放在 aside 中）。 */
export function cartPanel(page: Page) {
  return page.locator('aside').first()
}

/** 读取购物车面板中的合计金额（业务可见值，用于两端一致性比较）。 */
export async function readCartTotal(page: Page): Promise<string> {
  const values = await cartPanel(page).getByText(/^\s*¥[\d.,]+\s*$/).allTextContents()
  return (values.at(-1) ?? '').trim()
}

/** 读取订单页的合计金额。 */
export async function readOrderTotal(page: Page): Promise<string> {
  const values = await page.locator('main').getByText(/^\s*¥[\d.,]+\s*$/).allTextContents()
  return (values.at(-1) ?? '').trim()
}

/** 在时效阈值内断言另一端购物车合计收敛到端 A 的值。 */
export async function expectSameCartTotal(pageA: Page, pageB: Page) {
  const totalA = await readCartTotal(pageA)
  await expect.poll(() => readCartTotal(pageB), { timeout: COLLAB_SYNC_SLA_MS }).toBe(totalA)
}

/** 断言协同不可用/同步中断的可感知提示（REQ-004.2 / REQ-008.5）。 */
export async function expectCollabUnavailable(page: Page) {
  await expect(page.getByText(/协同不可用|协同暂不可用|同步中断|同步失败|重连中|未同步/).first()).toBeVisible()
}

/** 断言存在手动刷新/重试兜底入口（REQ-004.2 / REQ-008.5）。 */
export async function expectRetryEntry(page: Page) {
  await expect(page.getByRole('button', { name: /重试|刷新|重新连接|重新加入/ }).first()).toBeVisible()
}

/** 逐一点击本端可见的「确认知悉」按钮（仅他人条目可见），用于构造「全部已确认知悉」状态。 */
export async function ackAllPendingItems(page: Page, maxRounds = 12) {
  const buttons = cartPanel(page).getByRole('button', { name: /确认知悉/ })
  let remaining = await buttons.count()
  for (let i = 0; i < maxRounds && remaining > 0; i += 1) {
    await buttons.first().click()
    await expect.poll(() => buttons.count(), { timeout: COLLAB_SYNC_SLA_MS }).toBeLessThan(remaining)
    remaining = await buttons.count()
  }
  return remaining
}

/** 交付过程展示页（顶层视图，无需桌台上下文）。 */
export async function gotoShowcase(page: Page) {
  await page.goto('/#/showcase')
  await expect(page).toHaveURL(/#\/showcase$/)
}
