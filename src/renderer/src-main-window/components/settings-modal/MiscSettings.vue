<template>
  <NScrollbar class="h-full">
    <div class="flex flex-col gap-6">
      <SettingsSection
        setting-id="misc.respawn-timer"
        :title="t('settings.misc.respawnTimer.title')"
      >
        <SettingsRow
          setting-id="misc.respawn-timer.enabled"
          :label="t('settings.misc.respawnTimer.enabled.label')"
          :label-description="t('settings.misc.respawnTimer.enabled.description')"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="rts.settings.enabled"
            @update:value="(val) => rt.setEnabled(val)"
          />
        </SettingsRow>
      </SettingsSection>
      <!-- [lolps] 复活自动切回游戏 -->
      <SettingsSection setting-id="misc.game-refocus" title="复活自动切回游戏">
        <SettingsRow
          setting-id="misc.game-refocus.enabled"
          label="死亡后若在其他窗口，复活前 2 秒自动切回游戏"
          :label-description="
            grs.state.supported
              ? '只做窗口切换（等价于 Alt+Tab），不模拟任何按键；人已在游戏里时不会有任何动作。' +
                '判断“是否在游戏里”需要以管理员身份运行，否则每次复活都会执行一次无害的切换。' +
                (grs.state.lastTriggeredAt ? ' 本局已触发。' : '')
              : '当前系统不支持（仅 Windows）'
          "
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="grs.settings.enabled"
            :disabled="!grs.state.supported"
            @update:value="(val) => gr.setEnabled(val)"
          />
        </SettingsRow>
      </SettingsSection>
      <!-- [lolps] 对局评分：权重校准 -->
      <SettingsSection setting-id="misc.match-rating" title="对局评分">
        <SettingsRow
          setting-id="misc.match-rating.calibrate"
          label="用我的战绩校准评分权重"
          :label-description="calibrationStatusText"
          :label-width="400"
        >
          <div class="flex items-center gap-2">
            <NButton
              size="tiny"
              type="primary"
              secondary
              :loading="calibrating"
              :disabled="!canCalibrate"
              @click="startCalibration"
            >
              {{ calibrating ? calibrationProgressText : '校准（最近 400 场）' }}
            </NButton>
            <NPopover v-if="calibrationView" trigger="click" placement="bottom-end">
              <template #trigger>
                <NButton size="tiny" quaternary>权重表</NButton>
              </template>
              <div class="text-xs">
                <div class="mb-1 font-bold">当前权重（%）· 各位置</div>
                <table class="border-separate border-spacing-x-2">
                  <thead>
                    <tr class="text-[10px] text-black/60 dark:text-white/60">
                      <th class="text-left font-normal">指标</th>
                      <th v-for="pos of calibrationView.positions" :key="pos.key" class="font-normal">
                        {{ pos.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row of calibrationView.rows" :key="row.key">
                      <td class="pr-1 text-black/70 dark:text-white/70">{{ row.label }}</td>
                      <td
                        v-for="(cell, ci) of row.cells"
                        :key="ci"
                        class="text-center tabular-nums"
                      >
                        {{ cell }}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div class="mt-1 text-[10px] text-black/50 dark:text-white/45">
                  {{ calibrationView.footnote }}
                </div>
              </div>
            </NPopover>
            <NButton
              v-if="mrs.settings.calibration"
              size="tiny"
              quaternary
              :disabled="calibrating"
              @click="mr.saveCalibration(null)"
            >
              恢复内置权重
            </NButton>
          </div>
        </SettingsRow>
      </SettingsSection>
      <!-- [lolps] 赛后小结弹窗 -->
      <SettingsSection setting-id="misc.post-game" title="赛后小结弹窗">
        <SettingsRow
          setting-id="misc.post-game.enabled"
          label="对局结算后自动弹出赛后小结"
          label-description="在屏幕右下角弹出：本局英雄、游戏 ID、胜负、时长、KDA，以及双方每位玩家的对局评分与 MVP / SVP / 尽力局。回大厅后保持显示，直到关闭、超时或进入下一局。"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="pgs.settings.enabled"
            @update:value="(val) => wm.postGameWindow.setEnabled(val)"
          />
        </SettingsRow>
        <SettingsRow
          setting-id="misc.post-game.auto-close"
          label="自动收起"
          label-description="弹出后经过该时间自动收起；选择“不自动收起”则一直显示到手动关闭"
          :label-width="400"
        >
          <NSelect
            size="small"
            class="w-36"
            :value="pgs.settings.autoCloseSeconds"
            :options="postGameAutoCloseOptions"
            @update:value="(val) => wm.postGameWindow.setAutoCloseSeconds(val)"
          />
        </SettingsRow>
      </SettingsSection>
      <!-- [lolps] 团队之选窗口开关 -->
      <SettingsSection setting-id="misc.draftgap" title="团队之选（选人推荐窗口）">
        <SettingsRow
          setting-id="misc.draftgap.enabled"
          label="启用团队之选窗口"
          label-description="关闭后窗口不再创建，也不会在进入英雄选择时弹出"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="dgs.settings.enabled"
            @update:value="(val) => wm.draftgapWindow.setEnabled(val)"
          />
        </SettingsRow>
        <SettingsRow
          setting-id="misc.draftgap.auto-show"
          label="进入英雄选择时自动弹出"
          label-description="关闭后窗口保持启用但不自动现身，可手动打开"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="dgs.settings.autoShow"
            @update:value="(val) => wm.draftgapWindow.setAutoShow(val)"
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        setting-id="misc.streamer-mode"
        :title="t('settings.misc.streamerMode.title')"
      >
        <SettingsRow
          setting-id="misc.streamer-mode.enabled"
          :label="t('settings.misc.streamerMode.streamerMode.label')"
          :label-description="t('settings.misc.streamerMode.streamerMode.description')"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="as.settings.streamerMode"
            @update:value="(val) => a.setStreamerMode(val)"
          />
        </SettingsRow>
        <NCollapseTransition :show="as.settings.streamerMode">
          <SettingsRow
            setting-id="misc.streamer-mode.akari-name"
            :label="t('settings.misc.streamerMode.useAkariStyledName.label')"
            :label-description="t('settings.misc.streamerMode.useAkariStyledName.description')"
            :label-width="400"
            style="border-bottom-width: 1px"
          >
            <NSwitch
              size="small"
              :value="as.settings.streamerModeUseAkariStyledName"
              @update:value="(val) => a.setStreamerModeUseAkariStyledName(val)"
            />
          </SettingsRow>
        </NCollapseTransition>
        <SettingsRow
          setting-id="misc.streamer-mode.content-protection"
          :label="t('settings.misc.streamerMode.contentProtection.label')"
          :label-description="t('settings.misc.streamerMode.contentProtection.description')"
          :label-width="400"
        >
          <NSwitch
            size="small"
            :value="wms.settings.contentProtection"
            @update:value="(val) => wm.setContentProtection(val)"
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  </NScrollbar>
</template>

<script setup lang="ts">
import SettingsRow from '@main-window/settings-navigation/NavigableSettingsRow.vue'
import SettingsSection from '@main-window/settings-navigation/NavigableSettingsSection.vue'
import { useInstance } from '@renderer-shared/shards'
import { useAkariNavigationStep } from '@renderer-shared/shards/akari-navigation'
import { AppCommonRenderer } from '@renderer-shared/shards/app-common'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import {
  AKARI_METRIC_LABELS,
  AKARI_POSITION_WEIGHTS,
  type AkariMetricKey,
  type AkariScorePosition
} from '@renderer-shared/components/match-card/utils/akari-score'
import { parseStoredCalibration } from '@renderer-shared/components/match-card/utils/akari-score-calibration'
import { useRatingCalibration } from '@renderer-shared/components/match-card/utils/use-rating-calibration'
import { GameRefocusRenderer } from '@renderer-shared/shards/game-refocus'
import { useGameRefocusStore } from '@renderer-shared/shards/game-refocus/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { MatchRatingRenderer } from '@renderer-shared/shards/match-rating'
import { useMatchRatingStore } from '@renderer-shared/shards/match-rating/store'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { RespawnTimerRenderer } from '@renderer-shared/shards/respawn-timer'
import { useRespawnTimerStore } from '@renderer-shared/shards/respawn-timer/store'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import {
  useDraftgapWindowStore,
  usePostGameWindowStore,
  useWindowManagerStore
} from '@renderer-shared/shards/window-manager/store'
import { useTranslation } from 'i18next-vue'
import { NButton, NCollapseTransition, NPopover, NScrollbar, NSelect, NSwitch } from 'naive-ui'
import { computed } from 'vue'

import { MISC_SETTINGS_NAVIGATION_STEP_KEY, type MiscSettingsNavigationPayload } from './navigation'

const { t } = useTranslation()

const a = useInstance(AppCommonRenderer)
const as = useAppCommonStore()
const rts = useRespawnTimerStore()
const rt = useInstance(RespawnTimerRenderer)
const grs = useGameRefocusStore()
const gr = useInstance(GameRefocusRenderer)

// ===== [lolps] 对局评分权重校准 =====
const mrs = useMatchRatingStore()
const mr = useInstance(MatchRatingRenderer)
const sgps = useSgpStore()
const lcs = useLeagueClientStore()
const {
  calibrating,
  progressText: calibrationProgressText,
  calibrate: runRatingCalibration
} = useRatingCalibration()

const parsedCalibration = computed(() => parseStoredCalibration(mrs.settings.calibration))
const canCalibrate = computed(
  () =>
    !calibrating.value &&
    sgps.availability.serversSupported.matchHistory &&
    !!lcs.summoner.me?.puuid
)
const calibrationStatusText = computed(() => {
  const c = parsedCalibration.value
  const source = c?.sourceName ? `基于 ${c.sourceName} ` : '基于你 '
  const base = c
    ? `${source}最近 ${c.games} 场（${c.totalSamples} 个玩家样本）拟合的权重 · ${new Date(c.calibratedAt).toLocaleString()}`
    : '当前使用内置先验权重（未校准）'
  const how =
    '原理：拉取召唤师峡谷战绩，按位置用逻辑回归找出真正预测胜负的指标；样本少时向内置权重收缩。也可在任意玩家的战绩页用他的对局校准（例如王者高手）。'
  const switched =
    c?.sourcePuuid && lcs.summoner.me?.puuid && c.sourcePuuid !== lcs.summoner.me.puuid
      ? ' 当前登录账号与校准来源不同：权重反映的是来源账号所在分段的规律，换号仍可用；若段位差异大建议重新校准。'
      : ''
  const avail = sgps.availability.serversSupported.matchHistory ? '' : ' 当前区服不支持 SGP 战绩，暂不可校准。'
  return `${base}。${how}${switched}${avail}`
})

const POSITION_LABELS: Record<AkariScorePosition, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅',
  UNKNOWN: '通用'
}
const calibrationView = computed(() => {
  const c = parsedCalibration.value
  const weights = c?.weights ?? AKARI_POSITION_WEIGHTS
  const positions = (Object.keys(POSITION_LABELS) as AkariScorePosition[]).map((key) => ({
    key,
    label: POSITION_LABELS[key]
  }))
  const rows = (Object.keys(AKARI_METRIC_LABELS) as AkariMetricKey[]).map((key) => ({
    key,
    label: AKARI_METRIC_LABELS[key],
    cells: positions.map((p) => `${Math.round((weights[p.key]?.[key] ?? 0) * 100)}`)
  }))
  const footnote = c
    ? `样本内胜负预测准确率：${(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const)
        .map((p) => `${POSITION_LABELS[p]} ${(c.report[p].accuracy * 100).toFixed(0)}%（${c.report[p].samples}）`)
        .join(' · ')}`
    : '内置先验权重；校准后此处显示拟合结果与准确率'
  return { positions, rows, footnote }
})

function startCalibration() {
  const me = lcs.summoner.me
  if (!me?.puuid) return
  void runRatingCalibration({
    puuid: me.puuid,
    name: me.gameName || me.displayName || undefined
  })
}

const wm = useInstance(WindowManagerRenderer)
const wms = useWindowManagerStore()
const dgs = useDraftgapWindowStore()
const pgs = usePostGameWindowStore()
const postGameAutoCloseOptions = [
  { label: '1 分钟', value: 60 },
  { label: '2 分钟', value: 120 },
  { label: '5 分钟', value: 300 },
  { label: '不自动收起', value: 0 }
]

useAkariNavigationStep<MiscSettingsNavigationPayload>({
  key: MISC_SETTINGS_NAVIGATION_STEP_KEY,
  activate: () => {
    if (!as.settings.streamerMode) {
      return { status: 'unavailable', reason: 'streamer-mode-details-hidden' }
    }

    return undefined
  }
})
</script>
