import type { Session } from 'electron'

import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { NetworkSettings } from './state'

export { NETWORK_MAIN_NAMESPACE } from '@shared/shards/network'
export const NETWORK_SESSION_PARTITION = 'network'

export type NetworkSession = Pick<
  Session,
  'fetch' | 'setProxy' | 'resolveProxy' | 'closeAllConnections'
>

export interface NetworkMainContext {
  namespace: string
  settings: NetworkSettings
  logger: AkariLogger
  mobxUtils: MobxUtilsMain
  electronSession: NetworkSession
}
