import { Dep, Shard } from '@shared/akari-shard'
import {
  FRIEND_REQUEST_TEST_MAIN_NAMESPACE,
  type FriendRequestTestOptions,
  type FriendRequestTestRefreshResult,
  type FriendRequestTestStartResult
} from '@shared/shards/friend-request-test'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { useFriendRequestTestStore } from './store'

@Shard(FriendRequestTestRenderer.id)
export class FriendRequestTestRenderer {
  static id = 'friend-request-test-renderer'

  constructor(
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) private readonly _piniaMobxUtils: PiniaMobxUtilsRenderer
  ) {}

  async onInit() {
    await this._piniaMobxUtils.sync(
      FRIEND_REQUEST_TEST_MAIN_NAMESPACE,
      'state',
      useFriendRequestTestStore().state
    )
  }

  start(options: FriendRequestTestOptions): Promise<FriendRequestTestStartResult> {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'start', options)
  }

  withdrawPending(options: FriendRequestTestOptions): Promise<FriendRequestTestStartResult> {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'withdrawPending', options)
  }

  pause() {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'pause')
  }
  refreshRelationship(): Promise<FriendRequestTestRefreshResult> {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'refreshRelationship')
  }
  resume() {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'resume')
  }
  stop() {
    return this._ipc.call(FRIEND_REQUEST_TEST_MAIN_NAMESPACE, 'stop')
  }
}
