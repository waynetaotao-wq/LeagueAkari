import { type ReviewCandidate, matchesReviewCandidate } from './data-loader'
import { filterReviewMatches } from './statistics'
import type { ReviewFilter, ReviewMatch, ReviewPosition } from './types'

/** Defaults are drawn only from actual records; never invent a champion, role or patch. */
export function getReviewDefaultContext(
  candidates: ReviewCandidate[],
  preferredChampionId?: number | null,
  preferredPosition?: ReviewPosition
) {
  const ordered = [...candidates].sort(
    (a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId
  )
  if (!ordered.length) return null
  const preferred = ordered.filter((record) => record.championId === preferredChampionId)
  const selected =
    preferred.find((record) => record.position === preferredPosition) ??
    preferred.find((record) => record.position === 'MIDDLE') ??
    preferred[0] ??
    ordered.find((record) => record.championId === 238 && record.position === 'MIDDLE') ??
    ordered[0]
  const sameContext = ordered.filter(
    (record) => record.championId === selected.championId && record.position === selected.position
  )
  const queueId = sameContext.some((record) => record.queueId === 420)
    ? 420
    : sameContext[0].queueId
  const patch = sameContext.find((record) => record.queueId === queueId)!.patch || null
  return { championId: selected.championId, position: selected.position, queueId, patch }
}

export type ReviewBroadenOffer =
  /** History summaries that the current filter leaves out; `limit` is the batch size to request. */
  | { mode: 'analyze'; current: number; total: number; limit: 20 | 40 | 60 }
  /** Nothing new to analyze, but the filter hides games already kept on this device. */
  | { mode: 'show'; current: number; total: number }

/**
 * Whether dropping the opponent, queue and patch restrictions would bring in more games of the same
 * champion and role. `current` counts games under the filter as it is, `total` counts them once
 * those three restrictions are gone. Returns null when widening would add nothing.
 */
export function getReviewBroadenOffer(
  filter: ReviewFilter,
  candidates: ReviewCandidate[],
  stored: ReviewMatch[]
): ReviewBroadenOffer | null {
  if (!filter.championId) return null
  const broad: ReviewFilter = { championId: filter.championId, position: filter.position }
  const current = candidates.filter((candidate) => matchesReviewCandidate(candidate, filter)).length
  const total = candidates.filter((candidate) => matchesReviewCandidate(candidate, broad)).length
  if (total > current)
    return { mode: 'analyze', current, total, limit: total <= 20 ? 20 : total <= 40 ? 40 : 60 }
  const shown = filterReviewMatches(stored, filter).length
  const kept = filterReviewMatches(stored, broad).length
  return kept > shown ? { mode: 'show', current: shown, total: kept } : null
}
