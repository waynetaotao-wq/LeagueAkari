import type { DetailedGameEvent, SgpGameDetailsLol } from '@shared/types/sgp/match-history'
import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import {
  REVIEW_LANE_DIFF_MINUTES,
  buildReviewLaneGoldDiffs,
  buildReviewMinuteRows
} from './minute-table'
import { addReviewEvent, createReviewFixture, reviewTakedown } from './test-fixtures'
import type { ReviewMatch } from './types'

// The fixture: a 25-minute game, the reviewed player is participant 8 (mid, blue side) against
// participant 3. Every minute each player gains 300 gold, the reviewed player 60 more and his
// teammates 30 more; he farms 8 a minute, everyone else 7; all ten stand in the middle lane.
type Fixture = ReturnType<typeof createReviewFixture>

function parse(change: (fixture: Fixture) => void = () => {}, options = {}): ReviewMatch {
  const fixture = createReviewFixture(options)
  change(fixture)
  const parsed = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId
  )
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.match
}

const frameOf = (details: SgpGameDetailsLol, minute: number, participantId: number) =>
  details.json.frames[minute].participantFrames[String(participantId)]

const execution = (timestamp: number, victimId: number): DetailedGameEvent => ({
  type: 'CHAMPION_KILL',
  timestamp,
  killerId: 0,
  victimId,
  assistingParticipantIds: [],
  position: { x: 7500, y: 7500 },
  bounty: 0,
  shutdownBounty: 0,
  killStreakLength: 0,
  victimDamageReceived: []
})

const at = (rows: ReturnType<typeof buildReviewMinuteRows>, minute: number) =>
  rows.find((row) => row.timestamp === minute * 60_000)!

