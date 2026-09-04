import { describe, expect, it } from 'vitest'

import { getReviewSummaryEligibility, parseReviewMatch } from './analysis'
import { addReviewEvent, createReviewFixture, reviewDragon, reviewKill } from './test-fixtures'

function parse(fixture = createReviewFixture()) {
  const result = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId
  )
  if (!result.ok) throw new Error(result.reason)
  return result.match
}

describe('review timeline evidence', () => {
  it('uses real participant teams and roles when IDs and arrays are scrambled', () => {
    const fixture = createReviewFixture()
    fixture.summary.json.participants.reverse()
    fixture.details.json.participants.reverse()
    fixture.details.json.frames.reverse()
    const match = parse(fixture)
    expect(match.meta).toMatchObject({
      participantId: 8,
      teamId: 100,
      opponentId: 3,
      opponentChampionId: 103
    })
    expect(match.snapshots[0]).toMatchObject({
      minute: 10,
      timestamp: 600_000,
      personalGoldDiff: 600,
      personalCsDiff: 10,
      teamGoldDiff: 1800
    })
    fixture.puuid = 'player-3'
    expect(parse(fixture).snapshots[0]).toMatchObject({
      personalGoldDiff: -600,
      personalCsDiff: -10,
      teamGoldDiff: -1800
    })
  })

  it.each([
    [
      'short',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.gameDuration = 299
      }
    ],
    [
      'remake',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.endOfGameResult = 'Abort_Unexpected'
      }
    ],
    [
      'early surrender',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.participants[0].gameEndedInEarlySurrender = true
      }
    ],
    [
      'wrong map',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.mapId = 12
      }
    ],
    [
      'wrong queue',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.queueId = 450
      }
    ],
    [
      'wrong mode',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.gameMode = 'ARAM'
      }
    ],
    [
      'incomplete team',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.participants.pop()
      }
    ],
    [
      'unbalanced teams',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.participants[0].teamId = 200
      }
    ],
    [
      'duplicate identity',
      (f: ReturnType<typeof createReviewFixture>) => {
        f.summary.json.participants[0].puuid = f.summary.json.participants[1].puuid
      }
    ]
  ])('rejects %s with a visible reason', (_, change) => {
    const fixture = createReviewFixture()
    change(fixture)
    expect(getReviewSummaryEligibility(fixture.summary, fixture.puuid)).toMatchObject({
      ok: false,
      reason: expect.any(String)
    })
  })

  it('requires matching game and participant identity, including metadata', () => {
    const fixture = createReviewFixture()
    fixture.details.json.participants[0].puuid = 'another-player'
    expect(parseReviewMatch(fixture.summary, fixture.details, fixture.puuid, 'TEST').ok).toBe(false)
    fixture.details.json.participants[0].puuid = fixture.puuid
    fixture.details.json.gameId++
    expect(parseReviewMatch(fixture.summary, fixture.details, fixture.puuid, 'TEST').ok).toBe(false)
    fixture.details.json.gameId--
    fixture.details.metadata.match_id = 'ANOTHER_12345'
    expect(parseReviewMatch(fixture.summary, fixture.details, fixture.puuid, 'TEST').ok).toBe(false)
  })

  it('reports malformed provider containers as a visible failure instead of throwing', () => {
    const fixture = createReviewFixture()
    Reflect.set(fixture.summary.json, 'participants', {})
    expect(() =>
      parseReviewMatch(fixture.summary, fixture.details, fixture.puuid, 'TEST')
    ).not.toThrow()
    expect(getReviewSummaryEligibility(fixture.summary, fixture.puuid).ok).toBe(false)
    const other = createReviewFixture()
    Reflect.set(other.details.json, 'participants', [
      null,
      ...other.details.json.participants.slice(1)
    ])
    expect(parseReviewMatch(other.summary, other.details, other.puuid, 'TEST').ok).toBe(false)
  })

  it('marks event coverage partial when full frame arrays omit deaths present in the summary', () => {
    const fixture = createReviewFixture()
    fixture.summary.json.participants[0].deaths = 2
    const missing = parse(fixture)
    expect(missing.quality.timelineCoverage).toBe(1)
    expect(missing.quality.eventCoverage).toBe('partial')
    addReviewEvent(fixture.details, reviewKill(500_000))
    addReviewEvent(fixture.details, reviewKill(600_000))
    expect(parse(fixture).quality.eventCoverage).toBe('complete')
  })

  it('keeps missing gold, CS and position independent; real zero is retained', () => {
    const fixture = createReviewFixture()
    const frame = fixture.details.json.frames[10].participantFrames['8']
    Reflect.deleteProperty(frame, 'totalGold')
    frame.minionsKilled = 0
    frame.jungleMinionsKilled = 0
    Reflect.deleteProperty(frame, 'position')
    const match = parse(fixture)
    expect(match.frames[10].participants.find((p) => p.participantId === 8)).toMatchObject({
      gold: null,
      cs: 0,
      position: null
    })
    expect(match.snapshots[0]).toMatchObject({
      personalGoldDiff: null,
      personalCsDiff: -70,
      teamGoldDiff: null
    })
    Reflect.deleteProperty(frame, 'jungleMinionsKilled')
    expect(parse(fixture).snapshots[0].personalCsDiff).toBeNull()
  })

  it('does not infer a counterpart when the role is unknown or ambiguous', () => {
    const fixture = createReviewFixture()
    fixture.summary.json.participants.find((p) => p.participantId === 2)!.teamPosition = 'MIDDLE'
    const match = parse(fixture)
    expect(match.meta.opponentId).toBeNull()
    expect(match.snapshots[0].personalGoldDiff).toBeNull()
    expect(match.snapshots[0].teamGoldDiff).toBe(1800)
  })

  it('uses only near-checkpoint frames and never carries a late frame backward', () => {
    const fixture = createReviewFixture()
    fixture.details.json.frames[10].timestamp += 10_001
    fixture.details.json.frames[15].timestamp += 9000
    const match = parse(fixture)
    expect(match.snapshots[0]).toMatchObject({ timestamp: null, personalGoldDiff: null })
    expect(match.snapshots[1].timestamp).toBe(909_000)
    expect(match.quality.missingFrames).toBe(1)
    expect(match.quality.eventCoverage).toBe('partial')
  })

  it('handles short valid games without inventing future checkpoints', () => {
    const match = parse(createReviewFixture({ duration: 600 }))
    expect(match.snapshots.map((s) => s.timestamp)).toEqual([600_000, null, null])
    expect(match.quality.timelineCoverage).toBe(1)
  })

  it('deduplicates frames and events and preserves event precision and bounty semantics', () => {
    const fixture = createReviewFixture()
    const event = reviewKill(615_125, 8, 450)
    addReviewEvent(fixture.details, event)
    addReviewEvent(fixture.details, event)
    fixture.details.json.frames.push(structuredClone(fixture.details.json.frames[11]))
    const match = parse(fixture)
    expect(match.frames).toHaveLength(26)
    expect(match.events).toHaveLength(1)
    expect(match.events[0]).toMatchObject({ timestamp: 615_125, shutdownBounty: 450, teamId: 200 })
    expect(match.moments[0].description).toContain('额外 450')
  })

  it('does not substitute ordinary kill bounty for an unknown shutdown', () => {
    const fixture = createReviewFixture()
    const event = reviewKill(615_000)
    Reflect.deleteProperty(event, 'shutdownBounty')
    addReviewEvent(fixture.details, event)
    const match = parse(fixture)
    expect(match.events[0].shutdownBounty).toBeNull()
    expect(match.moments.some((m) => m.kind === 'shutdown')).toBe(false)
  })

  it('interprets building team as owner and records subsequent objective association without causality', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewKill(601_000))
    addReviewEvent(fixture.details, {
      type: 'BUILDING_KILL',
      timestamp: 640_000,
      killerId: 0,
      teamId: 100,
      buildingType: 'TOWER_BUILDING',
      laneType: 'MID_LANE',
      position: { x: 5846, y: 6396 },
      bounty: 250
    })
    addReviewEvent(fixture.details, reviewDragon(691_001))
    const match = parse(fixture)
    expect(match.events[1].teamId).toBe(200)
    const moment = match.moments.find((m) => m.kind === 'death-objective')!
    expect(moment.eventIds).toHaveLength(2)
    expect(moment.description).toContain('不代表因果')
    expect(moment.end).toBe(640_000)
  })

  it('finds repeated deaths and economic setbacks, but not across gaps', () => {
    const fixture = createReviewFixture()
    addReviewEvent(fixture.details, reviewKill(610_000))
    addReviewEvent(fixture.details, reviewKill(750_000))
    for (let m = 11; m <= 15; m++)
      fixture.details.json.frames[m].participantFrames['3'].totalGold += (m - 10) * 300
    const match = parse(fixture)
    expect(match.moments.some((m) => m.kind === 'repeated-deaths')).toBe(true)
    expect(match.moments.some((m) => m.kind === 'gold-swing' && m.scope === 'personal')).toBe(true)
    fixture.details.json.frames = fixture.details.json.frames.filter(
      (frame) => frame.timestamp <= 600_000 || frame.timestamp >= 900_000
    )
    const sparse = parse(fixture)
    expect(sparse.moments.some((m) => m.kind === 'gold-swing')).toBe(false)
    expect(sparse.quality.eventCoverage).toBe('partial')
  })

  it('never displays a wholly unavailable timeline as an uneventful match', () => {
    const fixture = createReviewFixture()
    fixture.details.json.frames.forEach((frame) => {
      frame.participantFrames = {}
    })
    expect(parseReviewMatch(fixture.summary, fixture.details, fixture.puuid, 'TEST')).toMatchObject(
      { ok: false, reason: expect.any(String) }
    )
  })
})
