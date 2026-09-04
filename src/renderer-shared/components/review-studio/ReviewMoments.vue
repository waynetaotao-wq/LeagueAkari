<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <NText strong>{{ text.moments }}</NText>
      <NButton v-if="selectedId" size="tiny" quaternary @click="emit('select', null)">{{
        text.clearMoment
      }}</NButton>
    </div>
    <NText depth="3" class="text-xs">{{ text.momentsHint }}</NText>
    <NEmpty
      v-if="!model.moments.length"
      :description="text.momentsEmpty"
      size="small"
      class="py-4"
    />
    <div v-else class="moments-grid">
      <NCard
        v-for="moment in model.moments.slice(0, 5)"
        :key="moment.id"
        size="small"
        :class="{ 'moment-selected': selectedId === moment.id }"
      >
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <NText strong>{{ moment.title }}</NText>
            <NTag size="small" :bordered="false"
              >{{ reviewTime(moment.start) }}–{{ reviewTime(moment.end) }}</NTag
            >
          </div>
          <NText depth="2" class="text-xs leading-5">{{ moment.description }}</NText>
          <div
            v-if="moment.before !== null && moment.after !== null"
            class="flex items-center gap-2"
          >
            <NText depth="3" class="text-xs">{{
              moment.scope === 'team' ? text.teamGold : text.personalGold
            }}</NText>
            <NText strong
              >{{ reviewSigned(moment.before) }} → {{ reviewSigned(moment.after) }}</NText
            >
          </div>
          <div v-if="evidence(moment).length" class="flex flex-col gap-1">
            <NText depth="3" class="text-xs">{{ text.evidence }}</NText>
            <div v-for="event in evidence(moment).slice(0, 3)" :key="event.id" class="text-xs">
              <NText depth="3">{{ reviewTime(event.timestamp) }}</NText>
              <NText class="ml-2">{{ eventLabel(event) }}</NText>
            </div>
            <NText v-if="evidence(moment).length > 3" depth="3" class="text-xs">{{
              text.moreEvidence(evidence(moment).length - 3)
            }}</NText>
          </div>
          <NButton
            size="small"
            :type="selectedId === moment.id ? 'primary' : 'default'"
            :secondary="selectedId === moment.id"
            :aria-pressed="selectedId === moment.id"
            @click="emit('select', moment)"
            >{{ selectedId === moment.id ? text.selected : text.inspect }}</NButton
          >
        </div>
      </NCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { NButton, NCard, NEmpty, NTag, NText } from 'naive-ui'

import type { ReviewEvent, ReviewMatch, ReviewMoment } from './types'
import { reviewViewText as text } from './review-view-text'
import { reviewEventText, reviewSigned, reviewTime } from './review-view-utils'

const props = defineProps<{ model: ReviewMatch; selectedId?: string | null }>()
const emit = defineEmits<{ select: [moment: ReviewMoment | null] }>()
const resources = useAkariResourceProvider()
const evidence = (moment: ReviewMoment) =>
  props.model.events.filter((event) => moment.eventIds.includes(event.id))
const eventLabel = (event: ReviewEvent) =>
  reviewEventText(
    event,
    props.model.participants,
    resources.champions.name,
    props.model.meta.teamId
  )
</script>

<style scoped>
.moments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
  gap: 12px;
}
.moment-selected {
  border-color: var(--la-color-link);
}
</style>
