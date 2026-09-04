import { describe, expect, it } from 'vitest'

import {
  findReviewFrameIndex,
  isReviewEventRelated,
  reviewEventText,
  reviewGoldPoints,
  reviewSigned
} from './review-view-utils'
import type { ReviewEvent, ReviewFrame, ReviewParticipant } from './types'

const frames: ReviewFrame[] = [0, 60_000, 180_000].map((timestamp) => ({
  timestamp,
  participants: [],
  personalGoldDiff: null,
  personalCsDiff: null,
  teamGoldDiff: null
}))
const event: ReviewEvent = {
  id: 'kill-1',
  type: 'kill',
  timestamp: 120_000,
  killerId: 1,
  victimId: 2,
  assistingParticipantIds: [3],
  teamId: 100,
  position: null,
  shutdownBounty: null,
  buildingType: null,
  laneType: null,
  monsterType: null,
  monsterSubType: null
}
const participants: ReviewParticipant[] = [1, 2, 3].map((participantId) => ({
  participantId,
  puuid: `${participantId}`,
  name: `private-${participantId}`,
  championName: 'raw-name',
  championId: participantId * 10,
  teamId: participantId === 2 ? 200 : 100,
  position: 'MIDDLE',
  win: true
}))

describe('review timeline presentation contracts', () => {
  it('seeks backwards across missing frames instead of showing future positions', () => {
    expect(findReviewFrameIndex(frames, 120_000)).toBe(1)
    expect(findReviewFrameIndex(frames, 180_000)).toBe(2)
    expect(findReviewFrameIndex(frames, 1_000_000)).toBe(2)
    expect(findReviewFrameIndex([], 0)).toBe(-1)
  })
  it('keeps missing values distinct from real zero', () => {
    expect(reviewSigned(null)).toBe('—')
    expect(reviewSigned(0)).toBe('0')
    expect(reviewSigned(100)).toBe('+100')
  })
  it('breaks the gold line across missing whole frames and retains original sample times', () => {
    const points = reviewGoldPoints(
      frames.map((frame, index) => ({ ...frame, personalGoldDiff: index * 100 })),
      'personalGoldDiff'
    )
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 60_000, y: 100 },
      { x: 120_000, y: null },
      { x: 180_000, y: 200 }
    ])
    expect(
      reviewGoldPoints([{ ...frames[0], personalGoldDiff: null }], 'personalGoldDiff')
    ).toEqual([{ x: 0, y: null }])
  })
  it('includes assists in personal event filtering', () => {
    expect(isReviewEventRelated(event, 3)).toBe(true)
    expect(isReviewEventRelated(event, 4)).toBe(false)
  })
  it('describes heroes through localized resources without leaking player names', () => {
    const names = (championId: number) =>
      ({ 10: '劫', 20: '阿狸', 30: '盲僧' })[championId] ?? '未知'
    expect(reviewEventText(event, participants, names, 100)).toBe('劫 击杀 阿狸')
    expect(reviewEventText({ ...event, killerId: null }, participants, names, 100)).toBe(
      '系统 / 未知来源 击杀 阿狸'
    )
  })
  it('does not assign an unknown objective killer to the player', () => {
    const label = reviewEventText(
      {
        ...event,
        type: 'building',
        killerId: null,
        victimId: null,
        teamId: 200,
        buildingType: 'TOWER_BUILDING',
        laneType: 'MID_LANE'
      },
      participants,
      String,
      100
    )
    expect(label).toBe('敌方 拿下 中路防御塔')
  })
})
