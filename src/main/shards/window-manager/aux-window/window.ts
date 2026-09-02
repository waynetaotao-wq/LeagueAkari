import { i18next } from '@main/i18n'
import icon from '@resources/LA_ICON.ico?asset&asarUnpack'
import { Notification } from 'electron'
import { compareShallow, computed } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
import { repositionToAlignLeagueClientUx } from '../window-position-service'
import { AuxWindowSettings, AuxWindowState } from './state'

export class AkariAuxWindow extends BaseAkariWindow<AuxWindowState, AuxWindowSettings> {
  static readonly NAMESPACE_SUFFIX = 'aux-window'
  static readonly HTML_ENTRY = 'aux-window.html'
  static readonly TITLE = 'Mini Akari'
  static readonly BASE_WIDTH = 340
  static readonly BASE_HEIGHT = 420
  static readonly MIN_WIDTH = 340
  static readonly MIN_HEIGHT = 420

  static readonly QUICK_CLOSE_TIP_STORAGE_KEY = 'quickCloseTip'

  constructor(_context: WindowManagerMainContext) {
    const state = new AuxWindowState()
    const settings = new AuxWindowSettings()

    super(_context, AkariAuxWindow.NAMESPACE_SUFFIX, state, settings, {
      baseWidth: AkariAuxWindow.BASE_WIDTH,
      baseHeight: AkariAuxWindow.BASE_HEIGHT,
      minWidth: AkariAuxWindow.MIN_WIDTH,
      minHeight: AkariAuxWindow.MIN_HEIGHT,
      htmlEntry: AkariAuxWindow.HTML_ENTRY,
      rememberPosition: true,
      rememberSize: true,
      repositionWindowIfInvisible: true,
      settingSchema: {
        enabled: { default: settings.enabled, schema: z.boolean() },
        autoShow: { default: settings.autoShow, schema: z.boolean() }
      },
      browserWindowOptions: {
        title: AkariAuxWindow.TITLE,
        icon: icon,
        show: false,
        backgroundColor: '#141416', // [lolps] Mini 待机窗垫黑底，防止默认白窗透出
        frame: false,
        fullscreenable: false,
        maximizable: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 8, y: 8 }
      }
    })
  }

  private _watchAuxWindow() {
    const showTiming = computed(() => {
      if (!this.settings.autoShow) {
        return 'ignore'
      }

      if (!this.state.ready) {
        return 'ignore'
      }

      switch (this._leagueClient.data.gameflow.phase) {
        case 'ChampSelect':
          if (this._leagueClient.data.champSelect.session?.isSpectating) {
            return 'ignore'
          }

          // [lolps] 选人 / 加载 / 对局期间此窗无实际功能，自动隐藏；
          // 组队 / 排队 / 接受对局阶段自动回来（加载与对局命中下方默认 hide）
          return 'hide'
        case 'Lobby':
        case 'Matchmaking':
        case 'ReadyCheck':
          return 'show'
      }

      return 'hide'
    })

    // normally show & hide
    this._mobxUtils.reaction(
      () => showTiming.get(),
      (timing) => {
        if (timing === 'ignore') {
          return
        }

        if (timing === 'show') {
          this._showAndEnsurePainted()
        } else {
          this._cancelHealCheck()
          this.hide()
        }
      },
      { fireImmediately: true }
    )

    this._mobxUtils.reaction(
      () => [this.settings.enabled, this._windowManager.state.isManagerFinishedInit] as const,
      ([enabled, finishedInit]) => {
        if (!finishedInit) {
          return
        }

        if (enabled) {
          this.createWindow()
        } else {
          this.close(true)
        }
      },
      { fireImmediately: true, delay: 500, equals: compareShallow }
    )

    this._mobxUtils.reaction(
      () => this._leagueClient.state.connectionState,
      (state) => {
        if (state !== 'connected') {
          this.hide()
        }
      }
    )

    // 快速关闭会提供提示
    this._settingService._getFromStorage(AkariAuxWindow.QUICK_CLOSE_TIP_STORAGE_KEY).then((tip) => {
      if (!tip) {
        let _lastShow = -Infinity
        let inARow = 0
        let cb: Function | null = null
        cb = this._mobxUtils.reaction(
          () => this.state.show,
          (show) => {
            if (show) {
              _lastShow = Date.now()
            } else {
              if (Date.now() - _lastShow < 1000) {
                inARow++

                if (inARow < 5) {
                  return
                }

                new Notification({
                  title: i18next.t('window-manager-main.aux-window.quickClose.title'),
                  body: i18next.t('window-manager-main.aux-window.quickClose.body'),
                  icon: icon
                }).show()

                this._settingService._saveToStorage(
                  AkariAuxWindow.QUICK_CLOSE_TIP_STORAGE_KEY,
                  true
                )
                cb?.()
              } else {
                inARow = 0
              }
            }
          }
        )
      }
    })

    this._ipc.onCall(this._namespace, 'repositionToAlignLeagueClientUx', (_, placement) => {
      if (this._window) {
        repositionToAlignLeagueClientUx(this._window, placement)
      }
    })
  }

  /**
   * [lolps] 回大厅黑窗自愈。
   *
   * 对局期间此窗被隐藏，回大厅再显示时偶发整窗黑屏（内容未绘制）——可能是渲染进程在
   * 游戏独占全屏期间被系统回收/崩溃（基类对 render-process-gone 仅记日志），也可能是
   * 合成器未重绘。两种原因离线无法区分，因此做与原因无关的自愈：
   * 显示后强制重绘；稍后自检"渲染进程已崩"或"页面正文为空"，任一命中即重载页面。
   */
  private _healTimer: NodeJS.Timeout | null = null
  private _healSeq = 0

  private _cancelHealCheck() {
    this._healSeq++
    if (this._healTimer) {
      clearTimeout(this._healTimer)
      this._healTimer = null
    }
  }

  private _showAndEnsurePainted() {
    this.showOrRestore()
    const win = this._window
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.invalidate()
    } catch {}

    this._cancelHealCheck()
    const seq = this._healSeq
    this._healTimer = setTimeout(() => {
      this._healTimer = null
      void this._healIfBlank(seq)
    }, 800)
  }

  private async _healIfBlank(seq: number) {
    if (seq !== this._healSeq) return
    const win = this._window
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const wc = win.webContents
    try {
      if (wc.isCrashed()) {
        this._logger.warn('[lolps] aux window renderer crashed, reloading')
        wc.reload()
        return
      }
      const textLength = await wc.executeJavaScript(
        'document.body ? document.body.innerText.trim().length : 0',
        true
      )
      if (seq !== this._healSeq) return
      if (typeof textLength === 'number' && textLength === 0) {
        this._logger.warn('[lolps] aux window is blank after show, reloading')
        wc.reload()
      }
    } catch (error) {
      this._logger.warn(`[lolps] aux window health check failed, reloading: ${String(error)}`)
      try {
        wc.reload()
      } catch {}
    }
  }

  override async onInit() {
    await super.onInit()

    this._watchAuxWindow()
  }

  override async onDispose() {
    this._cancelHealCheck()
    await super.onDispose()
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'autoShow'] as const
  }
}
