import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { describe, expect, it } from 'vitest'

import { createDraftFixture, historyFixture } from './fixtures'
import {
  type DraftRole,
  type TargetPool,
  buildTargetPool,
  getDraftContext,
  pickCandidates,
  rankBans,
  rankPicks,
  readPlayerHistory
} from './model'

function evenlyPlayedHistory(
  puuid: string,
  groups: Array<[number, number]>,
  role: DraftRole = 'middle'
) {
  const now = Date.now()
  const data = historyFixture(
    puuid,
    groups.flatMap(([championId, games]) => Array(games).fill(championId)),
    role,
    now
  )
  data.forEach((entry, index) => {
    if (entry.source !== 'sgp') return
    entry.data.json.gameCreation = now
    entry.data.json.participants[0].win = index % 2 === 0
  })
  return readPlayerHistory(puuid, data, now)
}

describe('Premade five and Clash draft eligibility and live choices', () => {
  it.each([420, 400, 430, 440, 450, 490, 720])(
    'never enables in queue %i even if identities are visible',
    (queueId) => {
      const { game, session } = createDraftFixture()
      if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.queueId = queueId
      session.queueId = queueId
      expect(getDraftContext(game, session)).toBeNull()
    }
  )

  it('shows visible opponents in premade five on red side before gameflow has a game ID', () => {
    // Reconstructed from observed LCU metadata; identities and draft actions are synthetic.
    const { game, session } = createDraftFixture()
    ;[session.myTeam, session.theirTeam] = [session.theirTeam, session.myTeam]
    session.localPlayerCellId = 5
    session.myTeam[0].assignedPosition = 'middle'
    session.theirTeam.forEach((player) => (player.assignedPosition = ''))
    if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.gameId = 0

    const context = getDraftContext({ ...game, selfPuuid: session.myTeam[0].puuid }, session)
    expect(context?.self).toMatchObject({ cellId: 5, puuid: 'player-5', position: 'middle' })
    expect(context?.enemies.map((player) => player.cellId)).toEqual([0, 1, 2, 3, 4])
    expect(buildTargetPool(context!, {}, 'middle', null)).toMatchObject({
      source: 'unresolved',
      champions: []
    })
  })

  it.each([700, 710] as const)(
    'requires the current connected, non-spectating session for queue %i',
    (queueId) => {
      const { game, session } = createDraftFixture(queueId)
      expect(getDraftContext(game, session)?.enemies).toHaveLength(5)
      expect(getDraftContext({ ...game, isConnected: false }, session)).toBeNull()
      expect(getDraftContext({ ...game, isSpectating: true }, session)).toBeNull()
      expect(getDraftContext(game, { ...session, gameId: 999 })).toBeNull()
      expect(getDraftContext(game, { ...session, queueId: 420 })).toBeNull()
      expect(getDraftContext(game, { ...session, queueId: queueId === 700 ? 710 : 700 })).toBeNull()
      expect(getDraftContext(game, { ...session, isCustomGame: true })).toBeNull()
      expect(
        getDraftContext({ ...game, queryStage: { phase: 'unavailable', gameInfo: null } }, session)
      ).toBeNull()
      if (game.queryStage.phase === 'champ-select')
        expect(
          getDraftContext(
            { ...game, queryStage: { ...game.queryStage, phase: 'in-game' } },
            session
          )
        ).toBeNull()
    }
  )

  it.each([700, 710] as const)('never recovers hidden identities in queue %i', (queueId) => {
    const { game, session } = createDraftFixture(queueId)
    session.theirTeam[0].nameVisibilityType = 'HIDDEN'
    session.theirTeam[0].obfuscatedPuuid = 'has-data'
    session.theirTeam[1].puuid = '00000000-0000-0000-0000-000000000000'
    session.theirTeam[2].gameName = ''
    expect(getDraftContext(game, session)?.enemies.map((p) => p.cellId)).toEqual([8, 9])
    session.theirTeam.forEach((p) => (p.nameVisibilityType = 'HIDDEN'))
    expect(getDraftContext(game, session)).toBeNull()
  })

  it('distinguishes visible opponents with the same name by their Riot ID tags', () => {
    const { game, session } = createDraftFixture(700)
    session.theirTeam[0].gameName = ' SameName '
    session.theirTeam[0].tagLine = ' ONE '
    session.theirTeam[1].gameName = 'SameName'
    session.theirTeam[1].tagLine = 'TWO'
    session.theirTeam[2].gameName = 'NoTag'
    session.theirTeam[2].tagLine = ''
    session.theirTeam[3].gameName = 'HiddenName'
    session.theirTeam[3].tagLine = 'HIDDEN'
    session.theirTeam[3].nameVisibilityType = 'HIDDEN'

    const context = getDraftContext(game, session)!
    expect(context.enemies.slice(0, 3).map((player) => player.name)).toEqual([
      'SameName#ONE',
      'SameName#TWO',
      'NoTag'
    ])
    expect(context.enemies.some((player) => player.puuid === 'player-8')).toBe(false)
    expect(buildTargetPool(context, {}, 'middle', 'player-6').players[0].player).toMatchObject({
      puuid: 'player-6',
      name: 'SameName#TWO'
    })
  })

  it('excludes ambiguous duplicate identities and rejects an ambiguous local account', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[0].puuid = session.theirTeam[1].puuid
    const context = getDraftContext(game, session)!
    expect(context.enemies).toHaveLength(3)
    expect(context.enemies.some((player) => player.puuid === 'player-6')).toBe(false)
    session.theirTeam[2].puuid = game.selfPuuid!
    expect(getDraftContext(game, session)).toBeNull()
  })

  it.each([700, 710] as const)(
    'uses gameflow queue %i when LCU omits the redundant session queue field',
    (queueId) => {
      const { game, session } = createDraftFixture(queueId)
      Reflect.deleteProperty(session, 'queueId')
      expect(getDraftContext(game, session)?.enemies).toHaveLength(5)
      if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.queueId = 420
      expect(getDraftContext(game, session)).toBeNull()
    }
  )

  it('waits between Clash rounds without treating missing future actions as finished', () => {
    const { game, session } = createDraftFixture(700)
    const allActions = session.actions
    session.actions = allActions.slice(0, 6)
    session.actions.flat().forEach((action) => {
      action.completed = true
    })
    const histories = {
      'player-7': readPlayerHistory(
        'player-7',
        historyFixture('player-7', [105, 105], 'middle', Date.now(), 700),
        Date.now(),
        700
      )
    }
    let context = getDraftContext(game, session)!
    expect(context).toMatchObject({ banFinished: false, banState: 'waiting', banBudget: 0 })
    expect(rankBans(context, histories, new Set([105]), new Set(), [])).toEqual([])
    session.actions = allActions
    const pick = session.actions
      .flat()
      .find((action) => action.type === 'pick' && action.actorCellId === 7)!
    pick.completed = true
    pick.championId = session.theirTeam[2].championId = 105
    context = getDraftContext(game, session)!
    expect(context.banFinished).toBe(false)
    expect(rankBans(context, histories, new Set([105]), new Set(), [])).toEqual([])
    session.actions
      .flat()
      .filter((action) => action.type === 'ban')
      .forEach((action) => {
        action.completed = true
      })
    expect(getDraftContext(game, session)?.banFinished).toBe(true)
  })

  it('limits simultaneous bans to our remaining slots and stops when our team is done', () => {
    const { game, session } = createDraftFixture()
    const actions = session.actions.flat()
    actions
      .filter((action) => action.isAllyAction)
      .slice(0, 4)
      .forEach((action) => {
        action.completed = true // Empty bans consume a slot too.
      })
    session.actions.push([{ ...actions[0] }]) // Duplicate action IDs do not consume another slot.
    session.myTeam[0].nameVisibilityType = 'HIDDEN'
    const histories = {
      'player-7': evenlyPlayedHistory('player-7', [
        [13, 2],
        [105, 2],
        [238, 2]
      ])
    }
    const allowed = new Set([13, 105, 238])
    let context = getDraftContext(game, session)!
    expect(context).toMatchObject({ banFinished: false, banState: 'active', banBudget: 1 })
    expect(rankBans(context, histories, allowed, new Set(), [])).toHaveLength(1)
    actions[4].completed = true
    context = getDraftContext(game, session)!
    expect(context).toMatchObject({ banFinished: true, banState: 'finished', banBudget: 0 })
    expect(rankBans(context, histories, allowed, new Set(), [])).toEqual([])
  })

  it('keeps a Clash plan inside its ban round and counts separate captain actions', () => {
    const { game, session } = createDraftFixture(700)
    const actions = session.actions.flat()
    const histories = {
      'player-9': evenlyPlayedHistory(
        'player-9',
        [
          [13, 2],
          [105, 2],
          [238, 2]
        ],
        'utility'
      )
    }
    const allowed = new Set([13, 105, 238])
    const advance = (completed: number, active?: number) => {
      actions.forEach((action, index) => {
        action.completed = index < completed
        action.isInProgress = index === 0 || index === active // Completed stale flag is ignored.
      })
      return getDraftContext(game, session)!
    }
    let context = advance(4)
    expect(context).toMatchObject({ banState: 'active', banBudget: 1 })
    expect(rankBans(context, histories, allowed, new Set(), [])).toHaveLength(1)
    context = advance(6, 6)
    expect(context).toMatchObject({ banState: 'waiting', banBudget: 0, banFinished: false })
    expect(rankBans(context, histories, allowed, new Set(), [])).toEqual([])
    context = advance(12, 12)
    expect(context).toMatchObject({ banState: 'active', banBudget: 2 })
    expect(rankBans(context, histories, allowed, new Set(), [])).toHaveLength(2)
    context = advance(14, 14)
    expect(context).toMatchObject({ banState: 'active', banBudget: 1 })
    context = advance(16, 16)
    expect(context).toMatchObject({ banState: 'finished', banBudget: 0, banFinished: true })
  })

  it('recognizes completed red-side captain bans before the opponent finishes the round', () => {
    const { game, session } = createDraftFixture(700)
    ;[session.myTeam, session.theirTeam] = [session.theirTeam, session.myTeam]
    session.localPlayerCellId = 7
    session.myTeam[0].nameVisibilityType = 'HIDDEN'
    session.actions.flat().forEach((action, index) => {
      action.isAllyAction = action.actorCellId >= 5
      action.completed = index < 15
      action.isInProgress = index === 15
    })
    expect(getDraftContext({ ...game, selfPuuid: 'player-7' }, session)).toMatchObject({
      banState: 'finished',
      banBudget: 0,
      banFinished: true
    })
  })

  it.each(['FINALIZATION', 'GAME_STARTING'])(
    'finishes planning in %s even when actions are missing',
    (phase) => {
      const { game, session } = createDraftFixture()
      session.actions = []
      expect(getDraftContext(game, session)).toMatchObject({
        banState: 'waiting',
        banBudget: 0,
        banFinished: false
      })
      session.timer.phase = phase
      expect(getDraftContext(game, session)).toMatchObject({
        banState: 'finished',
        banBudget: 0,
        banFinished: true
      })
    }
  )

  it('does not invent an allied budget from a ban action with contradictory team ownership', () => {
    const { game, session } = createDraftFixture()
    session.actions[0][0].isAllyAction = false
    expect(getDraftContext(game, session)).toMatchObject({
      banState: 'waiting',
      banBudget: 0,
      banFinished: false
    })
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

  it('stops protecting a teammate stale hover after they lock another champion', () => {
    const { game, session } = createDraftFixture()
    session.myTeam[0].championPickIntent = 13
    session.myTeam[0].championId = 24
    const history = readPlayerHistory('player-2', historyFixture('player-2', [13, 13]))
    const histories = {
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', [13, 13]))
    }
    const allowed = new Set([13, 24])
    let context = getDraftContext(game, session)!
    expect(rankBans(context, histories, allowed, new Set(), [])).toEqual([])
    expect(pickCandidates(context, history, 'middle', null, allowed, new Set())).toEqual([])
    session.actions.push([
      {
        actorCellId: 0,
        championId: 24,
        completed: true,
        id: 20,
        isAllyAction: true,
        isInProgress: false,
        type: 'pick',
        duration: 30_000,
        pickTurn: 1
      }
    ])
    context = getDraftContext(game, session)!
    expect(
      rankBans(context, histories, allowed, new Set(), []).map((row) => row.championId)
    ).toEqual([13])
    expect(
      pickCandidates(context, history, 'middle', null, allowed, new Set()).map(
        (row) => row.championId
      )
    ).toEqual([13])
    expect(context.locked.has(24)).toBe(true)
  })
})

describe('history and ranking evidence', () => {
  it('keeps raw counts while giving recent practice more weight than old mains', () => {
    const now = Date.now()
    const data = historyFixture('player-7', [105, 105, 105, 13, 13, 13, 13, 13, 13], 'middle', now)
    data.forEach((entry, index) => {
      if (entry.source === 'sgp')
        entry.data.json.gameCreation = now - (index < 3 ? 0 : 80) * 86_400_000
    })
    const history = readPlayerHistory('player-7', data, now)
    expect(history.champions.map((row) => row.championId)).toEqual([105, 13])
    expect(history.champions[0]).toMatchObject({ games: 3, recencyGames: 3 })
    expect(history.champions[1].games).toBe(6)
    expect(history.champions[1].recencyGames).toBeLessThan(1)
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    expect(
      buildTargetPool(context, { 'player-7': history }, 'middle', null).champions[0].championId
    ).toBe(105)
    expect(
      rankBans(context, { 'player-7': history }, new Set([105, 13]), new Set(), [])[0].championId
    ).toBe(105)
  })

  it('accounts for known lane, replacement depth, ally opportunity cost and shortlist coverage', () => {
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    const history = (id: string, champions: number[], role: 'middle' | 'top' = 'middle') =>
      readPlayerHistory(id, historyFixture(id, champions, role))
    const histories = {
      'player-7': history('player-7', [
        ...Array(8).fill(105),
        ...Array(7).fill(13),
        ...Array(6).fill(238)
      ]),
      'player-5': history('player-5', Array(6).fill(24), 'top')
    }
    const allowed = new Set([105, 13, 238, 24])
    const bans = rankBans(context, histories, allowed, new Set(), [])
    expect(new Set(bans.slice(0, 2).map((ban) => ban.player.puuid)).size).toBe(2)
    const [before] = rankBans(context, histories, new Set([24]), new Set(), [])
    expect(before.replacementGap).toBeGreaterThan(0)
    const after = rankBans(
      context,
      {
        ...histories,
        'player-0': history('player-0', Array(20).fill(24), 'top')
      },
      new Set([24]),
      new Set(),
      []
    ).find((ban) => ban.championId === 24)!
    expect(after.allyCost).toBeGreaterThan(0.1)
    expect(after.score).toBeLessThan(before.score)
    context.enemies[2].position = 'utility'
    expect(
      rankBans(context, histories, allowed, new Set(), []).map((ban) => ban.championId)
    ).toEqual([24])
  })

  it('uses replacement depth after a ban while protecting intended allied picks', () => {
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    const histories = {
      'player-7': readPlayerHistory(
        'player-7',
        historyFixture('player-7', [...Array(10).fill(105), ...Array(10).fill(13)])
      )
    }
    const allowed = new Set([105])
    const before = rankBans(context, histories, allowed, new Set(), []).find(
      (row) => row.championId === 105
    )!
    context.banned.add(13)
    const after = rankBans(context, histories, allowed, new Set(), [])[0]
    expect(after.championId).toBe(105)
    expect(after.replacementGap).toBeGreaterThan(before.replacementGap)
    expect(after.score).toBeGreaterThan(before.score)
    context.allyIntents.add(105)
    expect(rankBans(context, histories, allowed, new Set(), [])).toEqual([])
  })

  it.each(['banned', 'locked', 'disabled'] as const)(
    'does not let a %s allied alternative dilute the cost of banning their remaining main',
    (unavailable) => {
      const { game, session } = createDraftFixture()
      const context = getDraftContext(game, session)!
      const histories = {
        'player-7': readPlayerHistory('player-7', historyFixture('player-7', Array(10).fill(13))),
        'player-0': readPlayerHistory(
          'player-0',
          historyFixture('player-0', [...Array(10).fill(13), ...Array(40).fill(24)], 'top')
        )
      }
      const disabled = new Set<number>()
      const before = rankBans(context, histories, new Set([13]), disabled, [])[0]
      if (unavailable === 'disabled') disabled.add(24)
      else context[unavailable].add(24)
      const after = rankBans(context, histories, new Set([13]), disabled, [])[0]
      expect(after.allyCost).toBeGreaterThan(before.allyCost)
      expect(after.score).toBeLessThan(before.score)
    }
  )

  it('uses the resolved self role for allied opportunity cost while keeping teammate roles independent', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = {
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', [13, 13, 105, 105])),
      'player-2': readPlayerHistory('player-2', historyFixture('player-2', Array(10).fill(13))),
      'player-0': readPlayerHistory(
        'player-0',
        historyFixture('player-0', Array(10).fill(105), 'top')
      )
    }
    const before = rankBans(context, histories, new Set([13, 105]), new Set(), [])
    const after = rankBans(context, histories, new Set([13, 105]), new Set(), [], {
      selfRole: 'top'
    })
    expect(before.find((row) => row.championId === 13)!.allyCost).toBeGreaterThan(0)
    expect(after.find((row) => row.championId === 13)!.allyCost).toBe(0)
    expect(after.find((row) => row.championId === 105)!.allyCost).toBe(
      before.find((row) => row.championId === 105)!.allyCost
    )
  })

  it('reconsiders the second main after the first suggested ban instead of mechanically spreading bans', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = {
      'player-7': evenlyPlayedHistory('player-7', [
        [13, 24],
        [105, 24]
      ]),
      'player-5': evenlyPlayedHistory('player-5', [[24, 2]], 'top'),
      'player-6': evenlyPlayedHistory('player-6', [[39, 2]], 'jungle')
    }
    const allowed = new Set([13, 105, 24, 39])
    const before = structuredClone({ context, histories })
    const bans = rankBans(context, histories, allowed, new Set(), [])
    expect(bans.slice(0, 2).map((row) => row.championId)).toEqual([13, 105])
    expect(bans[1].replacementGap).toBeGreaterThan(bans[0].replacementGap)
    expect({ context, histories }).toEqual(before)
  })

  it('recognizes that two enemies cannot both use the same replacement champion', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const shared = {
      'player-5': evenlyPlayedHistory(
        'player-5',
        [
          [13, 20],
          [105, 20]
        ],
        'top'
      ),
      'player-7': evenlyPlayedHistory('player-7', [
        [13, 20],
        [105, 20]
      ])
    }
    const distinct = {
      ...shared,
      'player-7': evenlyPlayedHistory('player-7', [
        [13, 20],
        [24, 20]
      ])
    }
    const [sharedBan] = rankBans(context, shared, new Set([13]), new Set(), [])
    const [distinctBan] = rankBans(context, distinct, new Set([13]), new Set(), [])
    expect(sharedBan.replacementGap).toBeGreaterThan(0)
    expect(distinctBan.replacementGap).toBe(0)
    expect(sharedBan.score).toBeGreaterThan(distinctBan.score)
    const [single] = rankBans(
      context,
      { 'player-7': shared['player-7'] },
      new Set([13]),
      new Set(),
      []
    )
    expect(single.replacementGap).toBe(0)

    const reordered = Object.fromEntries(
      Object.entries(shared)
        .reverse()
        .map(([puuid, history]) => [
          puuid,
          {
            ...history,
            champions: [...history.champions].reverse(),
            byRole: Object.fromEntries(
              Object.entries(history.byRole).map(([role, pool]) => [role, [...pool!].reverse()])
            )
          }
        ])
    )
    expect(
      rankBans(
        { ...context, enemies: [...context.enemies].reverse() },
        reordered,
        new Set([13]),
        new Set(),
        []
      )
    ).toEqual([sharedBan])
  })

  it('keeps the original single-player replacement gap and leaves an unknown fallback available', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const history = evenlyPlayedHistory('player-7', [
      [13, 20],
      [105, 4]
    ])
    const [before] = rankBans(context, { 'player-7': history }, new Set([13]), new Set(), [])
    const strength = (games: number) => Math.sqrt(games / (games + 4)) * 0.5
    expect(before.replacementGap).toBeCloseTo(strength(20) - strength(4))
    context.banned.add(105)
    const [after] = rankBans(context, { 'player-7': history }, new Set([13]), new Set(), [])
    expect(after.replacementGap).toBeCloseTo(strength(20) - 0.2)
    expect(after.replacementGap).toBeLessThan(strength(20))
  })

  it('removes a hypothetically banned enemy hover from later composition adjustments', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    context.enemies[0].hoverChampionId = 13
    context.enemies[1].lockedChampionId = 22
    context.enemies[3].lockedChampionId = 40
    context.locked.add(22)
    context.locked.add(40)
    const histories = {
      'player-5': evenlyPlayedHistory('player-5', [[13, 30]], 'top'),
      'player-7': evenlyPlayedHistory('player-7', [[54, 2]])
    }
    const options = {
      championRoles: { 13: ['tank'], 22: ['marksman'], 40: ['support'], 54: ['tank'] }
    }
    const bans = rankBans(context, histories, new Set([13, 54]), new Set(), [], options)
    expect(bans.map((row) => row.championId)).toEqual([13, 54])
    const actual = rankBans(
      {
        ...context,
        banned: new Set([13]),
        enemies: context.enemies.map((player) =>
          player.puuid === 'player-5' ? { ...player, hoverChampionId: 0 } : player
        )
      },
      histories,
      new Set([54]),
      new Set(),
      [],
      options
    )[0]
    expect(actual.compositionScore).toBeGreaterThan(0)
    expect(bans[1].compositionScore).toBeCloseTo(actual.compositionScore)
  })

  it('balances the weighted downside instead of letting an extremely rare counter dominate', () => {
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [
        { championId: 105, weight: 0.99 },
        { championId: 7, weight: 0.01 }
      ]
    }
    const picks = rankPicks(
      [13, 103].map((championId) => ({ championId, games: 10, wins: 5 })),
      target,
      {
        13: [
          { championId: 105, games: 10000, wins: 5400 },
          { championId: 7, games: 10000, wins: 1000 }
        ],
        103: [
          { championId: 105, games: 10000, wins: 5200 },
          { championId: 7, games: 10000, wins: 5200 }
        ]
      }
    )
    expect(picks[0].championId).toBe(13)
    expect(picks[0].worst?.championId).toBe(7)
  })

  it('keeps missing opponent mass in downside risk without fabricating matchup rows or outlook', () => {
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [
        { championId: 105, weight: 0.6 },
        { championId: 7, weight: 0.4 }
      ]
    }
    const candidates = [13, 103].map((championId) => ({ championId, games: 10, wins: 5 }))
    const samples = {
      13: [
        { championId: 105, games: 1000, wins: 550 },
        { championId: 7, games: 1000, wins: 400 }
      ],
      103: [{ championId: 105, games: 1000, wins: 540 }]
    }
    const picks = rankPicks(candidates, target, samples)
    expect(picks[0].championId).toBe(13)
    const missing = picks.find((pick) => pick.championId === 103)!
    expect(missing).toMatchObject({ coverage: 0.6, outlook: 'favorable', worst: null })
    expect(missing.rows[1]).toMatchObject({ games: null, winRate: null, weight: 0.4 })
    let previousScore = missing.score!
    for (const pair of [
      { championId: 7, games: 50, wins: 25 },
      { championId: 7, games: 1000, wins: 500 },
      { championId: 7, games: 1000, wins: 530 }
    ]) {
      const [known] = rankPicks([candidates[1]], target, { 103: [...samples[103], pair] })
      expect(known.coverage).toBe(1)
      expect(known.score).toBeGreaterThan(previousScore)
      previousScore = known.score!
    }
  })

  it('highlights the weighted adverse contribution rather than an extremely rare raw-rate outlier', () => {
    const candidate = [{ championId: 13, games: 10, wins: 5 }]
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [
        { championId: 7, weight: 0.01 },
        { championId: 105, weight: 0.49 },
        { championId: 238, weight: 0.5 }
      ]
    }
    const samples = {
      13: [
        { championId: 7, games: 50, wins: 0 },
        { championId: 105, games: 10000, wins: 4000 },
        { championId: 238, games: 10000, wins: 5500 }
      ]
    }
    const [pick] = rankPicks(candidate, target, samples)
    expect(pick.worst).toEqual({ championId: 105, winRate: 0.4 })
    expect(pick.rows.find((row) => row.championId === 7)).toMatchObject({ games: 50, winRate: 0 })
    const tied = {
      ...target,
      champions: [
        { championId: 238, weight: 0.5 },
        { championId: 105, weight: 0.5 }
      ]
    }
    samples[13][2].wins = 4000
    expect(rankPicks(candidate, tied, samples)[0].worst?.championId).toBe(105)
    expect(
      rankPicks(candidate, { ...tied, champions: [...tied.champions].reverse() }, samples)[0].worst
        ?.championId
    ).toBe(105)
  })

  it('rejects invalid/ambiguous pair evidence and keeps missing coverage unranked', () => {
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    for (const pairs of [
      [{ championId: 105, games: 100, wins: 101 }],
      [{ championId: 105, games: 100, wins: NaN }],
      [
        { championId: 105, games: 100, wins: 60 },
        { championId: 105, games: 100, wins: 60 }
      ]
    ]) {
      const [pick] = rankPicks([{ championId: 13, games: 50, wins: 40 }], target, { 13: pairs })
      expect(pick).toMatchObject({
        score: null,
        matchupScore: null,
        coverage: 0,
        outlook: 'unknown'
      })
    }
  })

  it('uses actual class structure, recent familiarity and locking changes without inventing synergy', () => {
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    const championRoles = {
      22: ['marksman', 'support'],
      99: ['mage'],
      40: ['support'],
      54: ['tank', 'mage'],
      238: ['assassin'],
      13: ['mage']
    }
    context.allies[0].lockedChampionId = 22
    context.allies[1].lockedChampionId = 99
    context.allies[3].lockedChampionId = 40
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    const candidates = [54, 238].map((championId) => ({ championId, games: 10, wins: 5 }))
    const samples = Object.fromEntries(
      candidates.map((row) => [row.championId, [{ championId: 105, games: 1000, wins: 500 }]])
    )
    const options = { context, championRoles }
    const picks = rankPicks(candidates, target, samples, options)
    expect(picks[0].championId).toBe(54)
    expect(picks[0].composition.signals).toContain('adds-frontline')
    expect(picks[0].outlook).toBe('even')
    context.allies[0].lockedChampionId = 54
    expect(
      rankPicks(candidates, target, samples, options).find((row) => row.championId === 54)!
        .composition.score
    ).toBe(0)
    context.allies[0].lockedChampionId = 0
    context.allies[0].hoverChampionId = 22
    expect(
      rankPicks(candidates, target, samples, options).find((row) => row.championId === 54)!
        .composition.score
    ).toBeLessThan(picks[0].composition.score)
    expect(rankPicks(candidates, target, {}, options).every((row) => row.score === null)).toBe(true)
    const [unseen] = rankPicks(candidates, target, samples, { context, championRoles: {} })
    expect(unseen.composition).toMatchObject({ score: 0, signals: ['limited-data'] })
    const familiar = rankPicks(
      [
        { championId: 54, games: 50, wins: 25, recencyGames: 3, recencyWins: 1.5 },
        { championId: 238, games: 10, wins: 5, recencyGames: 10, recencyWins: 5 }
      ],
      target,
      samples
    )
    expect(familiar[0].championId).toBe(238)
  })

  it('only uses locked enemies for class-pressure adjustments and does not call hybrid mages backline', () => {
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    const options = {
      context,
      championRoles: {
        54: ['tank', 'mage'],
        516: ['tank'],
        22: ['marksman'],
        99: ['mage'],
        238: ['assassin']
      }
    }
    context.enemies[0].hoverChampionId = 54
    context.enemies[1].hoverChampionId = 516
    const candidate = [{ championId: 22, games: 10, wins: 5 }]
    expect(rankPicks(candidate, target, {}, options)[0].composition.signals).not.toContain(
      'enemy-frontline'
    )
    context.enemies[0].lockedChampionId = 54
    context.enemies[1].lockedChampionId = 516
    expect(rankPicks(candidate, target, {}, options)[0].composition.signals).toContain(
      'enemy-frontline'
    )
    context.enemies[1].lockedChampionId = 99
    expect(
      rankPicks([{ championId: 238, games: 10, wins: 5 }], target, {}, options)[0].composition
        .signals
    ).not.toContain('enemy-backline')
    context.enemies[0].lockedChampionId = 22
    expect(
      rankPicks([{ championId: 238, games: 10, wins: 5 }], target, {}, options)[0].composition
        .signals
    ).toContain('enemy-backline')
  })

  it('treats ambiguous mage hybrids as unknown range instead of inventing a missing backline', () => {
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    context.allies[0].lockedChampionId = 103
    context.allies[1].lockedChampionId = 517
    context.allies[3].lockedChampionId = 54
    context.allies[4].lockedChampionId = 40
    const options = {
      context,
      championRoles: {
        103: ['mage', 'assassin'],
        517: ['mage', 'assassin'],
        54: ['tank', 'mage'],
        40: ['support'],
        22: ['marksman']
      }
    }
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    const [pick] = rankPicks([{ championId: 22, games: 10, wins: 5 }], target, {}, options)
    expect(pick.composition.score).toBe(0)
    expect(pick.composition.signals).not.toContain('adds-backline')
    expect(pick.composition.signals).not.toContain('backline-needed')
  })

  it('uses recent premade five games only, deduplicates and ignores unknown players/results and remakes', () => {
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
        queueId: 710,
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
    const fixture = createDraftFixture()
    const context = getDraftContext(fixture.game, fixture.session)!
    const target = (data: LcuOrSgpGameSummary[]) =>
      buildTargetPool(context, { 'player-7': readPlayerHistory('player', data) }, 'middle', null)
    expect(target([game]).unknownRole).toBe(true)
    // With known-position data, unknown-position games are excluded, not called an all-lane pool.
    const mixed = target([game, ...historyFixture('player', [105, 105])])
    expect(mixed.unknownRole).toBe(false)
    expect(mixed.champions.map((p) => p.championId)).toEqual([105])
  })

  it.each(['lcu', 'sgp'] as const)(
    'isolates Clash and premade five histories from other queues through %s',
    (source) => {
      const history = [710, 700, 440, 720].map((queueId, index) => {
        const championId = [13, 105, 238, 103][index]
        const common = {
          gameId: index + 1,
          queueId,
          mapId: 11,
          gameMode: 'CLASSIC',
          gameCreation: Date.now() - 1000,
          gameDuration: 1800
        }
        return source === 'lcu'
          ? {
              source,
              gameId: common.gameId,
              data: {
                ...common,
                participantIdentities: [{ participantId: 1, player: { puuid: 'player' } }],
                participants: [{ participantId: 1, championId, stats: { win: true } }]
              }
            }
          : {
              source,
              gameId: common.gameId,
              data: {
                json: {
                  ...common,
                  participants: [{ puuid: 'player', championId, win: true, teamPosition: 'MIDDLE' }]
                }
              }
            }
      }) as LcuOrSgpGameSummary[]
      expect(readPlayerHistory('player', history)).toMatchObject({
        games: 1,
        champions: [{ championId: 13, games: 1, wins: 1 }]
      })
      expect(readPlayerHistory('player', history, Date.now(), 700)).toMatchObject({
        games: 1,
        champions: [{ championId: 105, games: 1, wins: 1 }]
      })
    }
  )

  it('recomputes the opponent pool after bans and locks, with manual overrides', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = {
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', [13, 13, 105]))
    }
    const beforeBan = buildTargetPool(context, histories, 'middle', null).champions
    expect(beforeBan.map((row) => row.championId)).toEqual([13])
    expect(beforeBan[0].weight).toBeGreaterThan(2 / 3) // Its games are more recent.
    expect(beforeBan.reduce((sum, row) => sum + row.weight, 0)).toBeLessThan(1)
    context.banned.add(13)
    const target = buildTargetPool(context, histories, 'middle', null)
    expect(target.champions).toEqual([])
    expect(
      rankPicks([{ championId: 103, games: 10, wins: 5 }], target, {
        103: [{ championId: 105, games: 1000, wins: 600 }]
      })[0]
    ).toMatchObject({ score: null, coverage: 0, outlook: 'unknown' })
    context.enemies[2].lockedChampionId = 105
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
    expect(target.champions[0].weight).toBeLessThan(1)
    expect(target.players).toHaveLength(5)
    expect(target.players.every(({ weight }) => weight > 0)).toBe(true)
    expect(target.players.reduce((sum, { weight }) => sum + weight, 0)).toBeCloseTo(1)
  })

  it('resolves the remaining position from four distinct client assignments without inventing history', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[2].assignedPosition = ''
    const context = getDraftContext(game, session)!
    context.enemies[2].lockedChampionId = 105
    expect(buildTargetPool(context, {}, 'middle', null)).toMatchObject({
      source: 'assignment',
      players: [{ player: { puuid: 'player-7' }, weight: 1 }],
      champions: [{ championId: 105, weight: 1 }]
    })
  })

  it('infers unknown roles jointly so a flexible player can fill the lane a teammate rarely plays', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[1].assignedPosition = ''
    session.theirTeam[2].assignedPosition = ''
    const context = getDraftContext(game, session)!
    const histories = {
      'player-6': readPlayerHistory(
        'player-6',
        historyFixture('player-6', Array(10).fill(13)).map((entry, index) => {
          if (entry.source === 'sgp' && index >= 6)
            entry.data.json.participants[0].teamPosition = 'JUNGLE'
          return entry
        })
      ),
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', Array(10).fill(105)))
    }
    const middle = buildTargetPool(context, histories, 'middle', null)
    const jungle = buildTargetPool(context, histories, 'jungle', null)
    const midWeight = middle.players.find(({ player }) => player.puuid === 'player-7')!.weight
    const jungleWeight = jungle.players.find(({ player }) => player.puuid === 'player-6')!.weight
    expect(midWeight).toBeGreaterThan(0.8)
    expect(jungleWeight).toBeCloseTo(midWeight)
    for (const player of context.enemies.slice(1, 3)) {
      expect(
        [middle, jungle].reduce(
          (sum, target) =>
            sum + target.players.find((row) => row.player.puuid === player.puuid)!.weight,
          0
        )
      ).toBeCloseTo(1)
    }
  })

  it('retains unseen opponent mass and rejects contradictory client assignments unless overridden', () => {
    const { game, session } = createDraftFixture()
    session.theirTeam[1].nameVisibilityType = 'HIDDEN'
    session.theirTeam[2].assignedPosition = ''
    const context = getDraftContext(game, session)!
    context.enemies.find((player) => player.puuid === 'player-7')!.lockedChampionId = 105
    const histories = {
      'player-7': readPlayerHistory('player-7', historyFixture('player-7', Array(5).fill(105)))
    }
    const target = buildTargetPool(context, histories, 'middle', null)
    expect(target.champions[0].weight).toBeGreaterThan(0)
    expect(target.champions[0].weight).toBeLessThan(1)
    expect(target.players.reduce((sum, { weight }) => sum + weight, 0)).toBeLessThan(1)

    context.enemies[0].position = 'bottom'
    expect(buildTargetPool(context, histories, 'middle', null)).toMatchObject({
      source: 'unresolved',
      players: [],
      champions: []
    })
    expect(buildTargetPool(context, histories, 'middle', 'player-7')).toMatchObject({
      source: 'manual',
      champions: [{ championId: 105, weight: 1 }]
    })
  })

  it('does not infer missing classes when an already selected ally has unknown champion metadata', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    context.allies[0].lockedChampionId = 22
    context.allies[1].lockedChampionId = 99
    context.allies[3].lockedChampionId = 999
    const options = {
      context,
      championRoles: { 22: ['marksman'], 99: ['mage'], 54: ['tank'], 238: ['assassin'] }
    }
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    const picks = rankPicks(
      [54, 238].map((championId) => ({ championId, games: 10, wins: 5 })),
      target,
      {},
      options
    )
    expect(picks.every(({ composition }) => composition.score === 0)).toBe(true)
    expect(picks.every(({ composition }) => composition.signals.includes('limited-data'))).toBe(
      true
    )
    expect(picks.some(({ composition }) => composition.signals.includes('frontline-needed'))).toBe(
      false
    )
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

  it('does not mistake full data coverage or familiarity for favorable matchups', () => {
    const target: TargetPool = {
      source: 'manual',
      players: [],
      unknownRole: false,
      champions: [{ championId: 105, weight: 1 }]
    }
    const picks = rankPicks(
      [13, 103, 238].map((championId) => ({ championId, games: 50, wins: 40 })),
      target,
      {
        13: [{ championId: 105, games: 1000, wins: 560 }],
        103: [{ championId: 105, games: 1000, wins: 500 }],
        238: [{ championId: 105, games: 1000, wins: 460 }]
      }
    )
    expect(picks.map((p) => p.coverage)).toEqual([1, 1, 1])
    expect(picks.map((p) => p.outlook)).toEqual(['favorable', 'even', 'unfavorable'])
    expect(picks[0].worst).toBeNull()
    expect(picks[1].worst).toBeNull()
    expect(picks[2].worst?.championId).toBe(105)
  })

  it('accounts for a shared main across opponents without adding their games to one player', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = Object.fromEntries(
      ['player-5', 'player-7'].map((id) => [
        id,
        readPlayerHistory(
          id,
          historyFixture(id, [105, 105, 105, 105], id === 'player-5' ? 'top' : 'middle')
        )
      ])
    )
    const [ban] = rankBans(context, histories, new Set([105]), new Set(), [])
    const [single] = rankBans(
      context,
      { 'player-7': histories['player-7'] },
      new Set([105]),
      new Set(),
      []
    )
    expect(ban.score).toBeGreaterThan(single.score)
    expect(ban.score).toBeLessThan(single.score * 2)
    expect(ban.games).toBe(4)
    expect(ban.poolGames).toBe(4)
    expect(ban.otherPlayers).toHaveLength(1)
  })

  it('keeps shared-main value monotone even with fifty recent wins per player', () => {
    const { game, session } = createDraftFixture()
    const context = getDraftContext(game, session)!
    const histories = Object.fromEntries(
      ['player-5', 'player-7'].map((id) => {
        const data = historyFixture(id, Array(50).fill(105), id === 'player-5' ? 'top' : 'middle')
        for (const entry of data)
          if (entry.source === 'sgp') entry.data.json.participants[0].win = true
        return [id, readPlayerHistory(id, data)]
      })
    )
    const [single] = rankBans(
      context,
      { 'player-7': histories['player-7'] },
      new Set([105]),
      new Set(),
      []
    )
    const [shared] = rankBans(context, histories, new Set([105]), new Set(), [])
    expect(shared.score).toBeGreaterThan(single.score)
    expect(shared.score).toBeLessThan(1)
    expect(shared.games).toBe(50)
  })
})
