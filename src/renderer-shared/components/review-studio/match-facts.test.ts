import type { DetailedChampionKillEvent } from '@shared/types/sgp/match-history'
import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { type ReviewCoreItemResolver, isReviewCoreItem } from './match-facts'
import {
  addReviewEvent,
  createReviewFixture,
  reviewKill,
  reviewPlate,
  reviewPurchase,
  reviewUndo,
  reviewWard
} from './test-fixtures'

type Fixture = ReturnType<typeof createReviewFixture>

// Fixture roles — own team: 8 mid (self), 2 top, 10 jungle, 4 bottom, 6 support.
// Enemy team: 3 mid, 1 top, 9 jungle, 5 bottom, 7 support.
const catalogue: Record<number, { priceTotal: number; from: number[]; categories: string[] }> = {
  1055: { priceTotal: 450, from: [], categories: ['Damage'] },
  1036: { priceTotal: 350, from: [], categories: ['Damage'] },
  3134: { priceTotal: 1000, from: [1036, 1036], categories: ['Damage'] },
  3158: { priceTotal: 900, from: [1001], categories: ['Boots'] },
  6699: { priceTotal: 3000, from: [3134, 1036], categories: ['Damage'] }
}
const coreItem: ReviewCoreItemResolver = (id) => isReviewCoreItem(catalogue[id])

/** Pass null to parse the way the app does before the item catalogue has loaded. */
function parse(fixture: Fixture, resolver: ReviewCoreItemResolver | null = coreItem) {
  const result = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId,
    { coreItem: resolver ?? undefined }
  )
  if (!result.ok) throw new Error(result.reason)
  return result.match
}

function kill(
  timestamp: number,
  killerId: number,
  victimId: number,
  assistingParticipantIds: number[] = [],
  position = { x: 7500, y: 7500 }
): DetailedChampionKillEvent {
  return {
    type: 'CHAMPION_KILL',
    timestamp,
    killerId,
    victimId,
    assistingParticipantIds,
    position,
    bounty: 300,
    shutdownBounty: 0,
    killStreakLength: 0,
    victimDamageReceived: []
  }
}

/** Keeps the summary's death counts in step with the timeline so the game counts as reconciled. */
function reconcile(fixture: Fixture) {
  for (const participant of fixture.summary.json.participants) {
    participant.deaths = fixture.details.json.frames
      .flatMap((frame) => frame.events)
      .filter(
        (event) => event.type === 'CHAMPION_KILL' && event.victimId === participant.participantId
      ).length
  }
}

function ownFrame(fixture: Fixture, minute: number) {
  return fixture.details.json.frames[minute].participantFrames['8']
}

