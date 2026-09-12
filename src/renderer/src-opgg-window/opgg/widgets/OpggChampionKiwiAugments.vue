<template>
  <div
    class="@container mb-1 rounded border border-black/10 p-2 last:mb-0 dark:border-[#37373c]"
    v-if="augments && Object.keys(augments).length"
  >
    <NInput
      v-model:value="augmentSearch"
      size="small"
      clearable
      :placeholder="t('opgg.champion.searchAugments')"
      class="mb-2"
    />
    <div v-if="effectiveSource === 'qq101'" class="mb-2 text-xs text-gray-500">
      {{ t('opgg.champion.qqMayhemAugmentScope') }}
    </div>
    <div v-if="unnamedCount" class="mb-2 text-xs text-gray-500">
      {{ t('opgg.champion.unnamedAugments', { count: unnamedCount }) }}
    </div>
    <NTabs v-model:value="augmentTab" size="small" :animated="false">
      <NTabPane v-for="group of augments" :key="group.rarity" :name="group.rarity">
        <template #tab>
          <span class="text-xs font-bold"
            >{{ group.rarityName }} · {{ group.augments.length }}</span
          >
        </template>

        <div class="my-2 flex flex-wrap items-center gap-2">
          <NCheckbox size="small" v-model:checked="showAdvancedStats">
            {{ t('opgg.champion.showAdvancedStats') }}
          </NCheckbox>
          <NCheckbox size="small" v-model:checked="isAugmentsExpanded">
            {{ t('opgg.champion.showAll') }}
          </NCheckbox>
          <NSelect
            v-model:value="augmentSort"
            size="tiny"
            :options="augmentSortOptions"
            class="w-22!"
            :consistent-menu-width="false"
            :render-label="renderLabel"
          />
        </div>

        <div
          class="grid gap-x-6 gap-y-1"
          :class="{
            'grid-cols-1 @min-[600px]:grid-cols-2': showAdvancedStats,
            'grid-cols-2': !showAdvancedStats
          }"
        >
          <div
            class="flex h-8 min-w-0 items-center gap-1"
            v-for="(a, i) of group.augments
              .filter(matchesSearch)
              .slice(0, isAugmentsExpanded || augmentSearch.trim() ? Infinity : 16)"
            :key="a.id"
          >
            <!-- name -->
            <div class="min-w-6 shrink-0 text-[10px] text-[#666666] dark:text-[#b2b2b2]">
              #{{ i + 1 }}
            </div>

            <!-- tier -->
            <div
              v-if="a.tier !== null"
              class="mr-1 flex size-4 shrink-0 items-center justify-center rounded text-[11px]"
              :class="TIER_COLOR[a.tier]"
            >
              {{ TIER_NAME[a.tier] }}
            </div>

            <div class="flex min-w-0 items-center gap-1">
              <NPopover v-if="a.display" :delay="100">
                <template #trigger>
                  <div class="flex min-w-0 items-center gap-1">
                    <LcuImage :src="a.display.iconPath" class="size-6 shrink-0 rounded" />
                    <span class="truncate text-xs">{{ a.display.name }}</span>
                  </div>
                </template>
                <div class="max-w-80 text-xs whitespace-pre-line">{{ a.display.description }}</div>
              </NPopover>
              <template v-else>
                <span class="name truncate text-xs">#{{ a.id }}</span>
              </template>
            </div>

            <div
              v-if="showAdvancedStats"
              class="ml-auto flex h-4 shrink-0 items-center justify-center rounded bg-black/10 px-1 text-[11px] text-black dark:bg-white/10 dark:text-white"
            >
              {{
                t(
                  effectiveSource === 'qq101'
                    ? 'opgg.champion.winRate'
                    : 'opgg.champion.augmentPerformance'
                )
              }}
              <span class="ml-1 font-bold"
                >{{ formatAugmentNumber(a.performance)
                }}{{ effectiveSource === 'qq101' ? '%' : '' }}</span
              >
            </div>

            <div
              v-if="showAdvancedStats"
              class="flex h-4 shrink-0 items-center justify-center rounded bg-black/10 px-1 text-[11px] text-black dark:bg-white/10 dark:text-white"
            >
              {{ t('opgg.champion.augmentPopular') }}
              <span class="ml-1 font-bold">{{ formatAugmentNumber(a.popular) }}</span>
            </div>
          </div>
        </div>
        <div
          v-if="!group.augments.some(matchesSearch)"
          class="py-4 text-center text-xs text-gray-500"
        >
          {{ t('opgg.champion.noMatchingAugments') }}
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<script setup lang="tsx">
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { OpggAramMayhemChampionAugmentItem } from '@shared/types/opgg'
import { ArrowSort16Filled } from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import {
  NCheckbox,
  NIcon,
  NInput,
  NSelect,
  NTabPane,
  NTabs,
  NPopover,
  SelectOption
} from 'naive-ui'
import { computed, ref, watch, watchEffect } from 'vue'

import { useOpgg } from '../context'

const { champion, kiwiAugments, effectiveSource } = useOpgg()
const { t } = useTranslation()
const extra = useExtraAssetsStore()

const augmentTab = ref<AugmentTab | undefined>(undefined)
const augmentSort = ref<AugmentSort>('default')
const augmentSearch = ref('')

function formatAugmentNumber(value: number | null) {
  return value !== null && Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '—'
}

