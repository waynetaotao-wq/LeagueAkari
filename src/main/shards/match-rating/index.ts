import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { makeAutoObservable } from 'mobx'
import { z } from 'zod'

import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'

export const MATCH_RATING_MAIN_NAMESPACE = 'match-rating-main'

/** [lolps] 对局评分：持久化"用我的战绩校准"得到的权重（JSON 字符串；null = 内置先验） */
export class MatchRatingSettings {
  calibration: string | null = null

  setCalibration(value: string | null) {
    this.calibration = value
  }

  constructor() {
    makeAutoObservable(this)
  }
}

@Shard(MatchRatingMain.id)
export class MatchRatingMain implements IAkariShardInitDispose {
  static id = MATCH_RATING_MAIN_NAMESPACE

  public readonly settings = new MatchRatingSettings()

  private readonly _settingService: SetterSettingService<MatchRatingSettings>

  constructor(
    private readonly _mobxUtils: MobxUtilsMain,
    _settingFactory: SettingFactoryMain
  ) {
    this._settingService = _settingFactory.register(
      MatchRatingMain.id,
      {
        calibration: {
          default: null,
          schema: z.string().nullable()
        }
      },
      this.settings
    )
  }

  async onInit() {
    await this._settingService.applyToState()
    this._mobxUtils.propSync(MatchRatingMain.id, 'settings', this.settings, ['calibration'])
  }

  async onDispose() {}
}
