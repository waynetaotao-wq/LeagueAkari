<template>
  <div class="report-view">
    <NText depth="3" class="text-xs">{{ t('report.hint') }}</NText>
    <NAlert v-if="!report.complete" type="warning" :show-icon="false">{{
      t('report.incomplete')
    }}</NAlert>
    <NCollapse v-model:expanded-names="expanded">
      <NCollapseItem name="scoreboard" :title="t('report.scoreboard.title')">
        <div class="report-section">
          <NText v-if="!opponent" depth="3" class="text-xs">{{ t('report.noOpponent') }}</NText>
          <div class="report-table" role="table" :aria-label="t('report.scoreboard.title')">
            <div class="report-row score-row report-header" role="row">
              <div role="columnheader">{{ t('report.scoreboard.metric') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.own') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.opponent') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.teamShare') }}</div>
            </div>
            <div v-for="row in scoreRows" :key="row.id" class="report-row score-row" role="row">
              <div role="cell">{{ t(`report.scoreboard.${row.id}`) }}</div>
              <div role="cell" class="font-medium">{{ row.own }}</div>
              <div role="cell">{{ row.opponent }}</div>
              <div role="cell">{{ row.share }}</div>
            </div>
          </div>
          <NText strong class="text-xs">{{ t('report.scoreboard.players') }}</NText>
          <div class="report-table" role="table" :aria-label="t('report.scoreboard.players')">
            <div class="report-row player-row report-header" role="row">
              <div role="columnheader">{{ t('report.scoreboard.champion') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.kda') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.cs') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.gold') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.damage') }}</div>
              <div role="columnheader">{{ t('report.scoreboard.vision') }}</div>
            </div>
            <div
              v-for="player in orderedPlayers"
              :key="player.participantId"
              class="report-row player-row"
              :class="{
                'own-row': player.participantId === model.meta.participantId,
                'enemy-row': player.teamId !== model.meta.teamId
              }"
              role="row"
            >
              <div role="cell" class="champion-cell">
                <ChampionIcon :champion-id="player.championId" class="size-6! shrink-0 rounded" />
                <span class="truncate">{{ resources.champions.name(player.championId) }}</span>
                <NText depth="3" class="text-xs">{{
                  REVIEW_POSITION_LABELS[player.position]
                }}</NText>
              </div>
              <div role="cell">{{ kda(player) }}</div>
              <div role="cell">{{ amount(player.cs) }}</div>
              <div role="cell">{{ amount(player.gold) }}</div>
              <div role="cell">{{ amount(player.damage) }}</div>
              <div role="cell">{{ amount(player.visionScore) }}</div>
            </div>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem name="laning" :title="t('report.laning.title')">
        <div class="report-section">
          <div>
            <NText strong class="text-xs">{{ t('report.laning.checkpoints') }}</NText>
            <div class="report-hint">{{ t('report.laning.checkpointsHint') }}</div>
          </div>
          <div class="report-table" role="table" :aria-label="t('report.laning.checkpoints')">
            <div class="report-row checkpoint-row report-header" role="row">
              <div role="columnheader">{{ t('minute') }}</div>
              <div role="columnheader">{{ t('report.laning.gold') }}</div>
              <div role="columnheader">{{ t('report.laning.cs') }}</div>
              <div role="columnheader">{{ t('report.laning.xp') }}</div>
              <div role="columnheader">{{ t('report.laning.level') }}</div>
              <div role="columnheader">{{ t('report.laning.teamGold') }}</div>
            </div>
            <div
              v-for="checkpoint in report.checkpoints"
              :key="checkpoint.minute"
              class="report-row checkpoint-row"
              role="row"
            >
              <div role="cell">
                <NButton
                  v-if="checkpoint.timestamp !== null"
                  size="tiny"
                  secondary
                  @click="emit('timeline', checkpoint.timestamp)"
                  >{{ t('report.laning.minute', { minute: checkpoint.minute }) }} ↗</NButton
                ><NText v-else depth="3" class="text-xs"
                  >{{ t('report.laning.minute', { minute: checkpoint.minute }) }} ·
                  {{ t('missing') }}</NText
                >
              </div>
              <div
                v-for="(value, index) in [
                  checkpoint.goldDiff,
                  checkpoint.csDiff,
                  checkpoint.xpDiff,
                  checkpoint.levelDiff,
                  checkpoint.teamGoldDiff
                ]"
                :key="index"
                role="cell"
              >
                <NText :type="reviewValueTone(value)">{{ reviewSigned(value) }}</NText>
              </div>
            </div>
          </div>
          <template v-if="levelRows.length">
            <NText strong class="text-xs">{{ t('report.laning.levels') }}</NText>
            <div class="report-table" role="table" :aria-label="t('report.laning.levels')">
              <div class="report-row level-row report-header" role="row">
                <div role="columnheader">{{ t('report.laning.levelColumn') }}</div>
                <div role="columnheader">{{ t('report.laning.ownTime') }}</div>
                <div role="columnheader">{{ t('report.laning.opponentTime') }}</div>
                <div role="columnheader">{{ t('report.laning.lead') }}</div>
              </div>
              <div
                v-for="row in levelRows"
                :key="row.level"
                class="report-row level-row"
                role="row"
              >
                <div role="cell">{{ row.level }}</div>
                <div role="cell">{{ row.own === null ? '—' : reviewClock(row.own) }}</div>
                <div role="cell">{{ row.opponent === null ? '—' : reviewClock(row.opponent) }}</div>
                <div role="cell">
                  <NText :type="row.tone">{{ row.lead }}</NText>
                </div>
              </div>
            </div>
          </template>
        </div>
      </NCollapseItem>

      <NCollapseItem name="build" :title="t('report.build.title')">
        <div class="report-section">
          <div class="build-block">
            <NText strong class="text-xs">{{ t('report.build.coreItems') }}</NText>
            <NText v-if="!catalogueKnown" depth="3" class="text-xs">{{
              t('report.build.noCatalogue')
            }}</NText>
            <NText v-else-if="!report.build.coreItems.length" depth="3" class="text-xs">{{
              t('report.build.noCore')
            }}</NText>
            <div v-else class="item-line">
              <div v-for="(item, index) in report.build.coreItems" :key="index" class="timed-item">
                <ItemDisplay :item-id="item.itemId" :size="28" />
                <NButton size="tiny" quaternary @click="emit('timeline', item.timestamp)">{{
                  reviewClock(item.timestamp)
                }}</NButton>
              </div>
              <div v-if="report.build.boots" class="timed-item">
                <ItemDisplay :item-id="report.build.boots.itemId" :size="28" />
                <NButton
                  size="tiny"
                  quaternary
                  @click="emit('timeline', report.build.boots.timestamp)"
                  >{{ t('report.build.boots') }}
                  {{ reviewClock(report.build.boots.timestamp) }}</NButton
                >
              </div>
            </div>
          </div>
          <div class="build-block">
            <NText strong class="text-xs">{{ t('report.build.visits') }}</NText>
            <div class="visit-list">
              <div v-for="visit in visitRows" :key="visit.timestamp" class="visit-row">
                <NButton size="tiny" secondary @click="emit('timeline', visit.timestamp)"
                  >{{ reviewClock(visit.timestamp) }} ↗</NButton
                >
                <NTag size="small" :bordered="false" :type="visit.tone">{{ visit.label }}</NTag>
                <div class="item-line">
                  <ItemDisplay
                    v-for="(itemId, index) in visit.itemIds"
                    :key="index"
                    :item-id="itemId"
                    :size="22"
                  />
                </div>
              </div>
            </div>
            <div v-if="report.build.sales.length" class="visit-row">
              <NText depth="3" class="text-xs">{{ t('report.build.sales') }}</NText>
              <div class="item-line">
                <div v-for="(sale, index) in report.build.sales" :key="index" class="timed-item">
                  <ItemDisplay :item-id="sale.itemId" :size="22" />
                  <NText depth="3" class="text-xs">{{ reviewClock(sale.timestamp) }}</NText>
                </div>
              </div>
            </div>
          </div>
          <div class="build-block">
            <NText strong class="text-xs">{{ t('report.build.skills') }}</NText>
            <div class="skill-line">
              <span
                v-for="(skill, index) in report.build.skills"
                :key="index"
                class="skill-chip"
                :class="`skill-${skill.slot}`"
                :title="reviewClock(skill.timestamp)"
                >{{ SKILL_KEYS[skill.slot - 1] }}</span
              >
            </div>
            <NText class="text-xs"
              >{{ t('report.build.skillPriority') }}：{{
                report.build.skillPriority
                  ? report.build.skillPriority.map((slot) => SKILL_KEYS[slot - 1]).join(' > ')
                  : t('report.build.skillPriorityUnknown')
              }}</NText
            >
            <NText v-if="own" depth="3" class="text-xs"
              >{{ t('report.build.abilityCasts') }}：Q {{ amount(own.casts.q) }} · W
              {{ amount(own.casts.w) }} · E {{ amount(own.casts.e) }} · R
              {{ amount(own.casts.r) }}</NText
            >
          </div>
          <div v-if="own" class="build-block">
            <NText strong class="text-xs">{{ t('report.build.runes') }}</NText>
            <div v-if="own.runes" class="item-line">
              <PerkDisplay
                v-for="(perk, index) in own.runes.perks"
                :key="perk"
                :perk-id="perk"
                :size="index === 0 ? 30 : 22"
              />
            </div>
            <NText v-else depth="3" class="text-xs">—</NText>
            <NText strong class="text-xs">{{ t('report.build.spells') }}</NText>
            <div class="item-line">
              <div v-for="(spell, index) in own.summonerSpells" :key="spell" class="timed-item">
                <SummonerSpellDisplay :spell-id="spell" :size="24" />
                <NText depth="3" class="text-xs">{{
                  t('report.build.casts', {
                    count: (index === 0 ? own.casts.summoner1 : own.casts.summoner2) ?? 0
                  })
                }}</NText>
              </div>
            </div>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem
        name="takedowns"
        :title="`${t('report.takedowns.title')} · ${report.takedowns.length}`"
      >
        <NText v-if="!report.takedowns.length" depth="3" class="text-xs">{{
          t('report.takedowns.empty')
        }}</NText>
        <div v-else class="event-list">
          <div v-for="(takedown, index) in report.takedowns" :key="index" class="event-row">
            <NButton size="tiny" secondary @click="emit('timeline', takedown.timestamp)"
              >{{ reviewClock(takedown.timestamp) }} ↗</NButton
            >
            <ChampionIcon :champion-id="takedown.victim.championId" class="size-6! rounded" />
            <span class="event-main">{{
              resources.champions.name(takedown.victim.championId)
            }}</span>
            <NTag size="small" :bordered="false" :type="takedown.kill ? 'success' : 'default'">{{
              t(takedown.kill ? 'report.takedowns.kill' : 'report.takedowns.assist')
            }}</NTag>
            <NTag v-if="takedown.firstBlood" size="small" :bordered="false" type="warning">{{
              t('report.takedowns.firstBlood')
            }}</NTag>
            <NText depth="3" class="text-xs">{{
              takedown.kill && takedown.allies === 0
                ? t('report.takedowns.solo')
                : t('report.takedowns.withAllies', { count: takedown.allies })
            }}</NText>
            <NText v-if="takedown.kill && takedown.bounty !== null" depth="3" class="text-xs">{{
              t('report.takedowns.gold', { gold: amount(takedown.bounty) })
            }}</NText>
            <NText
              v-if="takedown.kill && takedown.shutdownBounty"
              depth="3"
              class="text-xs"
              type="warning"
              >{{
                t('report.takedowns.shutdown', { gold: amount(takedown.shutdownBounty) })
              }}</NText
            >
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem name="deaths" :title="`${t('report.deaths.title')} · ${deathRows.length}`">
        <NText v-if="!deathRows.length" depth="3" class="text-xs">{{
          t('report.deaths.empty')
        }}</NText>
        <div v-else class="report-section">
          <div class="report-hint">{{ t('report.deaths.sourcesHint') }}</div>
          <div v-for="row in deathRows" :key="row.detail.timestamp" class="death-card">
            <div class="event-row">
              <NButton size="tiny" secondary @click="emit('timeline', row.detail.timestamp)"
                >{{ reviewClock(row.detail.timestamp) }} ↗</NButton
              >
              <ChampionIcon
                v-if="row.death?.killer"
                :champion-id="row.death.killer.championId"
                class="size-6! rounded"
              />
              <span class="event-main">{{ row.title }}</span>
              <NTag
                size="small"
                :bordered="false"
                :type="row.detail.fight === null ? 'default' : 'info'"
                >{{
                  t(row.detail.fight === null ? 'report.deaths.isolated' : 'report.deaths.inFight')
                }}</NTag
              >
              <NText
                v-if="row.detail.level !== null && row.detail.killerLevel !== null"
                depth="3"
                class="text-xs"
                >{{
                  t('report.deaths.levels', {
                    own: row.detail.level,
                    killer: row.detail.killerLevel
                  })
                }}</NText
              >
              <NText v-if="row.detail.damageTaken !== null" depth="3" class="text-xs">{{
                t('report.deaths.damageTaken', { damage: amount(row.detail.damageTaken) })
              }}</NText>
              <NText v-if="row.detail.damageDealt !== null" depth="3" class="text-xs">{{
                t('report.deaths.damageDealt', { damage: amount(row.detail.damageDealt) })
              }}</NText>
              <NText v-if="row.gold !== null" depth="3" class="text-xs">{{
                t('report.deaths.gaveGold', { gold: amount(row.gold) })
              }}</NText>
            </div>
            <div v-if="row.detail.sources.length" class="source-list">
              <div v-for="(source, index) in row.detail.sources" :key="index" class="source-row">
                <div class="champion-cell">
                  <ChampionIcon
                    v-if="source.championId !== null"
                    :champion-id="source.championId"
                    class="size-5! shrink-0 rounded"
                  />
                  <span class="truncate">{{
                    source.championId !== null
                      ? resources.champions.name(source.championId)
                      : t(`report.deaths.sourceKinds.${source.kind}`)
                  }}</span>
                </div>
                <div class="source-bar" aria-hidden="true">
                  <span
                    class="source-fill"
                    :style="{
                      width: `${row.detail.damageTaken ? (source.total / row.detail.damageTaken) * 100 : 0}%`
                    }"
                  />
                </div>
                <strong class="source-total">{{ amount(source.total) }}</strong>
                <NText depth="3" class="text-xs">{{ slotText(source) }}</NText>
              </div>
            </div>
            <NText v-if="row.detail.objectivesAfter.length" depth="3" class="text-xs">{{
              t('report.deaths.objectivesAfter', {
                objectives: objectiveNames(row.detail.objectivesAfter)
              })
            }}</NText>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem
        name="objectives"
        :title="`${t('report.objectives.title')} · ${report.objectives.length}`"
      >
        <NText v-if="!report.objectives.length" depth="3" class="text-xs">{{
          t('report.objectives.empty')
        }}</NText>
        <div v-else class="event-list">
          <div v-for="(objective, index) in report.objectives" :key="index" class="event-row">
            <NButton size="tiny" secondary @click="emit('timeline', objective.timestamp)"
              >{{ reviewClock(objective.timestamp) }} ↗</NButton
            >
            <NTag
              size="small"
              :bordered="false"
              :type="objective.own === null ? 'default' : objective.own ? 'success' : 'error'"
              >{{
                t(
                  objective.own === null
                    ? 'report.objectives.unassigned'
                    : objective.own
                      ? 'report.objectives.own'
                      : 'report.objectives.enemy'
                )
              }}</NTag
            >
            <span class="event-main">{{ objectiveName(objective) }}</span>
            <NTag v-if="objective.credited" size="small" :bordered="false" type="info">{{
              t('report.objectives.credited')
            }}</NTag>
            <NText v-if="objective.sinceDeath !== null" class="text-xs" type="warning">{{
              t('report.objectives.sinceDeath', {
                seconds: Math.round(objective.sinceDeath / 1000)
              })
            }}</NText>
            <NText
              v-if="objective.distance !== null && objective.snapshotOffset !== null"
              depth="3"
              class="text-xs"
              :title="
                t('report.objectives.distanceHint', {
                  distance: amount(objective.distance),
                  seconds: Math.round(Math.abs(objective.snapshotOffset) / 1000),
                  direction: t(
                    objective.snapshotOffset <= 0
                      ? 'report.objectives.before'
                      : 'report.objectives.after'
                  )
                })
              "
              >{{ t(`report.objectives.proximity.${proximity(objective.distance)}`) }}</NText
            >
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem name="fights" :title="`${t('report.fights.title')} · ${report.fights.length}`">
        <div class="report-section">
          <div class="report-hint">{{ t('report.fights.hint') }}</div>
          <NText v-if="!report.fights.length" depth="3" class="text-xs">{{
            t('report.fights.empty')
          }}</NText>
          <div v-else class="event-list">
            <div v-for="(fight, index) in report.fights" :key="index" class="event-row">
              <NButton size="tiny" secondary @click="emit('timeline', fight.start)"
                >{{ reviewClock(fight.start)
                }}<template v-if="fight.end !== fight.start"
                  >–{{ reviewClock(fight.end) }}</template
                >
                ↗</NButton
              >
              <NTag
                size="small"
                :bordered="false"
                :type="
                  fight.kills > fight.deaths
                    ? 'success'
                    : fight.kills < fight.deaths
                      ? 'error'
                      : 'default'
                "
                >{{ t('report.fights.score', { kills: fight.kills, deaths: fight.deaths }) }}</NTag
              >
              <NText depth="3" class="text-xs">{{
                t('report.fights.sides', { allies: fight.allies, enemies: fight.enemies })
              }}</NText>
              <span class="event-main">{{ fightOwnText(fight) }}</span>
              <NText v-if="fight.objectivesAfter.length" depth="3" class="text-xs">{{
                t('report.fights.objectivesAfter', {
                  objectives: objectiveNames(fight.objectivesAfter, true)
                })
              }}</NText>
            </div>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem name="vision" :title="t('report.vision.title')">
        <div class="report-section">
          <div class="report-hint">{{ t('report.vision.hint') }}</div>
          <div class="report-table" role="table" :aria-label="t('report.vision.title')">
            <div class="report-row vision-row report-header" role="row">
              <div role="columnheader">{{ t('report.vision.phase') }}</div>
              <div role="columnheader">{{ t('report.vision.placed') }}</div>
              <div role="columnheader">{{ t('report.vision.cleared') }}</div>
            </div>
            <div v-for="row in visionRows" :key="row.id" class="report-row vision-row" role="row">
              <div role="cell">{{ t(`report.vision.${row.id}`) }}</div>
              <div role="cell">
                <strong>{{ row.placed }}</strong>
                <NText v-if="row.breakdown" depth="3" class="text-xs"> · {{ row.breakdown }}</NText>
              </div>
              <div role="cell">{{ row.cleared }}</div>
            </div>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem name="challenges" :title="t('report.challenges.title')">
        <div class="report-section">
          <div class="report-hint">{{ t('report.challenges.hint') }}</div>
          <NText v-if="!challengeRows.length" depth="3" class="text-xs">{{
            t('report.challenges.empty')
          }}</NText>
          <div v-else class="challenge-grid">
            <div v-for="row in challengeRows" :key="row.key" class="challenge-item">
              <span class="report-hint">{{ t(`report.challenges.keys.${row.key}`) }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import ItemDisplay from '@renderer-shared/components/widgets/ItemDisplay.vue'
import PerkDisplay from '@renderer-shared/components/widgets/PerkDisplay.vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCollapse, NCollapseItem, NTag, NText } from 'naive-ui'
import { computed, ref } from 'vue'

import { REVIEW_FIRST_SHOP_AFTER_MS } from './match-facts'
import { REVIEW_CHALLENGE_KEYS } from './match-report'
import { REVIEW_POSITION_LABELS, reviewClock, reviewPercent, reviewSigned } from './review-display'
import { reviewValueTone } from './review-insights'
import type {
  ReviewDamageSlots,
  ReviewDamageSource,
  ReviewFight,
  ReviewMatch,
  ReviewObjective,
  ReviewPlayerLine,
  ReviewPosition,
  ReviewReport
} from './types'

const props = defineProps<{
  /** A freshly parsed match; the parent renders this panel only when `model.report` exists. */
  model: ReviewMatch
}>()
const emit = defineEmits<{ timeline: [timestamp: number] }>()
const resources = useAkariResourceProvider()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })

const SKILL_KEYS = ['Q', 'W', 'E', 'R'] as const
const ROLE_ORDER: ReviewPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN']
const LEVEL_MILESTONES = [2, 3, 6, 11, 16]
const SLOT_ORDER: Array<keyof ReviewDamageSlots> = [
  'q',
  'w',
  'e',
  'r',
  'basic',
  'passive',
  'summoner',
  'other'
]
const TEN_MINUTES_MS = 10 * 60_000
const TWENTY_MINUTES_MS = 20 * 60_000
/** 地图约 15000 单位宽：3000 以内算在附近，7000 以外算很远。只用于显示。 */
const OBJECTIVE_NEAR_DISTANCE = 3000
const OBJECTIVE_FAR_DISTANCE = 7000

const expanded = ref<string[]>(['scoreboard', 'laning'])
const report = computed<ReviewReport>(() => props.model.report!)
const line = (participantId: number | null) =>
  participantId === null
    ? null
    : (report.value.players.find((player) => player.participantId === participantId) ?? null)
const own = computed(() => line(props.model.meta.participantId))
const opponent = computed(() => line(props.model.meta.opponentId))
const minutes = computed(() => props.model.meta.gameDuration / 60)

const amount = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString()
const duration = (seconds: number) =>
  seconds >= 60
    ? t('outcomeGap.duration', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
    : t('outcomeGap.durationSeconds', { seconds })
/** Rough reading of a snapshot distance; the thresholds are display rules, not game rules. */
const proximity = (distance: number) =>
  distance <= OBJECTIVE_NEAR_DISTANCE ? 'near' : distance <= OBJECTIVE_FAR_DISTANCE ? 'away' : 'far'
const kda = (player: ReviewPlayerLine | null) =>
  player && player.kills !== null && player.deaths !== null && player.assists !== null
    ? `${player.kills} / ${player.deaths} / ${player.assists}`
    : '—'

const scoreRows = computed(() => {
  const perMinute = (value: number | null | undefined) =>
    value == null || minutes.value <= 0 ? '—' : (value / minutes.value).toFixed(1)
  const pair = (a: number | null | undefined, b: number | null | undefined) =>
    a == null && b == null ? '—' : `${amount(a)} / ${amount(b)}`
  const seconds = (value: number | null | undefined) =>
    value == null ? '—' : reviewClock(value * 1000)
  const unspent = (player: ReviewPlayerLine | null) =>
    player?.gold != null && player.goldSpent != null && player.gold >= player.goldSpent
      ? amount(player.gold - player.goldSpent)
      : '—'
  const a = own.value
  const b = opponent.value
  return [
    { id: 'kda', own: kda(a), opponent: kda(b), share: '' },
    {
      id: 'killParticipation',
      own: reviewPercent(a?.killParticipation),
      opponent: reviewPercent(b?.killParticipation),
      share: ''
    },
    { id: 'level', own: amount(a?.level), opponent: amount(b?.level), share: '' },
    { id: 'cs', own: amount(a?.cs), opponent: amount(b?.cs), share: '' },
    { id: 'csPerMinute', own: perMinute(a?.cs), opponent: perMinute(b?.cs), share: '' },
    {
      id: 'gold',
      own: amount(a?.gold),
      opponent: amount(b?.gold),
      share: reviewPercent(a?.goldShare)
    },
    {
      id: 'damage',
      own: amount(a?.damage),
      opponent: amount(b?.damage),
      share: reviewPercent(a?.damageShare)
    },
    {
      id: 'damageTaken',
      own: amount(a?.damageTaken),
      opponent: amount(b?.damageTaken),
      share: reviewPercent(a?.damageTakenShare)
    },
    { id: 'visionScore', own: amount(a?.visionScore), opponent: amount(b?.visionScore), share: '' },
    {
      id: 'wards',
      own: pair(a?.wardsPlaced, a?.wardsKilled),
      opponent: pair(b?.wardsPlaced, b?.wardsKilled),
      share: ''
    },
    {
      id: 'controlWards',
      own: amount(a?.controlWardsBought),
      opponent: amount(b?.controlWardsBought),
      share: ''
    },
    { id: 'timeDead', own: seconds(a?.secondsDead), opponent: seconds(b?.secondsDead), share: '' },
    { id: 'unspentGold', own: unspent(a), opponent: unspent(b), share: '' }
  ]
})

const orderedPlayers = computed(() =>
  [...report.value.players].sort(
    (a, b) =>
      Number(a.teamId !== props.model.meta.teamId) - Number(b.teamId !== props.model.meta.teamId) ||
      ROLE_ORDER.indexOf(a.position) - ROLE_ORDER.indexOf(b.position) ||
      a.participantId - b.participantId
  )
)

const levelRows = computed(() =>
  report.value.levels
    .filter((timing) => LEVEL_MILESTONES.includes(timing.level))
    .map((timing) => {
      const lead =
        timing.own !== null && timing.opponent !== null
          ? Math.round((timing.opponent - timing.own) / 1000)
          : null
      return {
        ...timing,
        lead:
          lead === null
            ? '—'
            : lead > 0
              ? t('report.laning.leadAhead', { time: duration(lead) })
              : lead < 0
                ? t('report.laning.leadBehind', { time: duration(-lead) })
                : t('report.laning.leadEven'),
        tone: reviewValueTone(lead)
      }
    })
)

const catalogueKnown = computed(() =>
  report.value.build.purchases.every((purchase) => purchase.kind !== null)
)
const visitRows = computed(() =>
  report.value.build.visits.map((visit, index) => {
    const opening = index === 0 && visit.timestamp < REVIEW_FIRST_SHOP_AFTER_MS
    return {
      ...visit,
      label: t(
        opening
          ? 'report.build.visitOpening'
          : visit.afterDeath
            ? 'report.build.visitAfterDeath'
            : 'report.build.visitRecall'
      ),
      tone: (opening ? 'default' : visit.afterDeath ? 'error' : 'info') as
        'default' | 'error' | 'info'
    }
  })
)

const deathRows = computed(() =>
  report.value.deaths.map((detail, index) => {
    const death = props.model.deaths?.[index] ?? null
    const bounty = detail.bounty ?? null
    const shutdown = death?.shutdownBounty ?? null
    return {
      detail,
      death,
      title: death?.killer
        ? t('report.deaths.killedBy', { killer: resources.champions.name(death.killer.championId) })
        : t('report.deaths.executed'),
      gold: bounty === null && shutdown === null ? null : (bounty ?? 0) + (shutdown ?? 0)
    }
  })
)

function slotText(source: ReviewDamageSource) {
  return SLOT_ORDER.filter((slot) => source.slots[slot] > 0)
    .map((slot) => `${t(`report.deaths.slots.${slot}`)} ${amount(source.slots[slot])}`)
    .join(' · ')
}

/** Word order and spacing live in the locale files; unknown raw values fall back to the kind. */
function objectiveName(objective: ReviewObjective) {
  const detail = objective.detail
    ? t(`report.objectives.details.${objective.detail}`, { defaultValue: '' })
    : ''
  const lane = objective.lane
    ? t(`report.objectives.lanes.${objective.lane}`, { defaultValue: '' })
    : ''
  const kind = t(`report.objectives.kinds.${objective.kind}`)
  if (objective.kind === 'tower' && lane && detail)
    return t('report.objectives.towerName', { lane, tier: detail })
  if (objective.kind === 'inhibitor' && lane) return t('report.objectives.inhibitorName', { lane })
  if (objective.kind === 'dragon' && detail)
    return t('report.objectives.dragonName', { element: detail })
  if (objective.kind === 'other' && objective.detail)
    return t('report.objectives.otherName', { raw: objective.detail })
  return kind
}

function objectiveNames(indexes: number[], withSide = false) {
  return indexes
    .map((index) => report.value.objectives[index])
    .filter((objective): objective is ReviewObjective => !!objective)
    .map((objective) =>
      withSide && objective.own !== null
        ? t('report.objectives.sideName', {
            side: t(objective.own ? 'report.objectives.own' : 'report.objectives.enemy'),
            name: objectiveName(objective)
          })
        : objectiveName(objective)
    )
    .join(t('report.objectives.separator'))
}

function fightOwnText(fight: ReviewFight) {
  if (fight.ownKills + fight.ownAssists === 0 && fight.ownDeathOrder === null)
    return t('report.fights.absent')
  return `${t('report.fights.own', { kills: fight.ownKills, assists: fight.ownAssists })} · ${
    fight.ownDeathOrder === null
      ? t('report.fights.survived')
      : t('report.fights.deathOrder', { order: fight.ownDeathOrder })
  }`
}

const visionRows = computed(() => {
  const phases = [
    { id: 'early', from: 0, to: TEN_MINUTES_MS },
    { id: 'middle', from: TEN_MINUTES_MS, to: TWENTY_MINUTES_MS },
    { id: 'late', from: TWENTY_MINUTES_MS, to: Infinity },
    { id: 'total', from: 0, to: Infinity }
  ]
  return phases.map((phase) => {
    const within = <T extends { timestamp: number }>(events: T[]) =>
      events.filter((event) => event.timestamp >= phase.from && event.timestamp < phase.to)
    const placed = within(report.value.vision.placed)
    const types = new Map<string, number>()
    for (const ward of placed) types.set(ward.wardType, (types.get(ward.wardType) ?? 0) + 1)
    return {
      id: phase.id,
      placed: placed.length,
      breakdown: [...types]
        .map(
          ([type, count]) =>
            `${t(`report.vision.wardTypes.${type}`, { defaultValue: type })} ${count}`
        )
        .join(' · '),
      cleared: within(report.value.vision.cleared).length
    }
  })
})

const challengeRows = computed(() => {
  const challenges = own.value?.challenges
  if (!challenges) return []
  return REVIEW_CHALLENGE_KEYS.filter((key) => key in challenges).map((key) => {
    const value = challenges[key]
    return {
      key,
      value: Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
    }
  })
})
</script>

<style scoped>
.report-view,
.report-section,
.build-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}
.report-view {
  gap: 14px;
}
.build-block {
  gap: 8px;
}
.report-hint {
  font-size: 12px;
  opacity: 0.68;
  line-height: 1.7;
}
.report-table {
  overflow-x: auto;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 8px;
}
.report-row {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.report-row + .report-row {
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
}
.report-header {
  background: rgb(var(--la-card-tint-rgb) / 0.04);
  font-size: 12px;
}
.score-row {
  grid-template-columns: 1.4fr 1fr 1fr 0.8fr;
  min-width: 460px;
}
.player-row {
  grid-template-columns: minmax(170px, 1.8fr) 1fr 0.6fr 0.8fr 0.8fr 0.5fr;
  min-width: 620px;
}
.checkpoint-row {
  grid-template-columns: 1.1fr repeat(5, 1fr);
  min-width: 600px;
}
.level-row {
  grid-template-columns: 0.6fr 1fr 1fr 1.2fr;
  min-width: 420px;
}
.vision-row {
  grid-template-columns: 0.8fr 2fr 0.6fr;
  min-width: 460px;
}
.own-row {
  background: rgb(var(--la-card-tint-rgb) / 0.07);
  font-weight: 600;
}
.enemy-row {
  opacity: 0.86;
}
.champion-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.item-line,
.skill-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.timed-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.visit-list,
.event-list,
.source-list {
  display: flex;
  flex-direction: column;
}
.visit-row,
.event-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  font-size: 13px;
}
.visit-row + .visit-row,
.event-row + .event-row {
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
}
.event-main {
  font-weight: 500;
}
.skill-chip {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgb(var(--la-card-tint-rgb) / 0.08);
  font-size: 12px;
  font-weight: 600;
}
.skill-4 {
  background: rgb(214 158 46 / 0.28);
}
.death-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 8px;
}
.death-card .event-row {
  padding: 0;
}
.source-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(80px, 1.2fr) 56px minmax(0, 3fr);
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
}
.source-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: rgb(var(--la-card-tint-rgb) / 0.08);
}
.source-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: rgb(255 96 96 / 0.85);
}
.source-total {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.challenge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}
.challenge-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
  border-radius: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
</style>
