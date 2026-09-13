<template>
  <div v-if="research?.visible.value" class="mb-1 flex w-full">
    <MidlaneResearchPopover v-slot="{ open, close, blur, focusDetails, setTrigger, expanded }">
      <NButton
        :ref="setTrigger"
        class="mid-research-trigger"
        :aria-expanded="expanded"
        aria-label="查看中单研究提醒"
        @focus="open"
        @blur="blur"
        @keydown.down.prevent="focusDetails"
        @click.stop="open"
        @keydown.esc.stop="close"
      >
        <span class="flex w-full min-w-0 items-center gap-2 text-left">
          <ChampionIcon
            v-if="research.championId.value"
            :champion-id="research.championId.value"
            class="size-7 shrink-0 rounded"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-xs leading-5 font-semibold">{{
              hasData ? briefing.headline : '中单研究'
            }}</span>
            <span class="text-[10px] leading-4 text-black/60 dark:text-white/60">{{
              hasData
                ? `${deep.deepGames} 场 · ${research.state.phase === 'deep' ? '仍在分析' : research.isOpponent.value ? '悬停看队友提醒' : '悬停看历史表现'}`
                : progressText
            }}</span>
          </span>
        </span>
      </NButton>
    </MidlaneResearchPopover>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { NButton } from 'naive-ui'
import { computed } from 'vue'

import { emptyDeepResult } from './analysis'
import { buildMidlaneBriefing } from './briefing'
import { useMidlaneResearch } from './context'
import MidlaneResearchPopover from './MidlaneResearchPopover.vue'
import { researchProgressText } from './progress'

const research = useMidlaneResearch()
const deep = computed(() => research?.state.result?.deep ?? emptyDeepResult())
const hasData = computed(() => deep.value.deepGames > 0)
const briefing = computed(() => buildMidlaneBriefing(deep.value))
const progressText = computed(() => (research ? researchProgressText(research.state) : ''))
</script>

<style scoped>
.mid-research-trigger {
  width: 100%;
  height: auto;
  min-height: 50px;
  padding: 5px 8px;
  border: 1px solid rgb(192 38 211 / 0.45);
  border-radius: 4px;
  background: rgb(192 38 211 / 0.06);
  color: var(--la-color-text-primary);
}
.mid-research-trigger :deep(.n-button__content) {
  width: 100%;
  min-width: 0;
  white-space: normal;
}
</style>
