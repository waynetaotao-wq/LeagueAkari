import { FRIEND_REQUEST_TEST_MAIN_NAMESPACE } from '@shared/shards/friend-request-test'
import type { WebContents } from 'electron'

import type { AkariIpcMain } from '../ipc'
import type { FriendRequestTestController } from './test-controller'

export class FriendRequestTestIpcHandlers {
  private _owner: WebContents | null = null
  private readonly _onGone = () => this._controller.stop('window-closed')
  private readonly _onReload = () => this._controller.pause()

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _controller: FriendRequestTestController
  ) {}

  register() {
    this._ipc.onCall(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'start', (event, options) => {
      const result = this._controller.start(options)
      if (result.started) this._claimOwner(event.sender)
      return result
    })
    this._ipc.onCall(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'withdrawPending', (event, options) => {
      const result = this._controller.start(options, 'withdraw-only')
      if (result.started) this._claimOwner(event.sender)
      return result
    })
    this._ipc.onCall(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'pause', () => this._controller.pause())
    this._ipc.onCall(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'resume', () => this._controller.resume())
    this._ipc.onCall(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'stop', () => this._controller.stop())
  }

  private _claimOwner(owner: WebContents) {
    this._releaseOwner()
    this._owner = owner
    owner.on('destroyed', this._onGone)
    owner.on('render-process-gone', this._onGone)
    owner.on('did-start-loading', this._onReload)
  }

  private _releaseOwner() {
    this._owner?.off('destroyed', this._onGone)
    this._owner?.off('render-process-gone', this._onGone)
    this._owner?.off('did-start-loading', this._onReload)
    this._owner = null
  }

  dispose() {
    this._controller.stop('window-closed')
    this._releaseOwner()
  }
}
