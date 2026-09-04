import { REVIEW_MAX_FRAME_GAP_MS } from './analysis'
import { reviewViewText as text } from './review-view-text'
import type { ReviewEvent, ReviewFrame, ReviewParticipant } from './types'

export function reviewTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(timestamp / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function reviewSigned(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}`
}

/** Missing whole frames also need explicit Chart.js nulls, not an invented line across the gap. */
export function reviewGoldPoints(frames: ReviewFrame[], key: 'personalGoldDiff' | 'teamGoldDiff') {
  const points: { x: number; y: number | null }[] = []
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    const previous = frames[index - 1]
    if (previous && frame.timestamp - previous.timestamp > REVIEW_MAX_FRAME_GAP_MS) {
      points.push({ x: (previous.timestamp + frame.timestamp) / 2, y: null })
    }
    points.push({ x: frame.timestamp, y: frame[key] })
  }
  return points
}

/** Seek to the latest available snapshot at or before an exact event timestamp. */
export function findReviewFrameIndex(frames: ReviewFrame[], timestamp: number) {
  if (!frames.length) return -1
  let left = 0
  let right = frames.length - 1
  while (left < right) {
    const mid = Math.ceil((left + right) / 2)
    if (frames[mid].timestamp <= timestamp) left = mid
    else right = mid - 1
  }
  return left
}

export function isReviewEventRelated(event: ReviewEvent, participantId: number) {
  return (
    event.killerId === participantId ||
    event.victimId === participantId ||
    event.assistingParticipantIds.includes(participantId)
  )
}

export function reviewEventText(
  event: ReviewEvent,
  participants: ReviewParticipant[],
  championName: (id: number) => string,
  ownTeamId: number
) {
  const name = (id: number | null) => {
    if (id === null || id === 0) return text.system
    const participant = participants.find((p) => p.participantId === id)
    return participant ? championName(participant.championId) : text.unknownPlayer
  }
  if (event.type === 'kill') return text.kill(name(event.killerId), name(event.victimId))
  const actor = event.killerId
    ? name(event.killerId)
    : event.teamId === null
      ? text.system
      : event.teamId === ownTeamId
        ? text.ally
        : text.enemy
  if (event.type === 'building') {
    const lane =
      { TOP_LANE: text.top, MID_LANE: text.mid, BOT_LANE: text.bottom }[event.laneType ?? ''] ?? ''
    const building =
      event.buildingType === 'TOWER_BUILDING'
        ? text.turret
        : event.buildingType === 'INHIBITOR_BUILDING'
          ? text.inhibitor
          : text.unknownBuilding
    return text.objective(actor, `${lane}${building}`)
  }
  const monster =
    event.monsterSubType === 'ELDER_DRAGON'
      ? text.elder
      : ({
          DRAGON: text.dragon,
          BARON_NASHOR: text.baron,
          RIFTHERALD: text.herald,
          HORDE: text.voidGrub,
          ATAKHAN: text.atakhan
        }[event.monsterType ?? ''] ?? text.unknownObjective)
  return text.objective(actor, monster)
}
