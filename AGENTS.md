# AGENTS.md

> 供 AI 编码 Agent 阅读的仓库事实与约定。通用的测试执行/Review 规范见 [docs/agent-testing.md](docs/agent-testing.md)，发布核验（GitHub Pages / veFaaS 单服务）见 [docs/agent-release.md](docs/agent-release.md)。
> 修改本文件需同步更新相关代码描述。

## 项目概述

沸点火锅点单与门店履约概念演示应用（`hdl-order-demo`）。React SPA + Express 同源单服务：

- 前端渲染事实来源仍是浏览器内存态 `orderReducer`；同桌协同能力由旁路「协同数据层」在上层做乐观写入 + 远端快照收敛。
- `server/` 为 **同源单服务**：同时托管前端构建产物 `dist/`、提供 `/api/v1` 协同接口（API-001～API-012）并通过 SSE 推送同桌全量快照。会话状态仅存于进程内存（演示级，无持久化，重启即清空）。
- 后端不可用时前端自动降级：协同区域提示不可用，浏览菜单/加菜/下单/结账等主链路保持单机可用（既有 E2E 在无后端环境同样必须通过）。

主流程视图状态机：`home → welcome → menu → order → checkout`，另有独立视图 `showcase`（交付过程展示页，无需桌台）。视图经 hash 路由与 URL 一一对应（`#/home`、`#/welcome`、`#/menu`、`#/order`、`#/checkout`、`#/showcase`），支持深链接与浏览器前进/后退；选用 hash 模式（非 History 模式）以兼容 Vite `base './'` 与 GitHub Pages 子路径部署。

## 技术栈

React 18 · TypeScript ~5.6 · Vite 6 · Tailwind CSS 3.4 · Radix UI（Dialog）· lucide-react · class-variance-authority · i18next（中/英）· Express（`server/`）· Playwright（E2E）。前端状态用 `useReducer` 内存态管理；ESM；路径别名 `@` → `src/`。

## 目录结构

```
src/
├── main.tsx               # 入口，挂载 React
├── App.tsx                # 根组件：useReducer + 视图路由 + 协同会话接入 + 全局布局
├── types.ts               # AppState / AppAction / Product / CartItem / OrderItem / 协同模型
├── api/                   # collabClient（接口封装/超时/错误归类）、collabStream（SSE + 轮询兜底）
├── i18n.ts                # i18next 初始化 + zh/en 资源
├── index.css              # 基础样式、老人模式、过渡、自定义 utilities
├── state/orderReducer.ts  # 订单/购物车/服务/售罄/支付 reducer
├── data/menu.ts           # 菜品/分类/桌台静态数据
├── data/deliveryShowcase.ts# 交付过程展示页节点与产物静态配置（唯一回填点）
├── hooks/useElderlyMode.ts# 老人模式：localStorage + html.elderly
├── hooks/useViewRoute.ts  # 视图 ↔ URL hash 双向同步（含深链接/非法地址纠正）
├── hooks/useCollabSession.ts # 协同会话状态机（身份/加入/快照收敛/动作代理/syncState）
├── lib/utils.ts           # cn（类名合并）、money（¥ 格式化）
├── components/            # 页面组件（HomeView/WelcomeView/MenuView/OrderView/CheckoutView/DeliveryShowcaseView）；通用件在 components/ui/（button、dialog）
└── assets/                # hotpot/broth/beef/vegetables 图片
server/src/                # 同源单服务
├── index.ts               # 组装：JSON 解析、CORS 白名单、/ping、/api/v1、静态托管 + SPA fallback
├── api.ts                 # API-001～API-012 路由与统一错误响应
├── store.ts               # 内存会话存储（rev/成员/共享购物车/共享订单/广播）
├── sse.ts                 # SSE 连接管理（全量快照推送 + 心跳 + 断连清理）
├── validate.ts            # 参数校验与错误码构造
└── types.ts               # 协同模型与错误码枚举
e2e/                       # Playwright 用例（含既有 super-spicy / view-routing 回归门禁）
scripts/dev-all.mjs        # 并行启动 Vite 与 server/（无新依赖），供开发与 E2E 使用
index.html                 # 入口，含初始化语言的内联脚本
tailwind.config.js         # 自定义色板；vite.config.ts 配 base './' 与 @ 别名及 /api 开发代理
playwright.config.ts       # E2E 配置
```

> 页面级视图组件统一以 `*View.tsx` 命名，文件名与视图状态一一对应（`home`→`HomeView`、`welcome`→`WelcomeView`…）。新增视图时同步：`ViewName` 类型、`useViewRoute` 的 `VIEWS`、对应 `*View.tsx` 组件。

## 样式约定

