import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import {
  analyzeLeadConversion,
  buildReviewTrend,
  filterReviewMatches,
  groupReviewMatchups,
  summarizeReviewMatches
} from './statistics'
import { addReviewEvent, createReviewFixture, reviewDragon, reviewKill } from './test-fixtures'

function match(id: number, win = true) {
  const fixture = createReviewFixture({ gameId: id, win })
  addReviewEvent(fixture.details, reviewKill(610_000))
  addReviewEvent(fixture.details, reviewDragon(640_000))
  const result = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId
  )
  if (!result.ok) throw new Error(result.reason)
  return result.match
}

describe('review longitudinal statistics', () => {
  it('filters by actual champion, role, counterpart, patch and queue and removes duplicates', () => {
    const first = match(1)
    const second = match(2)
    second.meta.patch = '16.16'
    const third = match(3)
    third.meta.opponentChampionId = 7
    const fourth = match(4)
    fourth.meta.position = 'TOP'
    const fifth = match(5)
    fifth.meta.queueId = 440
    expect(
      filterReviewMatches([first, first, second, third, fourth, fifth], {
        championId: 238,
        position: 'MIDDLE',
        opponentChampionId: 103,
        patch: '16.17',
        queueId: 420
      }).map((m) => m.meta.gameId)
    ).toEqual([1])
    expect(groupReviewMatchups([first, first, second, third, fourth])).toHaveLength(3)
  })

  it('uses independent denominators, preserves zero, and exposes sample dispersion', () => {
    const a = match(1)
    const b = match(2, false)
    a.snapshots[0].personalGoldDiff = 0
    b.snapshots[0].personalGoldDiff = null
    a.snapshots[0].personalCsDiff = 10
    b.snapshots[0].personalCsDiff = 20
    const stats = summarizeReviewMatches([a, a, b])
    expect(stats).toMatchObject({ games: 2, wins: 1, winRate: 0.5 })
    expect(stats.gold10).toEqual({ mean: 0, samples: 1, min: 0, max: 0, standardDeviation: null })
    expect(stats.cs10).toMatchObject({ mean: 15, samples: 2, min: 10, max: 20 })
    expect(stats.cs10.standardDeviation).toBeCloseTo(Math.sqrt(50))
    expect(summarizeReviewMatches([]).gold10.mean).toBeNull()
    expect(summarizeReviewMatches([]).winRate).toBeNull()
  })

  it('compares disjoint equal recent/previous groups capped at 20 without mixing time order', () => {
    const matches = Array.from({ length: 43 }, (_, id) => match(id + 1))
    const trend = buildReviewTrend(matches.reverse())
    expect(trend.recent.games).toBe(20)
    expect(trend.previous.games).toBe(20)
    expect(trend.recentMatches[0].meta.gameId).toBe(43)
    expect(trend.previousMatches[0].meta.gameId).toBe(23)
    expect(
      new Set([...trend.recentMatches, ...trend.previousMatches].map((m) => m.meta.gameId)).size
    ).toBe(40)
    expect(buildReviewTrend([match(1), match(2), match(3)]).recent.games).toBe(1)
    expect(buildReviewTrend([match(1)]).recent.games).toBe(0)
  })

  it('uses threshold equality and the selected checkpoint/scope, retaining source games', () => {
    const a = match(1)
    a.snapshots[0].personalGoldDiff = 500
    a.snapshots[0].teamGoldDiff = 1499
    const b = match(2, false)
    b.snapshots[0].personalGoldDiff = 499
    b.snapshots[0].teamGoldDiff = 1500
    const personal = analyzeLeadConversion([a, b], { checkpoint: 10, scope: 'personal' })
    expect(personal).toMatchObject({ games: 1, wins: 1, eligibleGames: 2, excludedGames: 0 })
    expect(personal.entries[0].match).toBe(a)
    expect(personal.entries[0].deaths).toHaveLength(1)
    expect(personal.entries[0].enemyObjectives).toHaveLength(1)
    const team = analyzeLeadConversion([a, b], { checkpoint: 10, scope: 'team', outcome: 'loss' })
    expect(team.entries.map((e) => e.match.meta.gameId)).toEqual([2])
    expect(team.entries[0].snapshots.map((s) => s.minute)).toEqual([10, 15, 20])
  })

  it('distinguishes not leading from unavailable evidence and counts each game once', () => {
    const missing = match(1)
    missing.snapshots[0].personalGoldDiff = null
    missing.snapshots[1].personalGoldDiff = null
    const behind = match(2)
    behind.snapshots[0].personalGoldDiff = -1000
    behind.snapshots[1].personalGoldDiff = -1000
    const late = match(3)
    late.snapshots[0].personalGoldDiff = -1
    late.snapshots[1].personalGoldDiff = 500
    const stats = analyzeLeadConversion([missing, behind, late, late], { scope: 'personal' })
    expect(stats).toMatchObject({ games: 1, eligibleGames: 2, excludedGames: 1 })
    expect(stats.entries[0].checkpoint).toBe(15)
    expect(stats.entries[0].deaths).toHaveLength(0)
    expect(stats.entries[0].snapshots.map((s) => s.minute)).toEqual([15, 20])
  })
})
