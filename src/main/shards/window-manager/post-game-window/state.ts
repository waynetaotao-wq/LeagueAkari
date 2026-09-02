import { Rectangle } from 'electron'
import { makeAutoObservable, observableRef } from 'mobx'

export class PostGameWindowSettings {
  enabled: boolean = true
  autoShow: boolean = true
  opacity: number = 1
  /** 默认置顶，赛后弹窗应浮在客户端之上 */
  pinned: boolean = true
  /** 自动收起秒数；0 = 不自动收起 */
  autoCloseSeconds: number = 120

  setOpacity(opacity: number) {
    this.opacity = opacity
  }

  setPinned(pinned: boolean) {
    this.pinned = pinned
  }

  setAutoShow(autoShow: boolean) {
    this.autoShow = autoShow
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  setAutoCloseSeconds(seconds: number) {
    this.autoCloseSeconds = seconds
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class PostGameWindowState {
  status: 'normal' | 'maximized' | 'minimized' = 'normal'

  focus: 'focused' | 'blurred' = 'focused'

  ready: boolean = false

  show: boolean = true

  trackedBounds: Rectangle | null = null

  setStatus(status: 'normal' | 'maximized' | 'minimized') {
    this.status = status
  }

  setFocus(focus: 'focused' | 'blurred') {
    this.focus = focus
  }

  setReady(ready: boolean) {
    this.ready = ready
  }

  setShow(show: boolean) {
    this.show = show
  }

  setTrackedBounds(bounds: Rectangle | null) {
    this.trackedBounds = bounds
  }

  constructor() {
    makeAutoObservable(this, {
      trackedBounds: observableRef
    })
  }
}
