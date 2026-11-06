import type { OngoingGameDraftHistory } from '@shared/shards/ongoing-game'
import { markRaw } from 'vue'

import {
  type LcuOrSgpGameSummary,
  MAIN_SHARD_NAMESPACE,
  type OngoingGameAllData,
  type OngoingGameRendererContext
} from './context'
import { useOngoingGameStore } from './store'

export class OngoingGameStoreEventHandlers {
  // Events can arrive after getAll takes its snapshot but before its IPC reply is applied.
  // Preserve the latest mutation per player; a clear also invalidates the whole snapshot.
  private _initialDraftUpdates: Map<string, OngoingGameDraftHistory | null> | null = new Map()
  private _initialDraftCleared = false

  constructor(private readonly context: OngoingGameRendererContext) {}

  register() {
    const store = useOngoingGameStore()
    const { ipc } = this.context

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'draft-match-history-clear', () => {
      if (this._initialDraftUpdates) {
        this._initialDraftCleared = true
        this._initialDraftUpdates.clear()
      }
      store.draftMatchHistory = {}
    })
    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'draft-match-history-removed', (puuid: string) => {
      this._initialDraftUpdates?.set(puuid, null)
      const next = { ...store.draftMatchHistory }
      delete next[puuid]
      store.draftMatchHistory = next
    })
    ipc.onEvent(
      MAIN_SHARD_NAMESPACE,
      'draft-match-history-loaded',
      (puuid: string, data: OngoingGameDraftHistory) => {
        this._initialDraftUpdates?.set(puuid, data)
        store.draftMatchHistory = { ...store.draftMatchHistory, [puuid]: markRaw(data) }
      }
    )

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'clear', () => {
      store.summoner = {}
      store.matchHistory = {}
      store.rankedStats = {}
      store.championMastery = {}
      store.savedInfo = {}
      store.cachedGames = {}
      store.gameDetails = {}
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'clear-player', (puuid: string) => {
      delete store.summoner[puuid]
      delete store.matchHistory[puuid]
      delete store.rankedStats[puuid]
      delete store.championMastery[puuid]
      delete store.savedInfo[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'summoner-removed', (puuid: string) => {
      delete store.summoner[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'ranked-stats-removed', (puuid: string) => {
      delete store.rankedStats[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'champion-mastery-removed', (puuid: string) => {
      delete store.championMastery[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'match-history-removed', (puuid: string) => {
      delete store.matchHistory[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'saved-info-removed', (puuid: string) => {
      delete store.savedInfo[puuid]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'match-history-loaded', (puuid: string, data) => {
      store.matchHistory[puuid] = markRaw(data)

      const games = data.data as LcuOrSgpGameSummary[]
      games.forEach((game) => (store.cachedGames[game.gameId] = markRaw(game)))
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'additional-game-loaded', (gameId: number, data) => {
      store.cachedGames[gameId] = markRaw(data)
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'game-details-loaded', (gameId: number, data) => {
      store.gameDetails[gameId] = markRaw(data)
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'game-details-removed', (gameId: number) => {
      delete store.gameDetails[gameId]
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'summoner-loaded', (puuid: string, data) => {
      store.summoner[puuid] = markRaw(data)
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'ranked-stats-loaded', (puuid: string, data) => {
      store.rankedStats[puuid] = markRaw(data)
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'champion-mastery-loaded', (puuid: string, data) => {
      store.championMastery[puuid] = markRaw(data)
    })

    ipc.onEvent(MAIN_SHARD_NAMESPACE, 'saved-info-loaded', (puuid: string, data) => {
      store.savedInfo[puuid] = markRaw(data)
    })
  }

  async loadInitialData(data: OngoingGameAllData) {
    const store = useOngoingGameStore()
    const {
      championMastery,
      matchHistory,
      rankedStats,
      savedInfo,
      summoner,
      additionalGames,
      gameDetails
    } = data

    store.championMastery = this._toShallowedMarkRaw(championMastery)
    const draftHistory: Record<string, OngoingGameDraftHistory> = this._initialDraftCleared
      ? {}
      : this._toShallowedMarkRaw(data.draftMatchHistory)
    for (const [puuid, history] of this._initialDraftUpdates ?? []) {
      if (history === null) delete draftHistory[puuid]
      else draftHistory[puuid] = markRaw(history)
    }
    store.draftMatchHistory = draftHistory
    this._initialDraftUpdates = null
    this._initialDraftCleared = false
    store.matchHistory = this._toShallowedMarkRaw(matchHistory)
    store.rankedStats = this._toShallowedMarkRaw(rankedStats)
    store.savedInfo = this._toShallowedMarkRaw(savedInfo)
    store.summoner = this._toShallowedMarkRaw(summoner)
    store.gameDetails = this._toShallowedMarkRaw(gameDetails)

    Object.values(matchHistory).forEach((entry) => {
      const games = entry.data as LcuOrSgpGameSummary[]
      games.forEach((game) => (store.cachedGames[game.gameId] = markRaw(game)))
    })

    Object.values(additionalGames).forEach((entry) => {
      store.cachedGames[entry.data.gameId] = markRaw(entry.data)
    })
  }

  private _toShallowedMarkRaw<T extends object>(obj: T) {
    return Object.entries(obj).reduce(
      (acc, [key, value]) => {
        acc[key] = markRaw(value)
        return acc
      },
      {} as Record<keyof T, any>
    )
  }
}
