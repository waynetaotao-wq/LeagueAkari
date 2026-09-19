<template>
  <section class="draft-advice" :aria-label="t('ongoingGame.flexDraft.title')">
    <div class="draft-header">
      <div class="draft-heading">
        <span class="draft-mark">BP</span>
        <div>
          <strong>{{ t('ongoingGame.flexDraft.title') }}</strong>
          <div class="draft-muted">
            {{ t('ongoingGame.flexDraft.samples', { players: loadedPlayers }) }}
          </div>
        </div>
      </div>
      <div class="draft-controls">
        <NSelect
          :value="selectedRole"
          :options="roleOptions"
          size="small"
          clearable
          :placeholder="
            role ? t(`ongoingGame.flexDraft.roles.${role}`) : t('ongoingGame.flexDraft.chooseRole')
          "
          :aria-label="t('ongoingGame.flexDraft.chooseRole')"
          @update:value="emit('update:selectedRole', $event)"
        />
        <NSelect
          :value="selectedOpponent"
          :options="opponentOptions"
          size="small"
          clearable
          :placeholder="targetLabel"
          :aria-label="t('ongoingGame.flexDraft.chooseOpponent')"
          @update:value="emit('update:selectedOpponent', $event)"
        />
        <NButton size="small" secondary :aria-expanded="expanded" @click="expanded = !expanded">
          {{ t(expanded ? 'ongoingGame.flexDraft.collapse' : 'ongoingGame.flexDraft.details') }}
        </NButton>
      </div>
    </div>

    <div class="draft-columns">
      <div class="draft-section">
        <div class="draft-section-title">
          <span class="draft-dot draft-dot-ban" />{{ t('ongoingGame.flexDraft.bans')
          }}<span class="draft-muted">{{ t('ongoingGame.flexDraft.banBasis') }}</span>
        </div>
        <div v-if="bans.length" class="draft-cards">
          <div v-for="(ban, index) in bans" :key="ban.championId" class="draft-card">
            <ChampionIcon :champion-id="ban.championId" class="draft-champion" />
            <div class="draft-card-copy">
              <strong>{{ index + 1 }}. {{ championName(ban.championId) }}</strong>
              <span class="draft-player" :title="playerNames[ban.player.puuid]">{{
                playerNames[ban.player.puuid]
              }}</span>
              <span class="draft-muted">{{
                t('ongoingGame.flexDraft.poolUsage', { games: ban.games, total: ban.poolGames })
              }}</span>
              <span v-if="expanded" class="draft-muted">{{
                t('ongoingGame.flexDraft.historyWins', { wins: ban.wins, games: ban.games })
              }}</span>
            </div>
          </div>
        </div>
        <div v-else class="draft-empty">
          {{
            t(
              context.banFinished
                ? 'ongoingGame.flexDraft.banFinished'
                : historyLoading
                  ? 'ongoingGame.flexDraft.historyLoading'
                  : 'ongoingGame.flexDraft.noBans'
            )
          }}
        </div>
      </div>
      <div class="draft-section">
        <div class="draft-section-title">
          <span class="draft-dot" />{{
            t(
              context.self.lockedChampionId
                ? 'ongoingGame.flexDraft.lockedPick'
                : 'ongoingGame.flexDraft.picks'
            )
          }}<span class="draft-muted">{{ t('ongoingGame.flexDraft.pickBasis') }}</span>
        </div>
        <div v-if="picks.length" class="draft-cards">
          <div
            v-for="(pick, index) in picks.slice(0, 3)"
            :key="pick.championId"
            class="draft-card"
            :class="{ 'draft-card-first': index === 0 && pick.score !== null }"
          >
            <ChampionIcon :champion-id="pick.championId" class="draft-champion" />
            <div class="draft-card-copy">
              <strong
                >{{ pick.score !== null ? `${index + 1}. ` : ''
                }}{{ championName(pick.championId) }}</strong
              >
              <span :class="pick.score !== null ? 'draft-positive' : 'draft-muted'">{{
                t(
                  pick.score !== null
                    ? 'ongoingGame.flexDraft.coverage'
                    : loading
                      ? 'ongoingGame.flexDraft.loading'
                      : 'ongoingGame.flexDraft.insufficient',
                  { rate: percent(pick.coverage) }
                )
              }}</span>
              <span class="draft-muted">{{
                t(
                  pick.games
                    ? 'ongoingGame.flexDraft.familiarGames'
                    : 'ongoingGame.flexDraft.manualChampion',
                  { games: pick.games }
                )
              }}</span>
              <span v-if="pick.worst && pick.score !== null" class="draft-caution">{{
                t('ongoingGame.flexDraft.watchOut', {
                  champion: championName(pick.worst.championId)
                })
              }}</span>
            </div>
          </div>
        </div>
        <div v-else class="draft-empty">
          {{
            t(
              !role
                ? 'ongoingGame.flexDraft.chooseRoleHint'
                : 'ongoingGame.flexDraft.choosePoolHint'
            )
          }}
          <NButton v-if="role" text type="primary" size="small" @click="expanded = true">{{
            t('ongoingGame.flexDraft.editPool')
          }}</NButton>
        </div>
      </div>
    </div>

    <div class="draft-footer">
      <span v-if="!role">{{ t('ongoingGame.flexDraft.chooseRoleHint') }}</span>
      <span v-else-if="target.source === 'unresolved'">{{
        t('ongoingGame.flexDraft.chooseOpponentHint')
      }}</span>
      <span v-else
        >{{ t('ongoingGame.flexDraft.target', { target: targetLabel })
        }}<span v-if="target.unknownRole">
          · {{ t('ongoingGame.flexDraft.unknownRole') }}</span
        ></span
      >
      <span v-if="patch">{{ t('ongoingGame.flexDraft.source', { patch }) }}</span>
      <span v-else-if="loading">{{ t('ongoingGame.flexDraft.loading') }}</span>
      <NButton v-if="failed" text type="warning" size="tiny" @click="emit('retry')">{{
        t('ongoingGame.flexDraft.retry')
      }}</NButton>
    </div>

    <div v-if="expanded" class="draft-details">
      <div class="draft-pool-editor">
        <span>{{ t('ongoingGame.flexDraft.myPool') }}</span>
        <NSelect
          :value="comfortable ?? picks.map((p) => p.championId)"
          multiple
          filterable
          clearable
          :max-tag-count="5"
          :options="championOptions"
          :max="MAX_CANDIDATES"
          :placeholder="t('ongoingGame.flexDraft.poolPlaceholder')"
          :aria-label="t('ongoingGame.flexDraft.myPool')"
          @update:value="emit('update:comfortable', $event)"
        />
        <NButton size="small" secondary @click="emit('update:comfortable', null)">{{
          t('ongoingGame.flexDraft.autoPool')
        }}</NButton>
      </div>
      <div class="draft-muted">{{ t('ongoingGame.flexDraft.method') }}</div>
      <div class="draft-opponents">
        <span v-for="entry in target.players" :key="entry.player.puuid" class="draft-opponent">
          {{ playerNames[entry.player.puuid] }} ·
          {{
            t('ongoingGame.flexDraft.familiarGames', {
              games: histories[entry.player.puuid]?.games ?? 0
            })
          }}
          <span v-if="entry.player.lockedChampionId">
            ·
            {{
              t('ongoingGame.flexDraft.locked', {
                champion: championName(entry.player.lockedChampionId)
              })
            }}</span
          >
        </span>
      </div>
      <div v-if="target.champions.length && picks.length" class="draft-table-scroll">
        <table class="draft-table">
          <caption>
            {{
              t('ongoingGame.flexDraft.tableCaption')
            }}
          </caption>
          <thead>
            <tr>
              <th>{{ t('ongoingGame.flexDraft.matchup') }}</th>
              <th v-for="pick in picks" :key="pick.championId">
                {{ championName(pick.championId) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="enemy in target.champions" :key="enemy.championId">
              <th>
                {{ championName(enemy.championId) }}
                <span class="draft-muted">{{ percent(enemy.weight) }}%</span>
              </th>
              <td v-for="pick in picks" :key="pick.championId">
                {{ pairLabel(pick, enemy.championId) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useTranslation } from 'i18next-vue'
import { NButton, NSelect } from 'naive-ui'
import { computed, ref } from 'vue'

import {
  DRAFT_ROLES,
  MAX_CANDIDATES,
  type BanAdvice,
  type DraftContext,
  type DraftRole,
  type PickAdvice,
  type PlayerHistory,
  type TargetPool
} from './model'

const props = defineProps<{
  context: DraftContext
  target: TargetPool
  role: DraftRole | null
  histories: Record<string, PlayerHistory>
  bans: BanAdvice[]
  picks: PickAdvice[]
  championNames: Record<number, string>
  pickableIds: number[]
  playerNames: Record<string, string>
  selectedRole: DraftRole | null
  selectedOpponent: string | null
  comfortable: number[] | null
  loading: boolean
  historyLoading: boolean
  failed: boolean
  patch: string | null
  loadedPlayers: number
}>()
const emit = defineEmits<{
  'update:selectedRole': [value: DraftRole | null]
  'update:selectedOpponent': [value: string | null]
  'update:comfortable': [value: number[] | null]
  retry: []
}>()
const { t } = useTranslation()
const expanded = ref(false)
const percent = (value: number) => Math.round(value * 100)
const championName = (id: number) => props.championNames[id] ?? `#${id}`
const roleOptions = computed(() =>
  DRAFT_ROLES.map((value) => ({ label: t(`ongoingGame.flexDraft.roles.${value}`), value }))
)
const opponentOptions = computed(() =>
  props.context.enemies.map((p) => ({ label: props.playerNames[p.puuid], value: p.puuid }))
)
const championOptions = computed(() =>
  [...new Set([...props.pickableIds, ...(props.comfortable ?? [])])]
    .map((id) => ({
      label: championName(id),
      value: id,
      disabled: !props.pickableIds.includes(id)
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
)
const targetLabel = computed(() => {
  const player = props.target.players.length === 1 ? props.target.players[0].player : null
  return player
    ? t(`ongoingGame.flexDraft.targetSources.${props.target.source}`, {
        player: props.playerNames[player.puuid]
      })
    : t(`ongoingGame.flexDraft.targetSources.${props.target.source}`)
})
function pairLabel(pick: PickAdvice, id: number) {
  const row = pick.rows.find((row) => row.championId === id)
  if (row?.winRate === null || row?.winRate === undefined)
    return row?.games ? t('ongoingGame.flexDraft.smallSample', { games: row.games }) : '—'
  return t('ongoingGame.flexDraft.pair', { rate: (row.winRate * 100).toFixed(1), games: row.games })
}
</script>

<style scoped>
.draft-advice {
  margin: 12px 16px 0;
  padding: 14px 16px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
  border-radius: 12px;
  background: var(--la-card-surface-90);
  color: var(--la-color-text-primary);
  font-size: 12px;
}
.draft-header,
.draft-heading,
.draft-controls,
.draft-section-title,
.draft-footer,
.draft-pool-editor {
  display: flex;
  align-items: center;
  gap: 10px;
}
.draft-header {
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}
.draft-heading strong {
  font-size: 15px;
}
.draft-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-weight: 800;
  color: var(--la-color-link);
  background: color-mix(in srgb, var(--la-color-link) 12%, transparent);
}
.draft-controls {
  flex-wrap: wrap;
}
.draft-controls .n-select:first-child {
  width: 112px;
}
.draft-controls .n-select:nth-child(2) {
  width: 205px;
}
.draft-muted,
.draft-footer {
  color: color-mix(in srgb, var(--la-color-text-primary) 70%, transparent);
  font-size: 11px;
}
.draft-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 14px;
}
.draft-section {
  min-width: 0;
}
.draft-section-title {
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 6px;
  font-weight: 600;
}
.draft-section-title .draft-muted {
  margin-left: auto;
  font-weight: 400;
}
.draft-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #36b6a1;
}
.draft-dot-ban {
  background: #d18b5a;
}
.draft-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.draft-card {
  display: flex;
  gap: 8px;
  padding: 10px 8px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
  border-radius: 8px;
  min-width: 0;
}
.draft-card-first {
  border-color: color-mix(in srgb, #36b6a1 50%, transparent);
  background: color-mix(in srgb, #36b6a1 7%, transparent);
}
.draft-champion {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 6px;
}
.draft-card-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.draft-card-copy strong {
  font-size: 12px;
}
.draft-player {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.draft-positive {
  color: var(--la-color-link);
  font-size: 11px;
}
.draft-caution {
  color: color-mix(in srgb, var(--la-color-text-primary) 70%, transparent);
  font-size: 11px;
}
.draft-empty {
  min-height: 70px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: color-mix(in srgb, var(--la-color-text-primary) 70%, transparent);
}
.draft-footer {
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 10px;
  gap: 6px;
}
.draft-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
}
.draft-pool-editor {
  margin-bottom: 8px;
}
.draft-pool-editor > span {
  flex-shrink: 0;
}
.draft-opponents {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.draft-opponent {
  padding: 3px 8px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
  border-radius: 6px;
}
.draft-table-scroll {
  overflow-x: auto;
  margin-top: 10px;
}
.draft-table {
  border-collapse: collapse;
  width: 100%;
  white-space: nowrap;
  font-size: 11px;
}
.draft-table caption {
  text-align: left;
  color: color-mix(in srgb, var(--la-color-text-primary) 70%, transparent);
  margin-bottom: 8px;
  white-space: normal;
}
.draft-table th,
.draft-table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
}
@media (max-width: 1000px) {
  .draft-columns {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
@media (max-width: 600px) {
  .draft-advice {
    margin: 8px;
    padding: 12px;
  }
  .draft-card {
    flex-direction: column;
  }
  .draft-pool-editor {
    flex-wrap: wrap;
  }
  .draft-pool-editor .n-select {
    width: 100%;
  }
}
</style>
