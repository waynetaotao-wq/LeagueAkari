import { describe, expect, it, vi } from 'vitest'

import {
  MAX_REVIEW_ARCHIVE_GAMES,
  REVIEW_ARCHIVE_WARNING,
  mergeReviewArchive,
  readReviewArchive,
  toReviewArchiveRecord,
  writeReviewArchive
} from './archive'
import { type ReviewArchiveScope, type ReviewStorageAdapter, reviewScopeKey } from './notes'
import type { ReviewEvent, ReviewMatch } from './types'

const scope: ReviewArchiveScope = {
  ownerPuuid: 'owner',
  ownerServerId: 'HN1',
  targetPuuid: 'target',
  targetServerId: 'KR'
}

function event(id: string, overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id,
    timestamp: 100000,
    type: 'kill',
    killerId: 6,
    victimId: 1,
    assistingParticipantIds: [],
    teamId: 200,
    position: { x: 5000, y: 5000 },
    shutdownBounty: 150,
    buildingType: null,
    laneType: null,
    monsterType: null,
    monsterSubType: null,
    ...overrides
  }
}

function match(gameId = 1): ReviewMatch {
  return {
    meta: {
      gameId,
      sgpServerId: 'KR',
      puuid: 'target',
      gameCreation: gameId * 1000000,
      gameDuration: 1800,
      queueId: 420,
      patch: '26.17',
      championId: 238,
      position: 'MIDDLE',
      participantId: 1,
      teamId: 100,
      opponentId: 6,
      opponentChampionId: 103,
      win: false
    },
    participants: [
      {
        participantId: 1,
        puuid: 'target',
        championId: 238,
        championName: 'Zed',
        name: 'target-name',
        position: 'MIDDLE',
        teamId: 100,
        win: false
      }
    ],
    frames: [
      {
        timestamp: 600000,
        personalGoldDiff: 600,
        personalCsDiff: null,
        teamGoldDiff: 1000,
        participants: [
          {
            participantId: 1,
            gold: 4000,
            cs: null,
            position: { x: 1000, y: 1000 },
            level: 8,
            alive: true
          }
        ]
      }
    ],
    events: [
      event('death'),
      event('teammate-death', { victimId: 2 }),
      event('enemy-dragon', { type: 'monster', victimId: null, monsterType: 'DRAGON' }),
      event('own-tower', { type: 'building', teamId: 100, victimId: null })
    ],
    moments: [],
    snapshots: [10, 15, 20].map((minute) => ({
      minute: minute as 10 | 15 | 20,
      timestamp: minute * 60000,
      personalGoldDiff: 600,
      personalCsDiff: null,
      teamGoldDiff: 1000
    })),
    quality: {
      expectedFrames: 31,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 3,
      validCsSnapshots: 0,
      validTeamSnapshots: 3,
      eventCoverage: 'complete',
      warnings: []
    }
  }
}

function storage() {
  const values = new Map<string, unknown>()
  const adapter: ReviewStorageAdapter = {
    get: vi.fn(async (_namespace, key) => values.get(key)),
    set: vi.fn(async (_namespace, key, value) => values.set(key, value))
  }
  return { values, adapter }
}

describe('review history archive', () => {
  it('persists conversion evidence without player frame tracks and marks archive limitations', async () => {
    const { adapter } = storage()
    const original = match()
    await writeReviewArchive(adapter, scope, [original])
    const records = await readReviewArchive(adapter, scope)
    expect(records).toHaveLength(1)
    const stored = records[0].match
    expect(stored.meta).toEqual(original.meta)
    expect(stored.snapshots).toEqual(original.snapshots)
    expect(stored.frames).toEqual([])
    expect(stored.participants).toEqual([])
    expect(stored.events.map((item) => item.id)).toEqual(['death', 'enemy-dragon'])
    expect(stored.events.every((item) => item.position === null)).toBe(true)
    expect(stored.quality.warnings).toContain(REVIEW_ARCHIVE_WARNING)
    expect(original.frames).toHaveLength(1)
    expect(original.quality.warnings).toEqual([])
  })

  it('rejects unsupported versions, malformed records and another target/server', async () => {
    const { adapter, values } = storage()
    const key = `archive:${reviewScopeKey(scope)}`
    values.set(key, { version: 2, records: [toReviewArchiveRecord(match())] })
    expect(await readReviewArchive(adapter, scope)).toEqual([])
    const foreign = match(2)
    foreign.meta.puuid = 'another-player'
    const missing = toReviewArchiveRecord(match(3))
    missing.match.snapshots[0].personalGoldDiff = Number.NaN
    values.set(key, {
      version: 1,
      records: [
        toReviewArchiveRecord(match()),
        toReviewArchiveRecord(foreign),
        missing,
        { savedAt: 1, match: {} }
      ]
    })
    expect(
      (await readReviewArchive(adapter, scope)).map((record) => record.match.meta.gameId)
    ).toEqual([1])
  })

  it('deduplicates refreshed games and bounds history to the newest 200 matches', () => {
    const records = Array.from({ length: 220 }, (_, index) =>
      toReviewArchiveRecord(match(index + 1), 100)
    )
    const revised = toReviewArchiveRecord(match(220), 200)
    revised.match.snapshots[0].personalGoldDiff = 800
    const merged = mergeReviewArchive(records, [revised])
    expect(merged).toHaveLength(MAX_REVIEW_ARCHIVE_GAMES)
    expect(merged[0]).toBe(revised)
    expect(merged.at(-1)?.match.meta.gameId).toBe(21)
  })

  it('serializes concurrent batches and recovers its queue after a failed write', async () => {
    const { adapter } = storage()
    await Promise.all([
      writeReviewArchive(adapter, scope, [match(1)]),
      writeReviewArchive(adapter, scope, [match(2)])
    ])
    expect(
      (await readReviewArchive(adapter, scope)).map((record) => record.match.meta.gameId)
    ).toEqual([2, 1])
    vi.mocked(adapter.set).mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(writeReviewArchive(adapter, scope, [match(3)])).rejects.toThrow('disk unavailable')
    await writeReviewArchive(adapter, scope, [match(4)])
    expect(
      (await readReviewArchive(adapter, scope)).map((record) => record.match.meta.gameId)
    ).toEqual([4, 2, 1])
    expect(await readReviewArchive(adapter, { ...scope, ownerPuuid: 'another-owner' })).toEqual([])
  })
})
