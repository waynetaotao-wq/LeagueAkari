import { describe, expect, it, vi } from 'vitest'

import { OngoingGameIpcHandlers } from './ipc-handlers'
import { OngoingGamePlayerDataLoader } from './player-data-loader'

describe('ongoing-game player reload flow', () => {
  it('provides dedicated draft history to later windows and routes retry only to its loader', () => {
    const handlers: Record<string, (...args: any[]) => any> = {}
    const draftMatchHistory = {
      enemy: { source: 'sgp', queueId: 710, scannedCount: 0, scanLimit: 50, data: [] }
    }
    const draftLoader = { update: vi.fn() }
    const matchHistory = { updateMatchHistories: vi.fn() }
    new OngoingGameIpcHandlers(
      {
        ipc: {
          onCall: (_namespace: string, name: string, handler: (...args: any[]) => any) => {
            handlers[name] = handler
          }
        },
        state: {
          draftMatchHistory,
          matchHistory: {},
          summoner: {},
          rankedStats: {},
          savedInfo: {},
          championMastery: {},
          gameDetails: {},
          additionalGame: {}
        }
      } as any,
      matchHistory as any,
      {} as any,
      {} as any,
      draftLoader as any
    ).register()
    expect(handlers.getAll().draftMatchHistory).toEqual(draftMatchHistory)
    handlers.retryDraftHistories()
    expect(draftLoader.update).toHaveBeenCalledWith(true)
    expect(matchHistory.updateMatchHistories).not.toHaveBeenCalled()
  })
  it('routes a saved-info-only IPC reload through the real loader without touching other scopes', () => {
    const handlers: Record<string, (...args: any[]) => void> = {}
    const context = {
      ipc: {
        onCall: vi.fn((_namespace, name, handler) => {
          handlers[name] = handler
        })
      },
      queueKeeper: {
        cancelByTags: vi.fn()
      },
      settings: {
        matchHistoryLoadCount: 10
      },
      state: {
        apiShouldUse: 'lcu',
        matchHistoryTagParams: {}
      }
    }
    const matchHistory = {
      loadMatchHistory: vi.fn()
    }
    const playerData = new OngoingGamePlayerDataLoader(context as any, matchHistory as any)
    const loadSummoner = vi.spyOn(playerData, 'loadSummoner').mockResolvedValue(undefined)
    const loadRankedStats = vi.spyOn(playerData, 'loadRankedStats').mockResolvedValue(undefined)
    const loadSavedInfo = vi.spyOn(playerData, 'loadSavedInfo').mockResolvedValue(undefined)
    const loadChampionMastery = vi
      .spyOn(playerData, 'loadChampionMastery')
      .mockResolvedValue(undefined)

    new OngoingGameIpcHandlers(context as any, matchHistory as any, playerData, {
      update: vi.fn()
    } as any).register()

    handlers.reloadPlayer(undefined, 'player-1', { includes: ['savedInfo'] })

    expect(context.queueKeeper.cancelByTags).toHaveBeenCalledTimes(1)
    expect(context.queueKeeper.cancelByTags).toHaveBeenCalledWith(['player-1', 'saved-info'], 'and')
    expect(loadSavedInfo).toHaveBeenCalledWith('player-1', { force: true })
    expect(loadSummoner).not.toHaveBeenCalled()
    expect(loadRankedStats).not.toHaveBeenCalled()
    expect(loadChampionMastery).not.toHaveBeenCalled()
    expect(matchHistory.loadMatchHistory).not.toHaveBeenCalled()
  })
})
