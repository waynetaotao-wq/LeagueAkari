import {
  LANE_POSITIONS,
  findMatchupTip
} from '@renderer-shared/components/ongoing-game-panel/widgets/player-info-card/matchup-tips/model'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { AiCoachRenderer } from '@renderer-shared/shards/ai-coach'
import { useAiCoachStore } from '@renderer-shared/shards/ai-coach/store'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { useChampionDataStore } from '@renderer-shared/shards/champion-data/store'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { RankLogRenderer } from '@renderer-shared/shards/rank-log'
import { useRankLogStore } from '@renderer-shared/shards/rank-log/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { RANK_LOG_QUERY_MAX_LIMIT, type RankLogEntryDto, isApexTier } from '@shared/shards/rank-log'
import type { MatchupBuildResult } from '@shared/types/counter-intel'
import type { ChampDetails } from '@shared/types/league-client/game-data'
import { useTranslation } from 'i18next-vue'
import { type MaybeRefOrGetter, computed, shallowRef, toValue, watch } from 'vue'

import { selectReviewBaseline } from './baseline'
import { buildReviewCoachCatalogue } from './coach-catalogue'
import { type ReviewCoachNames, buildReviewCoachContext } from './coach-context'
import { buildReviewCoachForm } from './coach-form'
import {
  REVIEW_COACH_CONTINUE_MESSAGE,
  buildReviewCoachFirstMessage,
  buildReviewCoachSystemPrompt,
  resolveReviewCoachLanguage
} from './coach-prompt'
import { ReviewCoachSessionController, type ReviewCoachTarget } from './coach-session'
import { type ReviewLoadoutStatistics, summarizeReviewLoadoutHistory } from './coach-statistics'
import { ReviewStatisticsLoader, type ReviewStatisticsRequest } from './coach-statistics-loader'
import type { ReviewMatch } from './types'

// [lolps] 对话管理器跟着教练模块本身走，不跟着界面组件走：切换页签、关掉复盘台都不会打断
// 正在写的回答。同段位统计的读取器也是：取过的不用再取。
const controllers = new WeakMap<object, ReviewCoachSessionController>()
const statisticsLoaders = new WeakMap<object, ReviewStatisticsLoader>()
// 英雄的技能说明要一个英雄一个英雄地向客户端要。同一次连接里内容不会变，取过的留着；
// 客户端断开就清掉，下次连上的可能是另一个版本或另一种语言。
const championDetailCaches = new WeakMap<object, Map<number, ChampDetails>>()

/** One champion entry is a small local request; a client that does not answer in time is skipped. */
export const REVIEW_CHAMPION_DETAILS_TIMEOUT_MS = 8000

/** Where the same-rank statistics stand for the game on screen. */
export type ReviewCoachStatisticsStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

/**
 * Everything the coach panel needs for one game: the document that would be sent, what it is
 * built from, the conversation and the actions on it.
 */
