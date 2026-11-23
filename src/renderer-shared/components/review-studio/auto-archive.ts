import type { SgpGameSummaryLol } from '@shared/types/sgp/match-history'

import { type ReviewArchiveScope, readReviewArchive, writeReviewArchive } from './archive'
import {
  type ReviewFetchApi,
  type ReviewIdentity,
  assertReviewNotAborted,
  createReviewDataLoader,
  getReviewCandidate,
  isReviewAbort
} from './data-loader'
import type { ReviewStorageAdapter } from './notes'
import type { ReviewMatch } from './types'

// [lolps] 自动存档：每局结束后把能复盘的对局读进本机档案，跨局统计和个人基线才会自己积累。

/** 平时每次看最近这么多条战绩、最多补这么多局。 */
export const REVIEW_AUTO_ARCHIVE_HISTORY_COUNT = 20
export const REVIEW_AUTO_ARCHIVE_MAX_GAMES = 5
/** 程序启动后的第一次多看一些，把没开程序时打的对局补上。 */
export const REVIEW_AUTO_ARCHIVE_CATCH_UP_HISTORY_COUNT = 60
export const REVIEW_AUTO_ARCHIVE_CATCH_UP_MAX_GAMES = 12

export interface ReviewAutoArchiveResult {
  /** History entries looked at. */
  scanned: number
  archived: number
  failed: number
  /** Games still waiting because the per-run limit was reached. */
  remaining: number
}

/**
 * The games worth reading now, newest first: review-eligible, not on this device with their
 * per-game numbers yet, and not already known to be unreadable.
 */
export function planReviewAutoArchive(
  summaries: readonly SgpGameSummaryLol[],
  puuid: string,
  archivedIds: ReadonlySet<number>,
  skippedIds: ReadonlySet<number>
) {
  const games = new Map<number, SgpGameSummaryLol>()
  for (const summary of summaries) {
    const candidate = getReviewCandidate(summary, puuid)
    if (candidate && !archivedIds.has(candidate.gameId) && !skippedIds.has(candidate.gameId))
      games.set(candidate.gameId, summary)
  }
  return [...games.values()].sort(
    (a, b) => b.json.gameCreation - a.json.gameCreation || b.json.gameId - a.json.gameId
  )
}

/**
 * Reads recent history and archives the games that are missing. Games are read one after another
 * so the background work never crowds out what the player is doing in the studio.
 * `skipped` collects games the server cannot provide; the caller keeps it between runs.
 */
export async function runReviewAutoArchive(options: {
  identity: ReviewIdentity
  scope: ReviewArchiveScope
  api: ReviewFetchApi
  storage: ReviewStorageAdapter
  signal: AbortSignal
  historyCount: number
  maxGames: number
  skipped: Set<number>
  loader?: Pick<ReturnType<typeof createReviewDataLoader>, 'loadMatch'>
}): Promise<ReviewAutoArchiveResult> {
  const { identity, scope, api, storage, signal, skipped } = options
  const loader = options.loader ?? createReviewDataLoader(api)
  assertReviewNotAborted(signal)

  const stored = await readReviewArchive(storage, scope)
  // 旧版本留下的存档没有单局数字：只要服务器上还有这一局，就重新读一次补齐。
  const archivedIds = new Set(
    stored.filter((record) => record.match.digest).map((record) => record.match.meta.gameId)
  )
  const history = await api.history(identity, 0, options.historyCount, signal)
  assertReviewNotAborted(signal)
  if (!Array.isArray(history)) throw new Error('Invalid history response')

  const pending = planReviewAutoArchive(history, identity.puuid, archivedIds, skipped)
  const matches: ReviewMatch[] = []
  let failed = 0
  try {
    for (const summary of pending.slice(0, Math.max(0, options.maxGames))) {
      const gameId = summary.json.gameId
      const result = await loader.loadMatch(identity, gameId, signal, summary)
      if (result.ok) {
        matches.push(result.match)
        continue
      }
      failed++
      // 网络问题下一次再试；服务器明确给不出或数据不合格的，不再反复请求。
      if (result.failure.kind === 'network') break
      skipped.add(gameId)
    }
  } catch (error) {
    if (!isReviewAbort(error)) throw error
  } finally {
    // 被打断时也保住已经读到的对局。
    if (matches.length) await writeReviewArchive(storage, scope, matches)
  }
  assertReviewNotAborted(signal)
  return {
    scanned: history.length,
    archived: matches.length,
    failed,
    remaining: Math.max(0, pending.length - matches.length - failed)
  }
}
