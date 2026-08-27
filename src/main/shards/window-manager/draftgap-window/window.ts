import icon from '@resources/LA_ICON.ico?asset&asarUnpack'
import { compareShallow, computed } from 'mobx'
import { z } from 'zod'

import { BaseAkariWindow } from '../base-akari-window'
import type { WindowManagerMainContext } from '../context'
import { registerDraftgapService } from './service'
import { DraftgapWindowSettings, DraftgapWindowState } from './state'

/**
 * 团队之选（DraftGap）独立窗口
 *
 * 行为契约（用户需求）：
 *  - 平时不显示（创建时 show:false，且不主动展示）
 *  - 进入英雄选择（ChampSelect）自动现身
 *  - 对局开始（GameStart / InProgress）自动隐藏
 *
 * 实现完全照 opgg-window 模板，仅在 showTiming 中新增 hide 分支。
 */
export class AkariDraftgapWindow extends BaseAkariWindow<
  DraftgapWindowState,
  DraftgapWindowSettings
> {
  static readonly NAMESPACE_SUFFIX = 'draftgap-window'
  static readonly HTML_ENTRY = 'draftgap-window.html'
  static readonly TITLE = 'League Akari - 团队之选'
  static readonly BASE_WIDTH = 1600
  static readonly BASE_HEIGHT = 850
  static readonly MIN_WIDTH = 960
  static readonly MIN_HEIGHT = 600

  constructor(_context: WindowManagerMainContext) {
    const state = new DraftgapWindowState()
    const settings = new DraftgapWindowSettings()

    super(_context, AkariDraftgapWindow.NAMESPACE_SUFFIX, state, settings, {
      baseWidth: AkariDraftgapWindow.BASE_WIDTH,
      baseHeight: AkariDraftgapWindow.BASE_HEIGHT,
      minWidth: AkariDraftgapWindow.MIN_WIDTH,
      minHeight: AkariDraftgapWindow.MIN_HEIGHT,
      htmlEntry: AkariDraftgapWindow.HTML_ENTRY,
      rememberPosition: true,
      rememberSize: true,
      repositionWindowIfInvisible: false,
      settingSchema: {
        enabled: { default: settings.enabled, schema: z.boolean() },
        autoShow: { default: settings.autoShow, schema: z.boolean() }
      },
      browserWindowOptions: {
        title: AkariDraftgapWindow.TITLE,
        icon: icon,
        show: false,
        backgroundColor: '#060608',
        fullscreenable: false,
        frame: false,
        maximizable: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 8, y: 8 }
      }
    })
  }

  private _watchDraftgapWindow() {
    const showTiming = computed(() => {
      if (!this.settings.autoShow) {
        return 'ignore'
      }

      if (!this.state.ready) {
        return 'ignore'
      }

      switch (this._context.leagueClient.data.gameflow.phase) {
        case 'ChampSelect':
          return 'show'
      }

      // 非选人阶段（含启动时、对局中、回大厅）一律隐藏
      return 'hide'
    })

    this._context.mobxUtils.reaction(
      () => showTiming.get(),
      (timing) => {
        if (timing === 'show') {
          this.showOrRestore()
        } else if (timing === 'hide') {
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
          this.close(true)
        }
      },
      { fireImmediately: true, delay: 500, equals: compareShallow }
    )

    // 标题栏窗口操作（渲染层无边框窗口的按钮走这里）
    this._ipc.onCall(this._namespace, 'winop', (_e, op: { action: string }) => {
      switch (op?.action) {
        case 'hide':
          this.hide()
          break
        case 'minimize':
          this._window?.minimize()
          break
        case 'close':
          this.close(true)
          break
      }
    })
  }

  override async onInit() {
    await super.onInit()

    this._watchDraftgapWindow()

    registerDraftgapService({
      ipc: this._ipc,
      namespace: this._namespace,
      leagueClient: this._context.leagueClient,
      logger: this._logger
    })
  }

  protected override getSettingPropKeys() {
    return ['enabled', 'autoShow'] as const
  }
}