describe('review match facts', () => {
  it('keeps each death at its recorded coordinates with the enemies credited for it', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, {
      ...kill(562_000, 7, 8, [9, 3], { x: 9888, y: 4642 }),
      shutdownBounty: 150
    })
    addReviewEvent(fixture.details, kill(1_226_000, 0, 8, [], { x: 11_870, y: 12_378 }))
    addReviewEvent(fixture.details, reviewKill(700_000, 2))
    reconcile(fixture)
    expect(parse(fixture).deaths).toEqual([
      {
        timestamp: 562_000,
        point: { x: 9888, y: 4642 },
        killer: { championId: 107, role: 'UTILITY' },
        assists: [
          { championId: 103, role: 'MIDDLE' },
          { championId: 109, role: 'JUNGLE' }
        ],
        shutdownBounty: 150
      },
      {
        timestamp: 1_226_000,
        point: { x: 11_870, y: 12_378 },
        killer: null,
        assists: [],
        shutdownBounty: 0
      }
    ])
  })

  it('counts early deaths, takedowns and wards inside their own time windows', () => {
    const fixture = createReviewFixture()
    for (const event of [
      kill(300_000, 3, 8),
      kill(500_000, 9, 8, [3]),
      kill(900_000, 3, 8),
      kill(400_000, 8, 3),
      kill(800_000, 2, 1, [8]),
      kill(1_000_000, 8, 3),
      reviewWard(100_000),
      reviewWard(200_000, 'CONTROL_WARD'),
      reviewWard(250_000, 'UNDEFINED'),
      reviewWard(300_000, 'YELLOW_TRINKET', 2),
      reviewWard(650_000),
      reviewWard(880_000, 'CONTROL_WARD'),
      reviewWard(1_000_000, 'CONTROL_WARD')
    ])
      addReviewEvent(fixture.details, event)
    reconcile(fixture)
    expect(parse(fixture).early).toMatchObject({
      cs10: 80,
      deathsBefore10: 2,
      soloDeathsBefore14: 1,
      jungleDeathsBefore14: 1,
      takedownsBefore14: 2,
      wardsBefore10: 2,
      controlWardsBefore15: 2
    })
  })

  it('leaves a count blank when the timeline cannot prove it', () => {
    const unreconciled = createReviewFixture()
    addReviewEvent(unreconciled.details, kill(300_000, 3, 8))
    addReviewEvent(unreconciled.details, reviewPurchase(200_000, 1036))
    expect(parse(unreconciled).early).toMatchObject({
      cs10: 80,
      deathsBefore10: null,
      takedownsBefore14: null,
      wardsBefore10: null,
      firstShopAt: null
    })

    const short = createReviewFixture({ duration: 780 })
    addReviewEvent(short.details, kill(300_000, 3, 8))
    reconcile(short)
    expect(parse(short).early).toMatchObject({
      deathsBefore10: 1,
      soloDeathsBefore14: null,
      controlWardsBefore15: null,
      roamsBefore14: null
    })

    const noEnemyJungler = createReviewFixture()
    noEnemyJungler.summary.json.participants.find((p) => p.participantId === 9)!.teamPosition =
      'TOP'
    noEnemyJungler.summary.json.participants.find(
      (p) => p.participantId === 9
    )!.individualPosition = 'TOP'
    expect(parse(noEnemyJungler).early).toMatchObject({
      soloDeathsBefore14: 0,
      jungleDeathsBefore14: null
    })
  })

  it('times the first trip back to the shop and the first completed item', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPurchase(6_000, 1055),
      reviewPurchase(150_000, 1036),
      reviewUndo(151_000, 1036),
      reviewPurchase(300_000, 3134),
      reviewPurchase(560_000, 3158),
      reviewPurchase(565_000, 6699),
      reviewUndo(570_000, 6699),
      reviewPurchase(600_000, 6699),
      reviewPurchase(601_000, 6699, 3)
    ])
      addReviewEvent(fixture.details, event)
    expect(parse(fixture).early).toMatchObject({
      firstShopAt: 150_000,
      firstCoreItemAt: 600_000,
      firstCoreItemId: 6699
    })
    expect(parse(fixture, null).early).toMatchObject({
      firstShopAt: 150_000,
      firstCoreItemAt: null,
      firstCoreItemId: null
    })
  })

  it('does not guess the first completed item past a purchase the catalogue cannot identify', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewPurchase(400_000, 9999))
    addReviewEvent(fixture.details, reviewPurchase(600_000, 6699))
    expect(parse(fixture).early).toMatchObject({ firstCoreItemAt: null, firstCoreItemId: null })
  })

  it.each([
    ['a completed item', { priceTotal: 2200, from: [1], categories: [] }, true],
    ['an expensive basic item', { priceTotal: 2600, from: [], categories: [] }, false],
    ['a component', { priceTotal: 1300, from: [1, 2], categories: [] }, false],
    [
      'a cheap item nothing is built from',
      { priceTotal: 1500, from: [1], to: [], categories: [] },
      true
    ],
    ['an equally dear component', { priceTotal: 1500, from: [1], to: [2], categories: [] }, false],
    [
      'a cheap item when the catalogue does not say what it builds into',
      { priceTotal: 1500, from: [1], categories: [] },
      false
    ],
    ['a support quest item', { priceTotal: 400, from: [3867], to: [], categories: [] }, false],
    ['upgraded boots', { priceTotal: 2500, from: [1001], categories: ['Boots'] }, false],
    ['a missing catalogue entry', undefined, null],
    ['a malformed catalogue entry', { priceTotal: '3000', from: [1] }, null]
  ])('treats %s consistently as a completed-item candidate', (_name, item, expected) => {
    expect(isReviewCoreItem(item)).toBe(expected)
  })

  it('credits plates to the right side of the own lane only', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPlate(300_000, 200),
      reviewPlate(700_000, 200),
      reviewPlate(500_000, 100),
      reviewPlate(400_000, 200, 'TOP_LANE'),
      reviewPlate(900_000, 200)
    ])
      addReviewEvent(fixture.details, event)
    expect(parse(fixture).early).toMatchObject({ platesTaken: 2, platesLost: 1 })

    fixture.puuid = 'player-3'
    expect(parse(fixture).early).toMatchObject({ platesTaken: 1, platesLost: 2 })

    fixture.puuid = 'player-10'
    expect(parse(fixture).early).toMatchObject({ platesTaken: null, platesLost: null })

    fixture.puuid = 'player-8'
    addReviewEvent(fixture.details, reviewPlate(600_000, 0))
    expect(parse(fixture).early).toMatchObject({ platesTaken: null, platesLost: null })
  })

  it('counts separate side-lane visits for a mid laner from minute snapshots', () => {
    const fixture = createReviewFixture()
    ownFrame(fixture, 5).position = { x: 1500, y: 9000 }
    ownFrame(fixture, 6).position = { x: 1400, y: 9800 }
    ownFrame(fixture, 9).position = { x: 9000, y: 1500 }
    ownFrame(fixture, 10).position = { x: 9800, y: 1400 }
    // Killed in the top lane at 11:40: the body lying there a moment later is not a visit,
    // whatever health the snapshot reports for it.
    fixture.summary.json.participants[0].deaths = 1
    addReviewEvent(fixture.details, {
      ...reviewKill(700_000),
      position: { x: 1500, y: 9000 }
    } as DetailedChampionKillEvent)
    ownFrame(fixture, 12).position = { x: 1500, y: 9000 }
    ownFrame(fixture, 12).championStats = { health: 9, healthMax: 1400 } as ReturnType<
      typeof ownFrame
    >['championStats']
    ownFrame(fixture, 16).position = { x: 1500, y: 9000 }
    expect(parse(fixture).early?.roamsBefore14).toBe(2)

    fixture.puuid = 'player-2'
    expect(parse(fixture).early?.roamsBefore14).toBeNull()

    fixture.puuid = 'player-8'
    ownFrame(fixture, 8).position = { x: -1, y: -1 }
    expect(parse(fixture).early?.roamsBefore14).toBeNull()
  })
})
