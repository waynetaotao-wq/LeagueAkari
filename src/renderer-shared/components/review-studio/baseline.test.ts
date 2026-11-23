import { describe, expect, it } from 'vitest'

import {
  REVIEW_BASELINE_MAX_GAMES,
  REVIEW_BASELINE_MIN_GAMES,
  REVIEW_DIGEST_METRIC_META,
  buildReviewBaseline,
  compareToReviewBaseline,
  selectReviewBaseline
} from './baseline'
import { REVIEW_DIGEST_METRIC_KEYS } from './match-digest'
import type { ReviewDigest, ReviewMatch } from './types'

const digest = (metrics: Record<string, number | null> = {}): ReviewDigest => ({
  metrics,
  coreItems: [],
  bootsItemId: null,
  keystone: null,
  summonerSpells: [],
  skillPriority: null,
  challenges: null
})

let nextGameId = 1
const game = (
  metrics: Record<string, number | null> | null,
  meta: Partial<ReviewMatch['meta']> = {}
): ReviewMatch => {
  const gameId = meta.gameId ?? nextGameId++
  return {
    meta: {
      gameId,
      sgpServerId: 'NA1',
      puuid: 'self',
      gameCreation: 1_780_000_000_000 + gameId * 3_600_000,
      gameDuration: 1800,
      queueId: 420,
      patch: '16.23',
      championId: 238,
      position: 'MIDDLE',
      participantId: 3,
      teamId: 100,
      opponentId: 8,
      opponentChampionId: 103,
      win: true,
      ...meta
    },
    participants: [],
    frames: [],
    events: [],
    moments: [],
    snapshots: [],
    quality: {
      expectedFrames: 0,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 0,
      validCsSnapshots: 0,
      validTeamSnapshots: 0,
      eventCoverage: 'complete',
      warnings: []
    },
    digest: metrics === null ? null : digest(metrics)
  }
}

describe('REVIEW_DIGEST_METRIC_META', () => {
  it('describes every digest metric and nothing else', () => {
    expect(Object.keys(REVIEW_DIGEST_METRIC_META).toSorted()).toEqual(
      [...REVIEW_DIGEST_METRIC_KEYS].toSorted()
    )
  })

  it('reads dying and late items as worse, leads as better, role-bound numbers as neither', () => {
    expect(REVIEW_DIGEST_METRIC_META.deaths.better).toBe('lower')
    expect(REVIEW_DIGEST_METRIC_META.firstCoreAt).toEqual({ unit: 'time', better: 'lower' })
    expect(REVIEW_DIGEST_METRIC_META.goldDiff10).toEqual({ unit: 'diff', better: 'higher' })
    expect(REVIEW_DIGEST_METRIC_META.killParticipation.unit).toBe('share')
    expect(REVIEW_DIGEST_METRIC_META.damageTaken.better).toBeNull()
  })
})

describe('buildReviewBaseline', () => {
  it('summarizes the known values of each metric', () => {
    const baseline = buildReviewBaseline(
      [
        game({ deaths: 4, cs10: 70 }),
        game({ deaths: 2, cs10: null }, { win: false }),
        game({ deaths: 8, cs10: 90 }),
        game({ deaths: 6 }),
        game(null)
      ],
      'champion'
    )!

    expect(baseline).toMatchObject({ scope: 'champion', games: 4, wins: 3 })
    expect(baseline.metrics.deaths).toEqual({
      values: [2, 4, 6, 8],
      samples: 4,
      median: 5,
      q1: 3.5,
      q3: 6.5,
      mean: 5
    })
    expect(baseline.metrics.cs10).toMatchObject({ values: [70, 90], samples: 2, median: 80 })
    expect(baseline.metrics.kills).toMatchObject({ samples: 0, median: null, mean: null })
    expect(baseline.to - baseline.from).toBe(3 * 3_600_000)
  })

  it('has nothing to say without a digest', () => {
    expect(buildReviewBaseline([game(null)], 'position')).toBeNull()
    expect(buildReviewBaseline([], 'position')).toBeNull()
  })
})

