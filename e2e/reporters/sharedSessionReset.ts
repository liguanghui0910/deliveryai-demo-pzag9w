import type { Reporter, TestCase } from '@playwright/test/reporter'

/**
 * 联调环境隔离：每条用例开始前重置「同桌共享会话」，恢复既有回归门禁的运行前提。
 *
 * 背景（联调部署节点发现）：`e2e/super-spicy.spec.ts`、`e2e/view-routing.spec.ts` 是协同能力
 * 上线前编写的回归门禁，其前提是 `docs/agent-testing.md` §5 记载的「应用为内存态，刷新即重置」。
 * 协同能力上线后，购物车/订单由服务端按桌台共享（REQ-002/REQ-006，进程内存态、无清理入口），
 * 同一桌台的残留状态会跨用例（跨 browser context）泄漏，导致既有门禁在「有后端」环境下出现
 * 与被测行为无关的失败（已实测：`super-spicy.spec.ts` REQ-005 因同一文件前序用例的共享购物车残留而失败；
 * 无后端降级环境下 17/17 通过）。
 *
 * 因此本 reporter 仅对「协同能力上线前编写、以单端内存态为前提」的回归门禁 spec（见 ISOLATED_SPECS）
 * 在每条用例前调用演示重置接口（与演示者点击「重置」等价），只隔离环境、不改产品语义、不改既有断言。
 * 协同用例（`collab-*.spec.ts`、`delivery-showcase.spec.ts`）不在其中：它们按设计使用共享会话，
 * 部分文件依赖同文件内用例按声明顺序的连续性，本 reporter 不介入。
 *
 * 后端不可用（降级环境）时全部请求静默失败，不影响用例执行（REQ-008.5）。
 *
 * 该处置方式已由需求方在联调部署节点确认（2026-11-13）：「测试环境侧隔离」，
 * 不做产品侧语义改动；若后续改为产品侧会话回收，需先修订上游 Spec。
 */

/** 桌台白名单，与 `src/data/menu.ts` / `server/src/types.ts` 保持一致。 */
const TABLE_CODES = ['A08', 'B12', 'C06', 'D03'] as const

/** 需要环境隔离的既有回归门禁 spec：每条用例前重置同桌共享会话。 */
const ISOLATED_SPECS = ['super-spicy.spec.ts', 'view-routing.spec.ts']

/** 协同服务地址（默认与 `server` 默认端口一致，可用 COLLAB_SERVER_URL 覆盖）。 */
const BASE = process.env.COLLAB_SERVER_URL || 'http://127.0.0.1:3001'

/** 单次重置请求超时；后端不可用时快速失败，不拖慢用例。 */
const RESET_TIMEOUT_MS = 1500

const resetTable = async (tableCode: string): Promise<void> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESET_TIMEOUT_MS)
  try {
    await fetch(`${BASE}/api/v1/tables/${tableCode}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    })
  } catch {
    // 协同服务不可用（降级环境）或接口不存在：静默跳过，用例仍按既有单机路径执行。
  } finally {
    clearTimeout(timer)
  }
}

export default class SharedSessionResetReporter implements Reporter {
  async onTestBegin(test: TestCase): Promise<void> {
    const file = test.location.file.replace(/\\/g, '/')
    const fileName = file.slice(file.lastIndexOf('/') + 1)
    if (!ISOLATED_SPECS.includes(fileName)) return
    await Promise.all(TABLE_CODES.map((tableCode) => resetTable(tableCode)))
  }
}
