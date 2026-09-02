import { createManager } from '@renderer-shared/shards'
import { AkariApiRenderer } from '@renderer-shared/shards/akari-api'
import { AkariProtocolRenderer } from '@renderer-shared/shards/akari-protocol'
import { AppCommonRenderer } from '@renderer-shared/shards/app-common'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { ExtraAssetsRenderer } from '@renderer-shared/shards/extra-assets'
import { FeatureGatingRenderer } from '@renderer-shared/shards/feature-gating'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import {
  LeagueClientRenderer,
  LeagueClientRendererConfig
} from '@renderer-shared/shards/league-client'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { MatchRatingRenderer } from '@renderer-shared/shards/match-rating'
import { PiniaMobxUtilsRenderer } from '@renderer-shared/shards/pinia-mobx-utils'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SetupInAppScopeRenderer } from '@renderer-shared/shards/setup-in-app-scope'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'

const manager = createManager()

manager.use(AkariIpcRenderer)
manager.use(AkariApiRenderer)
manager.use(AkariProtocolRenderer)
manager.use(AppCommonRenderer)
manager.use(ChampionDataRenderer)
manager.use(ExtraAssetsRenderer)
manager.use(FeatureGatingRenderer)
manager.use(LeagueClientRenderer, {
  subscribeState: {
    gameData: true,
    gameflow: true,
    summoner: true,
    champSelect: false,
    chat: false,
    matchmaking: false,
    lobby: false,
    login: false,
    honor: false
  }
} as LeagueClientRendererConfig)
manager.use(LoggerRenderer)
manager.use(MatchRatingRenderer)
manager.use(PiniaMobxUtilsRenderer)
manager.use(SettingUtilsRenderer)
manager.use(SetupInAppScopeRenderer)
manager.use(SgpRenderer)
manager.use(WindowManagerRenderer)

export { manager }
