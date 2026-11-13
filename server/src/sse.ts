// SSE 连接管理（技术 Spec 第 2.4 节 API-003 / 第 2.7 节）。
// 单向推送全量快照 + 心跳保活；写失败即注销连接（客户端自动重连并拉全量，天然自愈）。

import type { Request, Response } from 'express'
import type { SessionStore } from './store.js'
import type { SessionSnapshot } from './types.js'

export interface SseHub {
  /** 打开一条 SSE 连接：立即推送首个快照，注册变更推送与心跳，并在断开时清理。 */
  open(req: Request, res: Response, tableCode: string, store: SessionStore): void
  /** 当前活跃连接数（用于日志与探活）。 */
  connectionCount(): number
  /** 进程退出时关闭全部连接。 */
  closeAll(): void
}

const serialize = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export function createSseHub(options: { heartbeatMs: number }): SseHub {
  const active = new Set<() => void>()

  const open = (req: Request, res: Response, tableCode: string, store: SessionStore): void => {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    // 规避反向代理/网关缓冲导致的推送延迟（veFaaS 网关行为见 DEP-002）。
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    let current: SessionSnapshot = store.getSnapshot(tableCode)
    let closed = false

    const write = (event: string, data: unknown): boolean => {
      if (closed) return false
      try {
        res.write(serialize(event, data))
        return true
      } catch (error) {
        console.warn(`[sse] write failed for table ${tableCode}:`, error)
        return false
      }
    }

    // 浏览器 EventSource 的重连间隔提示。
    res.write('retry: 3000\n\n')

    const unsubscribe = store.subscribe(tableCode, (snapshot) => {
      current = snapshot
      if (!write('session', snapshot)) {
        cleanup()
      }
    })

    const heartbeat = setInterval(() => {
      if (!write('heartbeat', { rev: current.rev, serverTime: new Date().toISOString() })) {
        cleanup()
      }
    }, options.heartbeatMs)

    const cleanup = (): void => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      active.delete(cleanup)
      try {
        res.end()
      } catch {
        // 连接已由对端关闭，无需处理。
      }
    }

    active.add(cleanup)
    req.on('close', cleanup)
    res.on('close', cleanup)

    if (!write('session', current)) {
      cleanup()
    }
  }

  return {
    open,
    connectionCount: () => active.size,
    closeAll: () => {
      for (const cleanup of [...active]) {
        cleanup()
      }
    },
  }
}
