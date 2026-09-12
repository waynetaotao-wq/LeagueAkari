import type { ReviewMatch, ReviewMoment } from './types'

/** Select an actual early checkpoint; a missing 15-minute sample never becomes a zero. */
export function getReviewOverview(match: ReviewMatch) {
  const checkpoint =
    [15, 10].flatMap((minute) => {
      const snapshot = match.snapshots.find((value) => value.minute === minute)
      return snapshot?.timestamp != null &&
        (snapshot.personalGoldDiff !== null || snapshot.teamGoldDiff !== null)
        ? [snapshot]
        : []
    })[0] ?? null
  const personal = checkpoint?.personalGoldDiff
  const direction =
    personal == null ? 'unknown' : personal > 0 ? 'ahead' : personal < 0 ? 'behind' : 'even'
  const focus =
    [...match.moments].sort(
      (a, b) => momentPriority(b) - momentPriority(a) || a.start - b.start
    )[0] ?? null
  return { checkpoint, direction, focus }
}

function momentPriority(moment: ReviewMoment) {
  return {
    shutdown: 5,
    'repeated-deaths': 4,
    'death-objective': 3,
    'gold-swing': 2,
    'gold-gain': 1
  }[moment.kind]
}

export function reviewValueTone(value: number | null | undefined) {
  return value == null || value === 0 ? 'default' : value > 0 ? 'success' : 'error'
}
