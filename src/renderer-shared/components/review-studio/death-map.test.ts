import { describe, expect, it } from 'vitest'

import {
  type ReviewDeathFilter,
  buildReviewDeathHeat,
  classifyReviewDeathZone,
  collectReviewDeaths,
  summarizeReviewDeaths
} from './death-map'
import type { ReviewDeath, ReviewMatch } from './types'

const everything: ReviewDeathFilter = {
  fromMs: 0,
  toMs: Infinity,
  outcome: 'all',
  kind: 'all',
  side: 'all'
}

function death(timestamp: number, x: number, y: number, extra: Partial<ReviewDeath> = {}) {
  return {
    timestamp,
    point: { x, y },
    killer: { championId: 103, role: 'MIDDLE' },
    assists: [],
    shutdownBounty: 0,
    ...extra
  } satisfies ReviewDeath
}

function match(
  gameId: number,
  deaths: ReviewDeath[] | undefined,
  options: { win?: boolean; teamId?: 100 | 200; duration?: number; partial?: boolean } = {}
): ReviewMatch {
  return {
    meta: {
      gameId,
      sgpServerId: 'NA1',
      puuid: 'self',
      gameCreation: gameId * 1000,
      gameDuration: options.duration ?? 1800,
      queueId: 420,
      patch: '16.22',
      championId: 238,
      position: 'MIDDLE',
      participantId: 3,
      teamId: options.teamId ?? 100,
      opponentId: 8,
      opponentChampionId: 103,
      win: options.win ?? false
    },
    participants: [],
    frames: [],
    events: [],
    moments: [],
    snapshots: [],
    quality: {
      expectedFrames: 31,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 3,
      validCsSnapshots: 3,
      validTeamSnapshots: 3,
      eventCoverage: options.partial ? 'partial' : 'complete',
      warnings: []
    },
    deaths
  }
}

