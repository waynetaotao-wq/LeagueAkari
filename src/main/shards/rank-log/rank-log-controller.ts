import {
  type RankLogGameFacts,
  type RankLogQueueType,
  type RankLogSyncResult,
  type RankSnapshot,
  pickRankLogGame,
  readRankLogTrackedGame,
  reconcileRankSnapshots
} from '@shared/shards/rank-log'
import { compareShallow } from 'mobx'

import { RankLogEntry } from '../storage/entities/RankLogEntry'
import type { RankLogClientDataLoader } from './client-data-loader'
import {
  RANK_LOG_FOLLOW_UP_DELAYS_MS,
  RANK_LOG_HISTORY_FULL_COUNT,
  RANK_LOG_HISTORY_RECENT_COUNT,
  RANK_LOG_TRACKED_GAME_TTL_MS,
  type RankLogMainContext,
  type RankLogOwner
} from './context'
import type { RankLogEntryLoader } from './entry-loader'

/** A ranked game this client was seen playing, waiting for its rank change. */
interface TrackedGame {
  gameId: number
  queueType: RankLogQueueType
  /** null while the game is still running. */
  endedAt: number | null
}

type RankFields = Pick<
  RankLogEntry,
  | 'observedAt'
  | 'lpDelta'
  | 'tier'
  | 'division'
  | 'leaguePoints'
  | 'absoluteLp'
  | 'provisional'
  | 'wins'
  | 'losses'
>

const EMPTY_RANK: RankFields = {
  observedAt: null,
  lpDelta: null,
  tier: null,
  division: null,
  leaguePoints: null,
  absoluteLp: null,
  provisional: null,
  wins: null,
  losses: null
}

const PLAYING_PHASES: ReadonlySet<string> = new Set(['GameStart', 'InProgress', 'Reconnect'])

function createEntry(
  owner: RankLogOwner,
  values: Pick<RankLogEntry, 'kind' | 'queueType' | 'occurredAt'> & Partial<RankLogEntry>
) {
  return Object.assign(
    new RankLogEntry(),
    {
      puuid: owner.puuid,
      sgpServerId: owner.sgpServerId,
      gameId: null,
      gameCreation: null,
      gameDuration: null,
      championId: null,
      position: null,
      win: null,
      remake: null,
      kills: null,
      deaths: null,
      assists: null,
      cs: null,
      games: null,
      ...EMPTY_RANK
    },
    values
  )
}

function rankOf(snapshot: RankSnapshot, observedAt: number, lpDelta: number | null): RankFields {
  return {
    observedAt,
    lpDelta,
    tier: snapshot.tier,
    division: snapshot.division,
    leaguePoints: snapshot.leaguePoints,
    absoluteLp: snapshot.absoluteLp,
    provisional: snapshot.provisional,
    wins: snapshot.wins,
    losses: snapshot.losses
  }
}

function rankFieldsOf(entry: RankLogEntry): RankFields {
  return {
    observedAt: entry.observedAt,
    lpDelta: entry.lpDelta,
    tier: entry.tier,
    division: entry.division,
    leaguePoints: entry.leaguePoints,
    absoluteLp: entry.absoluteLp,
    provisional: entry.provisional,
    wins: entry.wins,
    losses: entry.losses
  }
}

