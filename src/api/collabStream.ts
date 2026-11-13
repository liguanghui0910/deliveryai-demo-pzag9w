import type { SessionSnapshot, SyncState } from '@/types'
import { collabApi, collabStreamUrl, CollabError } from '@/api/collabClient'

export interface CollabStreamOptions {
  tableCode: string
  memberId: string
  /** 轮询兜底间隔（= 同步时效阈值）。 */
  pollMs: number
  /** 连续失败阈值；超过后关闭 SSE 转为轮询。 */
  maxSseFailures: number
  onSnapshot: (snapshot: SessionSnapshot) => void
  onSyncState: (state: SyncState) => void
  onError?: (error: CollabError) => void
}

export interface CollabStream {
  /** 手动刷新：立即拉取一次全量快照。 */
  refresh: () => void
  close: () => void
}

/**
 * 协同变更订阅：SSE 推送全量快照为主，连续失败超过阈值后降级为轮询兜底。
 * 浏览器原生自动重连期间状态为 reconnecting；轮询亦失败时为 offline。
 */
export function createCollabStream(options: CollabStreamOptions): CollabStream {
  const { tableCode, memberId, pollMs, maxSseFailures, onSnapshot, onSyncState, onError } = options
  let closed = false
  let source: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollInFlight = false
  let sseFailures = 0

  const emit = (snapshot: SessionSnapshot) => {
    if (!closed) onSnapshot(snapshot)
  }

  const handleEventPayload = (event: Event) => {
    const data = (event as MessageEvent).data
    if (typeof data !== 'string') return
    try {
      emit(JSON.parse(data) as SessionSnapshot)
    } catch {
      // 忽略无法解析的推送，等待下一次快照收敛
    }
  }

  const pollOnce = async () => {
    if (closed || pollInFlight) return
    pollInFlight = true
    try {
      const snapshot = await collabApi.session(tableCode, memberId)
      sseFailures = 0
      onSyncState('connected')
      emit(snapshot)
    } catch {
      onSyncState('offline')
    } finally {
      pollInFlight = false
    }
  }

  const startPolling = () => {
    if (closed || pollTimer) return
    source?.close()
    source = null
    onSyncState('reconnecting')
    void pollOnce()
    pollTimer = setInterval(() => { void pollOnce() }, pollMs)
  }

  const openStream = () => {
    if (closed) return
    source = new EventSource(collabStreamUrl(tableCode, memberId))
    source.addEventListener('open', () => {
      sseFailures = 0
      onSyncState('connected')
    })
    source.addEventListener('session', handleEventPayload)
    source.addEventListener('heartbeat', () => {
      sseFailures = 0
      onSyncState('connected')
    })
    source.addEventListener('error', () => {
      if (closed) return
      sseFailures += 1
      if (sseFailures > maxSseFailures) startPolling()
      else onSyncState('reconnecting')
    })
  }

  const refresh = () => {
    if (closed) return
    if (pollTimer) {
      void pollOnce()
      return
    }
    void collabApi.session(tableCode, memberId)
      .then((snapshot) => { sseFailures = 0; onSyncState('connected'); emit(snapshot) })
      .catch((error) => onError?.(error as CollabError))
  }

  openStream()

  return {
    refresh,
    close: () => {
      closed = true
      source?.close()
      source = null
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    },
  }
}