describe('buildReviewMinuteRows', () => {
  it('has one row for every snapshot after the start, the last one included', () => {
    const rows = buildReviewMinuteRows(parse())

    expect(rows).toHaveLength(25)
    expect(rows[0].timestamp).toBe(60_000)
    expect(rows.at(-1)!.timestamp).toBe(25 * 60_000)
  })

  it('carries the cumulative numbers of the player and the lane opponent', () => {
    const row = at(buildReviewMinuteRows(parse()), 10)

    expect(row.own).toMatchObject({ gold: 4100, cs: 80, level: 6 })
    expect(row.opponent).toMatchObject({ gold: 3500, cs: 70, level: 6 })
    expect(row.goldDiff).toBe(600)
    expect(row.csDiff).toBe(10)
    // 4100 + 4 × 3800 against 5 × 3500
    expect(row.teamGoldDiff).toBe(1800)
  })

  it('reads purse and damage where the snapshot has them, and leaves the rest unknown', () => {
    const rows = buildReviewMinuteRows(
      parse(({ details }) => {
        Object.assign(frameOf(details, 6, 8), {
          currentGold: 1350,
          damageStats: { totalDamageDoneToChampions: 2400, totalDamageTaken: 1900 }
        })
      })
    )

    expect(at(rows, 6).own).toMatchObject({ unspentGold: 1350, damage: 2400, damageTaken: 1900 })
    // Nothing is filled in for the minutes that do not say.
    expect(at(rows, 5).own).toMatchObject({ unspentGold: null, damage: null, damageTaken: null })
    expect(at(rows, 6).opponent).toMatchObject({
      unspentGold: null,
      damage: null,
      damageTaken: null
    })
  })

  it('counts kills, deaths and assists up to each snapshot', () => {
    const rows = buildReviewMinuteRows(
      parse(({ details }) => {
        addReviewEvent(details, reviewTakedown(240_000, 8, 3))
        addReviewEvent(details, reviewTakedown(570_000, 3, 8, { assists: [9] }))
        addReviewEvent(details, reviewTakedown(730_000, 2, 1, { assists: [8, 10] }))
      })
    )
    const score = (minute: number) => {
      const { kills, deaths, assists } = at(rows, minute)
      return `${kills}-${deaths}-${assists}`
    }

    expect(score(3)).toBe('0-0-0')
    // A kill at exactly four minutes belongs to the four-minute snapshot.
    expect(score(4)).toBe('1-0-0')
    expect(score(9)).toBe('1-0-0')
    expect(score(10)).toBe('1-1-0')
    expect(score(12)).toBe('1-1-0')
    expect(score(13)).toBe('1-1-1')
    expect(score(25)).toBe('1-1-1')
  })

  it('keeps the kill score of both teams and gives executions to neither', () => {
    const rows = buildReviewMinuteRows(
      parse(({ details }) => {
        addReviewEvent(details, reviewTakedown(240_000, 8, 3))
        addReviewEvent(details, reviewTakedown(570_000, 3, 8, { assists: [9] }))
        addReviewEvent(details, reviewTakedown(730_000, 2, 1, { assists: [8, 10] }))
        addReviewEvent(details, execution(780_000, 4))
        addReviewEvent(details, reviewTakedown(900_000, 9, 6))
      })
    )
    const teams = (minute: number) => {
      const { ownTeamKills, enemyTeamKills } = at(rows, minute)
      return `${ownTeamKills}:${enemyTeamKills}`
    }

    expect(teams(4)).toBe('1:0')
    expect(teams(10)).toBe('1:1')
    expect(teams(13)).toBe('2:1')
    expect(teams(14)).toBe('2:1')
    expect(teams(15)).toBe('2:2')
  })

  it('names where each of the ten players was, from the side of the reviewed player', () => {
    const match = parse(({ details }) => {
      // own fountain, enemy fountain, own top lane, enemy bottom jungle, the dragon side river
      frameOf(details, 7, 8).position = { x: 800, y: 900 }
      frameOf(details, 7, 2).position = { x: 14_000, y: 14_100 }
      frameOf(details, 7, 10).position = { x: 1200, y: 9000 }
      frameOf(details, 7, 3).position = { x: 11_500, y: 6000 }
      frameOf(details, 7, 1).position = { x: 9800, y: 4600 }
    })
    const row = at(buildReviewMinuteRows(match), 7)
    const zoneOf = (participantId: number) =>
      row.places[
        match.participants.findIndex((participant) => participant.participantId === participantId)
      ].zone

    expect(row.places).toHaveLength(10)
    expect(row.places.map((place) => place.participantId)).toEqual(
      match.participants.map((participant) => participant.participantId)
    )
    expect(zoneOf(8)).toBe('own-base')
    expect(zoneOf(2)).toBe('enemy-base')
    expect(zoneOf(10)).toBe('top-own')
    expect(zoneOf(3)).toBe('jungle-enemy-bot')
    expect(zoneOf(1)).toBe('river-bot')
    // Everyone else still stands in the middle lane on the blue half.
    expect(zoneOf(4)).toBe('mid-own')
  })

  it('names the same spot from the other side for a red-side player', () => {
    const blue = parse()
    const red = parse(({ summary, details }) => {
      // The reviewed account now sits in the red team.
      const self = summary.json.participants.find((participant) => participant.participantId === 8)!
      const other = summary.json.participants.find(
        (participant) => participant.participantId === 3
      )!
      ;[self.teamId, other.teamId] = [other.teamId, self.teamId]
      frameOf(details, 7, 8).position = { x: 800, y: 900 }
    })

    expect(blue.meta.teamId).toBe(100)
    expect(red.meta.teamId).toBe(200)
    const place = at(buildReviewMinuteRows(red), 7).places.find(
      (entry) => entry.participantId === 8
    )!
    expect(place.zone).toBe('enemy-base')
    expect(at(buildReviewMinuteRows(red), 8).places[0].zone).toBe('mid-enemy')
  })

  it('tells a dead player and a missing position apart from a place', () => {
    const match = parse(({ details }) => {
      // Killed half a minute before the snapshot; the body lies where it fell.
      addReviewEvent(details, reviewTakedown(510_000, 3, 8, { position: { x: 7080, y: 7000 } }))
      frameOf(details, 9, 8).championStats = { health: 7, healthMax: 1500 } as never
      delete (frameOf(details, 9, 3) as { position?: unknown }).position
      delete (frameOf(details, 9, 1) as { championStats?: unknown }).championStats
    })
    const row = at(buildReviewMinuteRows(match), 9)
    const placeOf = (participantId: number) =>
      row.places.find((place) => place.participantId === participantId)!

    expect(placeOf(8)).toMatchObject({ alive: false, zone: 'mid-own' })
    expect(placeOf(3)).toMatchObject({ alive: true, zone: null })
    expect(placeOf(1)).toMatchObject({ alive: null, zone: 'mid-own' })
    expect(placeOf(2)).toMatchObject({ alive: true, zone: 'mid-own' })
  })

  it('has no opponent numbers when no lane opponent could be identified', () => {
    const match = parse(({ summary }) => {
      // Two enemy top laners and no enemy mid: nobody to compare with.
      const enemyMid = summary.json.participants.find(
        (participant) => participant.participantId === 3
      )!
      enemyMid.teamPosition = 'TOP'
      enemyMid.individualPosition = 'TOP'
    })
    const row = at(buildReviewMinuteRows(match), 10)

    expect(match.meta.opponentId).toBeNull()
    expect(row.opponent).toBeNull()
    expect(row.goldDiff).toBeNull()
    expect(row.csDiff).toBeNull()
    expect(row.own.gold).toBe(4100)
    expect(row.teamGoldDiff).toBe(1800)
  })

  it('leaves a number unknown when the snapshot lost that player', () => {
    const match = parse(({ details }) => {
      delete details.json.frames[11].participantFrames['3']
    })
    const row = at(buildReviewMinuteRows(match), 11)

    expect(row.opponent).toEqual({
      gold: null,
      unspentGold: null,
      cs: null,
      level: null,
      damage: null,
      damageTaken: null,
      health: null,
      healthMax: null,
      alive: null
    })
    expect(row.goldDiff).toBeNull()
    expect(row.teamGoldDiff).toBeNull()
    expect(row.own.gold).toBe(4460)
  })

  it('carries the health of both laners at the instant of the snapshot', () => {
    const rows = buildReviewMinuteRows(
      parse(({ details }) => {
        frameOf(details, 6, 8).championStats = { health: 312, healthMax: 1480 } as never
        frameOf(details, 6, 3).championStats = { health: 0, healthMax: 1320 } as never
      })
    )

    expect(at(rows, 6).own).toMatchObject({ health: 312, healthMax: 1480, alive: true })
    // Zero health is carried as it is, not as unknown. By itself it is not a death: the kill
    // log is complete and has none for him.
    expect(at(rows, 6).opponent).toMatchObject({ health: 0, healthMax: 1320, alive: true })
    // The fixture's other snapshots give the health but no maximum.
    expect(at(rows, 5).own).toMatchObject({ health: 800, healthMax: null })
  })

  it('goes by the kill log, not by health, to say who is dead', () => {
    const rows = buildReviewMinuteRows(
      parse(({ details }) => {
        addReviewEvent(details, reviewTakedown(340_000, 8, 3, { position: { x: 7030, y: 7000 } }))
        // The lane opponent's body still reports a little health where it fell.
        frameOf(details, 6, 3).championStats = { health: 31, healthMax: 1320 } as never
        // A minute later he has respawned and left the spot.
        frameOf(details, 7, 3).position = { x: 13_000, y: 13_000 }
      })
    )

    expect(at(rows, 6).opponent).toMatchObject({ health: 31, alive: false })
    expect(at(rows, 5).opponent).toMatchObject({ alive: true })
    expect(at(rows, 7).opponent).toMatchObject({ alive: true })
  })

  it('has no rows for a game without usable snapshots', () => {
    const match = parse()
    expect(buildReviewMinuteRows({ ...match, frames: [] })).toEqual([])
  })
})

