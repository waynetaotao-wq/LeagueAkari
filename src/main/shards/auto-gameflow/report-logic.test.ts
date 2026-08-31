import { normalizeAutoReportCategories } from '@shared/shards/auto-gameflow'
import axios, { AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import { describe, expect, it } from 'vitest'

import {
  type ReportTarget,
  buildNoRetryRequestConfig,
  buildReportPayload,
  chooseReportRoster,
  classifyReportWindow,
  getCompleteFriendPuuids,
  getCompletePartyMemberPuuids,
  getMinimumRosterTargetCount,
  getRemainingRequestTimeout,
  getReportRetryDelay,
  getReportedPlayerIds,
  isAmbiguousReportStatus,
  isReportRosterForGame,
  isRetryableReportStatus,
  parseEogRoster,
  selectReportTargets,
  shouldDelayPlayAgainForReport
} from './report-logic'

const target = (puuid: string, side: ReportTarget['side'], summonerId: number): ReportTarget => ({
  puuid,
  side,
  summonerId,
  summonerName: puuid
})

describe('auto-report category normalization', () => {
  it('migrates retired categories, removes duplicates, and keeps at most three', () => {
    expect(
      normalizeAutoReportCategories([
        'NEGATIVE_ATTITUDE',
        'ASSISTING_ENEMY_TEAM',
        'HATE_SPEECH',
        'RANK_MANIPULATION',
        'BOTTING',
        'NOT_A_CATEGORY'
      ])
    ).toEqual(['ASSISTING_ENEMY_TEAM', 'VERBAL_ABUSE', 'RANK_MANIPULATION'])
  })

  it('rejects malformed persisted values without inventing a category', () => {
    expect(normalizeAutoReportCategories('VERBAL_ABUSE')).toEqual([])
    expect(normalizeAutoReportCategories([null, 1, 'UNKNOWN'])).toEqual([])
  })
})

describe('EOG roster parsing', () => {
  it('parses the teams payload of /eog-stats-block and excludes the local player and bots', () => {
    const result = parseEogRoster({
      gameId: 111,
      reportGameId: 222,
      localPlayer: { puuid: 'self' },
      teams: [
        {
          players: [
            { puuid: 'self', summonerId: 1, isLocalPlayer: true },
            { puuid: 'ally', summonerId: 2, summonerName: 'Ally', gameId: 222 },
            { puuid: 'bot', summonerId: 3, botPlayer: true }
          ]
        },
        {
          players: [
            {
              puuid: 'enemy',
              summonerId: 4,
              riotIdGameName: 'Enemy',
              riotIdTagLine: 'CN1',
              gameId: 222
            },
            { puuid: 'enemy', summonerId: 4 }
          ]
        }
      ]
    })

    expect(result).toEqual({
      statsGameId: 111,
      reportGameId: 222,
      source: 'eog',
      targets: [
        { ...target('ally', 'ally', 2), summonerName: 'Ally' },
        { ...target('enemy', 'opponent', 4), summonerName: 'Enemy#CN1' }
      ]
    })
  })

  it('uses isLocalPlayer even when summoner state has not loaded', () => {
    const result = parseEogRoster({
      gameId: 333,
      reportGameId: 333,
      teams: [
        {
          players: [
            { puuid: 'self', summonerId: 1, isLocalPlayer: true },
            { puuid: 'ally', summonerId: 2 }
          ]
        },
        { players: [{ puuid: 'enemy', summonerId: 3 }] }
      ]
    })

    expect(result?.targets.map(({ puuid, side }) => ({ puuid, side }))).toEqual([
      { puuid: 'ally', side: 'ally' },
      { puuid: 'enemy', side: 'opponent' }
    ])
  })

  it('rejects the separate gameclient shape, flat data, or ID-less data', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        statsBlock: { players: [{ PUUID: 'gameclient-player', playerId: 1 }] }
      })
    ).toBeNull()
    expect(parseEogRoster({ gameId: 1, players: [{ puuid: 'unknown' }] })).toBeNull()
    expect(
      parseEogRoster({ teams: [{ isPlayerTeam: false, players: [{ puuid: 'enemy' }] }] })
    ).toBeNull()
  })

  it('requires positive evidence for the local team before assigning sides', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        teams: [
          { isPlayerTeam: false, players: [{ puuid: 'one', summonerId: 1 }] },
          { isPlayerTeam: false, players: [{ puuid: 'two', summonerId: 2 }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects a team flag without a local identity so all-mode cannot include self', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        teams: [
          { isPlayerTeam: true, players: [{ puuid: 'could-be-self', summonerId: 1 }] },
          { players: [{ puuid: 'enemy', summonerId: 2 }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects a state identity that is absent from the EOG roster', () => {
    expect(
      parseEogRoster(
        {
          gameId: 1,
          reportGameId: 1,
          teams: [
            { isPlayerTeam: true, players: [{ puuid: 'ally', summonerId: 1 }] },
            { players: [{ puuid: 'enemy', summonerId: 2 }] }
          ]
        },
        'self-from-state'
      )
    ).toBeNull()
  })

  it('rejects a player-team flag that conflicts with the local identity', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          { isPlayerTeam: true, players: [{ puuid: 'ally', summonerId: 2 }] },
          {
            players: [
              { puuid: 'self', summonerId: 1, isLocalPlayer: true },
              { puuid: 'enemy', summonerId: 3 }
            ]
          }
        ]
      })
    ).toBeNull()
  })

  it('rejects conflicting root, state, and marked local identities', () => {
    expect(
      parseEogRoster(
        {
          gameId: 1,
          reportGameId: 1,
          localPlayer: { puuid: 'wrong-root-self' },
          teams: [
            {
              players: [
                { puuid: 'real-self', summonerId: 1, isLocalPlayer: true },
                { puuid: 'ally', summonerId: 2 }
              ]
            },
            { players: [{ puuid: 'enemy', summonerId: 3 }] }
          ]
        },
        'real-self'
      )
    ).toBeNull()
  })

  it('rejects multiple player-team flags', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          {
            isPlayerTeam: true,
            players: [{ puuid: 'self', summonerId: 1, isLocalPlayer: true }]
          },
          { isPlayerTeam: true, players: [{ puuid: 'enemy', summonerId: 2 }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects a local identity appearing on more than one team', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          { players: [{ puuid: 'self', summonerId: 1 }] },
          { players: [{ puuid: 'self', summonerId: 1 }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects any PUUID that appears on both teams', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          {
            players: [
              { puuid: 'self', summonerId: 1 },
              { puuid: 'duplicated', summonerId: 2 }
            ]
          },
          { players: [{ puuid: 'duplicated', summonerId: 3 }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects conflicting summoner or obfuscated identifiers', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          { players: [{ puuid: 'self', summonerId: 1 }] },
          {
            players: [
              { puuid: 'enemy-a', summonerId: 2 },
              { puuid: 'enemy-b', summonerId: 2 }
            ]
          }
        ]
      })
    ).toBeNull()

    expect(
      parseEogRoster({
        gameId: 1,
        reportGameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          { players: [{ puuid: 'self', summonerId: 1 }] },
          {
            players: [
              { puuid: 'enemy-a', summonerId: 2, obfuscatedPuuid: 'shared-hidden' },
              { puuid: 'enemy-b', summonerId: 3, obfuscatedPuuid: 'shared-hidden' }
            ]
          }
        ]
      })
    ).toBeNull()
  })

  it('does not guess that the stats ID is also valid for report submission', () => {
    expect(
      parseEogRoster({
        gameId: 1,
        localPlayer: { puuid: 'self' },
        teams: [
          { players: [{ puuid: 'self', isLocalPlayer: true }, { puuid: 'ally' }] },
          { players: [{ puuid: 'enemy' }] }
        ]
      })
    ).toBeNull()
  })

  it('rejects conflicting root and player report IDs', () => {
    expect(
      parseEogRoster({
        gameId: 111,
        reportGameId: 222,
        teams: [
          {
            isPlayerTeam: true,
            players: [
              { puuid: 'self', summonerId: 1, isLocalPlayer: true, gameId: 222 },
              { puuid: 'ally', summonerId: 2, gameId: 333 }
            ]
          },
          { players: [{ puuid: 'enemy', summonerId: 3, gameId: 222 }] }
        ]
      })
    ).toBeNull()
  })

  it('does not create a target without the identifier used by the shipped modal', () => {
    const result = parseEogRoster({
      gameId: 1,
      reportGameId: 1,
      localPlayer: { puuid: 'self' },
      teams: [
        {
          players: [
            { puuid: 'self', summonerId: 1, isLocalPlayer: true },
            { puuid: 'ally-without-summoner-id' }
          ]
        },
        { players: [{ puuid: 'enemy', summonerId: 3 }] }
      ]
    })

    expect(result?.targets.map((item) => item.puuid)).toEqual(['enemy'])
  })
})

