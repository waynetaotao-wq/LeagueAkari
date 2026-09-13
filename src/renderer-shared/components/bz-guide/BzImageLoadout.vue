<template>
  <div class="bz-images">
    <div class="flex flex-wrap items-center gap-1.5">
      <NTag size="tiny" :bordered="false" :type="status === 'ready' ? 'success' : 'warning'">
        {{ t(`opgg.bzImages.status.${status}`) }}
      </NTag>
      <span v-if="location.sourceRow" class="source">
        {{ t('opgg.bzImages.location', { sheet: location.sourceSheet, row: location.sourceRow }) }}
      </span>
      <span v-if="row.imageLoadout?.catalogVersion" class="source">
        {{ t('opgg.bzImages.catalog', { version: row.imageLoadout.catalogVersion }) }}
      </span>
    </div>
    <div v-if="row.imageReference" class="source mt-1">
      {{
        t('opgg.bzImages.referenceTime', {
          time: new Date(row.imageReference.fetchedAt).toLocaleString()
        })
      }}
    </div>
    <div
      v-if="loadout?.spellIds || loadout?.starterItemId"
      class="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <template v-if="loadout.spellIds">
        <span class="source">{{ t('opgg.champion.spells') }}</span>
        <SummonerSpellDisplay v-for="id in loadout.spellIds" :key="id" :spell-id="id" :size="22" />
      </template>
      <template v-if="loadout.starterItemId">
        <span class="source">{{ t('opgg.champion.starterItemText') }}</span>
        <ItemDisplay :item-id="loadout.starterItemId" :size="22" />
      </template>
    </div>
    <div v-if="status !== 'ready'" class="mt-1 leading-relaxed">
      <template v-if="row.imageReference">
        {{ t(`opgg.bzImages.referenceReason.${row.imageReference.reason}`) }}
        {{ t('opgg.bzImages.referenceReading') }}
      </template>
      <template v-else-if="status === 'stale'">{{ t('opgg.bzImages.stale') }}</template>
      <template v-else>{{ issueText }}</template>
      <div v-if="row.imageReference && issueText">{{ issueText }}</div>
    </div>
    <div v-if="previews.length" class="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span class="source">{{ t('opgg.bzImages.previews') }}</span>
      <NImage
        v-for="(src, i) in previews"
        :key="i"
        :src="src"
        :width="32"
        :height="32"
        :alt="t('opgg.bzImages.previewAlt', { index: i + 1 })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ItemDisplay from '@renderer-shared/components/widgets/ItemDisplay.vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'
import type { BzMatchupRow } from '@shared/types/counter-intel'
import { resolveBzDisplayedLoadout } from '@shared/utils/bz-image-loadout'
import { useTranslation } from 'i18next-vue'
import { NImage, NTag } from 'naive-ui'
import { computed } from 'vue'

const { row } = defineProps<{ row: BzMatchupRow }>()
const { t } = useTranslation()
const loadout = computed(() => resolveBzDisplayedLoadout(row))
const location = computed(() => row.imageReference ?? row)
const status = computed(() =>
  row.imageReference
    ? 'reference'
    : row.stale
      ? 'stale'
      : (row.imageLoadout?.status ?? 'unavailable')
)
const issueText = computed(() => {
  const issues = (row.imageReference?.loadout ?? row.imageLoadout)?.issues ?? [
    { code: 'source-unavailable', field: 'both' }
  ]
  return [
    ...new Set(
      issues.map((issue) =>
        t('opgg.bzImages.issue', {
          field: t(`opgg.bzImages.fields.${issue.field}`),
          reason: t(`opgg.bzImages.issues.${issue.code}`)
        })
      )
    )
  ].join(' ')
})
const previews = computed(() =>
  row.stale
    ? []
    : (row.imageLoadout?.previews ?? [])
        .filter((src) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src))
        .slice(0, 6)
)
</script>

<style scoped>
.bz-images {
  margin: 6px 0;
  padding: 8px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
  border-radius: 6px;
  font-size: 11px;
}
.source {
  opacity: 0.7;
}
</style>
