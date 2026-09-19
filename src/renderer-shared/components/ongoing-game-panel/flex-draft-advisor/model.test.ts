import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { describe, expect, it } from 'vitest'

import { createDraftFixture, historyFixture } from './fixtures'
import {
  type TargetPool,
  buildTargetPool,
  getDraftContext,
  pickCandidates,
  rankBans,
  rankPicks,
  readPlayerHistory
} from './model'

describe('Flex draft eligibility and live choices', () => {
  it.each([420, 400, 430, 450, 490, 720])(
    'never enables in queue %i even if identities are visible',
    (queueId) => {
      const { game, session } = createDraftFixture()
      if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.queueId = queueId
      expect(getDraftContext(game, session)).toBeNull()
    }
  )

  it('requires the current connected, non-spectating champion-select session', () => {
    const { game, session } = createDraftFixture()
    expect(getDraftContext(game, session)?.enemies).toHaveLength(5)
    expect(getDraftContext({ ...game, isConnected: false }, session)).toBeNull()
    expect(getDraftContext({ ...game, isSpectating: true }, session)).toBeNull()
    expect(getDraftContext(game, { ...session, gameId: 999 })).toBeNull()
    expect(getDraftContext(game, { ...session, queueId: 420 })).toBeNull()
    expect(
      getDraftContext({ ...game, queryStage: { phase: 'unavailable', gameInfo: null } }, session)
    ).toBeNull()
    if (game.queryStage.phase === 'champ-select')
      expect(
        getDraftContext({ ...game, queryStage: { ...game.queryStage, phase: 'in-game' } }, session)
      ).toBeNull()
  })

  it('never recovers hidden identities from cached names or obfuscated PUUIDs', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[0].nameVisibilityType = 'HIDDEN'
    session.theirTeam[0].obfuscatedPuuid = 'has-data'
    session.theirTeam[1].puuid = '00000000-0000-0000-0000-000000000000'
    session.theirTeam[2].gameName = ''
    expect(getDraftContext(game, session)?.enemies.map((p) => p.cellId)).toEqual([8, 9])
    session.theirTeam.forEach((p) => (p.nameVisibilityType = 'HIDDEN'))
    expect(getDraftContext(game, session)).toBeNull()
  })

  it('uses the verified gameflow queue when LCU omits the redundant session queue field', () => {
    const { game, session } = createDraftFixture()
    Reflect.deleteProperty(session, 'queueId')
    expect(getDraftContext(game, session)?.enemies).toHaveLength(5)
    if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.queueId = 420
    expect(getDraftContext(game, session)).toBeNull()
  })

  it('distinguishes hover from lock and reads the current traded champion', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[2].championId = 105
    session.theirTeam[2].championPickIntent = 105
    expect(getDraftContext(game, session)?.enemies[2].lockedChampionId).toBe(0)
    session.actions.push([
      {
        actorCellId: 7,
        championId: 105,
        completed: true,
        id: 20,
        isAllyAction: false,
        isInProgress: false,
        type: 'pick',
        duration: 30_000,
        pickTurn: 1
      }
    ])
    session.theirTeam[2].championId = 13
    expect(getDraftContext(game, session)?.enemies[2].lockedChampionId).toBe(13)
  })
})

