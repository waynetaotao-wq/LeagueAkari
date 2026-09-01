import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import {
  GAME_REFOCUS_MAIN_NAMESPACE,
  GAME_REFOCUS_RENDERER_NAMESPACE,
  type GameRefocusRendererContext
} from './context'
import { syncGameRefocusState } from './state-sync'

/** [lolps] 复活自动切回游戏：渲染层设置同步 */
@Shard(GameRefocusRenderer.id)
export class GameRefocusRenderer implements IAkariShardInitDispose {
  static id = GAME_REFOCUS_RENDERER_NAMESPACE

  private readonly _context: GameRefocusRendererContext

  constructor(
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) settingUtils: SettingUtilsRenderer
  ) {
    this._context = {
      piniaMobxUtils,
      settingUtils
    }
  }

  async onInit() {
    await syncGameRefocusState(this._context)
  }

  setEnabled(value: boolean) {
    return this._context.settingUtils.set(GAME_REFOCUS_MAIN_NAMESPACE, 'enabled', value)
  }
}
