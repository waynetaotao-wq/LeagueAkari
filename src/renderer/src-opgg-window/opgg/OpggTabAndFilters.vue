<template>
  <div>
    <!-- buttons + tabs -->
    <div class="mb-1 flex items-center gap-1">
      <NSelect
        size="small"
        :placeholder="t('opgg.filters.source')"
        :options="sourceOptions"
        :value="preferredSource"
        :title="t('opgg.filters.source')"
        class="w-22!"
        :consistent-menu-width="false"
        :disabled="isLoading"
        @update:value="changeSource"
      />

      <a :href="sourceHomeUrl" :title="sourceHomeTitle" target="_blank">
        <NButton secondary class="size-8!">
          <template #icon>
            <NIcon><OpenOutline /></NIcon>
          </template>
        </NButton>
      </a>

      <!-- refresh -->
      <NButton
        secondary
        class="size-8!"
        :title="t('opgg.filters.refresh')"
        :loading="isLoading"
        @click="() => refresh()"
      >
        <template #icon>
          <NIcon><RefreshSharp /></NIcon>
        </template>
      </NButton>

      <!-- settings -->
      <NButton
        secondary
        class="size-8!"
        :title="t('opgg.filters.settings.button')"
        @click="isSettingsShow = true"
      >
        <template #icon>
          <NIcon><Settings /></NIcon>
        </template>
      </NButton>

      <NTabs class="tabs" :value="currentTab" type="segment" size="small" @update:value="setTab">
        <NTab name="champions" :tab="t('opgg.filters.champions')" />
        <NTab :title="t('opgg.filters.champion')" name="champion" :disabled="!championId">
          <div v-if="championId" class="flex items-center gap-2">
            <ChampionIcon round class="size-5" :champion-id="championId" />
            <span>{{ resources.champions.name(championId) }}</span>
          </div>
          <div v-else>{{ t('opgg.filters.empty') }}</div>
        </NTab>
      </NTabs>
    </div>

    <!-- filters -->
    <div class="flex gap-1">
      <NSelect
        size="small"
        :placeholder="t('opgg.filters.mode')"
        :options="modeOptions"
        :value="mode"
        @update:value="changeMode"
        :render-label="renderLabel"
        class="w-0! flex-1"
        :consistent-menu-width="false"
        :disabled="isLoading"
      />
      <NSelect
        v-if="supportsFilter('region')"
        size="small"
        :placeholder="t('opgg.filters.region')"
        :options="regionOptions"
        :value="region"
        @update:value="changeRegion"
        :render-label="renderLabel"
        class="w-0! flex-1"
        :consistent-menu-width="false"
        :disabled="isLoading"
      />
      <NSelect
        v-if="supportsFilter('tier')"
        size="small"
        :placeholder="t('opgg.filters.rankTier')"
        :options="tierOptions"
        :value="tier"
        @update:value="changeTier"
        :render-label="renderLabel"
        class="w-0! flex-1"
        :consistent-menu-width="false"
        :disabled="isLoading"
      />
      <NSelect
        v-if="supportsFilter('position')"
        size="small"
        :placeholder="t('opgg.filters.position')"
        :options="positionOptions"
        :value="position"
        @update:value="changePosition"
        class="w-18!"
        :render-label="renderLabel"
        :consistent-menu-width="false"
        :disabled="isLoading"
      />
      <NSelect
        v-if="supportsFilter('patch')"
        size="small"
        :placeholder="t('opgg.filters.version')"
        :value="version"
        :options="versionOptions"
        @update:value="changeVersion"
        :render-label="renderLabel"
        class="w-18!"
        :consistent-menu-width="false"
        :disabled="isLoading || versions.length === 0"
      />
    </div>

    <!-- settings modal -->
    <NModal v-model:show="isSettingsShow" transform-origin="center">
      <div class="w-125 max-w-[90vw]">
        <SettingsPane @close="isSettingsShow = false" />
      </div>
    </NModal>
  </div>
</template>