describe('history and ranking evidence', () => {
  it('uses recent Flex games only, deduplicates and ignores unknown players/results and remakes', () => {
    const now = Date.now()
    const data = historyFixture('player', [13, 13, 13, 13, 13, 13, 13, 13], 'middle', now)
    const games = data.map((p) => (p.source === 'sgp' ? p.data.json : null))!
    games[1]!.queueId = 420
    games[2]!.participants[0].puuid = 'someone-else'
    games[3]!.participants[0].gameEndedInEarlySurrender = true
    games[4]!.gameCreation = now - 91 * 86_400_000
    games[5]!.participants[0].win = undefined as unknown as boolean
    games[6]!.gameDuration = 200
    games[7]!.participants.push(games[7]!.participants[0])
    expect(readPlayerHistory('player', [...data, data[0]], now)).toMatchObject({
      games: 1,
      champions: [{ championId: 13, games: 1, wins: 0 }],
      roles: { middle: 1 }
    })
  })

  it('does not invent lane assignments for LCU history', () => {
    const game = {
      source: 'lcu',
      gameId: 9,
      data: {
        gameId: 9,
        gameCreation: Date.now() - 1000,
        gameDuration: 1800,
        queueId: 440,
        mapId: 11,
        gameMode: 'CLASSIC',
        participantIdentities: [{ participantId: 3, player: { puuid: 'player' } }],
        participants: [
          { participantId: 3, championId: 13, stats: { win: true }, timeline: { lane: 'MID' } }
        ]
      }
    } as LcuOrSgpGameSummary
    expect(readPlayerHistory('player', [game])).toMatchObject({
      games: 1,
      unknownRoleGames: 1,
      roles: { middle: 0 },
      champions: [{ championId: 13, wins: 1 }]
    })
  })

  it('recomputes the opponent pool after bans and locks, with manual overrides', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = {
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', [13, 13, 105]))
    }
    expect(buildTargetPool(context, histories, 'middle', null).champions).toEqual([
      { championId: 13, weight: 2 / 3 },
      { championId: 105, weight: 1 / 3 }
    ])
    context.banned.add(13)
    expect(buildTargetPool(context, histories, 'middle', null).champions).toEqual([
      { championId: 105, weight: 1 }
    ])
    context.enemies[2].lockedChampionId = 238
    expect(buildTargetPool(context, histories, 'middle', null).champions).toEqual([
      { championId: 238, weight: 1 }
    ])
    context.enemies[0].lockedChampionId = 24
    expect(buildTargetPool(context, histories, 'middle', 'player-5')).toMatchObject({
      source: 'manual',
      champions: [{ championId: 24, weight: 1 }]
    })
  })

  it('keeps uncertainty for missing histories while inferring likely opponents', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam.forEach((p) => (p.assignedPosition = ''))
    const context = getDraftContext(game, session)!
    expect(buildTargetPool(context, {}, 'middle', null).source).toBe('unresolved')
    const histories = {
      'player-7': readPlayerHistory(
        'player-7',
        historyFixture('player-7', [105, 105, 105, 105, 105])
      )
    }
    const target = buildTargetPool(context, histories, 'middle', null)
    expect(target.source).toBe('history')
    expect(target.champions[0].weight).toBeLessThan(0.6)
    expect(target.players).toHaveLength(5)
  })

  it('excludes bans, unavailable champions, ally intents and one-game automatic picks', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const history = readPlayerHistory(
      'player-2',
      historyFixture('player-2', [13, 13, 103, 103, 105, 105, 238])
    )
    context.banned.add(13)
    context.allyIntents.add(103)
    const available = new Set([13, 103, 105, 238])
    expect(
      pickCandidates(context, history, 'middle', null, available, new Set()).map(
        (p) => p.championId
      )
    ).toEqual([105])
    expect(
      pickCandidates(context, history, 'middle', [238], available, new Set()).map(
        (p) => p.championId
      )
    ).toEqual([238])
    expect(pickCandidates(context, history, 'middle', null, new Set(), new Set())).toEqual([])
    context.self.lockedChampionId = 13
    expect(
      pickCandidates(context, history, 'middle', null, new Set(), new Set()).map(
        (p) => p.championId
      )
    ).toEqual([13])
  })

  it('bans target enemy mains without banning ally intent or champions already locked', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = {
      'player-7': readPlayerHistory(
        'player-7',
        historyFixture('player-7', [105, 105, 105, 13, 13, 238])
      )
    }
    const allowed = new Set([13, 105, 238])
    expect(rankBans(context, histories, allowed, new Set(), [13]).map((p) => p.championId)).toEqual(
      [105]
    )
    context.allyIntents.add(105)
    expect(rankBans(context, histories, allowed, new Set(), [13])).toEqual([])
    context.allyIntents.clear()
    context.enemies[2].lockedChampionId = 105
    expect(rankBans(context, histories, allowed, new Set(), [])).toEqual([])
  })

  it('prefers broad coverage over one strong counter; unknown and small samples never become neutral evidence', () => {
    const candidates = [13, 103, 238].map((championId) => ({ championId, games: 10, wins: 6 }))
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [
        { championId: 105, weight: 0.6 },
        { championId: 7, weight: 0.4 }
      ]
    }
    const picks = rankPicks(candidates, target, {
      13: [
        { championId: 105, games: 1000, wins: 530 },
        { championId: 7, games: 1000, wins: 530 }
      ],
      103: [
        { championId: 105, games: 1000, wins: 570 },
        { championId: 7, games: 1000, wins: 360 }
      ],
      238: [{ championId: 105, games: 20, wins: 20 }]
    })
    expect(picks[0].championId).toBe(13)
    expect(picks.find((p) => p.championId === 103)?.worst?.championId).toBe(7)
    expect(picks[2]).toMatchObject({ championId: 238, score: null, coverage: 0 })
    expect(picks[2].rows.map((p) => p.winRate)).toEqual([null, null])
  })
})
