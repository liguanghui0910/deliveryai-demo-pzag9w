import { defineConfig, devices } from '@playwright/test'

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/chromium.org/chromium/chrome'
// 端口可经 PLAYWRIGHT_PORT 覆盖，避免与本机其它 dev server（默认 5173）冲突
const PORT = Number(process.env.PLAYWRIGHT_PORT || 5173)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // html/list 为既有报告；sharedSessionReset 为联调环境隔离（每条用例前重置同桌共享会话，见该文件注释）。
  reporter: [['html', { open: 'never' }], ['list'], ['./e2e/reporters/sharedSessionReset.ts']],
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    headless: true,
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // 同时拉起 Vite 与协同服务（协同服务不可用时前端降级，见 scripts/dev-all.mjs）
    command: 'node scripts/dev-all.mjs',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