describe('selectReviewBaseline', () => {
  const target = () => game({ deaths: 3 }, { gameId: 9000 })
  const many = (count: number, meta: Partial<ReviewMatch['meta']> = {}) =>
    Array.from({ length: count }, () => game({ deaths: 5 }, meta))

  it('prefers the same matchup when it has enough games', () => {
    const baseline = selectReviewBaseline(target(), [
      ...many(REVIEW_BASELINE_MIN_GAMES),
      ...many(8, { opponentChampionId: 61 })
    ])
    expect(baseline).toMatchObject({ scope: 'matchup', games: REVIEW_BASELINE_MIN_GAMES })
  })

  it('falls back to the champion, then to the role', () => {
    expect(
      selectReviewBaseline(target(), [
        ...many(REVIEW_BASELINE_MIN_GAMES - 1),
        ...many(3, { opponentChampionId: 61 })
      ])
    ).toMatchObject({ scope: 'champion', games: REVIEW_BASELINE_MIN_GAMES + 2 })
    expect(
      selectReviewBaseline(target(), [...many(2), ...many(4, { championId: 7 })])
    ).toMatchObject({ scope: 'position', games: 6 })
  })

  it('gives nothing below the minimum', () => {
    expect(selectReviewBaseline(target(), many(REVIEW_BASELINE_MIN_GAMES - 1))).toBeNull()
    expect(selectReviewBaseline(target(), [])).toBeNull()
  })

  it('leaves out the game itself, other players, other roles and games without numbers', () => {
    const baseline = selectReviewBaseline(target(), [
      ...many(REVIEW_BASELINE_MIN_GAMES),
      game({ deaths: 99 }, { gameId: 9000 }),
      game({ deaths: 99 }, { puuid: 'other' }),
      game({ deaths: 99 }, { sgpServerId: 'EUW1' }),
      game({ deaths: 99 }, { position: 'TOP' }),
      game(null)
    ])
    expect(baseline).toMatchObject({ games: REVIEW_BASELINE_MIN_GAMES })
    expect(baseline!.metrics.deaths.values).toEqual(Array(REVIEW_BASELINE_MIN_GAMES).fill(5))
  })

  it('counts a game once even when it is listed twice', () => {
    const games = many(REVIEW_BASELINE_MIN_GAMES)
    expect(selectReviewBaseline(target(), [...games, ...games])).toMatchObject({
      games: REVIEW_BASELINE_MIN_GAMES
    })
  })

  it('keeps only the most recent games', () => {
    const games = many(REVIEW_BASELINE_MAX_GAMES + 10)
    const baseline = selectReviewBaseline(target(), games)!
    expect(baseline.games).toBe(REVIEW_BASELINE_MAX_GAMES)
    expect(baseline.from).toBe(games[10].meta.gameCreation)
    expect(baseline.to).toBe(games.at(-1)!.meta.gameCreation)
  })

  it('has no baseline for a game whose role is unknown', () => {
    expect(
      selectReviewBaseline(game({ deaths: 3 }, { position: 'UNKNOWN' }), [
        ...many(8, { position: 'UNKNOWN' })
      ])
    ).toBeNull()
  })

  it('still uses the champion when the lane opponent is unknown', () => {
    expect(
      selectReviewBaseline(game({ deaths: 3 }, { opponentChampionId: null }), many(6))
    ).toMatchObject({ scope: 'champion' })
  })
})

