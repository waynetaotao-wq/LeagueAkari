import icon from '@resources/LA_ICON.ico?asset&asarUnpack'
import { screen } from 'electron'
import { compareShallow, computed } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
import { PostGameWindowSettings, PostGameWindowState } from './state'

/**
 * [lolps] 赛后小结弹窗（WeGame 式）
 *
 * 行为契约：
 *  - 平时不显示；对局结算（PreEndOfGame / EndOfGame）自动弹出在主屏右下角，置顶
 *  - 回大厅后保持显示，直到：用户关闭 / 自动收起超时 / 进入下一局选人或对局
 *  - 内容（本局英雄头像、游戏 ID、胜负、时长、KDA、各玩家对局评分与 MVP/SVP/尽力局）
 *    由渲染层自行拉取本局战绩并计算，本类只管窗口生命周期
 */
export class AkariPostGameWindow extends BaseAkariWindow<PostGameWindowState, PostGameWindowSettings> {
  static readonly NAMESPACE_SUFFIX = 'post-game-window'
  static readonly HTML_ENTRY = 'post-game-window.html'
  static readonly TITLE = 'League Akari - 赛后小结'
  static readonly BASE_WIDTH = 440
  static readonly BASE_HEIGHT = 780
  static readonly MIN_WIDTH = 440
  static readonly MIN_HEIGHT = 780
  static readonly SCREEN_MARGIN = 16

  private _autoCloseTimer: NodeJS.Timeout | null = null

  constructor(_context: WindowManagerMainContext) {
    const state = new PostGameWindowState()
    const settings = new PostGameWindowSettings()

    super(_context, AkariPostGameWindow.NAMESPACE_SUFFIX, state, settings, {
      baseWidth: AkariPostGameWindow.BASE_WIDTH,
      baseHeight: AkariPostGameWindow.BASE_HEIGHT,
      minWidth: AkariPostGameWindow.MIN_WIDTH,
      minHeight: AkariPostGameWindow.MIN_HEIGHT,
      htmlEntry: AkariPostGameWindow.HTML_ENTRY,
      rememberPosition: false,
      rememberSize: false,
      repositionWindowIfInvisible: false,
      settingSchema: {
        enabled: { default: settings.enabled, schema: z.boolean() },
        autoShow: { default: settings.autoShow, schema: z.boolean() },
        autoCloseSeconds: { default: settings.autoCloseSeconds, schema: z.number().int().min(0).max(900) }
      },
      browserWindowOptions: {
        title: AkariPostGameWindow.TITLE,
        icon: icon,
        show: false,
        backgroundColor: '#141416',
        fullscreenable: false,
        frame: false,
        maximizable: false,
        resizable: false,
        skipTaskbar: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 8, y: 8 }
      }
    })
  }

  private _clearAutoClose() {
    if (this._autoCloseTimer) {
      clearTimeout(this._autoCloseTimer)
      this._autoCloseTimer = null
    }
  }

  private _armAutoClose() {
    this._clearAutoClose()
    const seconds = this.settings.autoCloseSeconds
    if (seconds > 0) {
      this._autoCloseTimer = setTimeout(() => {
        this._autoCloseTimer = null
        this.hide()
      }, seconds * 1000)
    }
  }

  /** 每次弹出都放到主屏工作区右下角（WeGame 同款位置） */
  private _moveToBottomRight() {
    const win = this._window
    if (!win || win.isDestroyed()) return
    try {
      const { workArea } = screen.getPrimaryDisplay()
      const [w, h] = win.getSize()
      const margin = AkariPostGameWindow.SCREEN_MARGIN
      win.setPosition(
        Math.round(workArea.x + workArea.width - w - margin),
        Math.round(workArea.y + workArea.height - h - margin)
      )
    } catch {}
  }

  private _watchPostGameWindow() {
    const timing = computed(() => {
      if (!this.settings.autoShow || !this.state.ready) {
        return 'ignore'
      }
      switch (this._context.leagueClient.data.gameflow.phase) {
        case 'PreEndOfGame':
        case 'EndOfGame':
          return 'show'
        case 'ChampSelect':
        case 'GameStart':
        case 'InProgress':
        case 'Reconnect':
        case 'WaitingForStats':
          return 'hide'
      }
      // Lobby / Matchmaking / None：保持现状（结算后回大厅仍留着，直到关闭或超时）
      return 'keep'
    })

    this._context.mobxUtils.reaction(
      () => timing.get(),
      (value) => {
        if (value === 'show') {
          this._moveToBottomRight()
          this.showOrRestore(true)
          this._armAutoClose()
        } else if (value === 'hide') {
          this._clearAutoClose()
          this.hide()
        }
      }
    )

    this._context.mobxUtils.reaction(
      () =>
        [this.settings.enabled, this._context.windowManager.state.isManagerFinishedInit] as const,
      ([enabled, finishedInit]) => {
        if (!finishedInit) {
          return
        }
        if (enabled) {
          this.createWindow()
        } else {
          this._clearAutoClose()
          this.close(true)
        }
      },
      { fireImmediately: true, delay: 500, equals: compareShallow }
    )

    this._context.mobxUtils.reaction(
      () => this._context.leagueClient.state.connectionState,
      (state) => {
        if (state !== 'connected') {
          this._clearAutoClose()
          this.hide()
        }
      }
    )

    this._ipc.onCall(this._namespace, 'winop', (_e, op: { action: string }) => {
      switch (op?.action) {
        case 'hide':
          this._clearAutoClose()
          this.hide()
          break
        case 'close':
          this._clearAutoClose()
          this.hide()
          break
      }
    })
  }

  override async onInit() {
    await super.onInit()
    this._watchPostGameWindow()
  }

  override async onDispose() {
    this._clearAutoClose()
    await super.onDispose()
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'autoShow', 'autoCloseSeconds'] as const
  }
}