export function useReviewCoach(options: {
  model: MaybeRefOrGetter<ReviewMatch>
  /** The same player's other games kept on this device. */
  archive: MaybeRefOrGetter<readonly ReviewMatch[]>
  /** The coach is on screen; the rank log and the statistics are read only then. */
  active: MaybeRefOrGetter<boolean>
}) {
  const coach = useInstance(AiCoachRenderer)
  const storage = useInstance(SettingUtilsRenderer)
  const rankLog = useInstance(RankLogRenderer)
  const championData = useInstance(ChampionDataRenderer)
  const ipc = useInstance(AkariIpcRenderer)
  const lc = useInstance(LeagueClientRenderer)
  const coachStore = useAiCoachStore()
  const rankStore = useRankLogStore()
  const championDataStore = useChampionDataStore()
  const leagueClient = useLeagueClientStore()
  const sgp = useSgpStore()
  const resources = useAkariResourceProvider()
  const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
  const { t: common } = useTranslation()

  let controller = controllers.get(coach)
  if (!controller) {
    controller = new ReviewCoachSessionController(coach, storage)
    controllers.set(coach, controller)
  }
  const sessions = controller
  let statisticsLoader = statisticsLoaders.get(championData)
  if (!statisticsLoader) {
    statisticsLoader = new ReviewStatisticsLoader({
      loadPatches: (query, requestOptions) => championData.loadPatches(query, requestOptions),
      loadDetails: (query, championId, requestOptions) =>
        championData.loadDetails(query, championId, requestOptions),
      loadMatchup: (params) =>
        ipc.call<MatchupBuildResult>(
          CHAMPION_DATA_MAIN_NAMESPACE,
          'counterIntel/matchupBuild',
          params
        )
    })
    statisticsLoaders.set(championData, statisticsLoader)
  }
  const statisticsSource = statisticsLoader

  const model = computed(() => toValue(options.model))
  const self = computed(
    () => !!model.value.meta.puuid && model.value.meta.puuid === leagueClient.summoner.me?.puuid
  )
  const target = computed<ReviewCoachTarget>(() => {
    const { meta } = model.value
    const ownerPuuid = leagueClient.summoner.me?.puuid
    const ownerServerId = sgp.availability.sgpServerId
    return {
      scope:
        ownerPuuid && ownerServerId && meta.puuid && meta.sgpServerId
          ? {
              ownerPuuid,
              ownerServerId,
              targetPuuid: meta.puuid,
              targetServerId: meta.sgpServerId
            }
          : null,
      sgpServerId: meta.sgpServerId,
      gameId: meta.gameId
    }
  })
  const conversation = computed(() => sessions.open(target.value))
  /** The answer of another game is being written; only one request runs at a time. */
  const busyElsewhere = computed(
    () =>
      sessions.activeKey.value !== null && sessions.activeKey.value !== sessions.keyOf(target.value)
  )

  // ── 资料的各个来源 ─────────────────────────────────────────────────────
  const names: ReviewCoachNames = {
    champion: (id) => resources.champions.name(id),
    item: (id) => resources.items.display(id)?.name ?? `装备 ${id}`,
    perk: (id) => resources.perks.name(id),
    spell: (id) => resources.summonerSpells.name(id),
    queue: (id) => resources.queues.name(id)
  }
  // ── 英雄技能说明 ───────────────────────────────────────────────────────
  // 只要本人和敌方五人的：评价符文和出装要看对面有什么，队友的用不上。
  let detailCache = championDetailCaches.get(lc)
  if (!detailCache) {
    detailCache = new Map()
    championDetailCaches.set(lc, detailCache)
  }
  const kitCache = detailCache
  const kitChampionIds = computed(() => {
    const { meta, participants } = model.value
    return [
      ...new Set([
        meta.championId,
        ...participants
          .filter((participant) => participant.teamId !== meta.teamId)
          .map((participant) => participant.championId)
      ])
    ].sort((a, b) => a - b)
  })
  const championDetails = shallowRef<Record<number, ChampDetails>>({})
  const kitsLoading = shallowRef(false)
  let kitsSequence = 0
  watch(
    () =>
      [
        toValue(options.active),
        !!model.value.report,
        leagueClient.isConnected,
        kitChampionIds.value.join(',')
      ] as const,
    async ([active, hasReport, connected]) => {
      const sequence = ++kitsSequence
      const ids = kitChampionIds.value
      if (!connected) kitCache.clear()
      const known = () =>
        Object.fromEntries(
          ids.flatMap((id) => (kitCache.has(id) ? [[id, kitCache.get(id)!] as const] : []))
        )
      championDetails.value = known()
      const missing = ids.filter((id) => !kitCache.has(id))
      kitsLoading.value = false
      // 只在教练页开着、这一局确实能复盘、客户端也连着的时候才去取。
      if (!missing.length || !active || !hasReport || !connected) return

      kitsLoading.value = true
      await Promise.all(
        missing.map(async (id) => {
          try {
            const { data } = await lc.api.gameData.getChampDetails(id, {
              signal: AbortSignal.timeout(REVIEW_CHAMPION_DETAILS_TIMEOUT_MS)
            })
            if (data?.id === id && Array.isArray(data.spells)) kitCache.set(id, data)
          } catch {
            // 取不到就没有这个英雄的技能说明，资料里会写明。
          }
        })
      )
      if (sequence !== kitsSequence) return
      championDetails.value = known()
      kitsLoading.value = false
    },
    { immediate: true }
  )
  /** Every champion whose abilities the document describes has been read. */
  const kitsReady = computed(() => kitChampionIds.value.every((id) => id in championDetails.value))

  /** The client's own texts; null until its game data has loaded (it is empty while offline). */
  const catalogue = computed(() => {
    const { gameData } = leagueClient
    return Object.keys(gameData.perks).length && Object.keys(gameData.perkstyles.styles).length
      ? buildReviewCoachCatalogue({
          perks: gameData.perks,
          styles: gameData.perkstyles.styles,
          items: gameData.items,
          spells: gameData.summonerSpells,
          champions: gameData.champions,
          championDetails: championDetails.value
        })
      : null
  })
  const baseline = computed(() => selectReviewBaseline(model.value, toValue(options.archive)))
  const history = computed(() =>
    summarizeReviewLoadoutHistory(model.value, toValue(options.archive))
  )
  const tips = computed(() => {
    const { meta } = model.value
    const position = LANE_POSITIONS.find((candidate) => candidate === meta.position)
    if (!position || meta.opponentChampionId === null) return []
    return (
      findMatchupTip({
        gameId: meta.gameId,
        championId: meta.championId,
        opponentId: meta.opponentChampionId,
        position
      })?.points ?? []
    )
  })

  function rankText(entry: RankLogEntryDto) {
    if (!entry.tier) return null
    const values = {
      tier: common(`shortTiers.${entry.tier}`, { ns: 'common' }),
      division: entry.division ?? '',
      lp: entry.leaguePoints ?? 0
    }
    const text = isApexTier(entry.tier) ? t('rankLog.apexRank', values) : t('rankLog.rank', values)
    return entry.provisional ? `${text} · ${t('rankLog.provisional')}` : text
  }

  // 上分日志只记登录账号本人，所以近期状态只在看自己的对局时才有。
  const rankEntries = shallowRef<RankLogEntryDto[]>([])
  let rankSequence = 0
  watch(
    () =>
      [
        toValue(options.active),
        self.value,
        model.value.meta.puuid,
        model.value.meta.sgpServerId,
        rankStore.state.available,
        rankStore.state.revision
      ] as const,
    async ([active, isSelf, puuid, sgpServerId, available]) => {
      const sequence = ++rankSequence
      if (!isSelf || !available) {
        rankEntries.value = []
        return
      }
      if (!active) return
      try {
        const entries = await rankLog.queryEntries({
          puuid,
          sgpServerId,
          limit: RANK_LOG_QUERY_MAX_LIMIT
        })
        if (sequence === rankSequence) rankEntries.value = entries
      } catch {
        // 读不到近期状态不影响复盘，资料里会写明没有这一部分。
      }
    },
    { immediate: true }
  )
  const form = computed(() =>
    rankEntries.value.length
      ? buildReviewCoachForm(rankEntries.value, model.value.meta, { now: Date.now(), rankText })
      : null
  )

  // ── 同段位统计 ─────────────────────────────────────────────────────────
  // 地区和段位跟着英雄数据页的筛选走，资料里会写明是哪个地区、哪个段位、哪个版本。
  const statisticsRequest = computed<ReviewStatisticsRequest>(() => {
    const { meta } = model.value
    const { region, tier } = championDataStore.settings.preferences
    return {
      championId: meta.championId,
      opponentChampionId: meta.opponentChampionId,
      position: meta.position,
      patch: meta.patch,
      region,
      tier
    }
  })
  const statistics = shallowRef<ReviewLoadoutStatistics | null>(null)
  const statisticsStatus = shallowRef<ReviewCoachStatisticsStatus>('idle')
  let statisticsAbort: AbortController | null = null
  watch(
    () => [toValue(options.active), !!model.value.report, statisticsRequest.value] as const,
    async ([active, hasReport, request]) => {
      statisticsAbort?.abort()
      statisticsAbort = null
      const known = statisticsSource.peek(request)
      statistics.value = known ?? null
      statisticsStatus.value = known ? 'ready' : 'idle'
      // 只在教练页开着、而且这一局确实能复盘的时候才去取。
      if (known || !active || !hasReport) return

      const abort = new AbortController()
      statisticsAbort = abort
      statisticsStatus.value = 'loading'
      const loaded = await statisticsSource.load(request, abort.signal)
      if (abort.signal.aborted) return
      statistics.value = loaded
      statisticsStatus.value = loaded ? 'ready' : 'unavailable'
    },
    { immediate: true }
  )

  /** The document that would be sent now; null when this game has no full report to build from. */
  const context = computed(() =>
    model.value.report
      ? buildReviewCoachContext({
          match: model.value,
          baseline: baseline.value,
          form: form.value,
          tips: tips.value,
          names,
          catalogue: catalogue.value,
          statistics: statistics.value,
          history: history.value
        })
      : null
  )

  // ── 接口是否填好 ───────────────────────────────────────────────────────
  const configured = computed(() => {
    const { settings, state } = coachStore
    return settings.provider === 'anthropic'
      ? state.hasAnthropicKey && !!settings.anthropicModel.trim()
      : state.hasOpenaiKey && !!settings.openaiBaseUrl.trim() && !!settings.openaiModel.trim()
  })
  const modelName = computed(() =>
    coachStore.settings.provider === 'anthropic'
      ? coachStore.settings.anthropicModel
      : coachStore.settings.openaiModel
  )

  return {
    self,
    conversation,
    busyElsewhere,
    context,
    baseline,
    form,
    tips,
    catalogue,
    kitsReady,
    kitsLoading,
    history,
    statistics,
    statisticsStatus,
    configured,
    modelName,
    start(focus: string) {
      if (!context.value) return Promise.resolve()
      return sessions.start(target.value, {
        system: buildReviewCoachSystemPrompt({
          language: resolveReviewCoachLanguage(resources.runtime.locale),
          self: self.value
        }),
        firstMessage: buildReviewCoachFirstMessage(context.value.text, focus)
      })
    },
    ask: (question: string) => sessions.ask(target.value, question),
    continueAnswer: () => sessions.ask(target.value, REVIEW_COACH_CONTINUE_MESSAGE),
    retry: () => sessions.retry(target.value),
    stop: () => sessions.stop(target.value),
    restore: () => sessions.restore(target.value),
    reset: () => sessions.reset(target.value)
  }
}