describe('compareToReviewBaseline', () => {
  const baselineOf = (key: string, values: number[]) =>
    buildReviewBaseline(
      values.map((value) => game({ [key]: value })),
      'champion'
    )!

  it('places a value against the middle half of the baseline games', () => {
    const baseline = baselineOf('deaths', [2, 3, 4, 5, 6, 7, 8, 9])
    const row = (value: number) =>
      compareToReviewBaseline(digest({ deaths: value }), baseline).find(
        (item) => item.key === 'deaths'
      )!

    expect(row(5)).toMatchObject({
      unit: 'count',
      median: 5.5,
      q1: 3.75,
      q3: 7.25,
      samples: 8,
      band: 'typical',
      verdict: 'typical',
      percentile: 0.4375
    })
    expect(row(5).extreme).toBe(false)
    // 死得比平时少是好事，多是坏事。
    expect(row(1)).toMatchObject({ band: 'below', verdict: 'better', percentile: 0, extreme: true })
    expect(row(10)).toMatchObject({
      band: 'above',
      verdict: 'worse',
      percentile: 1,
      extreme: true
    })
  })

  it('calls a value extreme only beyond nine in ten of the baseline games', () => {
    const baseline = baselineOf(
      'deaths',
      Array.from({ length: 20 }, (_, index) => index + 1)
    )
    const row = (value: number) =>
      compareToReviewBaseline(digest({ deaths: value }), baseline).find(
        (item) => item.key === 'deaths'
      )!

    // 20 局里排在第 17 位：在中间一半之外，但还不到九成。
    expect(row(17)).toMatchObject({ band: 'above', extreme: false, percentile: 0.825 })
    expect(row(19)).toMatchObject({ band: 'above', extreme: true, percentile: 0.925 })
    expect(row(3)).toMatchObject({ band: 'below', extreme: false, percentile: 0.125 })
    expect(row(2)).toMatchObject({ band: 'below', extreme: true, percentile: 0.075 })
    expect(row(10)).toMatchObject({ band: 'typical', extreme: false })
  })

  it('does not call a value extreme when most baseline games share it', () => {
    const baseline = baselineOf('executions', [0, 0, 0, 0, 0, 0, 0, 1])
    expect(compareToReviewBaseline(digest({ executions: 0 }), baseline)[0]).toMatchObject({
      band: 'typical',
      extreme: false
    })
  })

  it('reads a higher-is-better metric the other way round', () => {
    const baseline = baselineOf('csPerMinute', [6, 6.5, 7, 7.5, 8])
    const rows = (value: number) =>
      compareToReviewBaseline(digest({ csPerMinute: value }), baseline)
    expect(rows(9)[0]).toMatchObject({ band: 'above', verdict: 'better', unit: 'rate' })
    expect(rows(5)[0]).toMatchObject({ band: 'below', verdict: 'worse' })
  })

  it('stays neutral for metrics without a direction', () => {
    const baseline = baselineOf('damageTaken', [10, 20, 30, 40, 50])
    expect(compareToReviewBaseline(digest({ damageTaken: 90 }), baseline)[0]).toMatchObject({
      band: 'above',
      verdict: 'neutral'
    })
  })

  it('skips metrics the game or the baseline cannot prove', () => {
    const baseline = buildReviewBaseline(
      [
        ...[1, 2, 3, 4, 5].map((value) => game({ deaths: value, cs10: value < 5 ? 70 : null })),
        game({ kills: 4 })
      ],
      'champion'
    )!
    const rows = compareToReviewBaseline(
      digest({ deaths: 3, cs10: 80, kills: 5, assists: null }),
      baseline
    )
    // cs10 只有 4 局有值，kills 只有 1 局：都不够。
    expect(rows.map((row) => row.key)).toEqual(['deaths'])
  })

  it('follows the order of the digest keys', () => {
    const baseline = buildReviewBaseline(
      [1, 2, 3, 4, 5].map((value) => game({ goldDiff10: value, kills: value, deaths: value })),
      'champion'
    )!
    expect(
      compareToReviewBaseline(digest({ goldDiff10: 3, deaths: 3, kills: 3 }), baseline).map(
        (row) => row.key
      )
    ).toEqual(['kills', 'deaths', 'goldDiff10'])
  })
})
