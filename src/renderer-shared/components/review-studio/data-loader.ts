import type { SgpGameDetailsLol, SgpGameSummaryLol } from '@shared/types/sgp/match-history'

import { getReviewSummaryEligibility, normalizeReviewPosition, parseReviewMatch } from './analysis'
import type { ReviewFilter, ReviewMatch, ReviewPosition } from './types'

export interface ReviewIdentity {
  puuid: string
  sgpServerId: string
}

export interface ReviewCandidate {
  gameId: number
  championId: number
  position: ReviewPosition
  opponentChampionId: number | null
  queueId: number
  patch: string
  gameCreation: number
  win: boolean
}

export interface ReviewFetchApi {
  history(
    identity: ReviewIdentity,
    start: number,
    count: number,
    signal: AbortSignal
  ): Promise<SgpGameSummaryLol[]>
  summary(identity: ReviewIdentity, gameId: number, signal: AbortSignal): Promise<SgpGameSummaryLol>
  details(identity: ReviewIdentity, gameId: number, signal: AbortSignal): Promise<SgpGameDetailsLol>
}

export interface ReviewLoadProgress {
  phase: 'idle' | 'history' | 'timelines' | 'single'
  scanned: number
  target: number
  attempted: number
  succeeded: number
  failed: number
  skipped: number
  truncated: boolean
}

export interface ReviewLoadFailure {
  gameId: number
  kind: 'network' | 'unavailable' | 'invalid'
  reason: string
}

export function reviewAbortError() {
  return new DOMException('复盘读取已取消', 'AbortError')
}

export function assertReviewNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw reviewAbortError()
}

export function isReviewAbort(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
}

/** One renderer-wide pool, shared by historical scans, single games and all open studios. */
export class ReviewRequestPool {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly limit = 3) {}

  private acquire(signal: AbortSignal): Promise<() => void> {
    assertReviewNotAborted(signal)
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.queue.indexOf(start)
        if (index >= 0) this.queue.splice(index, 1)
        reject(reviewAbortError())
      }
      const start = () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {
          reject(reviewAbortError())
          return
        }
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.queue.shift()?.()
        })
      }
      if (this.active < this.limit) start()
      else {
        this.queue.push(start)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }

  async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal)
    try {
      assertReviewNotAborted(signal)
      const result = await task()
      assertReviewNotAborted(signal)
      return result
    } finally {
      release()
    }
  }
}

export class ReviewMatchCache {
  private readonly entries = new Map<string, { expires: number; match: ReviewMatch }>()

  constructor(
    private readonly capacity = 120,
    private readonly ttlMs = 15 * 60_000,
    private readonly now = () => Date.now()
  ) {}

  private key(identity: ReviewIdentity, gameId: number) {
    return JSON.stringify([identity.sgpServerId, identity.puuid, gameId])
  }

  get(identity: ReviewIdentity, gameId: number) {
    const key = this.key(identity, gameId)
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    if (entry.expires <= this.now()) return null
    this.entries.set(key, entry)
    return entry.match
  }

  put(identity: ReviewIdentity, gameId: number, match: ReviewMatch) {
    const key = this.key(identity, gameId)
    this.entries.delete(key)
    this.entries.set(key, { match, expires: this.now() + this.ttlMs })
    while (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value!)
    }
  }
}

const sharedPool = new ReviewRequestPool()
const sharedCache = new ReviewMatchCache()

export function getReviewCandidate(
  summary: SgpGameSummaryLol,
  puuid: string
): ReviewCandidate | null {
  const eligibility = getReviewSummaryEligibility(summary, puuid)
  if (!eligibility.ok) return null
  const self = eligibility.participant
  const roleOf = (participant: typeof self) => {
    const primary = normalizeReviewPosition(participant.teamPosition)
    return primary !== 'UNKNOWN' ? primary : normalizeReviewPosition(participant.individualPosition)
  }
  const position = roleOf(self)
  const opponents = summary.json.participants.filter(
    (participant) => participant.teamId !== self.teamId && roleOf(participant) === position
  )
  const ownRoleCount = summary.json.participants.filter(
    (participant) => participant.teamId === self.teamId && roleOf(participant) === position
  ).length
  return {
    gameId: summary.json.gameId,
    championId: self.championId,
    position,
    opponentChampionId:
      position !== 'UNKNOWN' && ownRoleCount === 1 && opponents.length === 1
        ? opponents[0].championId
        : null,
    queueId: summary.json.queueId,
    patch:
      typeof summary.json.gameVersion === 'string'
        ? summary.json.gameVersion.split('.').slice(0, 2).join('.')
        : '',
    gameCreation: summary.json.gameCreation,
    win: self.win
  }
}