function factsOf(facts: RankLogGameFacts) {
  return {
    queueType: facts.queueType,
    occurredAt: facts.gameEnd,
    gameCreation: facts.gameCreation,
    gameDuration: facts.gameDuration,
    championId: facts.championId,
    position: facts.position,
    win: facts.win,
    remake: facts.remake,
    kills: facts.kills,
    deaths: facts.deaths,
    assists: facts.assists,
    cs: facts.cs
  }
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Turns rank readings and match history into rank log rows.
 *
 * 一次胜点变化认领对局的顺序：先认本机亲眼看着打完的那一局；没有的话（程序当时没开），
 * 再到战绩里找「上一次读数之后结束、胜负相同」的唯一一局；都认不出来就先记成未识别，
 * 以后读到战绩再补。认不准时宁可留空，不往错的对局上记。
 */
export class RankLogController {
  private _trackedGames: TrackedGame[] = []
  private _ownerKey = ''
  private _queue: Promise<unknown> = Promise.resolve()
  private _isObserveQueued = false
  private readonly _timers = new Set<NodeJS.Timeout>()
  private readonly _disposers: Array<() => void> = []
  private _loggedNotificationShapes = 0

  constructor(
    private readonly _context: RankLogMainContext,
    private readonly _entryLoader: RankLogEntryLoader,
    private readonly _clientDataLoader: Pick<
      RankLogClientDataLoader,
      'loadSnapshots' | 'canLoadHistory' | 'loadHistory'
    >,
    private readonly _now: () => number = Date.now
  ) {}

  watch() {
    const { leagueClient, mobxUtils, settings, sgp } = this._context

    // 账号、开关、登录凭据任一就绪或变化：读一次段位，并把战绩里已有的排位对局补录进来。
    mobxUtils.reaction(
      () => [this._readOwnerKey(), settings.enabled, sgp.state.isTokenReady] as const,
      ([ownerKey, enabled]) => {
        if (ownerKey !== this._ownerKey) {
          this._ownerKey = ownerKey
          this._trackedGames = []
          this._clearTimers()
        }
        if (ownerKey && enabled) {
          this._syncInBackground()
        }
      },
      { equals: compareShallow, fireImmediately: true }
    )

    mobxUtils.reaction(
      () =>
        [
          leagueClient.data.gameflow.phase,
          leagueClient.data.gameflow.session?.gameData?.gameId ?? 0
        ] as const,
      ([phase]) => this.trackGameflow(phase, leagueClient.data.gameflow.session),
      { equals: compareShallow, fireImmediately: true }
    )

    this._disposers.push(
      leagueClient.events.on('/lol-ranked/v1/current-ranked-stats', () => {
        void this.observe()
      }),
      leagueClient.events.on('/lol-ranked/v1/current-lp-change-notification', (event) => {
        this._logNotificationShape(event?.data)
      })
    )
  }

  dispose() {
    this._clearTimers()
    this._disposers.splice(0).forEach((dispose) => dispose())
  }

  /** Follows the client through a game so the rank change after it can be tied to that game. */
  trackGameflow(phase: string | null, session: unknown) {
    const owner = this._readOwner()
    if (phase !== null && PLAYING_PHASES.has(phase)) {
      if (!owner || !this._context.settings.enabled) {
        return
      }

      const game = readRankLogTrackedGame(session, owner.puuid)
      if (!game) {
        return
      }

      const tracked = this._trackedGames.find((candidate) => candidate.gameId === game.gameId)
      if (tracked) {
        // 重连回到同一局：这一局还没结束。
        tracked.endedAt = null
      } else {
        this._trackedGames.push({ ...game, endedAt: null })
        this._context.logger.info(`Tracking ranked game ${game.gameId} (${game.queueType})`)
      }
      return
    }

    // 结算、回到大厅、客户端退出：对这台电脑来说这一局结束了，开始等胜点变化。
    const running = this._trackedGames.filter((game) => game.endedAt === null)
    if (!running.length) {
      return
    }

    const now = this._now()
    running.forEach((game) => (game.endedAt = now))
    this._scheduleFollowUps()
  }

  /**
   * Reads the rank now and records whatever changed since the last reading. Never rejects: a
   * failed step is logged by the queue and the next reading starts from the stored rows again.
   */
  observe(): Promise<void> {
    if (this._isObserveQueued) {
      return this._queue.then(() => undefined)
    }

    this._isObserveQueued = true
    return this._enqueue(async () => {
      this._isObserveQueued = false
      await this._observe()
    }).catch(() => undefined)
  }

  /** Reads match history first and the rank after it, so one unseen game can be recognised. */
  sync(historyCount = RANK_LOG_HISTORY_FULL_COUNT): Promise<RankLogSyncResult> {
    return this._enqueue(async () => {
      const { settings, state } = this._context
      if (!state.available) {
        return { result: 'failed', reason: 'unavailable', historyLoaded: false }
      }
      if (!settings.enabled) {
        return { result: 'failed', reason: 'disabled', historyLoaded: false }
      }

      const owner = this._readOwner()
      if (!owner) {
        return { result: 'failed', reason: 'not-connected', historyLoaded: false }
      }

      state.setSyncing(true)
      try {
        const historyLoaded = await this._loadHistory(owner, historyCount)
        const rankRead = await this._observe(historyLoaded)
        return rankRead
          ? { result: 'ok', historyLoaded }
          : { result: 'failed', reason: 'rank-unreadable', historyLoaded }
      } finally {
        state.setSyncing(false)
      }
    })
  }

  /** A sync nobody waits for; its failure is already logged by the queue. */
  private _syncInBackground(historyCount?: number) {
    return this.sync(historyCount).then(
      () => undefined,
      () => undefined
    )
  }

  /** One operation at a time: every step reads rows, decides, then writes. */
  private _enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this._queue.then(task)
    this._queue = result.catch((error) => {
      this._context.logger.warn(`Rank log step failed: ${describeError(error)}`)
    })
    return result
  }

  private _readOwner(): RankLogOwner | null {
    const puuid = this._context.leagueClient.data.summoner.me?.puuid
    const sgpServerId = this._context.sgp.state.availability.sgpServerId
    return puuid && sgpServerId ? { puuid, sgpServerId } : null
  }

  private _readOwnerKey() {
    const owner = this._readOwner()
    return owner ? `${owner.sgpServerId}:${owner.puuid}` : ''
  }

  private _isCurrentOwner(owner: RankLogOwner) {
    const current = this._readOwner()
    return current?.puuid === owner.puuid && current.sgpServerId === owner.sgpServerId
  }

  /** @param isHistoryFresh match history was refilled just before this reading */
  private async _observe(isHistoryFresh = false) {
    const { logger, settings, state } = this._context
    const owner = this._readOwner()
    if (!owner || !settings.enabled || !state.available) {
      return false
    }

    let snapshots: RankSnapshot[]
    try {
      snapshots = await this._clientDataLoader.loadSnapshots()
    } catch (error) {
      logger.warn(`Rank is not readable right now: ${describeError(error)}`)
      return false
    }

    // 读数回来时账号已经换了：这份读数不属于现在的账号。
    if (!this._isCurrentOwner(owner)) {
      return false
    }

    let isChanged = false
    for (const snapshot of snapshots) {
      isChanged = (await this._applySnapshot(owner, snapshot, isHistoryFresh)) || isChanged
    }
    if (isChanged) {
      state.bumpRevision()
    }
    return true
  }

  private async _applySnapshot(
    owner: RankLogOwner,
    snapshot: RankSnapshot,
    isHistoryFresh: boolean
  ) {
    // 客户端刚启动或重连时，可能先给出一份全空的段位（没有段位、0 胜 0 负），随后才是真数据。
    // 全空的读数既不记录也不当参照，否则会凭空多出「漏记了上百局」。
    if (!snapshot.tier && snapshot.wins + snapshot.losses === 0) {
      return false
    }

    const previous = await this._entryLoader.findLatestSnapshot(owner, snapshot.queueType)
    const change = reconcileRankSnapshots(
      previous && {
        tier: previous.tier ?? '',
        division: previous.division ?? '',
        leaguePoints: previous.leaguePoints ?? 0,
        wins: previous.wins ?? 0,
        losses: previous.losses ?? 0,
        provisional: previous.provisional ?? false,
        absoluteLp: previous.absoluteLp
      },
      snapshot
    )
    if (!change) {
      return false
    }

    const now = this._now()
    this._context.logger.info(`Rank reading changed in ${snapshot.queueType}: ${change.kind}`)

    if (change.kind === 'game') {
      await this._recordGame(owner, snapshot, change, previous!.observedAt!, now, isHistoryFresh)
      return true
    }

    await this._entryLoader.save(
      createEntry(owner, {
        kind: change.kind,
        queueType: snapshot.queueType,
        occurredAt: now,
        games: change.kind === 'gap' ? change.games : null,
        ...rankOf(snapshot, now, change.kind === 'baseline' ? null : change.lpDelta)
      })
    )
    if (change.kind !== 'adjustment') {
      // 起点和漏记已经把之前打完的对局算进去了，它们不能再去认领以后的变化。
      this._trackedGames = this._trackedGames.filter(
        (game) => game.queueType !== snapshot.queueType || game.endedAt === null
      )
    }
    return true
  }

  private async _recordGame(
    owner: RankLogOwner,
    snapshot: RankSnapshot,
    change: { win: boolean; lpDelta: number | null },
    previousObservedAt: number,
    now: number,
    isHistoryFresh: boolean
  ) {
    const rank = rankOf(snapshot, now, change.lpDelta)
    let row = await this._takeTrackedRow(owner, snapshot.queueType, change.win, now)
    if (!row) {
      if (!isHistoryFresh) {
        await this._loadHistory(owner, RANK_LOG_HISTORY_RECENT_COUNT)
      }
      row = await this._pickHistoryRow(owner, snapshot.queueType, {
        after: previousObservedAt,
        before: now,
        win: change.win
      })
    }

    await this._entryLoader.save(
      row
        ? Object.assign(row, rank, { win: row.win ?? change.win })
        : createEntry(owner, {
            kind: 'game',
            queueType: snapshot.queueType,
            occurredAt: now,
            win: change.win,
            ...rank
          })
    )
  }

  /** The oldest finished game this client watched that can still own a rank change. */
  private async _takeTrackedRow(
    owner: RankLogOwner,
    queueType: RankLogQueueType,
    win: boolean,
    now: number
  ) {
    this._trackedGames = this._trackedGames.filter(
      (game) => game.endedAt === null || now - game.endedAt <= RANK_LOG_TRACKED_GAME_TTL_MS
    )

    for (const game of [...this._trackedGames]) {
      if (game.queueType !== queueType || game.endedAt === null) {
        continue
      }

      const row = await this._entryLoader.findGame(owner, game.gameId)
      if (row && row.observedAt !== null) {
        this._untrack(game.gameId)
        continue
      }
      // 战绩已经说明这一局是重开或胜负不同：这次变化不是它的。
      if (row && (row.remake || (row.win !== null && row.win !== win))) {
        continue
      }

      this._untrack(game.gameId)
      return (
        row ??
        createEntry(owner, {
          kind: 'game',
          queueType,
          occurredAt: game.endedAt,
          gameId: game.gameId
        })
      )
    }
    return null
  }

  private async _pickHistoryRow(
    owner: RankLogOwner,
    queueType: RankLogQueueType,
    change: { after: number; before: number; win: boolean }
  ) {
    const rows = await this._entryLoader.findUnattributedGames(owner, queueType)
    const picked = pickRankLogGame(
      rows.map((row) => ({
        gameId: row.gameId!,
        gameEnd: row.occurredAt,
        win: row.win === true,
        remake: row.remake === true
      })),
      change
    )
    return (picked && rows.find((row) => row.gameId === picked.gameId)) ?? null
  }

  /** Refills ranked games from match history; false when history cannot be read right now. */
  private async _loadHistory(owner: RankLogOwner, count: number) {
    const { logger, state } = this._context
    if (!this._clientDataLoader.canLoadHistory()) {
      return false
    }

    let games: RankLogGameFacts[]
    try {
      games = await this._clientDataLoader.loadHistory(owner, count)
    } catch (error) {
      logger.warn(`Match history is not readable right now: ${describeError(error)}`)
      return false
    }

    if (!this._isCurrentOwner(owner)) {
      return false
    }

    let isChanged = false
    for (const facts of games) {
      isChanged = (await this._applyFacts(owner, facts)) || isChanged
    }
    isChanged = (await this._resolveUnidentifiedGames(owner)) || isChanged

    state.setLastSyncedAt(this._now())
    if (isChanged) {
      state.bumpRevision()
    }
    return true
  }

  private async _applyFacts(owner: RankLogOwner, facts: RankLogGameFacts) {
    if (facts.remake) {
      // 重开不动胜点，不会再有变化来认领它。
      this._untrack(facts.gameId)
    }

    const row = await this._entryLoader.findGame(owner, facts.gameId)
    if (!row) {
      await this._entryLoader.save(
        createEntry(owner, { kind: 'game', gameId: facts.gameId, ...factsOf(facts) })
      )
      return true
    }

    let isChanged = false
    if (row.observedAt !== null && (facts.remake || (row.win !== null && row.win !== facts.win))) {
      // 战绩和当时按胜负计数推出的结果对不上：那次胜点变化不属于这一局，拆出来重新认领。
      this._context.logger.warn(
        `Game ${facts.gameId} contradicts the rank change recorded for it, the change was detached`
      )
      await this._entryLoader.save(
        createEntry(owner, {
          kind: 'game',
          queueType: row.queueType,
          occurredAt: row.observedAt,
          win: row.win,
          ...rankFieldsOf(row)
        })
      )
      Object.assign(row, EMPTY_RANK)
      isChanged = true
    }

    const values = factsOf(facts)
    const keys = Object.keys(values) as (keyof typeof values)[]
    if (keys.some((key) => row[key] !== values[key])) {
      Object.assign(row, values)
      isChanged = true
    }
    if (isChanged) {
      await this._entryLoader.save(row)
    }
    return isChanged
  }

  /** Gives rank changes that had no game yet the history game they belong to. */
  private async _resolveUnidentifiedGames(owner: RankLogOwner) {
    let isChanged = false
    for (const entry of await this._entryLoader.findUnidentifiedGames(owner)) {
      const previous = await this._entryLoader.findSnapshotBefore(entry)
      if (!previous || entry.observedAt === null || entry.win === null) {
        continue
      }

      const row = await this._pickHistoryRow(owner, entry.queueType, {
        after: previous.observedAt!,
        before: entry.observedAt,
        win: entry.win
      })
      if (!row) {
        continue
      }

      // 先删掉未识别的那一行再写入，免得同一次读数短暂出现两份。
      const rank = rankFieldsOf(entry)
      await this._entryLoader.remove(entry)
      await this._entryLoader.save(Object.assign(row, rank))
      isChanged = true
    }
    return isChanged
  }

  private _untrack(gameId: number) {
    this._trackedGames = this._trackedGames.filter((game) => game.gameId !== gameId)
  }

  /** After a game ends the client needs a moment to update the rank, and history even longer. */
  private _scheduleFollowUps() {
    this._clearTimers()
    for (const delay of RANK_LOG_FOLLOW_UP_DELAYS_MS) {
      const timer = setTimeout(() => {
        this._timers.delete(timer)
        void this._followUp()
      }, delay)
      this._timers.add(timer)
    }
  }

  private async _followUp() {
    await this._syncInBackground(RANK_LOG_HISTORY_RECENT_COUNT)

    try {
      const owner = this._readOwner()
      const isWaiting =
        this._trackedGames.some((game) => game.endedAt !== null) ||
        (owner !== null && (await this._entryLoader.hasGamesWithoutFacts(owner)))
      if (!isWaiting) {
        this._clearTimers()
      }
    } catch (error) {
      this._context.logger.warn(`Rank log follow-up failed: ${describeError(error)}`)
    }
  }

  private _clearTimers() {
    this._timers.forEach((timer) => clearTimeout(timer))
    this._timers.clear()
  }

  /** 胜点变动通知的结构没有文档；只记字段名和类型，供以后核对，不记数值。 */
  private _logNotificationShape(data: unknown) {
    if (!data || typeof data !== 'object' || this._loggedNotificationShapes >= 3) {
      return
    }

    this._loggedNotificationShapes++
    const shape = Object.entries(data)
      .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
      .join(', ')
    this._context.logger.info(`LP change notification fields: ${shape}`)
  }
}
