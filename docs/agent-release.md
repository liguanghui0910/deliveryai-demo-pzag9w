# 发布核验（veFaaS 单服务 / GitHub Pages 备用）

> 低频 runbook。职责只到“构建部署成功、站点可访问”，不重复 lint/build/E2E 全量验收（那些结论在上游环节取得，直接采信）。仓库事实见 [../AGENTS.md](../AGENTS.md)。

## 背景

- 工作流名 `Deploy GitHub Pages`（`.github/workflows/deploy-pages.yml`），push 到 `main` 触发；只执行 `npm ci` + `npm run build` 后上传 `dist`，CI 不跑 E2E。
- 项目级 Pages 站点：`https://<owner>.github.io/<repo>/`（Vite `base: './'`，资源为相对路径）。

下文中 `<owner>`/`<repo>` 替换为实际仓库归属和名称；API 为公开仓库只读查询，未鉴权即可。

## 步骤

1. 确认触发提交已在 `origin/main`（与第 2、4 步可并行）：
   ```bash
   git fetch origin main --quiet && git log --oneline origin/main -3
   ```
2. 查询 `main` 最新部署 run：
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/actions/workflows/deploy-pages.yml/runs?branch=main&per_page=1" \
     | jq '.workflow_runs[0] | {id, status, conclusion, head_sha, html_url}'
   ```
   判定：`status=completed` 且 `conclusion=success` 为成功；`queued`/`in_progress` 则每 30s 轮询、上限 5 分钟；`failure`/`cancelled` 为失败。
3. 失败时查失败 job 与步骤，只拉关键日志：
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/actions/runs/<run_id>/jobs" \
     | jq -r '.jobs[] | select(.conclusion!="success") | .name, (.steps[]|select(.conclusion=="failure")|.name)'
   ```
4. 成功后验证站点可访问：`curl -fsSI "https://<owner>.github.io/<repo>/" | head -5`，期望 `HTTP/2 200`；CDN 刚部署可能短暂 404，间隔重试 2-3 次。
5. 可选功能上线确认：从首页 HTML 取 JS 资源名后 `curl -fsSL <js 地址> | rg -o "沸点|超级辣" | head`，确认线上含关键功能标记，不把整包读入上下文。

## 完成条件

workflow run `completed/success` 且 Pages URL 返回 200，输出可访问链接；失败或超时则记录 run 链接、失败 job/步骤和处理建议。

---

# veFaaS 单服务发布核验（Demo 主入口）

> 低频 runbook。职责只到“构建部署成功、服务与站点可访问、协同接口可用”，不重复 lint/build/E2E 全量验收（结论在上游环节取得，直接采信）。仓库事实见 [../AGENTS.md](../AGENTS.md)。
> 本仓库 Demo 官方入口为 veFaaS 单服务地址：同一服务托管前端 `dist/` 与 `/api/v1`（同源，无 CORS）。

## 背景

- 工作流名 `Deploy veFaaS (single service)`（`.github/workflows/deploy-vefaas.yml`），push 到 `main` 或手动 `workflow_dispatch` 触发。
- 步骤：前端 `npm ci && npm run build` → 后端 `npm --prefix server ci && npm --prefix server run build` → 组装 `release/`（`dist/`、`server/dist/`、`server/package.json`、`server/package-lock.json`、`.vefaasignore`）→ 上传 artifact `vefaas-release` → 执行发布命令 → 可选探活。
- 发布命令与应用/环境参数由**联调部署**节点确认（依赖项 DEP-001）：写入仓库变量 `VEFAAS_DEPLOY_COMMAND`，公网地址写入 `VEFAAS_APP_URL`；凭证走 secrets `VEFAAS_ACCESS_KEY` / `VEFAAS_SECRET_KEY`，不得落库或写入任何产物。
- 运行时的前端静态目录默认 `<服务根>/dist`；如平台目录形态不同，用环境变量 `WEB_DIST_DIR` 覆盖。

## 步骤

1. 确认触发提交已在 `origin/<work_branch>` 并已合并到发布分支：
   ```bash
   git fetch origin --quiet && git log --oneline origin/main -3
   ```
2. 查询最新部署 run（`<owner>`/`<repo>` 替换为实际归属）：
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/actions/workflows/deploy-vefaas.yml/runs?per_page=1"      | jq '.workflow_runs[0] | {id, status, conclusion, head_sha, html_url}'
   ```
   判定：`completed/success` 为成功；`queued`/`in_progress` 每 30s 轮询、上限 5 分钟；`failure`/`cancelled` 为失败。若因 `VEFAAS_DEPLOY_COMMAND` 未配置而失败，属 DEP-001 未闭环，不是代码缺陷。
3. 失败时只拉失败 job 与步骤名：
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/actions/runs/<run_id>/jobs"      | jq -r '.jobs[] | select(.conclusion!="success") | .name, (.steps[]|select(.conclusion=="failure")|.name)'
   ```
4. 探活（用第 2 步得到的公网地址，或仓库变量 `VEFAAS_APP_URL`）：
   ```bash
   curl -fsS "$VEFAAS_APP_URL/api/v1/health"   # {"status":"ok","uptime":...}
   curl -fsS "$VEFAAS_APP_URL/ping"            # {"message":"pong","timestamp":"..."}
   curl -fsSI "$VEFAAS_APP_URL/" | head -3     # 200 + text/html
   ```
5. 协同链路抽检（单服务同源，无需跨域）：加入→加菜→确认知悉→下单→阶段→支付，观察 `rev` 递增；再开第二个浏览器标签加入同一桌台，确认 2s 内两端一致。
   ```bash
   curl -fsS -X POST "$VEFAAS_APP_URL/api/v1/tables/A08/members"      -H 'Content-Type: application/json'      -d '{"nickname":"验收","clientMemberId":"verify-1"}'
   ```
6. 记录实测值：多端同步时效、SSE 是否被网关限制而实际走轮询（依赖项 DEP-002），回填到交付过程展示页配置（DEP-003）。

## 回滚

| 场景 | 动作 | 数据影响 |
| --- | --- | --- |
| 新版本功能异常 | veFaaS 回退到上一版本，或回退提交后重新部署 | 无（会话为进程内存态，重启即清空） |
| 后端持续不可用 | 无需回滚：前端已内置降级（协同提示不可用，主链路单机可用）；必要时把演示入口切回 GitHub Pages 静态站点 | 无 |
| SSE 被网关限制 | 前端切默认轮询策略，无需回滚服务 | 无 |

无需数据/配置回滚（无 Schema、无迁移、无持久化）。

## 完成条件

workflow run `completed/success`、`/api/v1/health` 与 `/ping` 均 200、站点首页 200，输出可访问链接与实测同步时效；失败或超时则记录 run 链接、失败 job/步骤、以及是否为 DEP-001/DEP-002 未闭环。