export function matchesReviewCandidate(candidate: ReviewCandidate, filter: ReviewFilter) {
  return (
    (!filter.championId || candidate.championId === filter.championId) &&
    (!filter.position || candidate.position === filter.position) &&
    (!filter.opponentChampionId || candidate.opponentChampionId === filter.opponentChampionId) &&
    (!filter.patch || candidate.patch === filter.patch) &&
    (!filter.queueId || candidate.queueId === filter.queueId)
  )
}

export function describeReviewFailure(gameId: number, error: unknown): ReviewLoadFailure {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status === 401 || status === 403) {
    return {
      gameId,
      kind: 'unavailable',
      reason: '服务器拒绝访问，请检查登录状态或该区战绩访问权限'
    }
  }
  if (status === 404) {
    return { gameId, kind: 'unavailable', reason: '服务器未提供该场对局或时间线' }
  }
  return { gameId, kind: 'network', reason: 'SGP 请求失败，请检查网络或加速器后重试' }
}

export function createReviewDataLoader(
  api: ReviewFetchApi,
  pool = sharedPool,
  cache = sharedCache
) {
  async function scanHistory(
    identity: ReviewIdentity,
    signal: AbortSignal,
    onProgress: (
      scanned: number,
      skipped: number,
      summaries: SgpGameSummaryLol[]
    ) => void = () => {}
  ) {
    const summaries = new Map<number, SgpGameSummaryLol>()
    const seen = new Set<number>()
    let scanned = 0
    let skipped = 0
    let exhausted = false
    let failure: ReviewLoadFailure | null = null
    for (let start = 0; start < 500; start += 100) {
      assertReviewNotAborted(signal)
      let page: SgpGameSummaryLol[]
      try {
        page = await pool.run(signal, () => api.history(identity, start, 100, signal))
        if (!Array.isArray(page)) throw new Error('Invalid history response')
      } catch (error) {
        if (isReviewAbort(error) || signal.aborted) throw reviewAbortError()
        failure = describeReviewFailure(0, error)
        break
      }
      scanned += Math.min(page.length, 100)
      for (const summary of page.slice(0, 100)) {
        const id = summary?.json?.gameId
        if (!Number.isSafeInteger(id) || seen.has(id)) continue
        seen.add(id)
        if (getReviewCandidate(summary, identity.puuid)) summaries.set(id, summary)
        else skipped++
      }
      onProgress(scanned, skipped, [...summaries.values()])
      if (page.length < 100) {
        exhausted = true
        break
      }
    }
    assertReviewNotAborted(signal)
    return {
      summaries: [...summaries.values()].sort(
        (a, b) => b.json.gameCreation - a.json.gameCreation || b.json.gameId - a.json.gameId
      ),
      scanned,
      skipped,
      truncated: !exhausted,
      failure
    }
  }

  async function loadMatch(
    identity: ReviewIdentity,
    gameId: number,
    signal: AbortSignal,
    summary?: SgpGameSummaryLol,
    refresh = false
  ) {
    assertReviewNotAborted(signal)
    const cached = refresh ? null : cache.get(identity, gameId)
    if (cached) return { ok: true as const, match: cached }
    try {
      const actualSummary =
        summary ?? (await pool.run(signal, () => api.summary(identity, gameId, signal)))
      if (actualSummary?.json?.gameId !== gameId) {
        return {
          ok: false as const,
          failure: { gameId, kind: 'invalid' as const, reason: '服务器返回了不匹配的对局编号' }
        }
      }
      const eligibility = getReviewSummaryEligibility(actualSummary, identity.puuid)
      if (!eligibility.ok) {
        return {
          ok: false as const,
          failure: { gameId, kind: 'invalid' as const, reason: eligibility.reason }
        }
      }
      const details = await pool.run(signal, () => api.details(identity, gameId, signal))
      if (details?.json?.gameId !== gameId) {
        return {
          ok: false as const,
          failure: { gameId, kind: 'invalid' as const, reason: '服务器返回了不匹配的时间线编号' }
        }
      }
      const parsed = parseReviewMatch(actualSummary, details, identity.puuid, identity.sgpServerId)
      assertReviewNotAborted(signal)
      if (!parsed.ok)
        return {
          ok: false as const,
          failure: { gameId, kind: 'invalid' as const, reason: parsed.reason }
        }
      if (
        parsed.match.quality.timelineCoverage === 1 &&
        parsed.match.quality.eventCoverage === 'complete'
      ) {
        cache.put(identity, gameId, parsed.match)
      }
      return parsed
    } catch (error) {
      if (isReviewAbort(error) || signal.aborted) throw reviewAbortError()
      return { ok: false as const, failure: describeReviewFailure(gameId, error) }
    }
  }

  return { scanHistory, loadMatch }
}
