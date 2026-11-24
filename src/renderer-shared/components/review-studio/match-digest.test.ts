import type { SgpSelection } from '@shared/types/sgp/match-history'
import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { toReviewArchiveRecord } from './archive'
import { REVIEW_DIGEST_METRIC_KEYS } from './match-digest'
import type { ReviewItemKindResolver } from './match-report'
import {
  addReviewEvent,
  createReviewFixture,
  reviewLevelUp,
  reviewPurchase,
  reviewTakedown,
  reviewWard,
  setReviewStats
} from './test-fixtures'
import type { ReviewItemKind } from './types'

const ITEM_KINDS: Record<number, ReviewItemKind> = {
  1055: 'starter',
  3158: 'boots',
  6692: 'core',
  3142: 'core'
}
const itemKind: ReviewItemKindResolver = (itemId) => ITEM_KINDS[itemId] ?? null

/** One game with a full stat line, a lane opponent, a solo kill, a solo death and a build. */
function scenario() {
  const fixture = createReviewFixture()
  const selection = (perk: number): SgpSelection => ({ perk, var1: 0, var2: 0, var3: 0 })
  for (const [participantId, kills] of [
    [8, 5],
    [2, 1],
    [10, 2],
    [4, 0],
    [6, 2]
  ])
    setReviewStats(fixture.summary, participantId, {
      kills,
      totalDamageDealtToChampions: 10_000,
      goldEarned: 9000
    })
  setReviewStats(fixture.summary, 8, {
    deaths: 1,
    assists: 3,
    champLevel: 14,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 12,
    goldEarned: 11_000,
    goldSpent: 10_400,
    totalDamageDealtToChampions: 20_000,
    totalDamageTaken: 16_000,
    visionScore: 21,
    wardsPlaced: 9,
    wardsKilled: 3,
    visionWardsBoughtInGame: 2,
    totalTimeSpentDead: 95,
    spell1Id: 4,
    spell2Id: 14,
    spell4Casts: 9,
    summoner1Casts: 4,
    summoner2Casts: 5,
    perks: {
      statPerks: { offense: 5008, flex: 5008, defense: 5011 },
      styles: [
        { description: 'primaryStyle', style: 8100, selections: [8112, 8143].map(selection) },
        { description: 'subStyle', style: 8300, selections: [8304].map(selection) }
      ]
    },
    challenges: { soloKills: 2, skillshotsHit: 40 }
  })
  setReviewStats(fixture.summary, 3, {
    deaths: 1,
    champLevel: 13,
    totalMinionsKilled: 170,
    neutralMinionsKilled: 0,
    goldEarned: 9500,
    totalDamageDealtToChampions: 15_000,
    visionScore: 14
  })
  for (const event of [
    reviewPurchase(5000, 1055),
    reviewWard(60_000),
    reviewLevelUp(95_000, 2),
    reviewLevelUp(100_000, 2, 3),
    reviewTakedown(300_000, 8, 3),
    reviewLevelUp(330_000, 6),
    reviewLevelUp(345_000, 6, 3),
    reviewWard(400_000, 'CONTROL_WARD'),
    reviewPurchase(510_000, 3158),
    reviewTakedown(720_000, 3, 8),
    reviewPurchase(740_000, 6692),
    reviewLevelUp(780_000, 11),
    reviewPurchase(900_000, 3142)
  ])
    addReviewEvent(fixture.details, event)
  addReviewEvent(fixture.details, {
    type: 'CHAMPION_SPECIAL_KILL',
    timestamp: 300_000,
    killerId: 8,
    position: { x: 7500, y: 7500 },
    killType: 'KILL_FIRST_BLOOD'
  })
  return fixture
}

function parse(fixture: ReturnType<typeof createReviewFixture>, resolver = itemKind) {
  const parsed = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId,
    { itemKind: resolver }
  )
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.match
}

