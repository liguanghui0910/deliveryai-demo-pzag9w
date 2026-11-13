// 单服务入口（技术 Spec 第 1 章 / 第 2.1 节 / 第 2.9 节）：
// (a) 托管前端构建产物 dist/ 与 SPA fallback；(b) 提供 /api/v1 协同接口；(c) 通过 SSE 推送同桌快照。
// 既有 GET /ping 保留且响应体不变。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import { createApiRouter } from './api.js'
import { createSessionStore } from './store.js'
import { createSseHub } from './sse.js'
import { toErrorBody } from './types.js'

// __dirname 在 dev（tsx 运行 src/）与 build（node 运行 dist/）下均为 <repo>/server/<src|dist>，
// 因此向上两级即仓库根目录。
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(moduleDir, '../..')

const PORT = Number(process.env.PORT || 3001)
const SSE_HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS || 15000)
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || path.resolve(REPO_ROOT, 'dist')
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const app = express()
const hub = createSseHub({ heartbeatMs: SSE_HEARTBEAT_MS })
const store = createSessionStore()

// CORS 白名单：默认仅同源（不设置任何跨域头）；仅当配置 CORS_ORIGIN 时按白名单放行。
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header('Origin')
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key')
    res.setHeader('Access-Control-Max-Age', '600')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

app.use(express.json({ limit: '256kb' }))

// 既有健康检查：响应体保持不变。
app.get('/ping', (_req: Request, res: Response) => {
  res.json({
    message: 'pong',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/v1', createApiRouter(store, hub))

// 静态托管前端产物 + SPA fallback（hash 路由即指向 index.html）。
if (fs.existsSync(WEB_DIST_DIR)) {
  app.use(express.static(WEB_DIST_DIR, { index: 'index.html' }))
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path === '/ping') {
      next()
      return
    }
    res.sendFile(path.join(WEB_DIST_DIR, 'index.html'))
  })
} else {
  console.warn(`[server] 未找到前端构建产物目录（${WEB_DIST_DIR}），仅提供 /ping 与 /api/v1`)
}

app.use((_req: Request, res: Response) => {
  res.status(404).json(toErrorBody('NOT_FOUND', '资源不存在'))
})

// Express 依赖 4 参数签名识别错误处理中间件，故保留第 4 个参数（以 _ 前缀命名，见 eslint 约定）。
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number((error as { status?: number })?.status ?? 500)
  if (status >= 400 && status < 500) {
    // 请求体解析失败等客户端错误：不进入降级路径。
    res.status(status).json(toErrorBody('INVALID_REQUEST', '请求格式不合法'))
    return
  }
  console.error('[server] unhandled error:', error)
  res.status(500).json(toErrorBody('INTERNAL', '服务内部错误，请稍后重试'))
})

const server = app.listen(PORT, () => {
  console.log(`[server] hdl-order-demo 单服务已启动：http://localhost:${PORT}`)
  console.log(`[server] 静态产物目录：${WEB_DIST_DIR}`)
})

const shutdown = (signal: string): void => {
  console.log(`[server] 收到 ${signal}，正在关闭…`)
  hub.closeAll()
  server.close(() => process.exit(0))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
