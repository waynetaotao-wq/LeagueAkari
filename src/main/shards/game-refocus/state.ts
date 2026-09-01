import { makeAutoObservable } from 'mobx'

export class GameRefocusSettings {
  enabled: boolean = true

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class GameRefocusState {
  /** 当前平台是否支持（仅 Windows：需要按进程激活窗口的系统能力） */
  supported: boolean = false

  /** 最近一次成功触发切回的时间戳（0 = 本局尚未触发） */
  lastTriggeredAt: number = 0

  setSupported(supported: boolean) {
    this.supported = supported
  }

  setLastTriggeredAt(at: number) {
    this.lastTriggeredAt = at
  }

  constructor() {
    makeAutoObservable(this)
  }
}
