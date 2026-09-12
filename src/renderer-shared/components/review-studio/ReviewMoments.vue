<template>
  <div class="moments">
    <div class="moments-heading">
      <NText strong>{{ t('moments') }}</NText
      ><NText depth="3" class="text-xs">{{
        t('momentCount', { count: model.moments.length })
      }}</NText>
    </div>
    <NText depth="3" class="text-xs">{{ t('momentsHint') }}</NText>
    <NEmpty v-if="!model.moments.length" :description="t('noFocus')" size="small" class="py-4" />
    <NButton
      v-for="moment in model.moments"
      :key="moment.id"
      block
      class="moment-row"
      :aria-pressed="selectedId === moment.id"
      :secondary="selectedId === moment.id"
      @click="emit('select', moment)"
    >
      <div class="moment-content">
        <div class="moment-time">
          {{ reviewTime(moment.start) }}<span>{{ reviewTime(moment.end) }}</span>
        </div>
        <div class="moment-copy">
          <div class="moment-title">
            <NText strong>{{ moment.title }}</NText
            ><NTag
              :type="moment.kind === 'gold-gain' ? 'success' : 'warning'"
              size="tiny"
              :bordered="false"
              >{{ t(moment.kind === 'gold-gain' ? 'gain' : 'risk') }}</NTag
            >
          </div>
          <NText depth="3" class="moment-detail">{{ t(`questions.${moment.kind}`) }}</NText>
          <NText v-if="moment.before !== null && moment.after !== null" depth="2" class="text-xs"
            >{{ t(moment.scope === 'team' ? 'teamGold' : 'gold') }}
            {{ reviewSigned(moment.before) }} → {{ reviewSigned(moment.after) }}</NText
          >
          <NText v-else depth="3" class="text-xs">{{
            t('recordedEvents', { count: moment.eventIds.length })
          }}</NText>
        </div>
        <span class="moment-action">{{ t('inspect') }} ↗</span>
      </div>
    </NButton>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NButton, NEmpty, NTag, NText } from 'naive-ui'

import { reviewSigned, reviewTime } from './review-view-utils'
import type { ReviewMatch, ReviewMoment } from './types'

defineProps<{ model: ReviewMatch; selectedId?: string | null }>()
const emit = defineEmits<{ select: [moment: ReviewMoment | null] }>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
</script>

<style scoped>
.moments {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.moments-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.moment-row {
  height: auto;
  padding: 14px 16px;
  border-radius: 8px;
}
.moment-row :deep(.n-button__content) {
  display: block;
  width: 100%;
  white-space: normal;
  text-align: left;
}
.moment-content {
  display: flex;
  align-items: center;
  gap: 18px;
}
.moment-time {
  flex-shrink: 0;
  width: 52px;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--la-color-link);
}
.moment-time > span {
  display: block;
  font-size: 11px;
  font-weight: 400;
  margin-top: 4px;
  color: var(--la-color-text-primary);
}
.moment-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.moment-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}
.moment-detail {
  font-size: 12px;
  line-height: 1.65;
}
.moment-action {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--la-color-link);
}
@media (max-width: 560px) {
  .moment-content {
    gap: 12px;
    align-items: flex-start;
  }
  .moment-action {
    display: none;
  }
}
</style>
