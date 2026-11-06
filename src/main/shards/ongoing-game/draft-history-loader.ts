import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type { OngoingGameDraftHistory } from '@shared/shards/ongoing-game'
import { isAbortError } from '@shared/utils/queue-keeper'
import { compareStructural, runInAction } from 'mobx'

import { ONGOING_GAME_MAIN_NAMESPACE, type OngoingGameMainContext } from './context'

type DraftHistoryContext = {
  key: string
  queueId: 700 | 710
  source: 'sgp' | 'lcu'
  ready: boolean
  players: string[]
}

/** A mode-specific scouting sample, independent of the match-card filter and load count. */
export class OngoingGameDraftHistoryLoader {
  private _key: string | null = null
  private _requests = new Map<string, symbol>()
  private _sequence = 0

  constructor(private readonly _context: OngoingGameMainContext) {}

  watch() {
    this._context.mobxUtils.reaction(
      () => this._getContext(),
      () => this.update(),
      { fireImmediately: true, equals: compareStructural }
    )
  }

  private _getContext(): DraftHistoryContext | null {
    const { state, leagueClient, sgp, settings } = this._context
    const stage = state.queryStage
    const session = leagueClient.data.champSelect.session
    const self = leagueClient.data.summoner.me?.puuid
    if (
      !settings.enabled ||
      !leagueClient.state.isConnected ||
      state.draft ||
      stage.phase !== 'champ-select' ||
      (stage.gameInfo.queueId !== 700 && stage.gameInfo.queueId !== 710) ||
      stage.gameInfo.gameMode !== 'CLASSIC' ||
      !session ||
      session.isSpectating ||
      session.isCustomGame ||
      session.myTeam.length !== 5 ||
      session.theirTeam.length !== 5 ||
      (session.queueId > 0 && session.queueId !== stage.gameInfo.queueId) ||
      (session.gameId > 0 && stage.gameInfo.gameId > 0 && session.gameId !== stage.gameInfo.gameId)
    )
      return null

    const visible = [...session.myTeam, ...session.theirTeam].filter(
      (member) =>
        member.nameVisibilityType !== 'HIDDEN' &&
        member.gameName?.trim() &&
        member.puuid &&
        !/^0+(?:-0+)*$/.test(member.puuid)
    )
    if (
      !visible.some(
        (member) => member.puuid === self && member.cellId === session.localPlayerCellId
      )
    )
      return null
    const publicIds = visible
      .map((member) => member.puuid)
      .filter((puuid, _, all) => all.indexOf(puuid) === all.lastIndexOf(puuid))
    if (!publicIds.includes(self!)) return null
    const players = [
      self!,
      ...session.theirTeam.map((member) => member.puuid),
      ...session.myTeam.filter((member) => member.puuid !== self).map((member) => member.puuid)
    ].filter((puuid) => publicIds.includes(puuid))
    const source = state.apiShouldUse
    const auth = leagueClient.state.auth
    return {
      key: `${auth?.region}:${auth?.rsoPlatformId}:${self}:${stage.gameInfo.queueId}:${session.id || session.gameId}:${source}`,
      queueId: stage.gameInfo.queueId,
      source,
      ready: source !== 'sgp' || sgp.state.isTokenReady,
      players
    }
  }

  update(retry = false) {
    const context = this._getContext()
    const { state, queueKeeper, ipc } = this._context
    if (context?.key !== this._key) {
      this._requests.clear()
      queueKeeper.cancelByTags('draft-history')
      this._key = context?.key ?? null
      runInAction(() => {
        state.draftMatchHistory = {}
        state.draftMatchHistoryLoadingState = {}
      })
      ipc.sendEvent(ONGOING_GAME_MAIN_NAMESPACE, 'draft-match-history-clear')
    }
    if (!context) return

    const previous = new Set([
      ...Object.keys(state.draftMatchHistoryLoadingState),
      ...this._requests.keys()
    ])
    for (const puuid of previous) {
      if (context.players.includes(puuid)) continue
      this._requests.delete(puuid)
      queueKeeper.cancelByTags(['draft-history', puuid], 'and')
      runInAction(() => {
        delete state.draftMatchHistory[puuid]
        state.draftMatchHistoryLoadingState = Object.fromEntries(
          Object.entries(state.draftMatchHistoryLoadingState).filter(([id]) => id !== puuid)
        )
      })
      ipc.sendEvent(ONGOING_GAME_MAIN_NAMESPACE, 'draft-match-history-removed', puuid)
    }
    for (const puuid of context.players) {
      if (!context.ready) {
        this._requests.delete(puuid)
        queueKeeper.cancelByTags(['draft-history', puuid], 'and')
        this._setStatus(puuid, 'waiting')
      } else if (!this._requests.has(puuid)) {
        const status = state.draftMatchHistoryLoadingState[puuid]
        if (status === 'loaded' || (status === 'error' && !retry)) continue
        void this._load(puuid, context)
      }
    }
  }

