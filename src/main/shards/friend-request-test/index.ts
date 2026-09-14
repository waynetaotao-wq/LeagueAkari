import { type IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { FRIEND_REQUEST_TEST_MAIN_NAMESPACE } from '@shared/shards/friend-request-test'

import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { FriendRequestTestClientExecutor } from './client-executor'
import { FriendRequestTestIpcHandlers } from './ipc-handlers'
import { FriendRequestTestState } from './state'
import { FriendRequestTestController } from './test-controller'

@Shard(FriendRequestTestMain.id)
export class FriendRequestTestMain implements IAkariShardInitDispose {
  static id = FRIEND_REQUEST_TEST_MAIN_NAMESPACE
  public readonly state = new FriendRequestTestState()
  private readonly _controller: FriendRequestTestController
  private readonly _ipcHandlers: FriendRequestTestIpcHandlers

  constructor(
    private readonly _leagueClient: LeagueClientMain,
    private readonly _mobxUtils: MobxUtilsMain,
    ipc: AkariIpcMain,
    loggerFactory: LoggerFactoryMain
  ) {
    this._controller = new FriendRequestTestController({
      state: this.state,
      api: new FriendRequestTestClientExecutor(this._leagueClient),
      logger: loggerFactory.create(FriendRequestTestMain.id),
      getSession: () => {
        const client = this._leagueClient
        const selfPuuid = client.data.summoner.me?.puuid
        const phase = client.data.gameflow.phase
        if (
          !client.state.isConnected ||
          !client.state.auth ||
          !selfPuuid ||
          !['None', 'Lobby'].includes(phase ?? '')
        )
          return null
        if (client.data.chat.me?.puuid !== selfPuuid) return null
        return { connection: client.state.auth, selfPuuid }
      }
    })
    this._ipcHandlers = new FriendRequestTestIpcHandlers(ipc, this._controller)
  }

  async onInit() {
    this._mobxUtils.propSync(FriendRequestTestMain.id, 'state', this.state, ['snapshot'])
    this._ipcHandlers.register()
  }

  async onDispose() {
    this._ipcHandlers.dispose()
  }
}
