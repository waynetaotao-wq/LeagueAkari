import type { FriendRequestTestTarget } from '@shared/shards/friend-request-test'

import type { AkariLogger } from '../logger-factory'
import type { FriendRequestTestState } from './state'

export interface FriendTestRelationship {
  friend: { id: string; puuid: string } | null
  request: { puuid: string; direction: 'in' | 'out' | 'both' } | null
}

export interface FriendRequestTestApi {
  resolve(
    gameName: string,
    tagLine: string,
    signal: AbortSignal
  ): Promise<FriendRequestTestTarget | null>
  relationship(puuid: string, signal: AbortSignal): Promise<FriendTestRelationship>
  send(target: FriendRequestTestTarget, signal: AbortSignal): Promise<void>
  withdraw(puuid: string, signal: AbortSignal): Promise<void>
  remove(id: string, signal: AbortSignal): Promise<void>
}

export interface FriendRequestTestSession {
  connection: object
  selfPuuid: string
}

export interface FriendRequestTestContext {
  state: FriendRequestTestState
  api: FriendRequestTestApi
  getSession: () => FriendRequestTestSession | null
  logger: Pick<AkariLogger, 'info' | 'warn'>
}
