import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game/types'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type {
  ChampionDataDetails,
  ChampionDataLoadResult
} from '@shared/data-adapter/champion-data'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EffectScope, effectScope, nextTick, reactive } from 'vue'

import { createDraftFixture, historyFixture } from './fixtures'
import { useDraftAdvisor } from './use-draft-advisor'

let game: OngoingGameProviderValue
let scope: EffectScope
const source = vi.hoisted(() => ({ loadPatches: vi.fn(), loadDetails: vi.fn() }))
vi.mock('@renderer-shared/providers/ongoing-game', () => ({ useOngoingGameProvider: () => game }))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => source }))
vi.mock('@renderer-shared/shards/champion-data', () => ({ ChampionDataRenderer: class {} }))

function response(championId: number): ChampionDataLoadResult<ChampionDataDetails> {
  return {
    status: 'success',
    preferredSource: 'opgg',
    effectiveSource: 'opgg',
    fallbackReason: null,
    attempts: [],
    data: {
      championId,
      metadata: { source: 'opgg', mode: 'ranked', patch: '16.18' },
      summary: { championId, position: 'middle' },
      sections: {
        positions: [{ position: 'middle' }],
        matchups: [{ championId: 105, performance: { games: 1000, wins: 540 } }]
      }
    } as ChampionDataDetails
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const fixture = createDraftFixture()
  game = reactive(fixture.game)
  game.draftMatchHistory['player-2'] = {
    source: 'sgp',
    queueId: 710,
    scannedCount: 2,
    scanLimit: 50,
    data: historyFixture('player-2', [13, 13])
  }
  game.draftMatchHistory['player-7'] = {
    source: 'sgp',
    queueId: 710,
    scannedCount: 2,
    scanLimit: 50,
    data: historyFixture('player-7', [105, 105])
  }
  const store = useLeagueClientStore()
  store.champSelect.session = fixture.session
  store.champSelect.currentPickableChampionIds = new Set([13, 103])
  store.champSelect.currentBannableChampionIds = new Set([105])
  source.loadPatches.mockResolvedValue({
    status: 'success',
    effectiveSource: 'opgg',
    data: ['16.18']
  })
  source.loadDetails.mockImplementation(async (_query, id) => response(id))
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

describe('live draft advice lifecycle', () => {
  it('stops protecting old comfort picks and hover after locking while retaining the manual pool', () => {
    const fixture = createDraftFixture(700)
    Object.assign(game, fixture.game)
    game.draftMatchHistory['player-8'] = {
      source: 'sgp',
      queueId: 700,
      scannedCount: 10,
      scanLimit: 50,
      data: historyFixture('player-8', Array(10).fill(103), 'bottom', Date.now(), 700)
    }
    const store = useLeagueClientStore()
    store.champSelect.session = fixture.session
    store.champSelect.currentPickableChampionIds = new Set([13, 103])
    store.champSelect.currentBannableChampionIds = new Set([103])
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.comfortable.value = [13, 103]
    expect(advisor.bans.value).toEqual([])

    const session = store.champSelect.session!
    session.myTeam[2].championId = 13
    session.myTeam[2].championPickIntent = 103
    for (const action of session.actions.slice(0, 12).flat()) {
      action.completed = true
      action.isInProgress = false
    }
    session.actions[12][0].isInProgress = true
    store.champSelect.session = { ...session }
    expect(advisor.picks.value.map((pick) => pick.championId)).toEqual([13])
    expect(advisor.comfortable.value).toEqual([13, 103])
    expect(advisor.bans.value.map((ban) => ban.championId)).toContain(103)
  })

  it('updates the unpicked opponent pool when disabled champions change but retains actual locks', () => {
    const store = useLeagueClientStore()
    game.draftMatchHistory['player-7'].data = historyFixture('player-7', [105, 105, 105, 7, 7, 7])
    const advisor = scope.run(() => useDraftAdvisor())!
    expect(advisor.target.value?.champions.map((champion) => champion.championId)).toEqual([105, 7])
    store.champSelect.disabledChampionIds = new Set([105])
    expect(advisor.target.value?.champions).toEqual([{ championId: 7, weight: 1 }])
    store.champSelect.disabledChampionIds = new Set()
    expect(advisor.target.value?.champions.map((champion) => champion.championId)).toEqual([105, 7])

    store.champSelect.disabledChampionIds = new Set([105])
    const session = store.champSelect.session!
    session.theirTeam[2].championId = 105
    session.actions.push([
      {
        actorCellId: 7,
        championId: 105,
        completed: true,
        id: 30,
        isAllyAction: false,
        isInProgress: false,
        type: 'pick',
        duration: 30_000,
        pickTurn: 7
      }
    ])
    store.champSelect.session = { ...session }
    expect(advisor.target.value?.champions).toEqual([{ championId: 105, weight: 1 }])
  })

  it('uses the selected self role for ally ban cost without changing teammate assignments', () => {
    const store = useLeagueClientStore()
    store.champSelect.currentPickableChampionIds = new Set([13, 24])
    store.champSelect.currentBannableChampionIds = new Set([13, 105])
    const ownHistory = historyFixture('player-2', [...Array(10).fill(13), ...Array(10).fill(24)])
    for (const entry of ownHistory) {
      if (entry.source === 'sgp' && entry.data.json.participants[0].championId === 24)
        entry.data.json.participants[0].teamPosition = 'TOP'
    }
    game.draftMatchHistory['player-2'].data = ownHistory
    for (const [puuid, championId, role] of [
      ['player-0', 105, 'top'],
      ['player-5', 105, 'top'],
      ['player-7', 13, 'middle']
    ] as const) {
      game.draftMatchHistory[puuid] = {
        source: 'sgp',
        queueId: 710,
        scannedCount: 12,
        scanLimit: 50,
        data: historyFixture(puuid, Array(12).fill(championId), role)
      }
    }
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.comfortable.value = [24]
    const ownMiddleCost = advisor.bans.value.find((ban) => ban.championId === 13)!.allyCost
    const teammateTopCost = advisor.bans.value.find((ban) => ban.championId === 105)!.allyCost
    expect(ownMiddleCost).toBeGreaterThan(0)
    expect(teammateTopCost).toBeGreaterThan(0)

    advisor.selectedRole.value = 'top'
    expect(advisor.bans.value.find((ban) => ban.championId === 13)!.allyCost).toBe(0)
    expect(advisor.bans.value.find((ban) => ban.championId === 105)!.allyCost).toBe(teammateTopCost)
    expect(advisor.context.value?.self.position).toBe('middle')
    expect(
      advisor.context.value?.allies.find((player) => player.puuid === 'player-0')?.position
    ).toBe('top')

    advisor.selectedRole.value = null
    expect(advisor.bans.value.find((ban) => ban.championId === 13)!.allyCost).toBe(ownMiddleCost)
  })

  it('keeps an explicitly chosen comfort champion out of bans when temporarily unpickable', () => {
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.comfortable.value = [105]
    expect(advisor.picks.value).toEqual([])
    expect(advisor.bans.value.map((ban) => ban.championId)).not.toContain(105)
    advisor.comfortable.value = null
    expect(advisor.bans.value.map((ban) => ban.championId)).toContain(105)
  })

  it('exposes self and ally history failures, scan progress and retry alongside enemy status', async () => {
    const retry = vi.fn()
    Object.assign(game, { retryDraftHistories: retry })
    game.draftMatchHistoryLoadingState['player-2'] = 'error'
    game.draftMatchHistoryLoadingState['player-0'] = 'waiting'
    game.draftMatchHistoryLoadingState['player-1'] = 'loading'
    const advisor = scope.run(() => useDraftAdvisor())!
    expect(advisor.historyStatuses.value['player-2']).toBe('error')
    expect(advisor.historyStatuses.value['player-0']).toBe('waiting')
    expect(advisor.historyScans.value['player-2']).toMatchObject({
      source: 'sgp',
      scannedCount: 2
    })
    expect(advisor.historyLoading.value).toBe(true)
    expect(advisor.playerNames.value['player-0']).toBe('玩家1#TEST')
    advisor.retryHistories()
    expect(retry).toHaveBeenCalledOnce()
    game.draftMatchHistoryLoadingState['player-2'] = 'loaded'
    await nextTick()
    expect(advisor.historyStatuses.value['player-2']).toBe('ready')
  })

  it('reranks equal matchups as known ally classes change without refetching statistics', async () => {
    const store = useLeagueClientStore()
    store.champSelect.currentPickableChampionIds = new Set([13, 111])
    store.gameData.champions = {
      13: { id: 13, name: 'Ryze', alias: 'Ryze', squarePortraitPath: '', roles: ['mage'] },
      111: {
        id: 111,
        name: 'Nautilus',
        alias: 'Nautilus',
        squarePortraitPath: '',
        roles: ['tank', 'support']
      },
      103: {
        id: 103,
        name: 'Ahri',
        alias: 'Ahri',
        squarePortraitPath: '',
        roles: ['mage', 'assassin']
      },
      202: { id: 202, name: 'Jhin', alias: 'Jhin', squarePortraitPath: '', roles: ['marksman'] },
      89: {
        id: 89,
        name: 'Leona',
        alias: 'Leona',
        squarePortraitPath: '',
        roles: ['tank', 'support']
      }
    }
    game.draftMatchHistory['player-2'].data = historyFixture('player-2', [13, 111, 13, 111])
    const session = store.champSelect.session!
    for (const [cellId, championId] of [
      [0, 103],
      [1, 202]
    ]) {
      session.myTeam[cellId].championId = championId
      session.actions.push([
        {
          actorCellId: cellId,
          championId,
          completed: true,
          id: 30 + cellId,
          isAllyAction: true,
          isInProgress: false,
          type: 'pick',
          duration: 30_000,
          pickTurn: cellId
        }
      ])
    }
    store.champSelect.session = { ...session }
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0].championId).toBe(111)
    expect(advisor.picks.value[0].composition.signals).toContain('adds-frontline')
    store.champSelect.session = {
      ...store.champSelect.session!,
      myTeam: session.myTeam.map((p) => (p.cellId === 0 ? { ...p, championId: 89 } : p))
    }
    await nextTick()
    expect(advisor.picks.value[0].championId).toBe(13)
    await vi.advanceTimersByTimeAsync(300)
    expect(source.loadDetails).toHaveBeenCalledTimes(2)
  })

  it('uses dedicated queue histories for all allies and distinguishes missing, empty, failed and hidden opponents', async () => {
    const retry = vi.fn()
    Object.assign(game, { retryDraftHistories: retry })
    game.matchHistory['player-5'] = { data: historyFixture('player-5', [24, 24]) }
    game.draftMatchHistory['player-0'] = {
      source: 'sgp',
      queueId: 710,
      scannedCount: 2,
      scanLimit: 50,
      data: historyFixture('player-0', [24, 24], 'top')
    }
    game.draftMatchHistory['player-6'] = {
      source: 'lcu',
      queueId: 710,
      scannedCount: 200,
      scanLimit: 200,
      data: historyFixture('player-6', [64, 64], 'jungle', Date.now(), 700)
    }
    game.draftMatchHistoryLoadingState['player-8'] = 'error'
    game.draftMatchHistoryLoadingState['player-9'] = 'waiting'
    const advisor = scope.run(() => useDraftAdvisor())!
    expect(advisor.histories.value['player-0'].games).toBe(2)
    expect(advisor.histories.value['player-5'].games).toBe(0)
    expect(advisor.historyStatuses.value).toMatchObject({
      'player-5': 'pending',
      'player-6': 'empty',
      'player-7': 'ready',
      'player-8': 'error',
      'player-9': 'waiting'
    })
    expect(advisor.historyScans.value['player-6']).toMatchObject({
      source: 'lcu',
      scannedCount: 200
    })
    advisor.retryHistories()
    expect(retry).toHaveBeenCalledTimes(1)
    const store = useLeagueClientStore()
    store.champSelect.session = {
      ...store.champSelect.session!,
      theirTeam: store.champSelect.session!.theirTeam.map((player) =>
        player.puuid === 'player-8' ? { ...player, nameVisibilityType: 'HIDDEN' } : player
      )
    }
    await nextTick()
    expect(advisor.historyStatuses.value['player-8']).toBeUndefined()
    if (game.queryStage.phase === 'champ-select') game.queryStage.gameInfo.queueId = 440
    await nextTick()
    advisor.retryHistories()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('refreshes statistics at the first five-minute interval even after slow initial loading', async () => {
    source.loadPatches.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { status: 'success', effectiveSource: 'opgg', data: ['16.18'] }
    })
    let wins = 540
    source.loadDetails.mockImplementation(async (_query, id) => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const loaded = response(id)
      if (loaded.status === 'success') loaded.data.sections.matchups![0].performance.wins = wins
      return loaded
    })
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(3000)
    expect(advisor.result.value.samples[13][0].wins).toBe(540)
    wins = 460
    advisor.retry()
    await vi.advanceTimersByTimeAsync(300)
    expect(source.loadDetails).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(advisor.result.value.samples[13][0].wins).toBe(460)
    expect(source.loadPatches).toHaveBeenCalledTimes(2)
    expect(source.loadDetails).toHaveBeenCalledTimes(2)
  })

  it('distinguishes visible Riot IDs while keeping streamer aliases anonymous', async () => {
    const store = useLeagueClientStore()
    store.champSelect.session = {
      ...store.champSelect.session!,
      theirTeam: store.champSelect.session!.theirTeam.map((player, index) => ({
        ...player,
        gameName: 'SameName',
        tagLine: `TAG${index}`
      }))
    }
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.selectedOpponent.value = 'player-7'
    expect(advisor.playerNames.value['player-7']).toBe('SameName#TAG2')
    Object.assign(game, { streamerMode: true })
    await nextTick()
    expect(advisor.context.value?.enemies.map((p) => advisor.playerNames.value[p.puuid])).toEqual([
      '#1',
      '#2',
      '#3',
      '#4',
      '#5'
    ])
    expect(Object.values(advisor.playerNames.value).every((name) => /^#\d+$/.test(name))).toBe(true)
    expect(advisor.selectedOpponent.value).toBe('player-7')
    expect(advisor.target.value?.players[0].player.puuid).toBe('player-7')
  })

  it('switches to Clash with its own histories and choices, then hides for ARAM Clash', async () => {
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.selectedRole.value = 'middle'
    advisor.selectedOpponent.value = 'player-7'
    advisor.comfortable.value = [13]
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0].championId).toBe(13)
    const fixture = createDraftFixture(700)
    // Even if the client reuses selection identifiers, queue-scoped choices must reset.
    Object.assign(game, { queryStage: fixture.game.queryStage })
    useLeagueClientStore().champSelect.session = fixture.session
    await nextTick()
    expect(advisor.context.value?.queueId).toBe(700)
    expect(advisor.comfortable.value).toBeNull()
    expect(advisor.selectedRole.value).toBeNull()
    expect(advisor.selectedOpponent.value).toBeNull()
    expect(advisor.histories.value['player-2'].games).toBe(0)
    expect(advisor.picks.value).toEqual([])
    expect(advisor.bans.value).toEqual([])
    game.draftMatchHistory['player-2'] = {
      source: 'sgp',
      queueId: 700,
      scannedCount: 2,
      scanLimit: 50,
      data: historyFixture('player-2', [103, 103], 'middle', Date.now(), 700)
    }
    game.draftMatchHistory['player-7'] = {
      source: 'sgp',
      queueId: 700,
      scannedCount: 2,
      scanLimit: 50,
      data: historyFixture('player-7', [105, 105], 'middle', Date.now(), 700)
    }
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0]).toMatchObject({ championId: 103, coverage: 1 })
    expect(advisor.bans.value[0].championId).toBe(105)
    if (game.queryStage.phase === 'champ-select') {
      game.queryStage.gameInfo.queueId = 720
      game.queryStage.gameInfo.gameMode = 'ARAM'
    }
    useLeagueClientStore().champSelect.session!.queueId = 720
    await nextTick()
    expect(advisor.context.value).toBeNull()
    expect(advisor.picks.value).toEqual([])
    expect(advisor.result.value.samples).toEqual({})
  })

  it('loads premade five advice and clears it when switching to ordinary Ranked Flex', async () => {
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0]).toMatchObject({ championId: 13, coverage: 1 })
    expect(advisor.result.value.patch).toBe('16.18')
    Object.assign(game, {
      queryStage: {
        phase: 'champ-select',
        gameInfo: { queueId: 440, queueType: 'RANKED_FLEX_SR', gameMode: 'CLASSIC', gameId: 101 }
      }
    })
    useLeagueClientStore().champSelect.session!.queueId = 440
    await nextTick()
    expect(advisor.context.value).toBeNull()
    expect(advisor.picks.value).toEqual([])
    expect(advisor.result.value.samples).toEqual({})
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(source.loadDetails).toHaveBeenCalledTimes(1)
  })

  it('does not let a slow, cancelled response overwrite changed comfort picks', async () => {
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    source.loadDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    advisor.comfortable.value = [103]
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0].championId).toBe(103)
    finish(response(13))
    await vi.advanceTimersByTimeAsync(1)
    expect(advisor.result.value.samples[13]).toBeUndefined()
    expect(advisor.result.value.samples[103]).toHaveLength(1)
    expect(advisor.loading.value).toBe(false)
  })

  it('discards late lane statistics after a role change', async () => {
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    source.loadDetails.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    game.draftMatchHistory['player-5'] = {
      source: 'sgp',
      queueId: 710,
      scannedCount: 2,
      scanLimit: 50,
      data: historyFixture('player-5', [105, 105], 'top')
    }
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.comfortable.value = [13]
    await vi.advanceTimersByTimeAsync(300)
    source.loadDetails.mockImplementation(async (_query, id) => {
      const loaded = response(id)
      if (loaded.status === 'success') {
        loaded.data.summary.position = 'top'
        loaded.data.sections.positions = [
          { position: 'top' }
        ] as ChampionDataDetails['sections']['positions']
        loaded.data.sections.matchups![0].performance.wins = 460
      }
      return loaded
    })
    advisor.selectedRole.value = 'top'
    expect(advisor.picks.value[0].score).toBeNull()
    await vi.advanceTimersByTimeAsync(300)
    finish(response(13))
    await vi.advanceTimersByTimeAsync(1)
    expect(advisor.result.value.samples[13][0].wins).toBe(460)
    expect(advisor.picks.value[0].outlook).toBe('unfavorable')
    expect(source.loadDetails.mock.calls[1][0].position).toBe('top')
  })

  it('applies an in-flight full matchup response to the newly selected opponent', async () => {
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    source.loadDetails.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    game.draftMatchHistory['player-5'] = {
      source: 'sgp',
      queueId: 710,
      scannedCount: 2,
      scanLimit: 50,
      data: historyFixture('player-5', [7, 7])
    }
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    advisor.selectedOpponent.value = 'player-5'
    const loaded = response(13)
    if (loaded.status === 'success') {
      loaded.data.sections.matchups!.push({
        championId: 7,
        relationship: 'unfavorable',
        performance: { games: 1000, wins: 400 } as never
      })
    }
    finish(loaded)
    await vi.advanceTimersByTimeAsync(1)
    expect(advisor.picks.value[0]).toMatchObject({ coverage: 1, outlook: 'unfavorable' })
    expect(advisor.picks.value[0].rows.map((row) => row.championId)).toEqual([7])
    expect(source.loadDetails).toHaveBeenCalledOnce()
  })

  it('clears advice on disconnect and does not reuse a late disconnected response', async () => {
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    source.loadDetails.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    Object.assign(game, { isConnected: false })
    await nextTick()
    expect(advisor.context.value).toBeNull()
    expect(advisor.result.value.samples).toEqual({})
    expect(advisor.historyStatuses.value).toEqual({})
    finish(response(13))
    await vi.advanceTimersByTimeAsync(1)
    source.loadDetails.mockImplementation(async (_query, id) => {
      const loaded = response(id)
      if (loaded.status === 'success') loaded.data.sections.matchups![0].performance.wins = 460
      return loaded
    })
    Object.assign(game, { isConnected: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.result.value.samples[13][0].wins).toBe(460)
    expect(advisor.loading.value).toBe(false)
    expect(source.loadDetails).toHaveBeenCalledTimes(2)
  })

  it('retains ban advice on source failure and recovers through retry', async () => {
    source.loadPatches.mockRejectedValueOnce(new Error('offline'))
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.bans.value[0].championId).toBe(105)
    expect(advisor.failed.value).toBe(true)
    expect(advisor.picks.value[0].score).toBeNull()
    advisor.retry()
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.failed.value).toBe(false)
    expect(advisor.picks.value[0].score).not.toBeNull()
  })

  it('keeps manual choices while visible identities fill in, but clears a hidden target and a new draft', async () => {
    const store = useLeagueClientStore()
    store.champSelect.session!.theirTeam[0].gameName = ''
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.selectedRole.value = 'middle'
    advisor.selectedOpponent.value = 'player-7'
    advisor.comfortable.value = [103]
    await nextTick()
    store.champSelect.session = {
      ...store.champSelect.session!,
      theirTeam: store.champSelect.session!.theirTeam.map((p, i) =>
        i === 0 ? { ...p, gameName: 'Now visible' } : p
      )
    }
    await nextTick()
    expect(advisor.selectedRole.value).toBe('middle')
    expect(advisor.selectedOpponent.value).toBe('player-7')
    expect(advisor.comfortable.value).toEqual([103])
    store.champSelect.session = {
      ...store.champSelect.session!,
      theirTeam: store.champSelect.session!.theirTeam.map((p, i) =>
        i === 2 ? { ...p, nameVisibilityType: 'HIDDEN' } : p
      )
    }
    await nextTick()
    expect(advisor.selectedOpponent.value).toBeNull()
    expect(advisor.comfortable.value).toEqual([103])
    store.champSelect.session = { ...store.champSelect.session!, id: 'next-draft' }
    await nextTick()
    expect(advisor.selectedRole.value).toBeNull()
    expect(advisor.comfortable.value).toBeNull()
  })

  it('shows completed statistics while another pick is still loading and preserves them on retry', async () => {
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    source.loadDetails.mockImplementation(async (_query, id) =>
      id === 103 ? new Promise((resolve) => (finish = resolve)) : response(id)
    )
    const advisor = scope.run(() => useDraftAdvisor())!
    advisor.comfortable.value = [13, 103]
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.loading.value).toBe(true)
    expect(advisor.picks.value.find((p) => p.championId === 13)?.score).not.toBeNull()
    expect(advisor.picks.value.find((p) => p.championId === 103)?.score).toBeNull()
    finish(response(103))
    await vi.advanceTimersByTimeAsync(1)
    advisor.retry()
    await nextTick()
    expect(advisor.picks.value.every((p) => p.score !== null)).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(source.loadDetails).toHaveBeenCalledTimes(2)
    advisor.selectedRole.value = 'top'
    expect(advisor.picks.value.every((p) => p.score === null)).toBe(true)
  })
})