describe('report target safety', () => {
  it('accepts only complete friend and reported-player identifier lists', () => {
    expect(getCompleteFriendPuuids([{ puuid: 'friend-1' }, { PUUID: 'friend-2' }])).toEqual(
      new Set(['friend-1', 'friend-2'])
    )
    expect(getCompleteFriendPuuids([{ puuid: '' }])).toBeNull()
    expect(getCompleteFriendPuuids(null)).toBeNull()

    expect(getReportedPlayerIds(['puuid', 42])).toEqual(new Set(['puuid', '42']))
    expect(getReportedPlayerIds([])).toEqual(new Set())
    expect(getReportedPlayerIds([null])).toBeNull()
  })

  it('accepts only a complete, disjoint party EOG roster', () => {
    expect(
      getCompletePartyMemberPuuids({
        eogPlayers: ['self'],
        leftPlayers: ['premade-left'],
        readyPlayers: ['premade-ready'],
        partySize: 3
      })
    ).toEqual(new Set(['self', 'premade-left', 'premade-ready']))

    expect(
      getCompletePartyMemberPuuids({
        eogPlayers: ['self'],
        leftPlayers: [],
        readyPlayers: ['premade-ready'],
        partySize: 3
      })
    ).toBeNull()

    expect(
      getCompletePartyMemberPuuids({
        eogPlayers: ['self'],
        leftPlayers: ['premade'],
        readyPlayers: ['premade'],
        partySize: 2
      })
    ).toBeNull()
  })

  const roster = [
    target('ally', 'ally', 1),
    target('enemy', 'opponent', 2),
    target('unknown', 'unknown', 3),
    target('friend', 'opponent', 4),
    target('premade', 'opponent', 5),
    target('reported', 'opponent', 6),
    target('duplicate', 'opponent', 7),
    target('duplicate', 'opponent', 7)
  ]

  it('only accepts confirmed opponents in opponents-only mode', () => {
    expect(
      selectReportTargets(roster, {
        scope: 'opponents-only',
        excludedPuuids: new Set(['friend', 'premade']),
        alreadyReportedIds: new Set(['reported'])
      }).map((item) => item.puuid)
    ).toEqual(['enemy', 'duplicate'])
  })

  it('deduplicates targets by every stable identifier before submitting', () => {
    const first = { ...target('enemy-a', 'opponent', 2), obfuscatedPuuid: 'hidden-a' }
    const sameSummoner = target('enemy-b', 'opponent', 2)
    const sameObfuscated = {
      ...target('enemy-c', 'opponent', 3),
      obfuscatedPuuid: 'hidden-a'
    }

    expect(
      selectReportTargets([first, sameSummoner, sameObfuscated], {
        scope: 'opponents-only',
        excludedPuuids: new Set(),
        alreadyReportedIds: new Set()
      }).map((item) => item.puuid)
    ).toEqual(['enemy-a'])
  })

  it('allows unknown sides only when all players were explicitly requested', () => {
    expect(
      selectReportTargets(roster, {
        scope: 'all',
        excludedPuuids: new Set(['ally', 'friend', 'premade']),
        alreadyReportedIds: new Set(['6'])
      }).map((item) => item.puuid)
    ).toEqual(['enemy', 'unknown', 'duplicate'])
  })

  it('recognizes obfuscated PUUIDs in the server-reported set', () => {
    const obfuscated = { ...target('enemy', 'opponent', 2), obfuscatedPuuid: 'hidden-id' }
    expect(
      selectReportTargets([obfuscated], {
        scope: 'opponents-only',
        excludedPuuids: new Set(),
        alreadyReportedIds: new Set(['hidden-id'])
      })
    ).toEqual([])
  })

  it('expects nine report targets from a ten-player session before self has hydrated', () => {
    const tenPlayers = Array.from({ length: 10 }, (_, index) => `player-${index}`)
    expect(getMinimumRosterTargetCount(0, tenPlayers, undefined, 10)).toBe(9)
    expect(getMinimumRosterTargetCount(8, tenPlayers, 'player-0', 10)).toBe(9)
    expect(getMinimumRosterTargetCount(0, tenPlayers.slice(0, 5), undefined, 10)).toBe(4)
    expect(getMinimumRosterTargetCount(0, tenPlayers.slice(1), 'self-not-listed', 10)).toBe(9)
    expect(getMinimumRosterTargetCount(0, [], undefined, 10)).toBe(9)
  })
})

