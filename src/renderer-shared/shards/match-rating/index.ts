import { setAkariPositionWeights } from '@renderer-shared/components/match-card/utils/akari-score'
import { parseStoredCalibration } from '@renderer-shared/components/match-card/utils/akari-score-calibration'
import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { watch } from 'vue'

import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import { useMatchRatingStore } from './store'

export const MATCH_RATING_MAIN_NAMESPACE = 'match-rating-main'
export const MATCH_RATING_RENDERER_NAMESPACE = 'match-rating-renderer'

/**
 * [lolps] 对局评分：把持久化的校准权重同步到渲染层，并注入评分引擎（模块级覆盖）。
 * 未校准或数据损坏时评分引擎回落内置先验。
 */
@Shard(MatchRatingRenderer.id)
export class MatchRatingRenderer implements IAkariShardInitDispose {
  static id = MATCH_RATING_RENDERER_NAMESPACE

  constructor(
    @Dep(PiniaMobxUtilsRenderer) private readonly _piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) private readonly _settingUtils: SettingUtilsRenderer
  ) {}

  async onInit() {
    const store = useMatchRatingStore()
    await this._piniaMobxUtils.sync(MATCH_RATING_MAIN_NAMESPACE, 'settings', store.settings)
    watch(
      () => store.settings.calibration,
      (json) => {
        const parsed = parseStoredCalibration(json)
        setAkariPositionWeights(parsed ? parsed.weights : null)
      },
      { immediate: true }
    )
  }

  saveCalibration(json: string | null) {
    return this._settingUtils.set(MATCH_RATING_MAIN_NAMESPACE, 'calibration', json)
  }
}
