import {
  LANE_POSITIONS,
  findMatchupTip
} from '@renderer-shared/components/ongoing-game-panel/widgets/player-info-card/matchup-tips/model'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { AiCoachRenderer } from '@renderer-shared/shards/ai-coach'
import { useAiCoachStore } from '@renderer-shared/shards/ai-coach/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { RankLogRenderer } from '@renderer-shared/shards/rank-log'
import { useRankLogStore } from '@renderer-shared/shards/rank-log/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { RANK_LOG_QUERY_MAX_LIMIT, type RankLogEntryDto, isApexTier } from '@shared/shards/rank-log'
import { useTranslation } from 'i18next-vue'
import { type MaybeRefOrGetter, computed, shallowRef, toValue, watch } from 'vue'

import { selectReviewBaseline } from './baseline'
import { type ReviewCoachNames, buildReviewCoachContext } from './coach-context'
import { buildReviewCoachForm } from './coach-form'
import {
  REVIEW_COACH_CONTINUE_MESSAGE,
  buildReviewCoachFirstMessage,
  buildReviewCoachSystemPrompt,
  resolveReviewCoachLanguage
} from './coach-prompt'
import { ReviewCoachSessionController, type ReviewCoachTarget } from './coach-session'
import type { ReviewMatch } from './types'

// [lolps] 对话管理器跟着教练模块本身走，不跟着界面组件走：切换页签、关掉复盘台都不会打断
// 正在写的回答。
const controllers = new WeakMap<object, ReviewCoachSessionController>()

/**
 * Everything the coach panel needs for one game: the document that would be sent, what it is
 * built from, the conversation and the actions on it.
 */
export function useReviewCoach(options: {
  model: MaybeRefOrGetter<ReviewMatch>
  /** The same player's other games kept on this device. */
  archive: MaybeRefOrGetter<readonly ReviewMatch[]>
  /** The coach is on screen; the rank log is read only then. */
  active: MaybeRefOrGetter<boolean>
}) {
  const coach = useInstance(AiCoachRenderer)
  const storage = useInstance(SettingUtilsRenderer)
  const rankLog = useInstance(RankLogRenderer)
  const coachStore = useAiCoachStore()
  const rankStore = useRankLogStore()
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
  const baseline = computed(() => selectReviewBaseline(model.value, toValue(options.archive)))
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

  /** The document that would be sent now; null when this game has no full report to build from. */
  const context = computed(() =>
    model.value.report
      ? buildReviewCoachContext({
          match: model.value,
          baseline: baseline.value,
          form: form.value,
          tips: tips.value,
          names
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