function matchesSearch(augment: OpggAramMayhemChampionAugmentItem) {
  const query = augmentSearch.value.trim().toLocaleLowerCase()
  const name = augment.display?.name ?? ''
  return !query || `${augment.id} ${name}`.toLocaleLowerCase().includes(query)
}

const enum AugmentTab {
  All = '<akari:all>',
  kSilver = 'kSilver',
  kGold = 'kGold',
  kPrismatic = 'kPrismatic'
}

const TIER_NAME = {
  0: 'S',
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
  6: 'F'
}

const TIER_COLOR = {
  0: 'bg-violet-500 text-white dark:bg-violet-500 dark:text-white',
  1: 'bg-blue-500 text-white dark:bg-blue-500 dark:text-white',
  2: 'bg-emerald-500 text-white dark:bg-emerald-500 dark:text-white',
  3: 'bg-yellow-600 text-white dark:bg-yellow-600 dark:text-white',
  4: 'bg-gray-500 text-white dark:bg-gray-500 dark:text-white',
  5: 'bg-gray-500 text-white dark:bg-gray-500 dark:text-white',
  6: 'bg-gray-500 text-white dark:bg-gray-500 dark:text-white'
}

type AugmentSort = 'default' | 'performance' | 'popular'
type KiwiAugmentWithRarity = OpggAramMayhemChampionAugmentItem & {
  rarity: string | null
}

const augmentSortOptions = computed(() => [
  { label: t('opgg.champion.augmentSort.default'), value: 'default' },
  { label: t('opgg.champion.augmentSort.performance'), value: 'performance' },
  { label: t('opgg.champion.augmentSort.popular'), value: 'popular' }
])

const renderLabel = (option: SelectOption) => {
  return (
    <div class="flex items-center">
      <NIcon>
        <ArrowSort16Filled />
      </NIcon>
      <span class="ml-1">{option.label as string}</span>
    </div>
  )
}

const sortAugments = (items: KiwiAugmentWithRarity[]) => {
  if (augmentSort.value === 'performance') {
    return items.toSorted((a, b) => {
      if (a.popular === 0 && b.popular !== 0) {
        return 1
      }

      if (a.popular !== 0 && b.popular === 0) {
        return -1
      }

      return (b.performance ?? -Infinity) - (a.performance ?? -Infinity)
    })
  }

  if (augmentSort.value === 'popular') {
    return items.toSorted((a, b) => (b.popular ?? -Infinity) - (a.popular ?? -Infinity))
  }

  return items.toSorted((a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity))
}

const isAugmentsExpanded = ref(false)
const showAdvancedStats = ref(false)

function augmentDisplay(item: OpggAramMayhemChampionAugmentItem) {
  if (item.display) return item.display
  // QQ101 uses Tencent's Mayhem resource IDs. Arena resources can reuse IDs for different augments.
  if (effectiveSource.value !== 'qq101') return undefined
  const resource = extra.kiwiAugmentsMap[item.id]
  if (!resource?.name_cn && !resource?.name_en) return undefined
  return {
    name: resource.name_cn || resource.name_en,
    iconPath: resource.small_Icon,
    rarity: resource.level,
    description: (resource.tooltip || resource.desc || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  }
}
const unnamedCount = computed(
  () => kiwiAugments.value?.data.filter((item) => !augmentDisplay(item)).length ?? 0
)

const augments = computed(() => {
  if (!kiwiAugments.value) {
    return null
  }

  const mappedByRarity = kiwiAugments.value.data.map((item) => {
    const display = augmentDisplay(item)
    return {
      ...item,
      display,
      rarity: display?.rarity ?? null
    }
  })

  const sortedAugments = sortAugments(mappedByRarity)

  const kSilver = sortAugments(mappedByRarity.filter((item) => item.rarity === 'kSilver'))
  const kGold = sortAugments(mappedByRarity.filter((item) => item.rarity === 'kGold'))
  const kPrismatic = sortAugments(mappedByRarity.filter((item) => item.rarity === 'kPrismatic'))

  const groups: {
    rarity: AugmentTab
    rarityName: string
    augments: KiwiAugmentWithRarity[]
  }[] = []

  // all
  if (sortedAugments.length) {
    groups.push({
      rarity: AugmentTab.All,
      rarityName: t('opgg.champion.augmentAll'),
      augments: sortedAugments
    })
  }

  // kSilver
  if (kSilver.length) {
    groups.push({
      rarity: AugmentTab.kSilver,
      rarityName: t('opgg.champion.augmentSilver'),
      augments: kSilver
    })
  }

  // kGold
  if (kGold.length) {
    groups.push({
      rarity: AugmentTab.kGold,
      rarityName: t('opgg.champion.augmentGold'),
      augments: kGold
    })
  }

  // kPrismatic
  if (kPrismatic.length) {
    groups.push({
      rarity: AugmentTab.kPrismatic,
      rarityName: t('opgg.champion.augmentPrism'),
      augments: kPrismatic
    })
  }

  return groups
})

watch(
  () => augments.value?.map((group) => group.rarity) ?? [],
  (tabs) => {
    if (!tabs.length) {
      augmentTab.value = undefined
      return
    }

    const activeTab = augmentTab.value
    if (!activeTab || !tabs.includes(activeTab)) {
      augmentTab.value = tabs[0]
    }
  },
  { immediate: true }
)

watchEffect(() => {
  if (!champion.value) {
    isAugmentsExpanded.value = false
  }
})
</script>
