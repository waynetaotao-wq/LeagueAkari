import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'

interface PostGameSummaryOptions {
  getSgpSummary?: () => Promise<LcuOrSgpGameSummary | null>
  getLcuSummary: () => Promise<LcuOrSgpGameSummary | null>
  onSummary: (summary: LcuOrSgpGameSummary) => void
  onAttempt?: (attempt: number) => void
  signal: AbortSignal
  attempts?: number
  intervalMs?: number
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/**
 * 先显示可用的 LCU 摘要，继续等待同一局 SGP 入库；只有 SGP 到达才提前结束。
 * 超时保留 LCU，取消后不再发布结果，也不接受其它对局或错误来源的响应。
 */
export async function loadPostGameSummary(
  gameId: number,
  options: PostGameSummaryOptions
): Promise<LcuOrSgpGameSummary | null> {
  const { signal } = options
  const attempts = Math.max(1, options.attempts ?? 20)
  let latest: LcuOrSgpGameSummary | null = null
  const matches = (summary: LcuOrSgpGameSummary | null, source: 'sgp' | 'lcu') => {
    if (!summary || summary.source !== source || summary.gameId !== gameId) return false
    const rawId = summary.source === 'sgp' ? summary.data.json?.gameId : summary.data.gameId
    return rawId === gameId
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal.aborted) return null
    options.onAttempt?.(attempt)
    if (options.getSgpSummary) {
      let preferred: LcuOrSgpGameSummary | null = null
      try {
        preferred = await options.getSgpSummary()
      } catch {
        // SGP 可能尚未入库或暂时不可用，继续尝试 LCU 和后续轮询。
      }
      if (signal.aborted) return null
      if (matches(preferred, 'sgp')) {
        options.onSummary(preferred!)
        return preferred
      }
    }

    if (!latest) {
      let fallback: LcuOrSgpGameSummary | null = null
      try {
        fallback = await options.getLcuSummary()
      } catch {
        // 两个来源都失败时留给下一轮重试，最终由调用方显示未入库。
      }
      if (signal.aborted) return null
      if (matches(fallback, 'lcu')) {
        latest = fallback
        options.onSummary(fallback!)
      }
    }
    if (latest && !options.getSgpSummary) return latest
    if (attempt < attempts) await waitForRetry(options.intervalMs ?? 3000, signal)
  }
  return signal.aborted ? null : latest
}