describe('report execution helpers', () => {
  it('uses only a matching EOG snapshot and never falls back to a partial ballot', () => {
    const eogTarget = target('eog', 'opponent', 2)
    const eog = {
      statsGameId: 111,
      reportGameId: 222,
      targets: [eogTarget],
      source: 'eog' as const
    }
    const expected = { statsGameId: 111, reportGameId: 222 }

    expect(chooseReportRoster(eog, expected)).toBe(eog)
    expect(chooseReportRoster(null, expected)).toBeNull()
  })

  it('rejects a stale EOG snapshot from a different game', () => {
    const stale = {
      statsGameId: 333,
      reportGameId: 444,
      targets: [target('stale', 'opponent', 2)],
      source: 'eog' as const
    }
    const expected = { statsGameId: 111, reportGameId: 222 }

    expect(isReportRosterForGame(stale, expected)).toBe(false)
    expect(chooseReportRoster(stale, expected)).toBeNull()
  })

  it('classifies only the actual postgame phases as waitable or ready', () => {
    expect(classifyReportWindow('EndOfGame', true)).toBe('ready')
    expect(classifyReportWindow('WaitingForStats', true)).toBe('wait')
    expect(classifyReportWindow('PreEndOfGame', true)).toBe('wait')
    expect(classifyReportWindow('Lobby', true)).toBe('left')
    expect(classifyReportWindow(null, true)).toBe('left')
    expect(classifyReportWindow('EndOfGame', false)).toBe('disabled')
  })

  it('holds play-again throughout every report lifecycle phase', () => {
    expect(shouldDelayPlayAgainForReport('WaitingForStats', true, true)).toBe(true)
    expect(shouldDelayPlayAgainForReport('PreEndOfGame', true, true)).toBe(true)
    expect(shouldDelayPlayAgainForReport('EndOfGame', true, true)).toBe(true)
    expect(shouldDelayPlayAgainForReport('Lobby', true, true)).toBe(false)
    expect(shouldDelayPlayAgainForReport('EndOfGame', false, true)).toBe(false)
    expect(shouldDelayPlayAgainForReport('EndOfGame', true, false)).toBe(false)
  })

  it('retries only statuses that clearly did not accept the report', () => {
    expect(isRetryableReportStatus()).toBe(false)
    expect(isRetryableReportStatus(408)).toBe(false)
    expect(isRetryableReportStatus(425)).toBe(true)
    expect(isRetryableReportStatus(429)).toBe(true)
    expect(isRetryableReportStatus(503)).toBe(false)
    expect(isRetryableReportStatus(400)).toBe(false)
    expect(isRetryableReportStatus(404)).toBe(false)
    expect(isRetryableReportStatus(409)).toBe(false)
  })

  it('classifies no-response, timeout, and server errors as ambiguous', () => {
    expect(isAmbiguousReportStatus()).toBe(true)
    expect(isAmbiguousReportStatus(408)).toBe(true)
    expect(isAmbiguousReportStatus(503)).toBe(true)
    expect(isAmbiguousReportStatus(425)).toBe(false)
    expect(isAmbiguousReportStatus(429)).toBe(false)
    expect(isAmbiguousReportStatus(400)).toBe(false)
  })

  it('matches the payload sent by the current shipped postgame report modal', () => {
    expect(buildReportPayload(222, target('enemy', 'opponent', 9), ['VERBAL_ABUSE'])).toEqual({
      gameId: 222,
      offenderPuuid: 'enemy',
      offenderSummonerId: 9,
      categories: ['VERBAL_ABUSE'],
      comment: ''
    })

    expect(
      buildReportPayload(
        222,
        { ...target('enemy', 'opponent', 9), obfuscatedPuuid: 'real-obfuscated-id' },
        ['VERBAL_ABUSE']
      )
    ).not.toHaveProperty('obfuscatedOffenderPuuid')
  })

  it('disables the global Axios retry layer for a report POST', async () => {
    const client = axios.create()
    axiosRetry(client, { retries: 2 })
    let postAttempts = 0
    client.defaults.adapter = async (config) => {
      postAttempts++
      throw new AxiosError('socket reset', 'ECONNRESET', config)
    }

    await expect(
      client.post('/report', {}, buildNoRetryRequestConfig(new AbortController().signal))
    ).rejects.toThrow('socket reset')
    expect(postAttempts).toBe(1)
  })

  it('parses Retry-After seconds and dates without allowing an unbounded wait', () => {
    const now = Date.parse('2026-08-30T00:00:00Z')
    expect(getReportRetryDelay('2', now)).toBe(2000)
    expect(getReportRetryDelay('Sun, 30 Aug 2026 00:00:05 GMT', now)).toBe(5000)
    expect(getReportRetryDelay(undefined, now)).toBe(350)
    expect(getReportRetryDelay('Sun, 30 Aug 2026 00:01:00 GMT', now)).toBeNull()
  })

  it('caps each request at the remaining operation budget', () => {
    expect(getRemainingRequestTimeout(1000, 1000)).toBeNull()
    expect(getRemainingRequestTimeout(1000, 750)).toBe(250)
    expect(getRemainingRequestTimeout(20_000, 0)).toBe(17_500)
    expect(getRemainingRequestTimeout(20_000, 0, 2000)).toBe(2000)
  })
})
