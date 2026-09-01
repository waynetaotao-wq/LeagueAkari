import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import type { SettingUtilsRenderer } from '../setting-utils'

export const GAME_REFOCUS_MAIN_NAMESPACE = 'game-refocus-main'
export const GAME_REFOCUS_RENDERER_NAMESPACE = 'game-refocus-renderer'

export interface GameRefocusRendererContext {
  piniaMobxUtils: PiniaMobxUtilsRenderer
  settingUtils: SettingUtilsRenderer
}
