import type { GameflowSession } from '@shared/types/league-client/gameflow'
import { observable, reaction, runInAction } from 'mobx'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeagueClientData } from '.'
import type { LeagueClientMainContext } from '..'

const disposers: Array<() => void> = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
})

function createClientData() {
  const events = new Map<string, (event: { data: unknown; eventType: string }) => void>()
  const getPickableChampIds = vi.fn().mockResolvedValue({ data: [13] })
  const getBannableChampIds = vi.fn().mockResolvedValue({ data: [105] })
  const connection = observable({ isConnected: true })
  const warn = vi.fn()
  const sendEvent = vi.fn()
  const managedReaction: typeof reaction = (expression, effect, options) => {
    const dispose = reaction(expression, effect, options)
    disposers.push(dispose)
    return dispose
  }
  const data = new LeagueClientData({
    namespace: 'league-client-main',
    leagueClient: {
      state: connection,
      api: { champSelect: { getPickableChampIds, getBannableChampIds } },
      events: { on: (path: string, handler: (event: any) => void) => events.set(path, handler) }
    },
    mobxUtils: { reaction: managedReaction, propSync: vi.fn() },
    logger: { debug: vi.fn(), warn, info: vi.fn() },
    ipc: { sendEvent }
  } as unknown as LeagueClientMainContext)
  data.init()
  const setPhase = (phase: GameflowSession['phase']) => {
    events.get('/lol-gameflow/v1/session')!({
      eventType: 'Update',
      data: { phase, gameData: { gameId: 1, queue: { id: 700 } } } as GameflowSession
    })
  }
  const setPhaseEvent = (phase: GameflowSession['phase']) => {
    events.get('/lol-gameflow/v1/gameflow-phase')!({ eventType: 'Update', data: phase })
  }
  const setSession = (id: string | null, remaining = 30) => {
    events.get('/lol-champ-select/v1/session')!({
      eventType: id ? 'Update' : 'Delete',
      data: id ? { id, gameId: 1, myTeam: [], timer: { adjustedTimeLeftInPhase: remaining } } : null
    })
  }
  const enterChampSelect = () => {
    setPhaseEvent('ChampSelect')
    setSession('first')
    setPhase('ChampSelect')
  }
  const updateList = (kind: 'pickable' | 'bannable', ids: number[], eventType = 'Update') => {
    events.get(`/lol-champ-select/v1/${kind}-champion-ids`)!({ eventType, data: ids })
  }
  return {
    data,
    getPickableChampIds,
    getBannableChampIds,
    enterChampSelect,
    setPhase,
    setPhaseEvent,
    setSession,
    updateList,
    warn,
    sendEvent,
    disconnect: () => runInAction(() => (connection.isConnected = false))
  }
}

function deferredList() {
  let resolve!: (value: { data: number[] }) => void
  const promise = new Promise<{ data: number[] }>((res) => (resolve = res))
  return { promise, resolve }
}