  private _setStatus(puuid: string, status: 'waiting' | 'loading' | 'loaded' | 'error') {
    runInAction(() => {
      this._context.state.draftMatchHistoryLoadingState = {
        ...this._context.state.draftMatchHistoryLoadingState,
        [puuid]: status
      }
    })
  }

  private async _load(puuid: string, context: DraftHistoryContext) {
    const token = Symbol()
    this._requests.set(puuid, token)
    const isCurrent = () => {
      const live = this._getContext()
      return (
        this._requests.get(puuid) === token &&
        live?.key === context.key &&
        live.ready &&
        live.players.includes(puuid)
      )
    }
    const { state, leagueClient, sgp, queueKeeper, logger, ipc } = this._context
    // Completed pages are stable within this draft. Retry from the failed LCU page so a second
    // failure cannot replace a larger, already visible sample with only the first page.
    const previous = context.source === 'lcu' ? state.draftMatchHistory[puuid] : undefined
    const data: LcuOrSgpGameSummary[] = [...(previous?.data ?? [])]
    const seen = new Set(data.map((row) => row.gameId))
    const scanLimit = context.source === 'sgp' ? 50 : 200
    let scannedCount = previous?.scannedCount ?? 0
    const deadline = AbortSignal.timeout(30_000)
    this._setStatus(puuid, 'loading')
    const timeout = setTimeout(() => {
      if (!isCurrent()) return
      this._requests.delete(puuid)
      queueKeeper.cancelByTags(['draft-history', puuid], 'and')
      this._setStatus(puuid, 'error')
    }, 30_000)
    try {
      for (let start = scannedCount; start < scanLimit; start += 20) {
        if (!isCurrent()) return
        const pageSize = context.source === 'sgp' ? 50 : 20
        const rows = await queueKeeper.add(
          'match-history',
          `draft-history:${++this._sequence}`,
          async ({ signal }) => {
            const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
            combinedSignal.throwIfAborted()
            if (context.source === 'sgp') {
              const response = await sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(
                puuid,
                {
                  startIndex: 0,
                  count: 50,
                  tag: `q_${context.queueId}`,
                  signal: combinedSignal
                }
              )
              return response.data.games
                .filter((game) => game.json)
                .map((game) => ({
                  source: 'sgp' as const,
                  gameId: game.json.gameId,
                  data: game
                }))
            }
            const response = await leagueClient.api.matchHistory.getMatchHistory(
              puuid,
              start,
              start + pageSize - 1,
              { signal: combinedSignal }
            )
            return response.data.games.games.map((game) => ({
              source: 'lcu' as const,
              gameId: game.gameId,
              data: game
            }))
          },
          { priority: 26, tags: ['draft-history', puuid] }
        )
        if (!isCurrent()) return
        scannedCount += rows.length
        const fresh = rows.filter((row) => !seen.has(row.gameId))
        for (const row of fresh) {
          seen.add(row.gameId)
          const game = row.source === 'sgp' ? row.data.json : row.data
          if (game.queueId === context.queueId) data.push(row)
        }
        const result: OngoingGameDraftHistory = {
          source: context.source,
          queueId: context.queueId,
          scannedCount,
          scanLimit,
          data: [...data]
        }
        runInAction(() => {
          state.draftMatchHistory[puuid] = result
        })
        ipc.sendEvent(ONGOING_GAME_MAIN_NAMESPACE, 'draft-match-history-loaded', puuid, result)
        // Queue matches may still be remakes/invalid samples. The renderer selects its latest
        // 50 valid games; keep scanning LCU within the 200-record budget instead of stopping at
        // 50 raw queue matches. No per-game details/timelines are needed.
        if (context.source === 'sgp' || rows.length < pageSize || !fresh.length) break
      }
      if (isCurrent()) this._setStatus(puuid, 'loaded')
    } catch (error) {
      if (!isCurrent()) return
      // Explicit retries retain any pages already read; never label transport errors as no history.
      this._setStatus(puuid, 'error')
      if (!isAbortError(error))
        logger.warn('Draft history query failed', context.source, puuid, error)
    } finally {
      clearTimeout(timeout)
      if (this._requests.get(puuid) === token) this._requests.delete(puuid)
    }
  }
}