describe('review death map', () => {
  // Turret, pit and camp coordinates as recorded in real timelines.
  it.each([
    ['blue outer mid turret', 5846, 6396, 'mid-own', 'mid-enemy'],
    ['red outer mid turret', 8955, 8510, 'mid-enemy', 'mid-own'],
    ['blue outer top turret', 981, 10441, 'top-own', 'top-enemy'],
    ['red outer top turret', 4318, 13875, 'top-enemy', 'top-own'],
    ['blue outer bottom turret', 10504, 1029, 'bot-own', 'bot-enemy'],
    ['red outer bottom turret', 13866, 4505, 'bot-enemy', 'bot-own'],
    ['dragon pit', 9866, 4414, 'river-bot', 'river-bot'],
    ['baron pit', 5007, 10471, 'river-top', 'river-top'],
    ['blue-side blue buff', 3800, 7900, 'jungle-own-top', 'jungle-enemy-top'],
    ['blue-side red buff', 7800, 4000, 'jungle-own-bot', 'jungle-enemy-bot'],
    ['red-side blue buff', 11000, 7000, 'jungle-enemy-bot', 'jungle-own-bot'],
    ['red-side red buff', 7100, 10900, 'jungle-enemy-top', 'jungle-own-top'],
    ['blue inhibitor turret', 3651, 3696, 'own-base', 'enemy-base'],
    ['red fountain', 14340, 14391, 'enemy-base', 'own-base']
  ] as const)('places the %s in the expected zone for each side', (_name, x, y, blue, red) => {
    expect(classifyReviewDeathZone({ x, y }, 100)).toBe(blue)
    expect(classifyReviewDeathZone({ x, y }, 200)).toBe(red)
  })

  it('only counts games whose kill records are complete and labels how each death happened', () => {
    const sample = collectReviewDeaths([
      match(1, [
        death(300_000, 7500, 7500),
        death(400_000, 9866, 4414, {
          killer: { championId: 64, role: 'JUNGLE' },
          assists: [{ championId: 103, role: 'MIDDLE' }]
        }),
        death(500_000, 5846, 6396, { killer: null }),
        death(600_000, 7500, 7500, { killer: { championId: 1, role: 'UNKNOWN' } }),
        { ...death(700_000, 0, 0), point: null }
      ]),
      match(1, [death(1, 1, 1)]),
      match(2, undefined),
      match(3, [death(100_000, 7500, 7500)], { partial: true })
    ])
    expect(sample.games.map((game) => game.gameId)).toEqual([1])
    expect([sample.legacyGames, sample.partialGames]).toEqual([1, 1])
    expect(sample.entries.map((entry) => [entry.kind, entry.jungle, entry.zone])).toEqual([
      ['solo', false, 'mid-enemy'],
      ['group', true, 'river-bot'],
      ['execute', false, 'mid-own'],
      ['solo', null, 'mid-enemy'],
      ['solo', false, null]
    ])
  })

  it('summarises the selected deaths against the games that reached that time window', () => {
    const sample = collectReviewDeaths([
      match(1, [death(300_000, 9866, 4414), death(1_500_000, 7500, 7500)], { win: true }),
      match(2, [death(330_000, 9900, 4400), death(360_000, 9800, 4500)], { teamId: 200 }),
      match(3, [], { duration: 900 }),
      match(4, [death(200_000, 5007, 10471, { assists: [{ championId: 64, role: 'JUNGLE' }] })])
    ])
    const all = summarizeReviewDeaths(sample, everything).summary
    expect(all).toMatchObject({ games: 4, deaths: 5, perGame: 1.25, located: 5, solo: 4, group: 1 })
    expect(all.zones[0]).toEqual({ zone: 'river-bot', deaths: 3, share: 0.6, games: 2 })
    expect(all.timeline.slice(0, 4)).toEqual([0, 1, 2, 1])
    expect(all.timeline[12]).toBe(1)

    const late = summarizeReviewDeaths(sample, { ...everything, fromMs: 1_200_000 })
    expect(late.summary).toMatchObject({ games: 3, deaths: 1 })
    expect(late.entries.map((entry) => entry.gameId)).toEqual([1])
    // The histogram always covers the whole game so the chosen window can be seen in context.
    expect(late.summary.timeline).toEqual(all.timeline)

    expect(summarizeReviewDeaths(sample, { ...everything, outcome: 'win' }).summary).toMatchObject({
      games: 1,
      deaths: 2
    })
    expect(summarizeReviewDeaths(sample, { ...everything, side: 'red' }).summary).toMatchObject({
      games: 1,
      deaths: 2
    })
    expect(summarizeReviewDeaths(sample, { ...everything, kind: 'jungle' }).summary).toMatchObject({
      deaths: 1,
      jungle: 1
    })
  })

  it('names a hotspot only when enough deaths from enough games share one zone', () => {
    const spread = (games: number, perGame: number) =>
      collectReviewDeaths(
        Array.from({ length: games }, (_, index) =>
          match(
            index + 1,
            Array.from({ length: perGame }, (_, n) => death(300_000 + n, 9866, 4414))
          )
        )
      )
    expect(summarizeReviewDeaths(spread(3, 2), everything).summary.hotspot).toMatchObject({
      zone: 'river-bot',
      deaths: 6,
      games: 3
    })
    expect(summarizeReviewDeaths(spread(2, 3), everything).summary.hotspot).toBeNull()
    expect(summarizeReviewDeaths(spread(4, 1), everything).summary.hotspot).toBeNull()

    const diluted = collectReviewDeaths([
      ...Array.from({ length: 3 }, (_, index) =>
        match(index + 1, [death(1, 9866, 4414), death(2, 9866, 4414)])
      ),
      match(9, [
        death(1, 7500, 7500),
        death(2, 981, 10441),
        death(3, 4318, 13875),
        death(4, 10504, 1029),
        death(5, 13866, 4505),
        death(6, 5007, 10471),
        death(7, 3800, 7900),
        death(8, 7800, 4000),
        death(9, 11000, 7000),
        death(10, 7100, 10900),
        death(11, 3651, 3696),
        death(12, 14340, 14391),
        death(13, 5846, 6396),
        death(14, 2000, 2000),
        death(15, 13000, 13000),
        death(16, 1500, 9000),
        death(17, 9000, 1500),
        death(18, 6000, 9000),
        death(19, 6500, 6500)
      ])
    ])
    const dilutedSummary = summarizeReviewDeaths(diluted, everything).summary
    expect(dilutedSummary.zones[0].share).toBeLessThan(0.25)
    expect(dilutedSummary.hotspot).toBeNull()
  })

  it('draws the densest spot brightest and leaves an empty selection blank', () => {
    expect(Math.max(...buildReviewDeathHeat([], 16))).toBe(0)
    const heat = buildReviewDeathHeat(
      [
        { x: 9866, y: 4414 },
        { x: 9900, y: 4400 },
        { x: 9800, y: 4450 },
        { x: 2000, y: 12000 }
      ],
      32
    )
    // Row 0 is the top of the map, so the dragon pit sits in the lower-right part of the grid.
    const brightest = heat.indexOf(Math.max(...heat))
    expect(Math.max(...heat)).toBe(1)
    expect([brightest % 32, Math.floor(brightest / 32)]).toEqual([21, 22])
    expect(
      heat[Math.floor(32 * (1 - 12000 / 14881)) * 32 + Math.floor((32 * 2000) / 14820)]
    ).toBeGreaterThan(0.2)
    // The top-right corner is far from every point.
    expect(heat[31]).toBe(0)
  })
})