describe('champion availability synchronization', () => {
  it.each([
    { pickable: [13], bannable: [], pickCalls: 0, banCalls: 1 },
    { pickable: [], bannable: [105], pickCalls: 1, banCalls: 0 },
    { pickable: [13], bannable: [105], pickCalls: 0, banCalls: 0 }
  ])('repairs missing lists independently: $pickable / $bannable', async (entry) => {
    const { data, getPickableChampIds, getBannableChampIds, enterChampSelect } = createClientData()
    data.champSelect.setCurrentPickableChampionArray(entry.pickable)
    data.champSelect.setCurrentBannableChampionArray(entry.bannable)

    enterChampSelect()

    await vi.waitFor(() => {
      expect(data.champSelect.currentPickableChampionIds).toEqual(new Set([13]))
      expect(data.champSelect.currentBannableChampionIds).toEqual(new Set([105]))
    })
    expect(getPickableChampIds).toHaveBeenCalledTimes(entry.pickCalls)
    expect(getBannableChampIds).toHaveBeenCalledTimes(entry.banCalls)
  })

  it('keeps bans unavailable when the client returns no bannable champions', async () => {
    const { data, getBannableChampIds, enterChampSelect } = createClientData()
    data.champSelect.setCurrentPickableChampionArray([13])
    getBannableChampIds.mockResolvedValue({ data: [] })

    enterChampSelect()

    await vi.waitFor(() => expect(getBannableChampIds).toHaveBeenCalledOnce())
    expect(data.champSelect.currentBannableChampionIds.size).toBe(0)
  })

  it.each(['leave', 'phase-event-leave', 'delete-session', 'disconnect'] as const)(
    'ignores outstanding availability after %s',
    async (boundary) => {
      const client = createClientData()
      const pickable = deferredList()
      const bannable = deferredList()
      client.getPickableChampIds.mockReturnValue(pickable.promise)
      client.getBannableChampIds.mockReturnValue(bannable.promise)
      client.enterChampSelect()
      expect(client.getPickableChampIds).toHaveBeenCalledOnce()
      expect(client.getBannableChampIds).toHaveBeenCalledOnce()

      if (boundary === 'leave') client.setPhase('Lobby')
      else if (boundary === 'phase-event-leave') client.setPhaseEvent('Lobby')
      else if (boundary === 'delete-session') client.setSession(null)
      else client.disconnect()
      expect(client.getPickableChampIds.mock.calls[0][0].signal.aborted).toBe(true)
      expect(client.getBannableChampIds.mock.calls[0][0].signal.aborted).toBe(true)
      pickable.resolve({ data: [13] })
      bannable.resolve({ data: [105] })
      await Promise.all([pickable.promise, bannable.promise])

      expect(client.data.champSelect.currentPickableChampionIds.size).toBe(0)
      expect(client.data.champSelect.currentBannableChampionIds.size).toBe(0)
      expect(client.getPickableChampIds).toHaveBeenCalledOnce()
      expect(client.getBannableChampIds).toHaveBeenCalledOnce()
    }
  )

  it.each(['Update', 'Delete'])(
    'keeps newer list %s events over outstanding reads',
    async (eventType) => {
      const client = createClientData()
      const pickable = deferredList()
      const bannable = deferredList()
      client.getPickableChampIds.mockReturnValue(pickable.promise)
      client.getBannableChampIds.mockReturnValue(bannable.promise)
      client.enterChampSelect()

      client.updateList('pickable', [64], eventType)
      client.updateList('bannable', [238], eventType)
      pickable.resolve({ data: [13] })
      bannable.resolve({ data: [105] })
      await Promise.all([pickable.promise, bannable.promise])

      expect(client.data.champSelect.currentPickableChampionIds).toEqual(
        new Set(eventType === 'Delete' ? [] : [64])
      )
      expect(client.data.champSelect.currentBannableChampionIds).toEqual(
        new Set(eventType === 'Delete' ? [] : [238])
      )
    }
  )

  it('rechecks a new session but does not recheck its countdown updates', async () => {
    const client = createClientData()
    const pickable = deferredList()
    const bannable = deferredList()
    client.getPickableChampIds
      .mockReturnValueOnce(pickable.promise)
      .mockResolvedValue({ data: [64] })
    client.getBannableChampIds
      .mockReturnValueOnce(bannable.promise)
      .mockResolvedValue({ data: [238] })
    client.enterChampSelect()
    client.setSession('first', 29)
    expect(client.getPickableChampIds).toHaveBeenCalledOnce()
    expect(client.getBannableChampIds).toHaveBeenCalledOnce()

    client.setSession('second')
    await vi.waitFor(() => {
      expect(client.data.champSelect.currentPickableChampionIds).toEqual(new Set([64]))
      expect(client.data.champSelect.currentBannableChampionIds).toEqual(new Set([238]))
    })
    pickable.resolve({ data: [13] })
    bannable.resolve({ data: [105] })
    await Promise.all([pickable.promise, bannable.promise])
    client.setSession('second', 29)

    expect(client.data.champSelect.currentPickableChampionIds).toEqual(new Set([64]))
    expect(client.data.champSelect.currentBannableChampionIds).toEqual(new Set([238]))
    expect(client.getPickableChampIds).toHaveBeenCalledTimes(2)
    expect(client.getBannableChampIds).toHaveBeenCalledTimes(2)
  })

  it('handles failed availability reads in the sync flow', async () => {
    const client = createClientData()
    client.getPickableChampIds.mockRejectedValue(new Error('pickable unavailable'))
    client.getBannableChampIds.mockRejectedValue(new Error('bannable unavailable'))
    client.enterChampSelect()

    await vi.waitFor(() => expect(client.warn).toHaveBeenCalledTimes(2))
    expect(client.sendEvent).toHaveBeenCalledWith(
      'league-client-main',
      'error-sync-data',
      'get-pickable-champ-ids'
    )
    expect(client.sendEvent).toHaveBeenCalledWith(
      'league-client-main',
      'error-sync-data',
      'get-bannable-champ-ids'
    )
    expect(client.data.champSelect.currentPickableChampionIds.size).toBe(0)
    expect(client.data.champSelect.currentBannableChampionIds.size).toBe(0)
  })
})
