<template>
  <div class="mid-research-scroll">
    <NScrollbar :style="{ maxHeight: `${maxHeight}px` }">
      <div class="mid-research-content" role="note" aria-label="中单研究提醒">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 font-semibold">
            <ChampionIcon
              v-if="championId"
              :champion-id="championId"
              class="size-5 shrink-0 rounded"
            />
            <span>中单研究</span>
          </div>
          <span class="text-[11px] text-black/55 dark:text-white/55">{{
            analyzing ? '仍在分析' : '历史习惯'
          }}</span>
        </div>

        <template v-if="hasData">
          <div class="mt-1 text-[11px] text-black/60 dark:text-white/60">
            该玩家 · 当前英雄 · {{ deep.deepGames }} 场有效记录 · 前 14 分钟
          </div>
          <div class="mid-research-callout">
            <div class="mb-1 text-[11px] font-medium text-fuchsia-800 dark:text-fuchsia-200">
              {{ isOpponent ? '先提醒队友' : '历史表现' }}
            </div>
            <div class="text-base leading-relaxed font-semibold">
              {{ isOpponent ? briefing.callout : (briefing.signals[0]?.title ?? briefing.callout) }}
            </div>
            <div v-if="briefing.signals[0]" class="mt-1.5 text-xs text-black/65 dark:text-white/65">
              {{ briefing.signals[0].evidence }}
            </div>
          </div>

          <div v-if="briefing.signals.length > 1" class="flex flex-col gap-2.5">
            <div v-for="signal in briefing.signals.slice(1)" :key="signal.kind">
              <div class="text-[13px] font-semibold">{{ signal.title }}</div>
              <div class="mt-0.5 text-[11px] text-black/60 dark:text-white/60">
                {{ signal.evidence }}
              </div>
            </div>
          </div>
          <div class="mt-2 text-[11px] leading-relaxed text-black/55 dark:text-white/55">
            {{ analyzing ? '结果还在补齐，提醒可能变化。' : '历史倾向，不代表这局一定如此。' }}
            <template v-if="deep.timelineFailures"
              >已排除 {{ deep.timelineFailures }} 场失败或不完整记录。</template
            >
          </div>

          <div
            class="mt-2 flex items-center justify-between border-t border-black/8 pt-2 dark:border-white/10"
          >
            <NButton
              text
              size="small"
              :aria-expanded="detailsOpen"
              @click="detailsOpen = !detailsOpen"
            >
              {{ detailsOpen ? '收起数据与地图' : '查看数据与地图' }}
            </NButton>
            <NButton v-if="canRetry" text size="small" @click="$emit('retry')">重试</NButton>
          </div>
          <MidlaneResearchDetails
            v-if="detailsOpen && state.result"
            class="mt-3"
            :result="state.result"
          />
        </template>
        <div v-else class="py-3">
          <div class="font-medium">{{ progressText }}</div>
          <div class="mt-1 text-xs text-black/60 dark:text-white/60">
            {{
              analyzing
                ? '自动分析中，完成后这里会直接给出提醒。'
                : '暂时没有足够的数据判断他的习惯。'
            }}
          </div>
          <NButton v-if="canRetry" class="mt-2" size="small" @click="$emit('retry')"
            >重试中单研究</NButton
          >
        </div>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { NButton, NScrollbar } from 'naive-ui'
import { computed, ref } from 'vue'

import { emptyDeepResult } from './analysis'
import { buildMidlaneBriefing } from './briefing'
import type { MidResearchState } from './context'
import MidlaneResearchDetails from './MidlaneResearchDetails.vue'
import { researchProgressText } from './progress'

const { state, championId, maxHeight, isOpponent } = defineProps<{
  isOpponent: boolean
  maxHeight: number
  state: MidResearchState
  championId: number | null
}>()
defineEmits<{ retry: [] }>()
const detailsOpen = ref(false)
const deep = computed(() => state.result?.deep ?? emptyDeepResult())
const hasData = computed(() => deep.value.deepGames > 0)
const analyzing = computed(() => state.phase === 'list' || state.phase === 'deep')
const briefing = computed(() => buildMidlaneBriefing(deep.value))
const canRetry = computed(
  () => state.phase === 'error' || (state.phase === 'done' && deep.value.timelineFailures > 0)
)
const progressText = computed(() => researchProgressText(state))
</script>

<style scoped>
.mid-research-scroll {
  width: 356px;
  max-width: calc(100vw - 56px);
}
.mid-research-content {
  padding-right: 3px;
  overflow-wrap: anywhere;
  color: var(--la-color-text-primary);
  font-size: 13px;
  line-height: 1.6;
}
.mid-research-callout {
  margin: 12px 0;
  border: 1px solid rgb(192 38 211 / 0.22);
  border-radius: 6px;
  padding: 10px 12px;
  background: rgb(192 38 211 / 0.06);
}
</style>
