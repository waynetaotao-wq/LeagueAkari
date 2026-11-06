import type { OngoingGameDraftHistory } from '@shared/shards/ongoing-game'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import type { OngoingGameAllData } from './context'
import { useOngoingGameStore } from './store'
import { OngoingGameStoreEventHandlers } from './store-event-handlers'

describe('draft history window synchronization', () => {
  it('hydrates a later window from getAll and keeps both windows synchronized with per-player updates and removals', async () => {
    const events = new Map<string, Array<(...args: any[]) => void>>()
    const ipc = {
      onEvent: (_namespace: string, name: string, handler: (...args: any[]) => void) =>
        events.set(name, [...(events.get(name) ?? []), handler]),
      sendEvent: (_namespace: string, name: string, ...args: any[]) =>
        events.get(name)?.forEach((handler) => handler(...args))
    }
    const empty = {
      matchHistory: {},
      summoner: {},
      rankedStats: {},
      savedInfo: {},
      championMastery: {},
      gameDetails: {},
      additionalGames: {}
    }
    const state = { ...empty, draftMatchHistory: {} as Record<string, OngoingGameDraftHistory> }
    const openWindow = async () => {
      setActivePinia(createPinia())
      const store = useOngoingGameStore()
      const handlers = new OngoingGameStoreEventHandlers({ ipc } as any)
      handlers.register()
      await handlers.loadInitialData(state satisfies OngoingGameAllData)
      return store
    }
    const first = await openWindow()
    const history: OngoingGameDraftHistory = {
      source: 'sgp',
      queueId: 710,
      scannedCount: 0,
      scanLimit: 50,
      data: []
    }
    state.draftMatchHistory['enemy'] = history
    ipc.sendEvent('ongoing-game-main', 'draft-match-history-loaded', 'enemy', history)
    const second = await openWindow()
    expect(first.draftMatchHistory.enemy).toEqual(history)
    expect(second.draftMatchHistory.enemy).toEqual(history)
    ipc.sendEvent('ongoing-game-main', 'draft-match-history-removed', 'enemy')
    expect(first.draftMatchHistory).toEqual({})
    expect(second.draftMatchHistory).toEqual({})
    ipc.sendEvent('ongoing-game-main', 'draft-match-history-loaded', 'other', history)
    ipc.sendEvent('ongoing-game-main', 'draft-match-history-clear')
    expect(first.draftMatchHistory).toEqual({})
    expect(second.draftMatchHistory).toEqual({})
  })
})
