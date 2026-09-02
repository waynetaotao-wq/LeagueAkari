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
        // [lolps] 诊断：回大厅不显示时，凭这一行能判断是"时机没触发"还是"显示动作被拦"
        this._logger.info(
          `[lolps] aux timing=${timing} phase=${this._leagueClient.data.gameflow.phase} autoShow=${this.settings.autoShow} ready=${this.state.ready} nativeVisible=${this._window && !this._window.isDestroyed() ? this._window.isVisible() : 'n/a'} stateShow=${this.state.show}`
        )
        if (timing === 'ignore') {
          return
        }

        if (timing === 'show') {
          this._showAndEnsurePainted()
        } else {
          this._cancelHealCheck()
          this._hiddenByTiming = true
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

  /** 上一次是否由显示时机逻辑主动隐藏（用于识别"被系统误认为可见"的黑窗） */
  private _hiddenByTiming = false

  private _showAndEnsurePainted() {
    const cameFromHidden = this._hiddenByTiming
    this._hiddenByTiming = false
    const before = this._window
    if (before && !before.isDestroyed()) {
      const nativeVisible = before.isVisible()
      this._logger.info(
        `[lolps] aux show requested: fromHidden=${cameFromHidden} nativeVisible=${nativeVisible} stateShow=${this.state.show} minimized=${before.isMinimized()}`
      )
      // 我们明明隐藏过，系统却说它可见：这正是"窗口在、内容黑"的状态，先真隐藏再显示以重建
      if (cameFromHidden && nativeVisible) {
        this._logger.warn('[lolps] aux window reports visible after our hide; forcing hide/show cycle')
        try {
          before.hide()
        } catch {}
      }
    }

    // 根因（日志实证）：窗口曾被最小化、随后又被我们隐藏，基类 showOrRestore() 见到"已最小化"
    // 只做 restore() 就返回——系统层面窗口变为可见，但 Chromium 未走真正的 show 流程，内容停留在
    // 隐藏态 → 窗口在、内容黑。因此凡是"从隐藏态回来"的显示一律自己处理：先 restore 再真正 show。
    const win = this._window
    if (!win || win.isDestroyed()) return
    if (cameFromHidden) {
      if (win.isMinimized()) {
        this._logger.warn('[lolps] aux window was minimized while hidden; restoring then showing')
        try {
          win.restore()
        } catch {}
      }
      try {
        win.show()
      } catch {}
      if (!win.isVisible()) {
        this._logger.warn('[lolps] aux window still invisible after show(); retrying showOrRestore')
        this.showOrRestore()
      }
    } else {
      this.showOrRestore()
      if (!win.isVisible()) {
        this._logger.warn('[lolps] aux window still invisible after showOrRestore; forcing show()')
        try {
          win.show()
        } catch {}
      }
    }
    try {
      win.webContents.invalidate()
    } catch {}
    // 从隐藏态显示（典型：对局结束回大厅）：无感的 1px 尺寸往返，先发制人重建绘制表面
    if (cameFromHidden) this._nudgeWindowSize()

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
        return
      }

      // DOM 有内容但可能根本没画到屏幕上（游戏独占全屏期间被隐藏后，合成器表面失效的黑窗）：
      // 截屏采样，几乎全黑即判定为未绘制 → 尺寸微动重建表面 + 重载页面
      const brightRatio = await this._measureBrightRatio()
      if (seq !== this._healSeq) return
      this._logger.info(
        `[lolps] aux window paint check: text=${textLength} bright=${(brightRatio * 100).toFixed(1)}%`
      )
      if (brightRatio >= 0 && brightRatio < 0.01) {
        this._logger.warn('[lolps] aux window painted black, nudging size and reloading')
        this._nudgeWindowSize()
        wc.reload()
      }
    } catch (error) {
      this._logger.warn(`[lolps] aux window health check failed, reloading: ${String(error)}`)
      try {
        wc.reload()
      } catch {}
    }
  }

  /** 截屏并按 8px 网格采样，返回"亮像素"占比；无法截屏时返回 -1（不触发自愈） */
  private async _measureBrightRatio(): Promise<number> {
    const win = this._window
    if (!win || win.isDestroyed()) return -1
    try {
      const image = await win.webContents.capturePage()
      const { width, height } = image.getSize()
      if (width <= 0 || height <= 0) return -1
      const bitmap = image.toBitmap() // BGRA
      let bright = 0
      let total = 0
      for (let y = 0; y < height; y += 8) {
        for (let x = 0; x < width; x += 8) {
          const i = (y * width + x) * 4
          const b = bitmap[i]
          const g = bitmap[i + 1]
          const r = bitmap[i + 2]
          total++
          // 暗色主题底色 #141416 的最大通道 ≈ 22；正文/图标远高于 40
          if (Math.max(r, g, b) > 40) bright++
        }
      }
      return total > 0 ? bright / total : -1
    } catch {
      return -1
    }
  }

  /** 1px 尺寸往返，迫使系统重建窗口绘制表面（基类记忆尺寸会在回弹后落回原值） */
  private _nudgeWindowSize() {
    const win = this._window
    if (!win || win.isDestroyed()) return
    try {
      const [w, h] = win.getSize()
      win.setSize(w, h + 1)
      setTimeout(() => {
        if (!win.isDestroyed()) win.setSize(w, h)
      }, 60)
    } catch {}
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
