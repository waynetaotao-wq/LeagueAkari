import type { OngoingGameDraftHistory } from '@shared/shards/ongoing-game'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import type { OngoingGameAllData } from './context'
import { useOngoingGameStore } from './store'
import { OngoingGameStoreEventHandlers } from './store-event-handlers'

describe('draft history window synchronization', () => {
  it.each(['loaded', 'removed', 'clear'] as const)(
    'preserves a %s event that arrives while the initial snapshot is in flight',
    async (event) => {
      setActivePinia(createPinia())
      const store = useOngoingGameStore()
      const callbacks = new Map<string, (...args: any[]) => void>()
      const handlers = new OngoingGameStoreEventHandlers({
        ipc: {
          onEvent: (_namespace: string, name: string, handler: (...args: any[]) => void) =>
            callbacks.set(name, handler)
        }
      } as any)
      handlers.register()
      const oldHistory: OngoingGameDraftHistory = {
        source: 'sgp',
        queueId: 710,
        scannedCount: 1,
        scanLimit: 50,
        data: []
      }
      const snapshot: OngoingGameAllData = {
        draftMatchHistory: { enemy: oldHistory, unchanged: oldHistory },
        matchHistory: {},
        summoner: {},
        rankedStats: {},
        savedInfo: {},
        championMastery: {},
        gameDetails: {},
        additionalGames: {}
      }
      const newer = { ...oldHistory, queueId: 700 as const, scannedCount: 8 }
      if (event === 'clear') {
        callbacks.get('draft-match-history-clear')!()
        callbacks.get('draft-match-history-loaded')!('new-enemy', newer)
      } else if (event === 'removed') callbacks.get('draft-match-history-removed')!('enemy')
      else callbacks.get('draft-match-history-loaded')!('enemy', newer)

      await handlers.loadInitialData(snapshot)
      expect(store.draftMatchHistory).toEqual(
        event === 'clear'
          ? { 'new-enemy': newer }
          : event === 'removed'
            ? { unchanged: oldHistory }
            : { enemy: newer, unchanged: oldHistory }
      )
      // Once hydrated, subsequent events still apply immediately.
      callbacks.get('draft-match-history-clear')!()
      expect(store.draftMatchHistory).toEqual({})
    }
  )

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
