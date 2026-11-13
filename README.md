# 沸点火锅点单演示

一个面向火锅门店场景的移动端点单与履约流程演示项目，用于展示从绑定餐桌、同桌多人协同点餐到订单履约和结账支付的完整体验，并提供「交付过程展示页」呈现本次需求的节点产物。

> 本项目为概念演示，不代表正式产品；协同会话为进程内存态，服务重启即清空。

## 功能介绍

- 绑定餐桌并进入点餐流程（支持桌台码输入与快速进入）
- 按分类浏览、搜索和选择菜品
- 配置菜品规格、口味及下单人
- **同桌多人协同点餐**：服务端持有共享会话，同一桌台多端共享购物车、确认知悉与订单
- 查看订单制作及上菜进度（同桌各端一致）
- 呼叫加汤、饮料、餐具和结账服务（本端演示行为）
- 模拟菜品售罄、服务响应及履约状态
- 模拟结账和支付成功流程
- 交付过程展示页（`#/showcase`）：展示需求澄清 → 产品/技术 Spec → 开发 → 测试 → 发布验证的节点产物
- 支持中英文切换和老人模式
- 后端不可用时自动降级：协同区域提示「协同不可用」，浏览菜单、加菜、下单、结账等主链路仍可单机使用

## 技术栈

- React 18 + TypeScript + Vite + Tailwind CSS + Radix UI + i18next
- Express（`server/`，**同源单服务**：托管前端静态产物 + `/api/v1` 协同接口 + SSE 推送）
- Playwright（E2E）

## 环境要求

- Node.js 18 或更高版本
- npm 9 或更高版本

## 本地开发

安装前后端依赖：

```bash
npm install
npm --prefix server install
```

同时启动前端与协同服务（推荐）：

```bash
node scripts/dev-all.mjs
```

- 前端：`http://localhost:5173`（可用 `PLAYWRIGHT_PORT` 覆盖端口），`/api` 由 Vite 开发代理转发到协同服务。
- 协同服务：`http://localhost:3001`（`GET /ping`、`GET /api/v1/health`）。

仅启动前端（协同自动降级为主链路单机可用）：

```bash
npm run dev
```

演示「同桌多人协同」时，在同一浏览器的多个标签页中打开站点，分别以不同昵称加入同一桌台码即可；身份按标签页隔离（`sessionStorage`）。

## 常用命令

```bash
# 启动开发服务（前端）
npm run dev

# 执行代码检查
npm run lint

# 构建生产版本（前端 dist/）
npm run build

# 协同服务：类型检查 / 构建 / 启动
npm --prefix server run typecheck
npm --prefix server run build
npm --prefix server start
```

## 接口基址与环境变量

前端接口基址由 `VITE_API_BASE` 决定：**留空即同源**（veFaaS 单服务部署的默认形态）；仅在前后端分离部署时显式配置。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VITE_API_BASE` | 空（同源） | 前端接口基址（构建时注入） |
| `PORT` | `3001` | 协同服务监听端口 |
| `WEB_DIST_DIR` | `<repo>/dist` | 前端静态产物目录（同源托管） |
| `CORS_ORIGIN` | 空（仅同源） | 允许的跨域来源白名单（逗号分隔），默认不放开任何跨域 |
| `SSE_HEARTBEAT_MS` | `15000` | SSE 心跳间隔 |

`/api/v1` 接口清单与错误码定义见工作区共享产物中的技术 Spec（API-001～API-012）；服务端实现位于 `server/src/`，统一错误响应为 `{ code, message, retryable }`。

除技术 Spec 的 API-001～API-012 外，服务端另提供一个**新增（追加式）**端点：`POST /api/v1/tables/{tableCode}/reset`，用于「一键重置演示」时清空该桌台的共享会话（成员、购物车、订单与幂等键），使演示可干净重跑；`rev` 保持单调递增，重复调用为无操作。

## 生产部署（veFaaS 单服务同源）

前端产物与 `/api/v1` 由同一个 Express 服务提供，规避跨域：

```bash
npm ci && npm run build
npm --prefix server ci && npm --prefix server run build
WEB_DIST_DIR="$(pwd)/dist" PORT=3001 node server/dist/index.js
```

发布流程见 `.github/workflows/deploy-vefaas.yml`（需 secrets `VEFAAS_ACCESS_KEY` / `VEFAAS_SECRET_KEY`，以及仓库变量 `VEFAAS_DEPLOY_COMMAND` / `VEFAAS_APP_URL`）；既有 GitHub Pages 静态流程（`.github/workflows/deploy-pages.yml`）保留为备用入口。发布核验与回滚步骤见 [docs/agent-release.md](docs/agent-release.md)。

## 项目结构

```text
.
├── e2e/                    # Playwright 端到端测试
├── server/                 # 同源单服务（静态托管 + /api/v1 协同接口 + SSE）
│   └── src/
│       ├── index.ts        # 组装：JSON 解析、CORS 白名单、/ping、/api/v1、静态托管 + SPA fallback
│       ├── api.ts          # API-001～API-012 路由与统一错误响应
│       ├── store.ts        # 内存会话存储（rev、成员、共享购物车、共享订单、广播）
│       ├── sse.ts          # SSE 连接管理：全量快照推送 + 心跳 + 断连清理
│       ├── validate.ts     # 参数校验与错误码构造
│       └── types.ts        # 协同模型与错误码枚举
├── src/
│   ├── api/                # 协同接口封装与 SSE/轮询流
│   ├── assets/             # 图片资源
│   ├── components/         # 页面及通用组件
│   ├── data/               # 菜单与交付过程展示静态配置
│   ├── hooks/              # React Hooks
│   ├── state/              # 订单状态管理
│   ├── App.tsx             # 应用入口组件
│   ├── i18n.ts             # 中英文文案
│   └── index.css           # 全局样式
├── index.html
├── tailwind.config.js
└── vite.config.ts
```

## 预览模式

访问以下地址可以直接进入已绑定餐桌并带有购物车数据的菜单预览：

```text
http://localhost:5173/?preview=menu
```

实际端口以 Vite 启动日志为准；交付过程展示页地址为 `http://localhost:5173/#/showcase`。
