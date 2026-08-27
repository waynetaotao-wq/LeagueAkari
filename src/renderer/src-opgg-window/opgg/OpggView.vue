<template>
  <div class="relative flex flex-col px-2 pt-1 pb-2">
    <OpggTabAndFilters class="mb-1" />

    <OpggCounterIntel />

    <NEmpty
      v-if="isDataUnavailable"
      class="flex min-h-0 flex-1 items-center justify-center"
      :description="t('opgg.view.dataUnavailable')"
    />
    <template v-else>
      <MayhemOverview
        v-if="currentTab === 'champions' && mode === 'aram_mayhem'"
        class="min-h-0 flex-1"
      />
      <KeepAlive v-else>
        <OpggChampionTable v-if="currentTab === 'champions'" class="min-h-0 flex-1" />
        <OpggChampion class="min-h-0 flex-1" v-else-if="currentTab === 'champion'" />
      </KeepAlive>
    </template>

    <SessionChampions />
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NEmpty } from 'naive-ui'
import { computed, provide } from 'vue'

import MayhemOverview from './MayhemOverview.vue'
import OpggChampion from './OpggChampion.vue'
import OpggChampionTable from './OpggChampionTable.vue'
import OpggTabAndFilters from './OpggTabAndFilters.vue'
import { OpggContextKey, useOpgg } from './context'
import { useMatchupOverlay } from './matchup-overlay'
import OpggCounterIntel from './widgets/OpggCounterIntel.vue'
import SessionChampions from './widgets/SessionChampions.vue'

const { t } = useTranslation()
const parentContext = useOpgg()
const { currentTab, mode, isDataUnavailable } = parentContext

// [lolps] 对位覆盖：就近再 provide 一层，champion 变为 merge(基础数据, 对位 overlay)。
// 子树内全部区块组件与"应用"按钮 inject 到覆盖版 → 整窗自动切换为对位数据；
// overlay 为空时原样透传，通用版行为零变化。
const { matchupOverlay } = useMatchupOverlay()
const mergedChampion = computed(() => {
  const base = parentContext.champion.value
  const patch = matchupOverlay.value
  if (!base || !patch) return base
  return { ...base, data: { ...base.data, ...patch } }
})
provide(OpggContextKey, {
  ...parentContext,
  champion: mergedChampion as unknown as typeof parentContext.champion
})
</script>