<script setup lang="tsx">
import {
  useModeOptions,
  usePositionOptions,
  useRegionOptions,
  useTierOptions
} from '@opgg-window/opgg/utils/options'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useChampionDataStore } from '@renderer-shared/shards/champion-data/store'
import {
  type ChampionDataFilter,
  type ChampionDataMode,
  getChampionDataCapability
} from '@shared/data-adapter/champion-data'
import { OpenOutline, RefreshSharp, Settings } from '@vicons/ionicons5'
import { useTranslation } from 'i18next-vue'
import { NButton, NIcon, NModal, NSelect, NTab, NTabs, SelectRenderLabel } from 'naive-ui'
import { computed, ref, watchEffect } from 'vue'

import { useOpgg } from './context'
import SettingsPane from './widgets/Settings.vue'

const { t } = useTranslation()
const resources = useAkariResourceProvider()
const championDataStore = useChampionDataStore()

const {
  currentTab,
  mode,
  versions,
  version,
  tier,
  position,
  region,
  isLoading,
  championId,
  preferredSource,
  changeSource,
  changeMode,
  changePosition,
  changeRegion,
  changeTier,
  changeVersion,
  refresh,
  setTab
} = useOpgg()

const isSettingsShow = ref(false)

const { modeOptions } = useModeOptions(preferredSource)
const { regionOptions } = useRegionOptions()
const { tierOptions: opggTierOptions } = useTierOptions()

// lol.ps 仅有四档段位（接口实测：1=青铜~铂金, 2=翡翠+, 13=钻石+, 3=大师+）
const LOLPS_TIER_OPTIONS = [
  { label: '青铜 ~ 铂金', value: 'bronze_plat' },
  { label: '翡翠 +', value: 'emerald_plus' },
  { label: '钻石 +', value: 'diamond_plus' },
  { label: '大师 +', value: 'master_plus' }
]
const LOLPS_TIER_VALUES = new Set(LOLPS_TIER_OPTIONS.map((o) => o.value))

// 切到 lol.ps 时，把 OP.GG 风格的段位就近折算到四档
const OPGG_TO_LOLPS_TIER: Record<string, string> = {
  all: 'bronze_plat',
  ibsg: 'bronze_plat',
  gold_minus: 'bronze_plat',
  gold: 'bronze_plat',
  gold_plus: 'bronze_plat',
  platinum_plus: 'emerald_plus',
  master: 'master_plus',
  grandmaster: 'master_plus',
  challenger: 'master_plus'
}

const tierOptions = computed(() =>
  preferredSource.value === 'lolps' ? LOLPS_TIER_OPTIONS : opggTierOptions.value
)

watchEffect(() => {
  const current = String(tier.value ?? '')
  if (preferredSource.value === 'lolps') {
    if (!LOLPS_TIER_VALUES.has(current)) {
      changeTier(OPGG_TO_LOLPS_TIER[current] ?? 'emerald_plus')
    }
  } else if (current === 'bronze_plat') {
    // 从 lol.ps 切回其它数据源时，其独有档位回落为「全部段位」
    changeTier('all')
  }
})
const { positionOptions } = usePositionOptions()

const versionOptions = computed(() =>
  versions.value.map((version) => ({ label: version, value: version }))
)

const sourceOptions = computed(() =>
  (['opgg', 'qq101', 'lolps'] as const).map((source) => ({
    label: source === 'lolps' ? 'LOL.PS' : t(`opgg.filters.sources.${source}`),
    value: source,
    disabled: !championDataStore.availability.sources[source].enabled
  }))
)

const capability = computed(() =>
  getChampionDataCapability(preferredSource.value, mode.value as ChampionDataMode)
)

const supportsFilter = (filter: ChampionDataFilter) =>
  capability.value?.filters.includes(filter) ?? false

const sourceHomeUrl = computed(() => {
  switch (preferredSource.value) {
    case 'qq101':
      return 'https://101.qq.com'
    case 'lolps':
      return 'https://lol.ps'
    default:
      return 'https://op.gg'
  }
})

const sourceHomeTitle = computed(() =>
  t('opgg.filters.openSource', {
    source:
      preferredSource.value === 'lolps'
        ? 'LOL.PS'
        : t(`opgg.filters.sources.${preferredSource.value}`)
  })
)

const renderLabel: SelectRenderLabel = (option) => {
  return <span class="text-xs">{option.label as string}</span>
}
</script>
