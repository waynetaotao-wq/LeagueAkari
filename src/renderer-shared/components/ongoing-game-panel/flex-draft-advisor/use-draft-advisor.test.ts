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
  game.matchHistory['player-2'] = { data: historyFixture('player-2', [13, 13]) }
  game.matchHistory['player-7'] = { data: historyFixture('player-7', [105, 105]) }
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
  it('loads from the registered source, ranks the current draft and clears it when leaving Flex', async () => {
    const advisor = scope.run(() => useDraftAdvisor())!
    await vi.advanceTimersByTimeAsync(300)
    expect(advisor.picks.value[0]).toMatchObject({ championId: 13, coverage: 1 })
    expect(advisor.result.value.patch).toBe('16.18')
    Object.assign(game, {
      queryStage: {
        phase: 'champ-select',
        gameInfo: { queueId: 420, gameMode: 'CLASSIC', gameId: 101 }
      }
    })
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
