import type { DamageStats, SgpSelection } from '@shared/types/sgp/match-history'
import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { type ReviewItemKindResolver, classifyReviewItem } from './match-report'
import {
  addReviewEvent,
  createReviewFixture,
  reviewBountyEnd,
  reviewBountyStart,
  reviewBuilding,
  reviewKill,
  reviewLevelUp,
  reviewMonster,
  reviewPlate,
  reviewPurchase,
  reviewSale,
  reviewSkill,
  reviewSoul,
  reviewTakedown,
  reviewUndo,
  reviewUndoSale,
  reviewWard,
  reviewWardKill,
  setReviewStats
} from './test-fixtures'
import type { ReviewItemKind } from './types'

type Fixture = ReturnType<typeof createReviewFixture>

function parse(fixture: Fixture, itemKind?: ReviewItemKindResolver) {
  const parsed = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId,
    { itemKind }
  )
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.match
}

/** Keeps the summary's death counts in step with the kill events of a fixture. */
function setDeaths(fixture: Fixture, counts: Record<number, number>) {
  for (const [participantId, deaths] of Object.entries(counts))
    setReviewStats(fixture.summary, Number(participantId), { deaths })
}

const ITEM_KINDS: Record<number, ReviewItemKind> = {
  1055: 'starter',
  2003: 'consumable',
  1036: 'component',
  1001: 'component',
  1037: 'component',
  3158: 'boots',
  6692: 'core',
  3142: 'core'
}
const itemKind: ReviewItemKindResolver = (itemId) => ITEM_KINDS[itemId] ?? null

describe('review item classification', () => {
  it.each([
    ['trinket', { priceTotal: 0, from: [], to: [], categories: ['Trinket', 'Vision'] }],
    ['consumable', { priceTotal: 75, from: [], to: [], categories: ['Consumable', 'Vision'] }],
    ['component', { priceTotal: 300, from: [], to: [3158], categories: ['Boots'] }],
    ['boots', { priceTotal: 1100, from: [1001], to: [], categories: ['Boots'] }],
    ['core', { priceTotal: 3000, from: [1036, 1036], to: [], categories: ['Damage'] }],
    ['component', { priceTotal: 350, from: [], to: [3142], categories: ['Damage'] }],
    ['component', { priceTotal: 1100, from: [1036], to: [], categories: ['Damage'] }],
    // A cheap completed item: built from a component, and nothing is built from it.
    ['core', { priceTotal: 1500, from: [1082], to: [], categories: ['SpellDamage'] }],
    // Just as dear, but a step towards something else.
    ['component', { priceTotal: 1600, from: [1036], to: [3142], categories: ['Damage'] }],
    ['starter', { priceTotal: 450, from: [], to: [], categories: ['Damage'] }],
    ['other', { priceTotal: 900, from: [], to: [], categories: [] }]
  ] as const)('recognizes a %s', (kind, item) => {
    expect(classifyReviewItem(item)).toBe(kind)
  })

  it('does not guess for entries the catalogue cannot describe', () => {
    expect(classifyReviewItem(undefined)).toBeNull()
    expect(classifyReviewItem({ priceTotal: 3000, categories: [] })).toBeNull()
  })
})

