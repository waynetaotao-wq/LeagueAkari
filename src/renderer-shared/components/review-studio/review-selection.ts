import type { ReviewCandidate } from './data-loader'
import type { ReviewPosition } from './types'

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
