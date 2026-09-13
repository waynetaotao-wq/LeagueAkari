import { EMPTY_PUUID } from '@shared/constants/common'
import { describe, expect, it } from 'vitest'

import champions from './champions.json'
import { createMatchupFixture } from './fixtures'
import records from './matchups.json'
import { findMatchupTip, matchupChampionName, resolveConfirmedMatchup } from './model'
import sources from './sources.json'

describe('ongoing-game matchup tips', () => {
  it('waits for loading/in-game data even when champion select has a complete roster', () => {
    const game = createMatchupFixture()
    expect(
      resolveConfirmedMatchup(
        {
          ...game,
          queryStage: {
            phase: 'champ-select',
            gameInfo: {
              gameId: 101,
              gameMode: 'CLASSIC',
              queueId: 420,
              queueType: 'RANKED_SOLO_5x5'
            }
          }
        },
        'enemy'
      )
    ).toBeNull()
    const matchup = resolveConfirmedMatchup(game, 'enemy')!
    expect(matchup).toEqual({ gameId: 101, championId: 13, opponentId: 105, position: 'MIDDLE' })
    expect(findMatchupTip(matchup)?.points.length).toBeGreaterThan(0)
    expect(
      resolveConfirmedMatchup(
        { ...game, queryStage: { phase: 'unavailable', gameInfo: null } },
        'enemy'
      )
    ).toBeNull()
  })

  it('keeps the two requested Ryze/Fizz directions separate and never reuses another lane', () => {
    const forward = resolveConfirmedMatchup(createMatchupFixture(13, 105), 'enemy')!
    const reverse = resolveConfirmedMatchup(createMatchupFixture(105, 13), 'enemy')!
    expect(findMatchupTip(forward)?.sourceId).not.toBe(findMatchupTip(reverse)?.sourceId)
    expect(findMatchupTip(forward)?.points).not.toEqual(findMatchupTip(reverse)?.points)
    expect(findMatchupTip({ ...forward, position: 'TOP' })).toBeNull()
    expect(findMatchupTip({ ...forward, opponentId: 999999 })).toBeNull()
  })

  it('shows only on the actual same-position opponent card', () => {
    const game = createMatchupFixture()
    for (const puuid of ['self', 'ally-top', 'enemy-top', 'not-in-roster']) {
      expect(resolveConfirmedMatchup(game, puuid)).toBeNull()
    }
    const changed = createMatchupFixture(13, 103)
    expect(findMatchupTip(resolveConfirmedMatchup(changed, 'enemy')!)?.opponentId).toBe(103)
    expect(resolveConfirmedMatchup({ ...game, selfPuuid: null }, 'enemy')).toBeNull()
  })

  it.each([
    'missing-player',
    'duplicate-player',
    'placeholder',
    'missing-champion',
    'missing-position',
    'duplicate-position'
  ] as const)('does not guess from an incomplete or ambiguous roster: %s', (problem) => {
    const game = createMatchupFixture()
    if (problem === 'missing-player') game.teams['TEAM-200'].pop()
    if (problem === 'duplicate-player') game.teams['TEAM-200'][0] = 'self'
    if (problem === 'placeholder') game.teams['TEAM-200'][0] = EMPTY_PUUID
    if (problem === 'missing-champion') delete game.championSelections['ally-top']
    if (problem === 'missing-position') delete game.positionAssignments['enemy-support']
    if (problem === 'duplicate-position') game.positionAssignments['enemy-top'].position = 'MIDDLE'
    expect(resolveConfirmedMatchup(game, 'enemy')).toBeNull()
  })

  it('rejects disconnected, spectating, history simulation and non-classic games', () => {
    const game = createMatchupFixture()
    expect(resolveConfirmedMatchup({ ...game, isConnected: false }, 'enemy')).toBeNull()
    expect(resolveConfirmedMatchup({ ...game, isSpectating: true }, 'enemy')).toBeNull()
    expect(
      resolveConfirmedMatchup(
        {
          ...game,
          draft: {
            gameModeKind: 'normal',
            queueId: 420,
            puuid: 'self',
            teams: game.teams,
            championSelections: game.championSelections,
            positions: null
          }
        },
        'enemy'
      )
    ).toBeNull()
    for (const gameMode of ['ARAM', 'CHERRY', 'URF']) {
      expect(
        resolveConfirmedMatchup(
          {
            ...game,
            queryStage: {
              phase: 'in-game',
              gameInfo: { gameId: 101, gameMode, queueId: 450, queueType: 'ARAM' }
            }
          },
          'enemy'
        )
      ).toBeNull()
    }
  })

  it('keeps playing Zed exclusively on Bz while allowing an enemy Zed', () => {
    expect(resolveConfirmedMatchup(createMatchupFixture(238, 13), 'enemy')).toBeNull()
    expect(resolveConfirmedMatchup(createMatchupFixture(13, 238), 'enemy')?.opponentId).toBe(238)
  })

  it('requires a valid current game identity before selecting content', () => {
    const game = createMatchupFixture()
    for (const gameId of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        resolveConfirmedMatchup(
          {
            ...game,
            queryStage: {
              phase: 'in-game',
              gameInfo: { gameId, gameMode: 'CLASSIC', queueId: 420, queueType: 'RANKED_SOLO_5x5' }
            }
          },
          'enemy'
        )
      ).toBeNull()
    }
  })

  it('keeps Chinese names available without online champion resources', () => {
    expect(matchupChampionName(13)).toBe('瑞兹')
    expect(matchupChampionName(105)).toBe('菲兹')
    expect(matchupChampionName(999999)).toBe('英雄 999999')
  })
})

describe('curated dataset contract', () => {
  it('has unique directional lane records backed by matching author sources', () => {
    const ids = new Set(champions.map((champion) => champion.id))
    const sourceIndex = new Map(sources.map((source) => [source.id, source]))
    expect(sourceIndex.size).toBe(sources.length)
    const keys = new Set<string>()
    for (const record of records) {
      expect(ids.has(record.championId)).toBe(true)
      expect(ids.has(record.opponentId)).toBe(true)
      expect(record.championId).not.toBe(238)
      expect(record.championId).not.toBe(record.opponentId)
      expect(sourceIndex.get(record.sourceId)?.championId).toBe(record.championId)
      expect(record.positions.length).toBeGreaterThan(0)
      for (const position of record.positions) {
        expect(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']).toContain(position)
        const key = `${record.championId}:${record.opponentId}:${position}`
        expect(keys.has(key), key).toBe(false)
        keys.add(key)
      }
      expect(record.points.length).toBeGreaterThan(0)
      expect(record.points.length).toBeLessThanOrEqual(3)
      for (const point of record.points) {
        expect(point).toMatch(/[\u4e00-\u9fff]/)
        expect(point.length).toBeLessThanOrEqual(110)
      }
    }
    for (const source of sources) {
      expect(new URL(source.url).protocol).toBe('https:')
      expect(source.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(source.author.trim().length).toBeGreaterThan(0)
      expect(records.some((record) => record.sourceId === source.id)).toBe(true)
    }
  })
})
