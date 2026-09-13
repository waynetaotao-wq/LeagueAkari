<template>
  <NPopover
    v-if="matchup"
    :show="show"
    trigger="hover"
    placement="bottom"
    :delay="100"
    :keep-alive-on-hover="true"
    style="box-sizing: border-box; max-width: min(340px, calc(100vw - 24px))"
    @update:show="show = $event"
  >
    <template #trigger>
      <NButton
        class="matchup-tips-trigger"
        size="tiny"
        round
        secondary
        :type="tip ? 'info' : 'default'"
        :aria-label="`查看${matchupTitle}的对线心得`"
        :aria-expanded="show"
        @focus="show = true"
        @blur="show = false"
        @click.stop="show = true"
        @keydown.esc.stop="show = false"
      >
        心得
      </NButton>
    </template>

    <div class="matchup-tips-content" role="note" :aria-label="`${matchupTitle}的对线心得`">
      <div class="matchup-tips-heading">
        <ChampionIcon :champion-id="matchup.championId" class="size-5 shrink-0 rounded" />
        <span>{{ matchupTitle }}</span>
      </div>
      <div v-if="tip" class="matchup-tips-points">
        <div v-for="(point, index) in tip.points" :key="index" class="matchup-tips-point">
          <span class="matchup-tips-dot" aria-hidden="true" />
          <span>{{ point }}</span>
        </div>
      </div>
      <div v-else class="matchup-tips-empty">这个对位暂未收录中文心得。</div>
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { NButton, NPopover } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import { useOngoingGamePanel } from '../../../context'
import { findMatchupTip, matchupChampionName, resolveConfirmedMatchup } from './model'

const { puuid } = defineProps<{ puuid: string }>()
const { ongoingGame } = useOngoingGamePanel()
const show = ref(false)
const matchup = computed(() => resolveConfirmedMatchup(ongoingGame.value, puuid))
const tip = computed(() => (matchup.value ? findMatchupTip(matchup.value) : null))
const matchupTitle = computed(() =>
  matchup.value
    ? `${matchupChampionName(matchup.value.championId)} 对 ${matchupChampionName(matchup.value.opponentId)}`
    : ''
)

watch(
  () =>
    matchup.value
      ? `${matchup.value.gameId}:${matchup.value.championId}:${matchup.value.opponentId}:${matchup.value.position}:${puuid}`
      : null,
  () => {
    show.value = false
  },
  { flush: 'sync' }
)
</script>

<style scoped>
.matchup-tips-trigger {
  flex-shrink: 0;
  height: 20px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
}

.matchup-tips-content {
  max-width: 100%;
  font-size: 12px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.matchup-tips-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 600;
}

.matchup-tips-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.matchup-tips-point {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.matchup-tips-dot {
  flex: 0 0 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.45;
  transform: translateY(-2px);
}

.matchup-tips-empty {
  opacity: 0.65;
}
</style>
