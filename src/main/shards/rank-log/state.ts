import { makeAutoObservable } from 'mobx'

export class RankLogSettings {
  /** 每局结束后自动记录 */
  enabled: boolean = true

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class RankLogState {
  /** 数据表是否可用；不可用时整个功能停用 */
  available: boolean = false

  /** 日志内容每变一次加一，界面据此重新读取 */
  revision: number = 0

  syncing: boolean = false

  /** 最近一次成功读到战绩的时间戳（0 = 本次启动还没有） */
  lastSyncedAt: number = 0

  setAvailable(available: boolean) {
    this.available = available
  }

  bumpRevision() {
    this.revision++
  }

  setSyncing(syncing: boolean) {
    this.syncing = syncing
  }

  setLastSyncedAt(at: number) {
    this.lastSyncedAt = at
  }

  constructor() {
    makeAutoObservable(this)
  }
}
