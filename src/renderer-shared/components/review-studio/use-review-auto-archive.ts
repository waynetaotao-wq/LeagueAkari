import { useSgpApiStatus } from '@renderer-shared/composables/useSgpApiStatus'
import { useInstance } from '@renderer-shared/shards'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { useRankLogStore } from '@renderer-shared/shards/rank-log/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { computed, onScopeDispose, watch } from 'vue'

import {
  REVIEW_AUTO_ARCHIVE_CATCH_UP_HISTORY_COUNT,
  REVIEW_AUTO_ARCHIVE_CATCH_UP_MAX_GAMES,
  REVIEW_AUTO_ARCHIVE_HISTORY_COUNT,
  REVIEW_AUTO_ARCHIVE_MAX_GAMES,
  runReviewAutoArchive
} from './auto-archive'
import { type ReviewFetchApi, isReviewAbort } from './data-loader'
import { isReviewCoreItem } from './match-facts'
import { classifyReviewItem } from './match-report'

const NAMESPACE = 'review-auto-archive'
/** 触发后等一会儿再读：一局结束会连着来好几次变化，战绩服务也要几秒才有新对局。 */
const START_DELAY_MS = 8_000
/** 对局结束后没等到上分日志的变化时，隔这么久自己再看一次（非排位对局走这条路）。 */
const AFTER_GAME_DELAY_MS = 60_000
const PLAYING_PHASES: ReadonlySet<string> = new Set(['GameStart', 'InProgress', 'Reconnect'])

/**
 * [lolps] 自动存档：登录账号本人每打完一局能复盘的对局，自动读进本机档案。
 * 只在主窗口里挂一次；开关跟随上分日志的「自动记录」。游戏进行中不读取，免得和游戏抢网络。
 */
export function useReviewAutoArchive() {
  const sgp = useInstance(SgpRenderer)
  const storage = useInstance(SettingUtilsRenderer)
  const logger = useInstance(LoggerRenderer)
  const leagueClient = useLeagueClientStore()
  const sgpStore = useSgpStore()
  const rankLog = useRankLogStore()
  const sgpStatus = useSgpApiStatus()

  const identity = computed(() => {
    const puuid = leagueClient.summoner.me?.puuid
    const sgpServerId = sgpStore.availability.sgpServerId
    return puuid && sgpServerId ? { puuid, sgpServerId } : null
  })
  const identityKey = computed(() =>
    identity.value ? `${identity.value.sgpServerId}:${identity.value.puuid}` : ''
  )
  const isPlaying = computed(() => PLAYING_PHASES.has(leagueClient.gameflow.phase ?? ''))
  const isReady = computed(
    () =>
      rankLog.settings.enabled &&
      identity.value !== null &&
      sgpStatus.value.canUse &&
      sgpStatus.value.isReady &&
      !!sgpStore.leagueServers.servers[identity.value.sgpServerId]?.matchHistory &&
      // 物品库还没加载时读到的对局认不出成装，等它就绪再读。
      Object.keys(leagueClient.gameData.items).length > 0 &&
      !isPlaying.value
  )

  const api: ReviewFetchApi = {
    history: async (target, startIndex, count, signal) =>
      (
        await sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(target.puuid, {
          startIndex,
          count,
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data.games,
    summary: async (target, gameId, signal) =>
      (
        await sgp.api.matchHistoryQuery.getGameSummaryByGameId(gameId, {
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data,
    details: async (target, gameId, signal) =>
      (
        await sgp.api.matchHistoryQuery.getGameDetailsByGameId(gameId, {
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data,
    coreItem: (itemId) => isReviewCoreItem(leagueClient.gameData.items[itemId]),
    itemKind: (itemId) => classifyReviewItem(leagueClient.gameData.items[itemId])
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let isRunning = false
  let isQueued = false
  /** 本次启动里已经补过历史的账号。 */
  let caughtUpKey = ''
  const skipped = new Map<string, Set<number>>()

  function schedule(delay = START_DELAY_MS) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, delay)
  }

  async function run() {
    if (!isReady.value || !identity.value) return
    if (isRunning) {
      isQueued = true
      return
    }

    const target = { ...identity.value }
    const key = identityKey.value
    const isCatchUp = caughtUpKey !== key
    let skippedGames = skipped.get(key)
    if (!skippedGames) skipped.set(key, (skippedGames = new Set()))
    isRunning = true
    controller = new AbortController()
    try {
      const result = await runReviewAutoArchive({
        identity: target,
        scope: {
          ownerPuuid: target.puuid,
          ownerServerId: target.sgpServerId,
          targetPuuid: target.puuid,
          targetServerId: target.sgpServerId
        },
        api,
        storage,
        signal: controller.signal,
        historyCount: isCatchUp
          ? REVIEW_AUTO_ARCHIVE_CATCH_UP_HISTORY_COUNT
          : REVIEW_AUTO_ARCHIVE_HISTORY_COUNT,
        maxGames: isCatchUp
          ? REVIEW_AUTO_ARCHIVE_CATCH_UP_MAX_GAMES
          : REVIEW_AUTO_ARCHIVE_MAX_GAMES,
        skipped: skippedGames
      })
      caughtUpKey = key
      if (result.archived || result.failed) {
        logger.info(
          NAMESPACE,
          `Archived ${result.archived} games, ${result.failed} failed, ${result.remaining} left`
        )
      }
      // 还有没读完的就接着读，直到补齐。
      if (result.remaining > 0 && result.archived > 0) isQueued = true
    } catch (error) {
      if (!isReviewAbort(error)) {
        logger.warn(NAMESPACE, `Auto archive did not finish: ${(error as Error)?.message ?? error}`)
      }
    } finally {
      isRunning = false
      controller = null
      if (isQueued) {
        isQueued = false
        schedule()
      }
    }
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
    isQueued = false
    controller?.abort()
  }

  // 条件就绪、账号变化、上分日志记下新对局：都去看一眼有没有要存的。
  watch(
    () => [isReady.value, identityKey.value, rankLog.state.revision] as const,
    ([ready], previous) => {
      if (previous && previous[1] !== identityKey.value) stop()
      if (ready) schedule()
      else stop()
    },
    { immediate: true }
  )
  watch(isPlaying, (playing, wasPlaying) => {
    if (wasPlaying && !playing && isReady.value) schedule(AFTER_GAME_DELAY_MS)
  })
  onScopeDispose(stop)
}