describe('review match report', () => {
  it('copies final stat lines and derives team shares only from complete totals', () => {
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
      assists: 3,
      champLevel: 14,
      totalMinionsKilled: 180,
      neutralMinionsKilled: 12,
      goldEarned: 11_000,
      goldSpent: 10_400,
      totalDamageDealtToChampions: 20_000,
      totalDamageTaken: 16_000,
      visionScore: 21,
      visionWardsBoughtInGame: 2,
      totalTimeSpentDead: 95,
      item0: 3142,
      item1: 0,
      item2: 6692,
      item3: 3158,
      item4: 0,
      item5: 0,
      item6: 3364,
      roleBoundItem: 0,
      spell1Id: 4,
      spell2Id: 14,
      spell1Casts: 80,
      spell2Casts: 30,
      spell3Casts: 60,
      spell4Casts: 9,
      summoner1Casts: 4,
      summoner2Casts: 5,
      perks: {
        statPerks: { offense: 5008, flex: 5008, defense: 5011 },
        styles: [
          {
            description: 'primaryStyle',
            style: 8100,
            selections: [8112, 8143, 8140, 8106].map(selection)
          },
          { description: 'subStyle', style: 8300, selections: [8304, 8345].map(selection) }
        ]
      },
      challenges: { soloKills: 2, skillshotsHit: 40, madeUp: 9 }
    })

    const players = parse(fixture).report!.players
    const own = players.find((player) => player.participantId === 8)!
    expect(own).toMatchObject({
      teamId: 100,
      championId: 238,
      position: 'MIDDLE',
      kills: 5,
      deaths: 0,
      assists: 3,
      level: 14,
      cs: 192,
      jungleCs: 12,
      gold: 11_000,
      goldSpent: 10_400,
      damage: 20_000,
      damageTaken: 16_000,
      visionScore: 21,
      controlWardsBought: 2,
      secondsDead: 95,
      items: [3142, 6692, 3158],
      trinket: 3364,
      roleItem: null,
      summonerSpells: [4, 14],
      casts: { q: 80, w: 30, e: 60, r: 9, summoner1: 4, summoner2: 5 },
      runes: {
        primaryStyle: 8100,
        subStyle: 8300,
        perks: [8112, 8143, 8140, 8106, 8304, 8345],
        shards: [5008, 5008, 5011]
      },
      // Counters outside the supported list are not copied.
      challenges: { soloKills: 2, skillshotsHit: 40 }
    })
    expect(own.killParticipation).toBeCloseTo(8 / 10)
    expect(own.damageShare).toBeCloseTo(20_000 / 60_000)
    expect(own.goldShare).toBeCloseTo(11_000 / 47_000)
    // One teammate without the number is enough to leave the share unknown.
    expect(own.damageTakenShare).toBeNull()

    const enemy = players.find((player) => player.participantId === 3)!
    expect(enemy).toMatchObject({
      kills: null,
      gold: null,
      items: [],
      runes: null,
      challenges: null,
      killParticipation: null
    })
  })

  it('reads team objectives, bans and the order of dragons', () => {
    const fixture = createReviewFixture()
    const none = { first: false, kills: 0 }
    fixture.summary.json.teams = [
      {
        teamId: 100,
        win: true,
        bans: [
          { championId: 157, pickTurn: 1 },
          { championId: -1, pickTurn: 2 }
        ],
        objectives: {
          baron: { first: true, kills: 1 },
          champion: none,
          dragon: { first: true, kills: 2 },
          horde: { first: true, kills: 3 },
          inhibitor: none,
          riftHerald: none,
          tower: { first: false, kills: 7 },
          atakhan: none
        }
      },
      {
        teamId: 200,
        win: false,
        bans: [],
        objectives: {
          baron: none,
          champion: { first: true, kills: 6 },
          dragon: none,
          horde: none,
          inhibitor: none,
          riftHerald: { first: true, kills: 1 },
          tower: { first: true, kills: 2 },
          atakhan: none
        }
      }
    ]
    addReviewEvent(
      fixture.details,
      reviewMonster(360_000, 'DRAGON', 10, { subType: 'FIRE_DRAGON' })
    )
    addReviewEvent(
      fixture.details,
      reviewMonster(660_000, 'DRAGON', 9, { subType: 'WATER_DRAGON' })
    )
    addReviewEvent(
      fixture.details,
      reviewMonster(960_000, 'DRAGON', 10, { subType: 'EARTH_DRAGON' })
    )
    addReviewEvent(fixture.details, {
      type: 'DRAGON_SOUL_GIVEN',
      timestamp: 1_300_000,
      name: 'Mountain',
      teamId: 100
    })

    const [blue, red] = parse(fixture).report!.teams
    expect(blue).toMatchObject({
      teamId: 100,
      win: true,
      towers: 7,
      dragons: 2,
      barons: 1,
      grubs: 3,
      heralds: 0,
      firstBlood: false,
      firstTower: false,
      firstDragon: true,
      firstBaron: true,
      bans: [157],
      dragonTypes: ['FIRE_DRAGON', 'EARTH_DRAGON'],
      soul: 'Mountain'
    })
    expect(red).toMatchObject({
      teamId: 200,
      win: false,
      towers: 2,
      heralds: 1,
      firstBlood: true,
      firstTower: true,
      bans: [],
      dragonTypes: ['WATER_DRAGON'],
      soul: null
    })
    // The players carry no kill numbers in this fixture, so the team total is unknown, not zero.
    expect(blue.kills).toBeNull()
  })

  it('rebuilds the item path with undo, sales and separate stops at the shop', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPurchase(5000, 1055),
      reviewPurchase(6000, 2003),
      reviewPurchase(240_000, 1036),
      reviewPurchase(240_500, 1001),
      reviewPurchase(241_000, 1037),
      reviewUndo(241_500, 1037),
      reviewPurchase(510_000, 3158),
      reviewKill(720_000),
      reviewPurchase(740_000, 6692),
      reviewPurchase(900_000, 3142),
      reviewSale(900_500, 1055),
      reviewSale(901_000, 1036),
      reviewUndoSale(901_500, 1036),
      // Someone else's shopping never enters the reviewed player's path.
      reviewPurchase(300_000, 6692, 3)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    const build = parse(fixture, itemKind).report!.build
    expect(build.purchases).toEqual([
      { timestamp: 5000, itemId: 1055, kind: 'starter' },
      { timestamp: 6000, itemId: 2003, kind: 'consumable' },
      { timestamp: 240_000, itemId: 1036, kind: 'component' },
      { timestamp: 240_500, itemId: 1001, kind: 'component' },
      { timestamp: 510_000, itemId: 3158, kind: 'boots' },
      { timestamp: 740_000, itemId: 6692, kind: 'core' },
      { timestamp: 900_000, itemId: 3142, kind: 'core' }
    ])
    expect(build.sales).toEqual([{ timestamp: 900_500, itemId: 1055 }])
    expect(build.coreItems).toEqual([
      { timestamp: 740_000, itemId: 6692 },
      { timestamp: 900_000, itemId: 3142 }
    ])
    expect(build.boots).toEqual({ timestamp: 510_000, itemId: 3158 })
    expect(build.visits).toEqual([
      { timestamp: 5000, afterDeath: false, itemIds: [1055, 2003] },
      { timestamp: 240_000, afterDeath: false, itemIds: [1036, 1001] },
      { timestamp: 510_000, afterDeath: false, itemIds: [3158] },
      // Bought 20 seconds after dying: the respawn, not a recall.
      { timestamp: 740_000, afterDeath: true, itemIds: [6692] },
      // The sale that was taken back is not part of the stop; the one that stood is.
      { timestamp: 900_000, afterDeath: false, itemIds: [3142], soldIds: [1055] }
    ])

    // Without a catalogue nothing is classified and no completed item is claimed.
    const unknown = parse(fixture).report!.build
    expect(unknown.purchases.every((purchase) => purchase.kind === null)).toBe(true)
    expect(unknown.coreItems).toEqual([])
    expect(unknown.boots).toBeNull()
  })

  it('tells a stop that only sold from one where everything was taken back', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPurchase(5000, 1055),
      // Sells and keeps it sold.
      reviewSale(400_000, 1055),
      // Buys and undoes, sells and undoes: nothing is left of this stop.
      reviewPurchase(700_000, 1036),
      reviewUndo(701_000, 1036),
      reviewSale(702_000, 2003),
      reviewUndoSale(703_000, 2003)
    ])
      addReviewEvent(fixture.details, event)

    expect(parse(fixture, itemKind).report!.build.visits).toEqual([
      { timestamp: 5000, afterDeath: false, itemIds: [1055] },
      { timestamp: 400_000, afterDeath: false, itemIds: [], soldIds: [1055] },
      { timestamp: 700_000, afterDeath: false, itemIds: [] }
    ])
  })

  it('keeps a long stay at the shop together when the time in between was spent undoing', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPurchase(5000, 1055),
      // Dies, then sells, takes it back, sells again and takes it back, and only then buys:
      // more than 45 seconds lie between the operations that stand, but he never left.
      reviewKill(700_000),
      reviewSale(720_000, 1055),
      reviewUndoSale(757_000, 1055),
      reviewSale(765_000, 1055),
      reviewUndoSale(772_000, 1055),
      reviewSale(792_000, 1055),
      reviewPurchase(793_000, 6692)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    expect(parse(fixture, itemKind).report!.build.visits).toEqual([
      { timestamp: 5000, afterDeath: false, itemIds: [1055] },
      { timestamp: 720_000, afterDeath: true, itemIds: [6692], soldIds: [1055] }
    ])
  })

  it('starts a new stop at the shop after every own death, however soon the next purchase is', () => {
    const fixture = createReviewFixture()
    for (const event of [
      // Dies, buys while dead, walks out, dies again 38 seconds after that purchase and buys
      // again: two stops, although the purchases are less than 45 seconds apart.
      reviewKill(497_000),
      reviewPurchase(509_000, 1036),
      reviewKill(547_000),
      reviewPurchase(550_000, 1001),
      reviewPurchase(551_000, 2003)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 2 })

    expect(parse(fixture, itemKind).report!.build.visits).toEqual([
      { timestamp: 509_000, afterDeath: true, itemIds: [1036] },
      { timestamp: 550_000, afterDeath: true, itemIds: [1001, 2003] }
    ])
  })

  it('marks only the first stop after a death as following that death', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewKill(739_000),
      // Four seconds after dying: the respawn.
      reviewPurchase(743_000, 1036),
      // 83 seconds after the same death, but the player has shopped since: a recall.
      reviewPurchase(822_000, 1001),
      // A death long before a purchase has nothing to do with it either.
      reviewPurchase(1_100_000, 3158)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    expect(parse(fixture, itemKind).report!.build.visits).toEqual([
      { timestamp: 743_000, afterDeath: true, itemIds: [1036] },
      { timestamp: 822_000, afterDeath: false, itemIds: [1001] },
      { timestamp: 1_100_000, afterDeath: false, itemIds: [3158] }
    ])
  })

  it('does not call a late first purchase after a death a respawn', () => {
    const fixture = createReviewFixture()
    for (const event of [reviewKill(300_000), reviewPurchase(400_000, 1036)])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    // 100 seconds after the death: he went back out and recalled, or stayed without buying.
    expect(parse(fixture, itemKind).report!.build.visits).toEqual([
      { timestamp: 400_000, afterDeath: false, itemIds: [1036] }
    ])
  })

  it('reports only the part of the max order that the level-ups settle', () => {
    const order = (slots: number[]) => {
      const fixture = createReviewFixture()
      slots.forEach((slot, index) =>
        addReviewEvent(fixture.details, reviewSkill(10_000 + index * 60_000, slot))
      )
      // Evolutions are not ability points, and other players' points are ignored.
      addReviewEvent(fixture.details, reviewSkill(15_000, 1, 8, 'EVOLVE'))
      addReviewEvent(fixture.details, reviewSkill(16_000, 2, 3))
      return parse(fixture).report!.build
    }

    const full = order([1, 2, 3, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2])
    expect(full.skills).toHaveLength(15)
    expect(full.skills[5]).toEqual({ timestamp: 310_000, slot: 4 })
    // Q maxed at the ninth point, E at the thirteenth, W still at three points.
    expect(full.skillPriority).toEqual([1, 3, 2])

    // Q leads, but W and E hold one point each: only the first place is settled.
    expect(order([1, 2, 3, 1, 1]).skillPriority).toEqual([1])
    // Two points say nothing about a max order.
    expect(order([1, 2, 3, 1]).skillPriority).toBeNull()
    expect(order([]).skillPriority).toBeNull()
  })

  it('times level-ups against the lane opponent and samples fixed checkpoints', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewLevelUp(95_000, 2),
      reviewLevelUp(160_000, 3),
      reviewLevelUp(330_000, 6),
      reviewLevelUp(331_000, 6),
      reviewLevelUp(100_000, 2, 3),
      reviewLevelUp(345_000, 6, 3),
      reviewLevelUp(90_000, 2, 2)
    ])
      addReviewEvent(fixture.details, event)
    const tenth = fixture.details.json.frames[10].participantFrames
    Object.assign(tenth['8'], {
      xp: 5000,
      damageStats: { totalDamageDoneToChampions: 3000 } as DamageStats
    })
    Object.assign(tenth['3'], { xp: 4600 })
    fixture.details.json.frames = fixture.details.json.frames.filter(
      (frame) => frame.timestamp !== 900_000
    )

    const report = parse(fixture).report!
    expect(report.levels).toEqual([
      { level: 2, own: 95_000, opponent: 100_000 },
      { level: 3, own: 160_000, opponent: null },
      { level: 6, own: 330_000, opponent: 345_000 }
    ])
    // A 25-minute game has no 30-minute checkpoint.
    expect(report.checkpoints.map((checkpoint) => checkpoint.minute)).toEqual([5, 10, 15, 20, 25])
    expect(report.checkpoints[0]).toEqual({
      minute: 5,
      timestamp: 300_000,
      own: { gold: 2300, cs: 40, xp: null, level: 3, damage: null },
      opponent: { gold: 2000, cs: 35, xp: null, level: 3, damage: null },
      goldDiff: 300,
      csDiff: 5,
      xpDiff: null,
      levelDiff: 0,
      teamGoldDiff: 900
    })
    expect(report.checkpoints[1]).toMatchObject({
      timestamp: 600_000,
      own: { gold: 4100, cs: 80, xp: 5000, level: 6, damage: 3000 },
      goldDiff: 600,
      csDiff: 10,
      xpDiff: 400,
      teamGoldDiff: 1800
    })
    // The 15-minute snapshot is missing: the checkpoint stays empty instead of borrowing a neighbour.
    expect(report.checkpoints[2]).toEqual({
      minute: 15,
      timestamp: null,
      own: null,
      opponent: null,
      goldDiff: null,
      csDiff: null,
      xpDiff: null,
      levelDiff: null,
      teamGoldDiff: null
    })
  })

  it('lists own kills and assists with the allies credited beside the player', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewTakedown(300_000, 8, 3, { assists: [10] }))
    addReviewEvent(fixture.details, {
      type: 'CHAMPION_SPECIAL_KILL',
      timestamp: 300_000,
      killerId: 8,
      position: { x: 7500, y: 7500 },
      killType: 'KILL_FIRST_BLOOD'
    })
    addReviewEvent(
      fixture.details,
      reviewTakedown(600_000, 10, 9, { assists: [8, 6], shutdownBounty: 450 })
    )
    // Finished off by a turret: still an assist for the player, with nobody else credited.
    addReviewEvent(fixture.details, reviewTakedown(700_000, 0, 5, { assists: [8], bounty: 0 }))
    addReviewEvent(fixture.details, reviewTakedown(800_000, 2, 1))
    setDeaths(fixture, { 3: 1, 9: 1, 5: 1, 1: 1 })

    const report = parse(fixture).report!
    expect(report.complete).toBe(true)
    expect(report.takedowns).toEqual([
      {
        timestamp: 300_000,
        point: { x: 7500, y: 7500 },
        victim: { championId: 103, role: 'MIDDLE' },
        kill: true,
        allies: 1,
        bounty: 300,
        shutdownBounty: 0,
        firstBlood: true,
        damage: null
      },
      {
        timestamp: 600_000,
        point: { x: 7500, y: 7500 },
        victim: { championId: 109, role: 'JUNGLE' },
        kill: false,
        allies: 2,
        bounty: 300,
        shutdownBounty: 450,
        firstBlood: false,
        damage: null
      },
      {
        timestamp: 700_000,
        point: { x: 7500, y: 7500 },
        victim: { championId: 105, role: 'BOTTOM' },
        kill: false,
        allies: 0,
        bounty: 0,
        shutdownBounty: 0,
        firstBlood: false,
        damage: null
      }
    ])
  })

  it('says what the player did to each victim, with Ignite told apart', () => {
    const fixture = createReviewFixture()
    addReviewEvent(
      fixture.details,
      reviewTakedown(300_000, 8, 3, {
        received: [
          { participantId: 8, spellSlot: 0, physicalDamage: 210 },
          { participantId: 8, spellSlot: 3, physicalDamage: 300, magicDamage: 40 },
          { participantId: 8, basic: true, physicalDamage: 95 },
          { participantId: 8, spellSlot: 4, spellName: 'summonerdot', trueDamage: 120 },
          // An item active has no bucket of its own.
          { participantId: 8, spellSlot: 6, spellName: '3152active', magicDamage: 60 },
          { participantId: 10, spellSlot: 1, magicDamage: 150 },
          { type: 'MINION', physicalDamage: 25 }
        ]
      })
    )
    // Smite is a summoner spell too, but not Ignite.
    addReviewEvent(
      fixture.details,
      reviewTakedown(600_000, 10, 9, {
        assists: [8],
        received: [
          {
            participantId: 8,
            spellSlot: 5,
            spellName: 'summonersmiteavataroffensive',
            trueDamage: 80
          },
          { participantId: 10, spellSlot: 0, physicalDamage: 400 }
        ]
      })
    )
    setDeaths(fixture, { 3: 1, 9: 1 })

    const [kill, assist] = parse(fixture).report!.takedowns
    const none = { basic: 0, passive: 0, q: 0, w: 0, e: 0, r: 0, summoner: 0, other: 0 }
    expect(kill.damage).toEqual({
      total: 825,
      slots: { ...none, basic: 95, q: 210, r: 340, summoner: 120, other: 60 },
      ignite: 120,
      victimTotal: 1000
    })
    expect(assist.damage).toEqual({
      total: 80,
      slots: { ...none, summoner: 80 },
      ignite: 0,
      victimTotal: 480
    })
  })

  it('prefers the wider damage list of a kill record when it has one', () => {
    const fixture = createReviewFixture()
    addReviewEvent(
      fixture.details,
      reviewTakedown(300_000, 8, 3, {
        received: [{ participantId: 8, spellSlot: 0, physicalDamage: 200 }],
        fightReceived: [
          { participantId: 8, spellSlot: 0, physicalDamage: 450 },
          { participantId: 2, spellSlot: 1, magicDamage: 300 }
        ]
      })
    )
    addReviewEvent(
      fixture.details,
      reviewTakedown(500_000, 3, 8, {
        received: [{ participantId: 3, spellSlot: 0, magicDamage: 600 }],
        dealt: [{ participantId: 8, spellSlot: 0, physicalDamage: 100 }],
        fightReceived: [
          { participantId: 3, spellSlot: 0, magicDamage: 900 },
          { participantId: 9, basic: true, physicalDamage: 350 }
        ],
        fightDealt: [{ participantId: 8, spellSlot: 0, physicalDamage: 700 }]
      })
    )
    setDeaths(fixture, { 3: 1, 8: 1 })

    const report = parse(fixture).report!
    expect(report.takedowns[0].damage).toMatchObject({ total: 450, victimTotal: 750 })
    // The sources of an own death stay on the plain list; the wider totals are given beside it.
    expect(report.deaths[0]).toMatchObject({
      damageTaken: 600,
      damageDealt: 100,
      fightDamageTaken: 1250,
      fightDamageDealt: 700
    })
    expect(report.deaths[0].sources).toHaveLength(1)
  })

  it('breaks an own death down by who dealt the damage and with what', () => {
    const fixture = createReviewFixture()
    addReviewEvent(
      fixture.details,
      reviewTakedown(500_000, 3, 8, {
        assists: [9],
        received: [
          { participantId: 3, spellSlot: 0, magicDamage: 300, trueDamage: 20 },
          { participantId: 3, spellSlot: 2, magicDamage: 150 },
          { participantId: 3, basic: true, physicalDamage: 60 },
          { participantId: 3, spellSlot: 63, magicDamage: 40 },
          { participantId: 3, spellSlot: 4, trueDamage: 100 },
          { participantId: 3, spellSlot: 7, magicDamage: 25 },
          { participantId: 9, spellSlot: 3, physicalDamage: 250 },
          { type: 'TOWER', basic: true, physicalDamage: 200 },
          { type: 'MINION', physicalDamage: 30 },
          { type: 'MONSTER' }
        ],
        dealt: [
          { participantId: 8, spellSlot: 0, physicalDamage: 500 },
          { participantId: 8, basic: true, magicDamage: 80 }
        ]
      })
    )
    fixture.details.json.frames[8].participantFrames['3'].level = 6
    setDeaths(fixture, { 8: 1 })

    const report = parse(fixture).report!
    const none = { basic: 0, passive: 0, q: 0, w: 0, e: 0, r: 0, summoner: 0, other: 0 }
    expect(report.deaths).toEqual([
      {
        timestamp: 500_000,
        sources: [
          {
            kind: 'champion',
            championId: 103,
            role: 'MIDDLE',
            total: 695,
            physical: 60,
            magic: 515,
            trueDamage: 120,
            // Slot 4 is a summoner spell; slot 7 (an item active) has no bucket of its own.
            slots: { ...none, basic: 60, passive: 40, q: 320, e: 150, summoner: 100, other: 25 }
          },
          {
            kind: 'champion',
            championId: 109,
            role: 'JUNGLE',
            total: 250,
            physical: 250,
            magic: 0,
            trueDamage: 0,
            slots: { ...none, r: 250 }
          },
          {
            kind: 'turret',
            championId: null,
            role: null,
            total: 200,
            physical: 200,
            magic: 0,
            trueDamage: 0,
            slots: { ...none, basic: 200 }
          },
          {
            kind: 'minion',
            championId: null,
            role: null,
            total: 30,
            physical: 30,
            magic: 0,
            trueDamage: 0,
            slots: { ...none, other: 30 }
          }
        ],
        damageTaken: 1175,
        damageDealt: 580,
        // This record has no wider lists.
        fightDamageTaken: null,
        fightDamageDealt: null,
        bounty: 300,
        // No level-up is recorded here, so the levels fall back to the 8-minute snapshot,
        // the last one before the death.
        level: 5,
        killerLevel: 6,
        fight: null,
        objectivesAfter: []
      }
    ])
  })

  it('takes the levels at a death from the level-ups, which a minute snapshot can lag behind', () => {
    const fixture = createReviewFixture()
    for (const event of [
      // Both were level 5 in the 8-minute snapshot. The player reached 6 five seconds before
      // dying; the killer reaches 6 earlier and 7 with the experience of this very kill.
      reviewLevelUp(495_000, 6),
      reviewLevelUp(485_000, 6, 3),
      reviewTakedown(500_000, 3, 8),
      reviewLevelUp(500_000, 7, 3),
      // An execution has no killer and therefore no killer level.
      reviewTakedown(900_000, 0, 8)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 2 })

    expect(parse(fixture).report!.deaths.map((death) => [death.level, death.killerLevel])).toEqual([
      [6, 6],
      // By 15:00 the snapshots are ahead of the two recorded level-ups.
      [8, null]
    ])
  })

  it('classifies objectives and states the player’s part in each', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewMonster(360_000, 'DRAGON', 10, { subType: 'FIRE_DRAGON', assists: [8] }),
      reviewTakedown(690_000, 3, 8),
      reviewMonster(720_000, 'RIFTHERALD', 9, { position: { x: 5000, y: 10_400 } }),
      reviewBuilding(740_000, 200, 8, { assists: [2] }),
      reviewMonster(840_000, 'HORDE', 9, { position: null }),
      reviewMonster(1_200_000, 'BARON_NASHOR', 0, { killerTeamId: 100 }),
      reviewMonster(1_260_000, 'DRAGON', 9, { subType: 'ELDER_DRAGON' }),
      reviewMonster(1_320_000, 'ATAKHAN', 9, { subType: 'ATAKHAN_RUINOUS' }),
      reviewBuilding(1_440_000, 100, 3, { buildingType: 'INHIBITOR_BUILDING' }),
      reviewMonster(1_450_000, 'SCUTTLE', 9)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    const objectives = parse(fixture).report!.objectives
    expect(
      objectives.map((objective) => [objective.kind, objective.detail, objective.own])
    ).toEqual([
      ['dragon', 'FIRE_DRAGON', true],
      ['herald', null, false],
      ['tower', 'OUTER_TURRET', true],
      ['grubs', null, false],
      ['baron', null, true],
      ['elder', 'ELDER_DRAGON', false],
      ['atakhan', 'ATAKHAN_RUINOUS', false],
      ['inhibitor', null, false],
      ['other', 'SCUTTLE', false]
    ])
    // The fixture keeps the player at (7080, 7000) in every snapshot.
    expect(objectives[0]).toEqual({
      timestamp: 360_000,
      kind: 'dragon',
      detail: 'FIRE_DRAGON',
      lane: null,
      own: true,
      credited: true,
      sinceDeath: null,
      distance: 3801,
      snapshotOffset: 0,
      point: { x: 9866, y: 4414 }
    })
    // The enemy herald fell 30 seconds after the player's death.
    expect(objectives[1]).toMatchObject({ credited: false, sinceDeath: 30_000, distance: 3986 })
    // The nearest snapshot to 12:20 is the 12:00 one, 20 seconds earlier.
    expect(objectives[2]).toMatchObject({
      lane: 'MID_LANE',
      credited: true,
      sinceDeath: 50_000,
      distance: 2407,
      snapshotOffset: -20_000
    })
    // No coordinates in the record: no distance is invented. The death is also too long ago.
    expect(objectives[3]).toMatchObject({ sinceDeath: null, distance: null, snapshotOffset: null })
    expect(objectives[7]).toMatchObject({ lane: 'MID_LANE', credited: false })
    // Nothing here was fought over by the losing side or left untaken.
    expect(objectives.some((objective) => objective.contested || objective.unclaimed)).toBe(false)
  })

  it('says when the player fought for an objective the enemy took, and when nobody took it', () => {
    const fixture = createReviewFixture()
    for (const event of [
      // The enemy jungler gets the baron; the record still lists the player among those on it.
      reviewMonster(1_200_000, 'BARON_NASHOR', 9, { assists: [5, 8] }),
      // An own dragon the player helped with is a credit, not a contest.
      reviewMonster(1_260_000, 'DRAGON', 10, { subType: 'FIRE_DRAGON', assists: [8] }),
      // The herald leaves the map: no killer, the neutral team.
      reviewMonster(1_185_000, 'RIFTHERALD', 0, { killerTeamId: 300 })
    ])
      addReviewEvent(fixture.details, event)

    const [herald, baron, dragon] = parse(fixture).report!.objectives
    expect(herald).toMatchObject({ kind: 'herald', own: null, credited: false, unclaimed: true })
    expect(herald.contested).toBeUndefined()
    expect(baron).toMatchObject({ kind: 'baron', own: false, credited: false, contested: true })
    expect(baron.unclaimed).toBeUndefined()
    expect(dragon).toMatchObject({ kind: 'dragon', own: true, credited: true })
    expect(dragon.contested).toBeUndefined()
  })

  it('gives no distance to an objective while the player lies dead in the snapshot', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewTakedown(700_000, 3, 8, { position: { x: 7080, y: 7000 } }),
      reviewMonster(725_000, 'DRAGON', 9, { subType: 'FIRE_DRAGON' })
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 1 })

    // The 12:00 snapshot still has him on the spot where he was killed 20 seconds earlier.
    expect(parse(fixture).report!.objectives[0]).toMatchObject({
      sinceDeath: 25_000,
      distance: null,
      snapshotOffset: null
    })
  })

  it('groups kills into fights by time and distance', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewTakedown(600_000, 3, 8, { assists: [9], position: { x: 5000, y: 5000 } }),
      reviewTakedown(606_000, 10, 3, { assists: [2], position: { x: 5500, y: 5200 } }),
      reviewTakedown(612_000, 9, 10, { position: { x: 5200, y: 5600 } }),
      // One second later but on the other side of the map: a different skirmish.
      reviewTakedown(613_000, 5, 4, { position: { x: 12_000, y: 2000 } }),
      reviewMonster(630_000, 'DRAGON', 9, { subType: 'FIRE_DRAGON' }),
      reviewTakedown(900_000, 1, 2, { position: { x: 2000, y: 12_000 } }),
      // A single kill, but six champions are credited on it.
      reviewTakedown(1_000_000, 8, 3, { assists: [2, 10, 4, 6], position: { x: 7000, y: 7000 } }),
      // Same place 20 seconds later: past the time window.
      reviewTakedown(1_020_000, 9, 6, { position: { x: 7100, y: 7100 } }),
      reviewTakedown(1_300_000, 3, 8, { position: { x: 3000, y: 3000 } })
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 8: 2, 3: 2, 10: 1, 4: 1, 2: 1, 6: 1 })

    const report = parse(fixture).report!
    expect(report.complete).toBe(true)
    expect(report.fights).toEqual([
      {
        start: 600_000,
        end: 612_000,
        point: { x: 5233, y: 5267 },
        killPoints: [
          { x: 5000, y: 5000 },
          { x: 5500, y: 5200 },
          { x: 5200, y: 5600 }
        ],
        kills: 1,
        deaths: 2,
        allies: 3,
        enemies: 2,
        ownKills: 0,
        ownAssists: 0,
        ownDeathOrder: 1,
        objectivesAfter: [0]
      },
      {
        start: 1_000_000,
        end: 1_000_000,
        point: { x: 7000, y: 7000 },
        killPoints: [{ x: 7000, y: 7000 }],
        kills: 1,
        deaths: 0,
        allies: 5,
        enemies: 1,
        ownKills: 1,
        ownAssists: 0,
        ownDeathOrder: null,
        objectivesAfter: []
      }
    ])
    expect(
      report.deaths.map((death) => [death.timestamp, death.fight, death.objectivesAfter])
    ).toEqual([
      [600_000, 0, [0]],
      [1_300_000, null, []]
    ])
  })

  it('counts the executed of a fight apart, since they are nobody’s kill', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewTakedown(600_000, 8, 3, { position: { x: 5000, y: 5000 } }),
      // An enemy and then a teammate die to a turret in the same skirmish.
      reviewTakedown(604_000, 0, 9, { position: { x: 5100, y: 5000 } }),
      reviewTakedown(608_000, 0, 2, { position: { x: 5200, y: 5000 } })
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 3: 1, 9: 1, 2: 1 })

    expect(parse(fixture).report!.fights).toEqual([
      expect.objectContaining({
        // Two enemies and one teammate died; one on each side was an execution.
        kills: 2,
        deaths: 1,
        enemyExecutions: 1,
        allyExecutions: 1,
        ownKills: 1
      })
    ])
  })

  it('samples a checkpoint every five minutes for as long as the game lasts', () => {
    const report = parse(createReviewFixture({ duration: 2520 })).report!
    expect(report.checkpoints.map((checkpoint) => checkpoint.minute)).toEqual([
      5, 10, 15, 20, 25, 30, 35, 40
    ])
    expect(report.checkpoints.at(-1)).toMatchObject({ timestamp: 2_400_000, goldDiff: 2400 })
  })

  it('keeps only real ward placements and the wards the player cleared', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewWard(60_000),
      reviewWard(400_000, 'CONTROL_WARD'),
      reviewWard(500_000, 'UNDEFINED'),
      reviewWard(520_000, 'YELLOW_TRINKET', 3),
      reviewWardKill(700_000),
      reviewWardKill(710_000, 'CONTROL_WARD', 3),
      // Traps and unnamed objects are not wards: the summary does not count them either.
      reviewWardKill(720_000, 'TEEMO_MUSHROOM'),
      reviewWardKill(730_000, 'UNDEFINED')
    ])
      addReviewEvent(fixture.details, event)

    expect(parse(fixture).report!.vision).toEqual({
      placed: [
        { timestamp: 60_000, wardType: 'YELLOW_TRINKET' },
        { timestamp: 400_000, wardType: 'CONTROL_WARD' }
      ],
      cleared: [{ timestamp: 700_000, wardType: 'SIGHT_WARD' }]
    })
  })

  it('flags the report when the event log does not reconcile with the summary', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewKill(500_000))
    // The summary still says zero deaths.
    expect(parse(fixture).report!.complete).toBe(false)
  })

  it('keeps the numbers the server records for each rune, in page order', () => {
    const fixture = createReviewFixture()
    setReviewStats(fixture.summary, 8, {
      perks: {
        statPerks: { offense: 5008, flex: 5010, defense: 5001 },
        styles: [
          {
            description: 'primaryStyle',
            style: 8100,
            selections: [
              { perk: 8112, var1: 2782, var2: 0, var3: 0 },
              { perk: 8143, var1: 1895, var2: 0, var3: 0 },
              { perk: 8140, var1: 14, var2: 0, var3: 0 },
              { perk: 8135, var1: 450, var2: 5, var3: 0 }
            ]
          },
          {
            description: 'subStyle',
            style: 8300,
            selections: [
              { perk: 8304, var1: 9, var2: 4, var3: 5 },
              { perk: 8345, var1: 3, var2: 0, var3: 183 }
            ]
          }
        ]
      }
    })

    expect(
      parse(fixture).report!.players.find((player) => player.participantId === 8)!.runes
    ).toEqual({
      primaryStyle: 8100,
      subStyle: 8300,
      perks: [8112, 8143, 8140, 8135, 8304, 8345],
      primaryCount: 4,
      stats: [
        [2782, 0, 0],
        [1895, 0, 0],
        [14, 0, 0],
        [450, 5, 0],
        [9, 4, 5],
        [3, 0, 183]
      ],
      // Offense, flex, defense.
      shards: [5008, 5010, 5001]
    })
  })

  it('copies damage taken by type, the away flag and the pings', () => {
    const fixture = createReviewFixture()
    setReviewStats(fixture.summary, 8, {
      physicalDamageTaken: 14_000,
      magicDamageTaken: 8200,
      trueDamageTaken: 1100,
      wasAfk: false,
      enemyMissingPings: 5,
      onMyWayPings: 0,
      retreatPings: 2,
      // Always zero in real summaries and not copied.
      holdPings: 3
    })
    setReviewStats(fixture.summary, 4, { wasAfk: true })

    const players = parse(fixture).report!.players
    expect(players.find((player) => player.participantId === 8)).toMatchObject({
      physicalDamageTaken: 14_000,
      magicDamageTaken: 8200,
      trueDamageTaken: 1100,
      afk: false,
      pings: { enemyMissingPings: 5, onMyWayPings: 0, retreatPings: 2 }
    })
    expect(players.find((player) => player.participantId === 4)).toMatchObject({
      physicalDamageTaken: null,
      afk: true,
      pings: null
    })
    // Without the field the summary simply does not say.
    expect(players.find((player) => player.participantId === 2)!.afk).toBeNull()
  })

  it.each([
    [
      'MIDDLE.PRIMARY.MIDDLE.TOP.FILL',
      'MIDDLE',
      { choice: 'primary', preferences: ['MIDDLE', 'TOP'], assigned: null }
    ],
    [
      'MIDDLE.SECONDARY.TOP.MIDDLE',
      'MIDDLE',
      { choice: 'secondary', preferences: ['TOP', 'MIDDLE'], assigned: null }
    ],
    [
      'MIDDLE.AUTOFILL.TOP.JUNGLE.FILL',
      'MIDDLE',
      { choice: 'autofill', preferences: ['TOP', 'JUNGLE'], assigned: null }
    ],
    [
      'MIDDLE.FILL_PRIMARY.FILL.UNSELECTED.FILL',
      'MIDDLE',
      { choice: 'fill', preferences: ['FILL'], assigned: null }
    ],
    [
      'MIDDLE.PRIMARY.MIDDLE.UNSELECTED',
      'MIDDLE',
      { choice: 'primary', preferences: ['MIDDLE'], assigned: null }
    ],
    // Handed top by matchmaking, swapped to mid in champion select.
    [
      'MIDDLE.PRIMARY.MIDDLE.TOP',
      'TOP',
      { choice: 'primary', preferences: ['MIDDLE', 'TOP'], assigned: 'TOP' }
    ]
  ] as const)('reads the role assignment %s', (preferences, assigned, expected) => {
    const fixture = createReviewFixture()
    setReviewStats(fixture.summary, 8, {
      selectedRolePreferences: preferences,
      positionAssignedByMatchmaking: assigned
    })
    expect(parse(fixture).report!.assignment).toEqual(expected)
  })

  it.each([
    // The string is about another position than the one played.
    'TOP.PRIMARY.TOP.MIDDLE',
    // The tag contradicts the listed choices.
    'MIDDLE.PRIMARY.TOP.MIDDLE',
    'MIDDLE.SECONDARY.MIDDLE.TOP',
    'MIDDLE.AUTOFILL.MIDDLE.TOP',
    'MIDDLE.SOMETHING.MIDDLE.TOP',
    ''
  ])('does not guess the role assignment from %j', (preferences) => {
    const fixture = createReviewFixture()
    setReviewStats(fixture.summary, 8, { selectedRolePreferences: preferences })
    expect(parse(fixture).report!.assignment).toBeNull()
  })

  it('leaves the role assignment unknown when the summary does not carry it', () => {
    expect(parse(createReviewFixture()).report!.assignment).toBeNull()
  })

  it('rebuilds the lane opponent’s item path from the opponent’s own purchases and deaths', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewPurchase(5000, 1055, 3),
      reviewPurchase(300_000, 1001, 3),
      // The opponent dies and buys on respawn; the reviewed player's shopping is not mixed in.
      reviewTakedown(500_000, 8, 3),
      reviewPurchase(520_000, 6692, 3),
      reviewPurchase(521_000, 1036, 8),
      reviewSkill(10_000, 1, 3),
      reviewSkill(100_000, 3, 3)
    ])
      addReviewEvent(fixture.details, event)
    setDeaths(fixture, { 3: 1 })

    const report = parse(fixture, itemKind).report!
    expect(report.opponentBuild).toMatchObject({
      visits: [
        { timestamp: 5000, afterDeath: false, itemIds: [1055] },
        { timestamp: 300_000, afterDeath: false, itemIds: [1001] },
        { timestamp: 520_000, afterDeath: true, itemIds: [6692] }
      ],
      coreItems: [{ timestamp: 520_000, itemId: 6692 }],
      skills: [
        { timestamp: 10_000, slot: 1 },
        { timestamp: 100_000, slot: 3 }
      ]
    })
    expect(report.build.visits).toEqual([
      { timestamp: 521_000, afterDeath: false, itemIds: [1036] }
    ])
  })

  it('has no opponent build without an identified lane opponent', () => {
    const fixture = createReviewFixture()
    // A second enemy claims the middle lane: nobody is "the" opponent any more.
    setReviewStats(fixture.summary, 1, { teamPosition: 'MIDDLE', individualPosition: 'MIDDLE' })
    expect(parse(fixture).report!.opponentBuild).toBeNull()
  })

  it('lists turret plates by who took them', () => {
    const fixture = createReviewFixture()
    for (const event of [
      // The enemy's mid turret loses a plate to the player, then one to a minion wave.
      reviewPlate(300_000, 200, 'MID_LANE', 8),
      reviewPlate(420_000, 200, 'MID_LANE'),
      // The own top turret loses one.
      reviewPlate(500_000, 100, 'TOP_LANE', 1)
    ])
      addReviewEvent(fixture.details, event)

    expect(parse(fixture).report!.plates).toEqual([
      { timestamp: 300_000, lane: 'MID_LANE', own: true, byPlayer: true },
      { timestamp: 420_000, lane: 'MID_LANE', own: true, byPlayer: false },
      { timestamp: 500_000, lane: 'TOP_LANE', own: false, byPlayer: false }
    ])
  })

  it('records when objective bounties were live and for whom', () => {
    const fixture = createReviewFixture()
    for (const event of [
      reviewBountyStart(600_000, 100),
      reviewBountyEnd(760_000, 100),
      // Still running when the game ends.
      reviewBountyStart(1_200_000, 200, 1_230_000)
    ])
      addReviewEvent(fixture.details, event)

    expect(parse(fixture).report!.bounties).toEqual([
      { announcedAt: 600_000, start: 615_000, end: 760_000, own: true },
      { announcedAt: 1_200_000, start: 1_230_000, end: null, own: false }
    ])
  })

  it('tells the rift taking an element apart from a team receiving the soul', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewSoul(729_000, 'Chemtech', 0))
    addReviewEvent(fixture.details, reviewSoul(1_300_000, 'Chemtech', 200))

    const report = parse(fixture).report!
    expect(report.riftElement).toEqual({ timestamp: 729_000, name: 'Chemtech' })
    expect(report.teams.map((team) => team.soul)).toEqual([null, 'Chemtech'])
    expect(parse(createReviewFixture()).report!.riftElement).toBeNull()
  })

  it('keeps the multi-kills and aces the timeline marks, one entry per kill', () => {
    const fixture = createReviewFixture()
    const special = (timestamp: number, killerId: number, killType: string, length?: number) =>
      addReviewEvent(fixture.details, {
        type: 'CHAMPION_SPECIAL_KILL',
        timestamp,
        killerId,
        position: { x: 7500, y: 7500 },
        killType: killType as 'KILL_MULTI',
        ...(length ? { multiKillLength: length } : {})
      })
    special(300_000, 8, 'KILL_FIRST_BLOOD')
    special(600_000, 9, 'KILL_MULTI', 2)
    // A triple kill that is also the ace: two marks for the same kill.
    special(900_000, 8, 'KILL_MULTI', 3)
    special(900_000, 8, 'KILL_ACE')
    special(1_000_000, 2, 'KILL_ACE')
    // Nothing to keep: a multi-kill of length one, and a kind this code does not know.
    special(1_100_000, 2, 'KILL_MULTI', 1)
    special(1_200_000, 2, 'KILL_SOMETHING_NEW')

    expect(parse(fixture).report!.killMarks).toEqual([
      { timestamp: 600_000, killerId: 9, multiKill: 2, ace: false },
      { timestamp: 900_000, killerId: 8, multiKill: 3, ace: true },
      { timestamp: 1_000_000, killerId: 2, multiKill: null, ace: true }
    ])
  })

  it('reads health and combat stats into the minute snapshots', () => {
    const fixture = createReviewFixture()
    Object.assign(fixture.details.json.frames[10].participantFrames['8'].championStats, {
      health: 612,
      healthMax: 1480,
      attackDamage: 131,
      abilityPower: 0,
      armor: 52,
      magicResist: 38,
      // Reported but not read: its meaning differs from champion to champion.
      power: 200,
      powerMax: 200
    })

    const match = parse(fixture)
    expect(match.frames[10].participants.find((entry) => entry.participantId === 8)).toMatchObject({
      health: 612,
      healthMax: 1480,
      attackDamage: 131,
      abilityPower: 0,
      armor: 52,
      magicResist: 38
    })
    // The fixture's other snapshots only say that the player is alive.
    expect(match.frames[11].participants.find((entry) => entry.participantId === 8)).toMatchObject({
      health: 800,
      healthMax: null,
      armor: null
    })
  })
})
