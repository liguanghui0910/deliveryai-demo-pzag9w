#!/usr/bin/env node
/**
 * 并行启动 Vite 开发服务器与协同服务，供本地开发与 E2E 共用（不引入新依赖）。
 *
 * - Vite 为关键进程：其退出即整体退出，保证 E2E 有稳定的待测站点。
 * - 协同服务为尽力启动：不可用时仅告警并继续以「仅前端」模式提供站点，
 *   前端据此自动降级为主链路单机可用（REQ-008.5），
 *   使既有 E2E 在未启动后端的环境下同样可回归。
 */
import { spawn } from 'node:child_process'

const port = process.env.PLAYWRIGHT_PORT || '5173'
const children = []
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  process.exit(code)
}

function start(name, args, critical) {
  const child = spawn('npm', args, { stdio: 'inherit', env: process.env })
  children.push(child)
  child.on('error', (error) => {
    console.warn(`[dev-all] ${name} 启动失败：${error.message}`)
    if (critical) shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (critical) {
      console.warn(`[dev-all] ${name} 已退出（code=${code}, signal=${signal}），整体退出`)
      shutdown(code ?? 1)
      return
    }
    console.warn(`[dev-all] ${name} 不可用（code=${code}, signal=${signal}）：继续以仅前端模式运行，协同能力由前端降级提示`)
  })
  return child
}

start('vite', ['run', 'dev', '--', '--port', port, '--strictPort'], true)
start('collab-server', ['--prefix', 'server', 'run', 'dev'], false)

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0))