describe('review game digest', () => {
  it('reduces one game to the numbers used for cross-game averages', () => {
    const digest = parse(scenario()).digest!
    // Every supported key is present, so a missing measurement is an explicit null.
    expect(Object.keys(digest.metrics).sort()).toEqual([...REVIEW_DIGEST_METRIC_KEYS].sort())
    expect(digest.metrics).toMatchObject({
      kills: 5,
      deaths: 1,
      assists: 3,
      level: 14,
      cs: 192,
      gold: 11_000,
      damage: 20_000,
      visionScore: 21,
      wardsPlaced: 9,
      wardsKilled: 3,
      controlWardsBought: 2,
      secondsDead: 95,
      unspentGold: 600,
      summoner1Casts: 4,
      summoner2Casts: 5,
      ultimateCasts: 9,
      // Against the lane opponent at the end of the game.
      csDiffEnd: 22,
      goldDiffEnd: 1500,
      damageDiffEnd: 5000,
      visionDiffEnd: 7,
      levelDiffEnd: 1,
      // Checkpoints from the minute snapshots.
      cs5: 40,
      goldDiff5: 300,
      csDiff5: 5,
      xpDiff5: null,
      cs10: 80,
      goldDiff10: 600,
      goldDiff20: 1200,
      csDiff20: 20,
      // Positive lead = reached the level before the opponent.
      level2Lead: 5000,
      level6At: 330_000,
      level6Lead: 15_000,
      level11At: 780_000,
      level16At: null,
      firstCoreAt: 740_000,
      secondCoreAt: 900_000,
      thirdCoreAt: null,
      bootsAt: 510_000,
      // The stop at 12:20 follows the death at 12:00 and is not a recall.
      firstRecallAt: 510_000,
      recalls: 2,
      takedowns: 1,
      soloKills: 1,
      soloDeaths: 1,
      executions: 0,
      firstBloodTakedown: 1,
      fights: 0,
      fightsJoined: 0,
      deathsInFights: 0,
      deathsOutsideFights: 1,
      epicOwn: 0,
      enemyObjectivesAfterDeath: 0,
      wardEvents: 2,
      controlWardsPlaced: 1,
      wardsCleared: 0
    })
    expect(digest.metrics.csPerMinute).toBeCloseTo(192 / 25)
    expect(digest.metrics.goldPerMinute).toBeCloseTo(440)
    expect(digest.metrics.damagePerMinute).toBeCloseTo(800)
    expect(digest.metrics.deadShare).toBeCloseTo(95 / 1500)
    expect(digest.metrics.killParticipation).toBeCloseTo(0.8)
    expect(digest.metrics.damageShare).toBeCloseTo(1 / 3)
    expect(digest).toMatchObject({
      coreItems: [
        { timestamp: 740_000, itemId: 6692 },
        { timestamp: 900_000, itemId: 3142 }
      ],
      bootsItemId: 3158,
      keystone: 8112,
      summonerSpells: [4, 14],
      skillPriority: null,
      challenges: { soloKills: 2, skillshotsHit: 40 }
    })
  })

  it('keeps every rune of the page with the three numbers the server recorded for it', () => {
    const fixture = scenario()
    const perks = fixture.summary.json.participants.find((p) => p.participantId === 8)!.perks!
    perks.styles[0].selections = [
      { perk: 8369, var1: 1192, var2: 836, var3: 0 },
      { perk: 8304, var1: 9, var2: 4, var3: 5 }
    ]
    perks.styles[1].selections = [{ perk: 8345, var1: 3, var2: 0, var3: 183 }]

    // Page order: the primary tree first, keystone in front; stat shards are not runes.
    expect(parse(fixture).digest!.runes).toEqual([
      [8369, 1192, 836, 0],
      [8304, 9, 4, 5],
      [8345, 3, 0, 183]
    ])

    // A summary without a rune page has nothing to keep.
    Reflect.deleteProperty(
      fixture.summary.json.participants.find((p) => p.participantId === 8)!,
      'perks'
    )
    expect(parse(fixture).digest).toMatchObject({ runes: null, keystone: null })
  })

  it('leaves event counts empty when the event log cannot be reconciled', () => {
    const fixture = scenario()
    // The summary now claims a death the timeline does not show.
    setReviewStats(fixture.summary, 8, { deaths: 2 })
    const digest = parse(fixture).digest!
    expect(digest.metrics).toMatchObject({
      // Summary numbers and snapshot checkpoints do not depend on the event log.
      deaths: 2,
      cs: 192,
      goldDiff10: 600,
      takedowns: null,
      soloKills: null,
      soloDeaths: null,
      recalls: null,
      firstRecallAt: null,
      level6At: null,
      level6Lead: null,
      firstCoreAt: null,
      fights: null,
      epicOwn: null,
      wardEvents: null
    })
    expect(digest.coreItems).toEqual([])
  })

  it('claims no completed item without an item catalogue', () => {
    const digest = parse(scenario(), () => null).digest!
    expect(digest.metrics).toMatchObject({ firstCoreAt: null, bootsAt: null, takedowns: 1 })
    expect(digest.coreItems).toEqual([])
    expect(digest.bootsItemId).toBeNull()
  })

  it('archives the digest but never the full report', () => {
    const match = parse(scenario())
    const stored = JSON.parse(JSON.stringify(toReviewArchiveRecord(match).match))
    expect(stored.report).toBeUndefined()
    expect(toReviewArchiveRecord(stored).match.digest).toEqual(match.digest)

    // One malformed number discards the digest and nothing else.
    stored.digest.metrics.kills = 'five'
    const damaged = toReviewArchiveRecord(stored).match
    expect(damaged.digest).toBeNull()
    expect(damaged.deaths).toHaveLength(1)
    // Records written before the digest existed simply have none.
    delete stored.digest
    expect(toReviewArchiveRecord(stored).match.digest).toBeNull()
  })

  it('reads a digest saved before the runes were kept, and refuses malformed rune numbers', () => {
    const match = parse(scenario())
    const stored = () => JSON.parse(JSON.stringify(toReviewArchiveRecord(match).match))
    expect(match.digest!.runes).toHaveLength(3)

    const older = stored()
    delete older.digest.runes
    expect(toReviewArchiveRecord(older).match.digest).toEqual({ ...match.digest, runes: null })

    for (const damage of [
      (runes: unknown[][]) => (runes[0] = [8112, 0, 0]),
      (runes: unknown[][]) => (runes[1] = [8143, 0, 'many', 0]),
      (runes: unknown[][]) => (runes[2] = [-1, 0, 0, 0]),
      (runes: unknown[][]) => runes.push(...Array.from({ length: 8 }, () => [8304, 0, 0, 0]))
    ]) {
      const damaged = stored()
      damage(damaged.digest.runes)
      expect(toReviewArchiveRecord(damaged).match.digest).toBeNull()
    }
  })
})
