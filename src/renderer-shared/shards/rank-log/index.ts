import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { RankLogEntryDto, RankLogQueryDto, RankLogSyncResult } from '@shared/shards/rank-log'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import { useRankLogStore } from './store'

export const RANK_LOG_MAIN_NAMESPACE = 'rank-log-main'
export const RANK_LOG_RENDERER_NAMESPACE = 'rank-log-renderer'

/** [lolps] 上分日志：渲染层的状态同步与读取入口 */
@Shard(RankLogRenderer.id)
export class RankLogRenderer implements IAkariShardInitDispose {
  static id = RANK_LOG_RENDERER_NAMESPACE

  constructor(
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) private readonly _piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) private readonly _settingUtils: SettingUtilsRenderer
  ) {}

  async onInit() {
    const store = useRankLogStore()
    await this._piniaMobxUtils.sync(RANK_LOG_MAIN_NAMESPACE, 'settings', store.settings)
    await this._piniaMobxUtils.sync(RANK_LOG_MAIN_NAMESPACE, 'state', store.state)
  }

  /** Newest first. */
  queryEntries(query: RankLogQueryDto): Promise<RankLogEntryDto[]> {
    return this._ipc.call(RANK_LOG_MAIN_NAMESPACE, 'queryEntries', query)
  }

  syncNow(): Promise<RankLogSyncResult> {
    return this._ipc.call(RANK_LOG_MAIN_NAMESPACE, 'syncNow')
  }

  setEnabled(enabled: boolean) {
    return this._settingUtils.set(RANK_LOG_MAIN_NAMESPACE, 'enabled', enabled)
  }
}