颜色类名直接硬编码在 JSX（如 `bg-rice-100`、`text-charcoal-900`、`border-charcoal-900/5`），不用 CSS 变量或语义 token 层，新组件沿用此模式。

`tailwind.config.js` 的自定义色板：

| 色系 | 色阶 | 用途 |
| --- | --- | --- |
| rice | 50 `#fffdf8` / 100 `#fbf5ea` / 200 `#f3e6d0` | 背景、卡片、次级面板 |
| charcoal | 500 `#5f5b55` / 700 `#34312d` / 900 `#211f1c` | 文字、深色背景 |
| chili | 50 `#fff1ef` / 100 `#ffddd8` / 500 `#e13b2b` / 600 `#c92f21` / 700 `#a9231a` | 按钮、强调、徽章 |
| amber | 100 `#fff2c7` / 400 `#f5b83f` / 500 `#e69b18` | 徽章、进度色 |

当前为单一浅色主题，Tailwind 未配置 `darkMode`，组件中没有 `dark:` 变体。全局颜色/字号变化有 250ms 过渡（`src/index.css`），老人模式切换无需额外动画。

## 编码约定

- 页面组件放 `src/components/`，通用件放 `src/components/ui/`；弹窗用封装的 `Dialog`，按钮用 CVA `Button`（default/secondary/outline/ghost），图标用 lucide-react 并靠 `currentColor` 继承。
- 样式只用 Tailwind 类名，不用 CSS Modules / styled-components。
- 新增 i18n 文案在 `src/i18n.ts` 的 zh/en 两处同步添加，按功能分组（`common.`、`menu.`、`cart.`、`order.`、`collab.`、`showcase.` 等）。
- 新增 `localStorage`/`sessionStorage` 持久化一律 `try/catch` 包裹，不可用时降级内存态；现有 key：`i18nextLng`、`elderly-mode`（`true`/`false`）、`collab:nickname`、`collab:memberId`、`collab:table`（标签页级身份）。
- 需要在 React 挂载前设置 html 属性/class 时，扩展 `index.html` 的内联脚本。
- 服务端约定：错误响应统一为 `{ code, message, retryable }`；参数校验与错误码集中在 `server/src/validate.ts` + `server/src/types.ts`；服务端不重算价格、不校验售罄（客户端为可信来源，仅做结构与范围校验）；所有共享状态变更通过 `store` 的 `commit` 统一递增 `rev` 并广播快照；SSE/CORS 手写实现，不引入新依赖。
- npm 源默认走 `https://registry.npmmirror.com`（见根目录与 `server/.npmrc`）。

## 验证命令

| 命令 | 作用 |
| --- | --- |
| `npm ci` / `npm install` | 安装前端依赖（缺 `node_modules` 时先装） |
| `npm --prefix server ci` / `npm --prefix server install` | 安装服务端依赖 |
| `npm run build` | `tsc -b && vite build`，产物到 `dist/` |
| `npm run lint` | ESLint，零警告通过 |
| `npx tsc -b --noEmit` | 仅类型检查（前端） |
| `npm --prefix server run typecheck` | 仅类型检查（服务端） |
| `npm --prefix server run build` | 服务端编译到 `server/dist` |
| `npx playwright test` | E2E，webServer 经 `scripts/dev-all.mjs` 同时拉起 Vite 与协同服务 |
| `node scripts/dev-all.mjs` | 本地同时启动前端与协同服务 |

E2E 的执行约束（浏览器来源、报告路径、批量修复、不重跑等）与用例编写/自审规范见 [docs/agent-testing.md](docs/agent-testing.md)。

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VITE_API_BASE` | 空（同源） | 前端接口基址（构建时注入） |
| `PORT` | `3001` | 协同服务监听端口 |
| `WEB_DIST_DIR` | `<repo>/dist` | 前端静态产物目录 |
| `CORS_ORIGIN` | 空（仅同源） | 跨域来源白名单（逗号分隔） |
| `SSE_HEARTBEAT_MS` | `15000` | SSE 心跳间隔 |
| `PLAYWRIGHT_PORT` | `5173` | E2E/开发态前端端口 |

## 不要做

- 不引入额外的 UI 库或设计系统框架。
- 不使用 CSS Modules 或 styled-components。
- 不在 `server/` 引入新框架或新运行时依赖（SSE/CORS 手写，仅用既有 `express`）。
- 不为演示引入持久化存储或数据库（会话为进程内存态）。
- 不改动 `server/` 既有 `GET /ping` 的响应体，不改动既有 `home → welcome → menu → order → checkout` 视图名与 hash 地址。
- 不修改既有 `e2e/super-spicy.spec.ts`、`e2e/view-routing.spec.ts` 的断言（回归门禁），且不得让主链路强依赖后端。
