import { describe, expect, it } from 'vitest'

import {
  type ReviewGapMetricId,
  compareReviewOutcomes,
  compareReviewSamples,
  sortReviewGapRows
} from './outcome-gap'
import type { ReviewEarlyFacts, ReviewMatch } from './types'

function match(
  gameId: number,
  win: boolean,
  early: Partial<ReviewEarlyFacts> | null,
  snapshots: { gold10?: number | null; cs10?: number | null } = {}
): ReviewMatch {
  return {
    meta: {
      gameId,
      sgpServerId: 'NA1',
      puuid: 'self',
      gameCreation: gameId * 1000,
      gameDuration: 1800,
      queueId: 420,
      patch: '16.22',
      championId: 238,
      position: 'MIDDLE',
      participantId: 3,
      teamId: 100,
      opponentId: 8,
      opponentChampionId: 103,
      win
    },
    participants: [],
    frames: [],
    events: [],
    moments: [],
    snapshots: [
      {
        minute: 10,
        timestamp: 600_000,
        personalGoldDiff: snapshots.gold10 ?? null,
        personalCsDiff: snapshots.cs10 ?? null,
        teamGoldDiff: null
      }
    ],
    quality: {
      expectedFrames: 31,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 1,
      validCsSnapshots: 1,
      validTeamSnapshots: 0,
      eventCoverage: 'complete',
      warnings: []
    },
    early:
      early === null
        ? null
        : {
            cs10: null,
            deathsBefore10: null,
            soloDeathsBefore14: null,
            jungleDeathsBefore14: null,
            takedownsBefore14: null,
            wardsBefore10: null,
            controlWardsBefore15: null,
            firstShopAt: null,
            firstCoreItemAt: null,
            firstCoreItemId: null,
            platesTaken: null,
            platesLost: null,
            roamsBefore14: null,
            ...early
          }
  }
}

function row(report: ReturnType<typeof compareReviewOutcomes>, id: ReviewGapMetricId) {
  return report.rows.find((value) => value.metric.id === id)!
}

describe('review win/loss comparison', () => {
  it('measures how completely two samples separate without assuming a distribution', () => {
    const apart = compareReviewSamples([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])!
    expect(apart.separation).toBe(1)
    expect(apart.z).toBeCloseTo(2.507, 3)
    const mirrored = compareReviewSamples([6, 7, 8, 9, 10], [1, 2, 3, 4, 5])!
    expect(mirrored.separation).toBe(0)
    expect(mirrored.z).toBeCloseTo(-apart.z, 10)
    expect(compareReviewSamples([2, 2, 2], [2, 2, 2, 2])).toEqual({ separation: 0.5, z: 0 })
    expect(compareReviewSamples([1, 2], [])).toBeNull()
    // Ties count half: one of four pairs is tied, one favours the loss value.
    expect(compareReviewSamples([1, 3], [1, 2])!.separation).toBe(0.375)
  })

  it('reports each metric from its own measurable games and grades the separation', () => {
    const games = [
      ...Array.from({ length: 10 }, (_, index) =>
        match(
          100 + index,
          true,
          {
            firstCoreItemAt: 540_000 + index * 10_000,
            firstCoreItemId: 6699,
            deathsBefore10: index % 2,
            controlWardsBefore15: 0,
            roamsBefore14: index < 3 ? index : null
          },
          { gold10: 300 + index * 20 }
        )
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        match(
          200 + index,
          false,
          {
            firstCoreItemAt: 700_000 + index * 10_000,
            firstCoreItemId: 6699,
            deathsBefore10: 1 + (index % 3),
            controlWardsBefore15: 0,
            roamsBefore14: index < 3 ? 2 : null
          },
          { gold10: index < 4 ? -500 : null }
        )
      ),
      match(100, true, { deathsBefore10: 9 }),
      match(300, false, null, { gold10: -900 })
    ]
    const report = compareReviewOutcomes(games)
    expect(report).toMatchObject({ games: 21, wins: 10, losses: 11, legacyGames: 1 })

    const item = row(report, 'firstCoreItemAt')
    expect(item).toMatchObject({ strength: 'clear', separation: 1, difference: 160_000 })
    expect([item.win.samples, item.win.median, item.win.q1, item.win.q3]).toEqual([
      10, 585_000, 562_500, 607_500
    ])
    expect(item.loss.values.at(-1)).toEqual({ gameId: 209, gameCreation: 209_000, value: 790_000 })

    const deaths = row(report, 'deathsBefore10')
    expect(deaths.win.center).toBe(0.5)
    expect(deaths.loss.center).toBeCloseTo(1.9, 10)
    expect(deaths.strength).toBe('clear')

    expect(row(report, 'controlWardsBefore15')).toMatchObject({
      strength: 'none',
      separation: 0.5,
      difference: 0
    })
    expect(row(report, 'roamsBefore14')).toMatchObject({ strength: 'insufficient' })
    expect(row(report, 'roamsBefore14').win.samples).toBe(3)
    // Archived games without early measurements still feed the snapshot-based metrics.
    expect(row(report, 'goldDiff10').loss.samples).toBe(5)
    expect(row(report, 'goldDiff10').strength).toBe('possible')
    expect(row(report, 'cs10')).toMatchObject({ strength: 'insufficient', difference: null })
  })

  it('lists the clearest separations first and keeps a stable order among equals', () => {
    const report = compareReviewOutcomes([
      ...Array.from({ length: 8 }, (_, index) =>
        match(100 + index, true, { deathsBefore10: 0, firstShopAt: 200_000 + index * 1000 })
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        match(200 + index, false, { deathsBefore10: 2, firstShopAt: 200_500 + index * 1000 })
      )
    ])
    const order = sortReviewGapRows(report.rows).map((value) => value.metric.id)
    expect(order.slice(0, 2)).toEqual(['deathsBefore10', 'firstShopAt'])
    expect(order.slice(2, 5)).toEqual([
      'soloDeathsBefore14',
      'jungleDeathsBefore14',
      'wardsBefore10'
    ])
  })
})
