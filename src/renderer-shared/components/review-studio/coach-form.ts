import { RANK_LOG_QUEUE_IDS, type RankLogEntryDto } from '@shared/shards/rank-log'
import { summarizeRankLog } from '@shared/shards/rank-log/stats'

import type { ReviewCoachForm } from './coach-context'
import type { ReviewMatch } from './types'

/**
 * The player's rank and recent form for the coach, read from the rank log. Rank, recent record
 * and streak describe the present; the point change and the place in the session belong to the
 * reviewed game. A normal game borrows the solo queue's rank and has no game-specific part.
 * null when the log has nothing for that queue.
 */
export function buildReviewCoachForm(
  entries: readonly RankLogEntryDto[],
  meta: Pick<ReviewMatch['meta'], 'gameId' | 'queueId'>,
  options: {
    now: number
    /** Writes a rank in words; the wording belongs to the interface language. */
    rankText: (entry: RankLogEntryDto) => string | null
  }
): ReviewCoachForm | null {
  const rankedQueue = RANK_LOG_QUEUE_IDS[meta.queueId]
  const queueType = rankedQueue ?? 'RANKED_SOLO_5x5'
  if (!entries.some((entry) => entry.queueType === queueType)) return null

  const summary = summarizeRankLog(entries, { queueType, now: options.now })
  const game = rankedQueue
    ? summary.games.find((candidate) => candidate.entry.gameId === meta.gameId)
    : undefined
  return {
    rank: summary.current ? options.rankText(summary.current) : null,
    recent: summary.recent.games
      ? { games: summary.recent.games, wins: summary.recent.wins }
      : null,
    streak: summary.streak,
    lpDelta: game?.entry.lpDelta ?? null,
    sessionIndex: game?.sessionIndex ?? null,
    lossesBefore: game?.lossesBefore ?? null
  }
}
