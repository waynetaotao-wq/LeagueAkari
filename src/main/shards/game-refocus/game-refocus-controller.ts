import { riotId, summonerName } from '@shared/utils/name'
import { compareShallow, runInAction } from 'mobx'
import { spawn } from 'node:child_process'

import { NATIVE_SUPPORT, getPidsByName } from '@main/native'
import {
  GAME_REFOCUS_LEAD_SECONDS,
  GAME_REFOCUS_MIN_ACTIVATE_GAP_MS,
  GAME_REFOCUS_POLL_ALIVE_MS,
  GAME_REFOCUS_POLL_DEAD_MS,
  type GameRefocusMainContext
} from './context'
import {
  RespawnRefocusTracker,
  buildActivateWindowScript,
  encodePowershellCommand,
  shouldActivate
} from './refocus-logic'

const GAME_CLIENT_PROCESS_NAME = 'League of Legends.exe'

export class GameRefocusController {
  private _timerId: NodeJS.Timeout | null = null
  private _isStarted = false
  private _pollSeq = 0
  private _lastActivateAt = 0
  private _activating = false
  private readonly _tracker = new RespawnRefocusTracker(GAME_REFOCUS_LEAD_SECONDS)

  constructor(private readonly context: GameRefocusMainContext) {}

  watch() {
    this.context.state.setSupported(process.platform === 'win32')
    this._watchGameflow()
  }

  dispose() {
    this._stopPoll()
  }

  applyEnabledSettingSideEffect(enabled: boolean) {
    if (enabled && this._isInProgress()) {
      this._startPoll()
    } else if (!enabled) {
      this._stopPoll()
    }
  }

  private _isInProgress() {
    return this.context.leagueClient.data.gameflow.phase === 'InProgress'
  }

  private _watchGameflow() {
    const { leagueClient, mobxUtils, settings } = this.context

    mobxUtils.reaction(
      () => [leagueClient.data.gameflow.phase, settings.enabled],
      ([phase, enabled]) => {
        if (phase === 'InProgress' && enabled && this.context.state.supported) {
          this._startPoll()
        } else {
          // 加载、重连、结算、大厅、秒退：一律停止并复位，本局痕迹不带入下一局
          this._stopPoll()
        }
      },
      { equals: compareShallow, fireImmediately: true }
    )
  }

  private _startPoll() {
    if (this._isStarted) return
    this._isStarted = true
    this._tracker.reset()
    this._lastActivateAt = 0
    runInAction(() => this.context.state.setLastTriggeredAt(0))
    this.context.logger.info('[GameRefocus] polling started')
    this._scheduleNext(0)
  }

  private _stopPoll() {
    if (!this._isStarted) return
    this._isStarted = false
    this._pollSeq++
    if (this._timerId) {
      clearTimeout(this._timerId)
      this._timerId = null
    }
    this._tracker.reset()
    this.context.logger.info('[GameRefocus] polling stopped')
  }

  /** 用 setTimeout 链而非 setInterval：死亡时加密轮询、失败时不堆积 */
  private _scheduleNext(delayMs: number) {
    if (!this._isStarted) return
    const seq = ++this._pollSeq
    this._timerId = setTimeout(async () => {
      if (seq !== this._pollSeq || !this._isStarted) return
      const wasDead = await this._pollOnce()
      if (seq !== this._pollSeq || !this._isStarted) return
      this._scheduleNext(wasDead ? GAME_REFOCUS_POLL_DEAD_MS : GAME_REFOCUS_POLL_ALIVE_MS)
    }, delayMs)
  }

  /** @returns 本人当前是否处于死亡状态（决定下一次轮询间隔） */
  private async _pollOnce(): Promise<boolean> {
    const { gameClient, leagueClient } = this.context
    const me = leagueClient.data.summoner.me
    if (!me) return false

    try {
      const playerList = (await gameClient.api.getLiveClientDataPlayerList()).data
      const self = playerList.find((p) => {
        if (p.riotId) return p.riotId === riotId(me)
        if (p.summonerName) return summonerName(p.summonerName) === riotId(me)
        return p.summonerName === me.internalName
      })
      // 观战 / 回放 / 列表未就绪：找不到本人即不动作
      if (!self) return false

      const decision = this._tracker.observe({
        isDead: !!self.isDead,
        respawnTimer: Number(self.respawnTimer) || 0
      })
      if (decision === 'fire') {
        void this._activateGameWindow()
      }
      return !!self.isDead
    } catch {
      // 加载中 / 游戏进程尚未开放本地接口：静默等待下一次
      return false
    }
  }

  private async _activateGameWindow() {
    if (this._activating) return
    const now = Date.now()
    if (now - this._lastActivateAt < GAME_REFOCUS_MIN_ACTIVATE_GAP_MS) return
    this._activating = true
    try {
      // 本来就在游戏里：不做任何事（前台判断需要提权；无法判断时保守地执行激活，
      // 对已在前台的窗口激活等价于无操作）
      const foregroundKnown = NATIVE_SUPPORT.isProcessForeground.available
      const gameIsForeground = foregroundKnown
        ? await this.context.gameClient.isGameClientForegroundCached()
        : false
      if (!shouldActivate(foregroundKnown, gameIsForeground)) {
        this.context.logger.info('[GameRefocus] game already in foreground, skip')
        return
      }

      const pids = await getPidsByName(GAME_CLIENT_PROCESS_NAME)
      if (pids.length === 0) {
        this.context.logger.warn('[GameRefocus] game client process not found')
        return
      }

      this._lastActivateAt = now
      await this._runActivateScript(pids[0])
      runInAction(() => this.context.state.setLastTriggeredAt(Date.now()))
      this.context.logger.info(`[GameRefocus] activated game window pid=${pids[0]}`)
    } catch (error) {
      this.context.logger.warn(`[GameRefocus] activate failed: ${String(error)}`)
    } finally {
      this._activating = false
    }
  }

  private _runActivateScript(pid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const encoded = encodePowershellCommand(buildActivateWindowScript(pid))
      const child = spawn(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-EncodedCommand',
          encoded
        ],
        { windowsHide: true, stdio: 'ignore' }
      )
      const guard = setTimeout(() => {
        child.kill()
        reject(new Error('activate script timeout'))
      }, 8000)
      child.once('error', (error) => {
        clearTimeout(guard)
        reject(error)
      })
      child.once('close', () => {
        clearTimeout(guard)
        resolve()
      })
    })
  }
}
