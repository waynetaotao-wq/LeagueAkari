<template>
  <div class="relative -mt-2 flex h-full flex-col items-center justify-center px-4">
    <NIcon class="relative -left-2 mb-3 text-[64px] text-black/20 dark:text-white/20">
      <AkariLogo />
    </NIcon>
    <span class="text-sm font-normal text-gray-500 dark:text-gray-400">
      {{ statusText }}
    </span>

    <!-- [lolps] 待机不再空白：自动化状态一览（进入排队/选人后此窗会自动切换为对应面板） -->
    <div class="mt-4 w-full max-w-60 rounded-lg bg-black/5 px-3 py-2 text-[12px] dark:bg-white/6">
      <div class="mb-1 text-[11px] font-bold text-black/55 dark:text-white/55">自动化状态</div>
      <div v-for="row of rows" :key="row.label" class="flex items-center gap-2 py-0.5">
        <span
          class="size-2 shrink-0 rounded-full"
          :class="row.on ? 'bg-emerald-500' : 'bg-gray-500/50'"
        />
        <span class="text-black/75 dark:text-white/80">{{ row.label }}</span>
        <span class="ml-auto text-black/45 dark:text-white/40">{{ row.on ? '开' : '关' }}</span>
      </div>
      <div
        v-if="agfs.settings.autoReportEnabled && agfs.lastAutoReportSummary"
        class="mt-1 border-t border-black/10 pt-1 text-[11px] text-black/50 dark:border-white/10 dark:text-white/45"
      >
        上局举报：{{ agfs.lastAutoReportSummary }}
      </div>
      <div class="mt-1 text-[10px] text-black/35 dark:text-white/30">
        进入排队 / 选人后，此窗口会自动切换为对应操作面板
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AkariLogo from '@renderer-shared/assets/icon/AkariLogo.vue'
import { useAutoGameflowStore } from '@renderer-shared/shards/auto-gameflow/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useTranslation } from 'i18next-vue'
import { NIcon } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()

const lcs = useLeagueClientStore()
const agfs = useAutoGameflowStore()

const statusText = computed(() => {
  if (lcs.gameflow.phase === 'InProgress') {
    return t('auxWindow.placeholder.inProgress')
  }
  return t('auxWindow.placeholder.idle')
})

const rows = computed(() => [
  { label: '自动接受对局', on: agfs.settings.autoAcceptEnabled },
  { label: '自动点赞队友', on: agfs.settings.autoHonorEnabled },
  { label: '自动举报违规', on: agfs.settings.autoReportEnabled },
  { label: '自动匹配排队', on: agfs.settings.autoMatchmakingEnabled },
  { label: '自动重连回城', on: agfs.settings.autoReconnectEnabled }
])
</script>