describe('buildReviewLaneGoldDiffs', () => {
  it('compares each role with the same role of the other team at the checkpoints', () => {
    const diffs = buildReviewLaneGoldDiffs(parse())

    // A 25-minute game has no 30-minute checkpoint.
    expect(diffs.map((entry) => entry.minute)).toEqual([5, 10, 15, 20, 25])
    expect(diffs[1]).toEqual({
      minute: 10,
      roles: [
        { role: 'TOP', diff: 300 },
        { role: 'JUNGLE', diff: 300 },
        { role: 'MIDDLE', diff: 600 },
        { role: 'BOTTOM', diff: 300 },
        { role: 'UTILITY', diff: 300 }
      ]
    })
    expect(REVIEW_LANE_DIFF_MINUTES).toContain(30)
  })

  it('takes the side of the reviewed player, whichever colour it is', () => {
    const red = parse(({ summary }) => {
      const self = summary.json.participants.find((participant) => participant.participantId === 8)!
      const other = summary.json.participants.find(
        (participant) => participant.participantId === 3
      )!
      ;[self.teamId, other.teamId] = [other.teamId, self.teamId]
    })
    const tenMinutes = buildReviewLaneGoldDiffs(red).find((entry) => entry.minute === 10)!

    // His own gold is still 600 ahead of the other mid; his new teammates earn 300 less.
    expect(tenMinutes.roles.find((entry) => entry.role === 'MIDDLE')!.diff).toBe(600)
    expect(tenMinutes.roles.find((entry) => entry.role === 'TOP')!.diff).toBe(-300)
  })

  it('leaves out a role that is not held by exactly one player on each side', () => {
    const diffs = buildReviewLaneGoldDiffs(
      parse(({ summary }) => {
        const enemySupport = summary.json.participants.find(
          (participant) => participant.participantId === 7
        )!
        enemySupport.teamPosition = 'BOTTOM'
        enemySupport.individualPosition = 'BOTTOM'
      })
    )

    expect(diffs[0].roles.map((entry) => entry.role)).toEqual(['TOP', 'JUNGLE', 'MIDDLE'])
  })

  it('leaves out a role whose gold is missing and a checkpoint without a snapshot', () => {
    const diffs = buildReviewLaneGoldDiffs(
      parse(({ details }) => {
        delete details.json.frames[10].participantFrames['2']
        details.json.frames.splice(15, 1)
      })
    )

    expect(diffs.map((entry) => entry.minute)).toEqual([5, 10, 20, 25])
    expect(diffs[1].roles.map((entry) => entry.role)).toEqual([
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY'
    ])
  })

  it('uses the snapshot closest to the minute and none that is too far away', () => {
    const near = parse(({ details }) => {
      details.json.frames[5].timestamp = 5 * 60_000 + 4000
    })
    const far = parse(({ details }) => {
      details.json.frames[5].timestamp = 5 * 60_000 + 20_000
    })

    expect(buildReviewLaneGoldDiffs(near)[0].minute).toBe(5)
    expect(buildReviewLaneGoldDiffs(far)[0].minute).toBe(10)
  })
})
