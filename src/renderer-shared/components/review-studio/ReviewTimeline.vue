<template>
  <NCard size="small" :title="text.map">
    <template #header-extra>
      <NTag size="small" :bordered="false">{{
        currentFrame ? text.frameCount(currentIndex + 1, model.frames.length) : text.noFrames
      }}</NTag>
    </template>
    <div v-if="currentFrame" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <NText depth="3">{{ text.snapshot }}</NText>
          <NText strong class="tabular-nums">{{ reviewTime(currentFrame.timestamp) }}</NText>
          <NTag v-if="currentIndex === model.frames.length - 1" size="small" :bordered="false">{{
            text.lastFrame
          }}</NTag>
        </div>
        <div class="flex items-center gap-1">
          <NButton size="small" :disabled="currentIndex <= 0" @click="step(-1)">{{
            text.previous
          }}</NButton>
          <NButton
            size="small"
            secondary
            type="primary"
            :disabled="model.frames.length < 2 || !active"
            @click="togglePlayback"
          >
            {{
              playing
                ? text.pause
                : currentIndex === model.frames.length - 1
                  ? text.replay
                  : text.play
            }}
          </NButton>
          <NButton
            size="small"
            :disabled="currentIndex >= model.frames.length - 1"
            @click="step(1)"
            >{{ text.next }}</NButton
          >
          <NSelect
            v-model:value="speed"
            size="small"
            class="w-20!"
            :options="speedOptions"
            :aria-label="text.speed"
          />
        </div>
      </div>
      <NSlider
        :value="currentIndex"
        :min="0"
        :max="Math.max(1, model.frames.length - 1)"
        :step="1"
        :disabled="model.frames.length < 2"
        :format-tooltip="sliderTooltip"
        :aria-label="text.slider"
        @update:value="setFrame"
      />
      <div class="timeline-layout">
        <div class="flex min-w-0 flex-col gap-3">
          <NRadioGroup v-model:value="mapMode" size="small" :aria-label="text.map">
            <NRadioButton value="all">{{ text.allPlayers }}</NRadioButton>
            <NRadioButton value="own">{{ text.ownPlayer }}</NRadioButton>
            <NRadioButton value="events">{{ text.eventsOnly }}</NRadioButton>
          </NRadioGroup>
          <div class="review-map">
            <img :src="map11" :alt="text.mapAlt" class="map-image" />
            <NTooltip
              v-for="marker in playerMarkers"
              :key="marker.participant.participantId"
              trigger="hover"
            >
              <template #trigger>
                <NButton
                  quaternary
                  circle
                  class="map-player"
                  :class="{ 'map-player-focus': focusedId === marker.participant.participantId }"
                  :aria-pressed="focusedId === marker.participant.participantId"
                  :style="marker.style"
                  :aria-label="
                    text.mapPlayerLabel(
                      championName(marker.participant),
                      teamLabel(marker.participant.teamId),
                      playerState(marker.frame)
                    )
                  "
                  @click="focusedId = marker.participant.participantId"
                >
                  <ChampionIcon
                    :champion-id="marker.participant.championId"
                    round
                    ring
                    :ring-color="teamColor(marker.participant.teamId)"
                    :ring-width="
                      marker.participant.participantId === model.meta.participantId ||
                      marker.participant.participantId === model.meta.opponentId
                        ? 3
                        : 2
                    "
                    class="size-7!"
                  />
                  <span
                    v-if="marker.participant.participantId === model.meta.participantId"
                    class="map-badge"
                    >{{ text.me }}</span
                  >
                  <span
                    v-else-if="marker.participant.participantId === model.meta.opponentId"
                    class="map-badge"
                    >{{ text.opponent }}</span
                  >
                </NButton>
              </template>
              {{ championName(marker.participant) }} · {{ teamLabel(marker.participant.teamId) }} ·
              {{ playerState(marker.frame) }}
            </NTooltip>
            <template v-if="showEvents || mapMode === 'events'">
              <NTooltip v-for="marker in eventMarkers" :key="marker.event.id" trigger="hover">
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    class="map-event"
                    :style="marker.style"
                    :aria-label="`${reviewTime(marker.event.timestamp)} ${eventLabel(marker.event)}`"
                    @click="emit('event', marker.event)"
                    >{{ marker.event.type === 'kill' ? '×' : '◆' }}</NButton
                  >
                </template>
                {{ reviewTime(marker.event.timestamp) }} · {{ eventLabel(marker.event) }}
              </NTooltip>
            </template>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex gap-3 text-xs">
              <NText :style="{ color: teamColor(100) }">{{ text.blue }}</NText>
              <NText :style="{ color: teamColor(200) }">{{ text.red }}</NText>
            </div>
            <NCheckbox v-if="mapMode !== 'events'" v-model:checked="showEvents">{{
              text.showEvents
            }}</NCheckbox>
          </div>
          <NText depth="3" class="text-xs">{{
            text.eventWindow(reviewTime(intervalStart), reviewTime(currentFrame.timestamp))
          }}</NText>
          <NText v-if="selectedEvent" class="text-xs"
            >{{ text.exactEvent }} {{ reviewTime(selectedEvent.timestamp) }} ·
            {{ eventLabel(selectedEvent)
            }}<template v-if="!selectedEvent.position"> · {{ text.noCoordinates }}</template></NText
          >
          <NText depth="3" class="text-xs leading-5">{{ text.playbackHint }}</NText>
          <NDivider class="my-0!" />
          <NText strong class="text-xs">{{ text.participants }}</NText>
          <div class="participant-grid">
            <NButton
              v-for="participant in sortedParticipants"
              :key="participant.participantId"
              size="small"
              :secondary="focusedId === participant.participantId"
              :aria-pressed="focusedId === participant.participantId"
              :type="focusedId === participant.participantId ? 'primary' : 'default'"
              @click="focusedId = participant.participantId"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <ChampionIcon :champion-id="participant.championId" class="size-5! rounded" />
                <span class="truncate">{{ championName(participant) }}</span>
                <span v-if="participant.participantId === model.meta.participantId" class="text-xs"
                  >· {{ text.me }}</span
                >
                <span
                  v-else-if="participant.participantId === model.meta.opponentId"
                  class="text-xs"
                  >· {{ text.opponent }}</span
                >
              </div>
            </NButton>
          </div>
          <div v-if="focusedPlayer" class="player-details">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <NText strong>{{ championName(focusedPlayer) }}</NText>
              <NText depth="3" class="text-xs">{{ playerState(focusedFrame) }}</NText>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              <span>{{ text.gold }} {{ valueLabel(focusedFrame?.gold) }}</span>
              <span>{{ text.cs }} {{ valueLabel(focusedFrame?.cs) }}</span>
              <span>{{ text.level }} {{ valueLabel(focusedFrame?.level) }}</span>
            </div>
          </div>
        </div>
        <div class="flex min-w-0 flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <NText strong>{{ text.events }}</NText>
            <NText depth="3" class="text-xs">{{ text.eventCount(filteredEvents.length) }}</NText>
          </div>
          <div class="flex flex-wrap gap-2">
            <NRadioGroup v-model:value="eventScope" size="small" :aria-label="text.events">
              <NRadioButton value="own">{{ text.related }}</NRadioButton>
              <NRadioButton value="all">{{ text.allEvents }}</NRadioButton>
            </NRadioGroup>
            <NSelect
              v-model:value="eventType"
              size="small"
              class="w-32!"
              :options="typeOptions"
              :aria-label="text.anyType"
            />
          </div>
          <NText v-if="moment" depth="3" class="text-xs">{{
            text.selectedRange(reviewTime(moment.start), reviewTime(moment.end))
          }}</NText>
          <NEmpty
            v-if="!filteredEvents.length"
            size="small"
            :description="text.noEvents"
            class="py-8"
          />
          <NScrollbar v-else class="event-scroll" style="max-height: 590px">
            <div class="flex flex-col gap-2 pr-2">
              <NButton
                v-for="event in filteredEvents"
                :key="event.id"
                block
                class="event-row"
                :secondary="selectedEventId === event.id"
                :type="selectedEventId === event.id ? 'primary' : 'default'"
                @click="emit('event', event)"
              >
                <div class="flex min-w-0 flex-col gap-1.5 text-left">
                  <div class="flex flex-wrap items-center gap-2">
                    <NText depth="3" class="text-xs tabular-nums">{{
                      reviewTime(event.timestamp)
                    }}</NText>
                    <ChampionIcon
                      v-for="participant in eventParticipants(event)"
                      :key="participant.participantId"
                      :champion-id="participant.championId"
                      class="size-5! rounded"
                    />
                    <NTag v-if="!event.position" size="tiny" :bordered="false">{{
                      text.noCoordinates
                    }}</NTag>
                  </div>
                  <span class="event-description">{{ eventLabel(event) }}</span>
                  <NText
                    v-if="event.assistingParticipantIds.length"
                    depth="3"
                    class="event-description text-xs"
                    >{{ assistsLabel(event) }}</NText
                  >
                  <NText
                    v-if="event.shutdownBounty !== null && event.shutdownBounty > 0"
                    type="warning"
                    class="text-xs"
                    >{{ text.shutdown(event.shutdownBounty) }}</NText
                  >
                </div>
              </NButton>
            </div>
          </NScrollbar>
        </div>
      </div>
    </div>
    <NEmpty v-else :description="text.noFrames" class="py-8" />
  </NCard>
</template>

<script setup lang="ts">
import map11 from '@renderer-shared/components/match-card/map-images/11.png'
import { mapToImagePosition } from '@renderer-shared/components/match-card/utils/game-map'
import { getTeamColor } from '@renderer-shared/components/match-card/utils/theme'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import {
  NButton,
  NCard,
  NCheckbox,
  NDivider,
  NEmpty,
  NRadioButton,
  NRadioGroup,
  NScrollbar,
  NSelect,
  NSlider,
  NTag,
  NText,
  NTooltip,
  useThemeVars
} from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type {
  ReviewEvent,
  ReviewMatch,
  ReviewMoment,
  ReviewParticipant,
  ReviewParticipantFrame,
  ReviewPoint
} from './types'
import { reviewViewText as text } from './review-view-text'
import { isReviewEventRelated, reviewEventText, reviewTime } from './review-view-utils'

const props = withDefaults(
  defineProps<{
    model: ReviewMatch
    frameIndex: number
    active?: boolean
    seekToken?: number
    selectedEventId?: string | null
    moment?: ReviewMoment | null
  }>(),
  { active: true }
)
const emit = defineEmits<{ frame: [index: number]; event: [event: ReviewEvent] }>()
const resources = useAkariResourceProvider()
const theme = useThemeVars()
const playing = ref(false)
const speed = ref(1)
const mapMode = ref<'all' | 'own' | 'events'>('all')
const showEvents = ref(true)
const focusedId = ref(props.model.meta.participantId)
const eventScope = ref<'own' | 'all'>('all')
const eventType = ref<'all' | ReviewEvent['type']>('all')
const speedOptions = [
  { label: '1×', value: 1 },
  { label: '2×', value: 2 }
]
const typeOptions = [
  { label: text.anyType, value: 'all' },
  { label: text.kills, value: 'kill' },
  { label: text.buildings, value: 'building' },
  { label: text.monsters, value: 'monster' }
]
const currentIndex = computed(() =>
  Math.max(0, Math.min(props.frameIndex, props.model.frames.length - 1))
)
const currentFrame = computed(() => props.model.frames[currentIndex.value])
const intervalStart = computed(() => props.model.frames[currentIndex.value - 1]?.timestamp ?? 0)
const selectedEvent = computed(() =>
  props.model.events.find((event) => event.id === props.selectedEventId)
)
const focusedPlayer = computed(() =>
  props.model.participants.find((participant) => participant.participantId === focusedId.value)
)
const focusedFrame = computed(() =>
  currentFrame.value?.participants.find(
    (participant) => participant.participantId === focusedId.value
  )
)
const sortedParticipants = computed(() =>
  props.model.participants.toSorted(
    (a, b) =>
      (a.teamId === props.model.meta.teamId ? 0 : 1) -
        (b.teamId === props.model.meta.teamId ? 0 : 1) || a.participantId - b.participantId
  )
)
const teamColor = (teamId: number) => getTeamColor(`TEAM-${teamId}`)
const teamLabel = (teamId: number) => (teamId === props.model.meta.teamId ? text.ally : text.enemy)
const championName = (participant: ReviewParticipant) =>
  resources.champions.name(participant.championId)
const valueLabel = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString()
const playerState = (frame?: ReviewParticipantFrame) =>
  frame?.alive === false
    ? text.dead
    : !frame?.position
      ? text.noPosition
      : frame.alive === null
        ? text.unknownLife
        : text.alive
const pointStyle = (position: ReviewPoint) => {
  const point = mapToImagePosition(position.x, position.y, 100, 100, 11)
  return { left: `${point.left}%`, top: `${point.top}%` }
}
const playerMarkers = computed(() => {
  if (mapMode.value === 'events') return []
  return props.model.participants.flatMap((participant) => {
    if (mapMode.value === 'own' && participant.participantId !== props.model.meta.participantId)
      return []
    const frame = currentFrame.value?.participants.find(
      (value) => value.participantId === participant.participantId
    )
    if (!frame?.position || frame.alive === false) return []
    return [{ participant, frame, style: pointStyle(frame.position) }]
  })
})
const eventMarkers = computed(() =>
  props.model.events
    .filter(
      (event) =>
        event.position &&
        (event.id === props.selectedEventId ||
          (event.timestamp <= (currentFrame.value?.timestamp ?? 0) &&
            (event.timestamp > intervalStart.value ||
              (currentIndex.value === 0 && event.timestamp === 0))))
    )
    .map((event) => ({
      event,
      style: {
        ...pointStyle(event.position!),
        color:
          event.id === props.selectedEventId
            ? theme.value.warningColor
            : event.teamId
              ? teamColor(event.teamId)
              : theme.value.textColor1
      }
    }))
)
const filteredEvents = computed(() =>
  props.model.events.filter(
    (event) =>
      (eventScope.value === 'all' || isReviewEventRelated(event, props.model.meta.participantId)) &&
      (eventType.value === 'all' || event.type === eventType.value) &&
      (!props.moment ||
        (event.timestamp >= props.moment.start && event.timestamp <= props.moment.end))
  )
)
const eventLabel = (event: ReviewEvent) =>
  reviewEventText(
    event,
    props.model.participants,
    resources.champions.name,
    props.model.meta.teamId
  )
const eventParticipants = (event: ReviewEvent) =>
  [...new Set([event.killerId, event.victimId])].flatMap((id) => {
    const participant = props.model.participants.find((value) => value.participantId === id)
    return participant ? [participant] : []
  })
const assistsLabel = (event: ReviewEvent) =>
  text.assists(
    event.assistingParticipantIds
      .map((id) => {
        const participant = props.model.participants.find((value) => value.participantId === id)
        return participant ? championName(participant) : text.unknownPlayer
      })
      .join('、')
  )
const sliderTooltip = (index: number) => reviewTime(props.model.frames[index]?.timestamp ?? 0)

let timer: ReturnType<typeof setInterval> | undefined
function stop() {
  playing.value = false
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}
function start() {
  stop()
  if (!props.active || props.model.frames.length < 2 || document.hidden) return
  playing.value = true
  timer = setInterval(() => {
    if (!props.active || document.hidden || currentIndex.value >= props.model.frames.length - 1) {
      stop()
      return
    }
    const nextIndex = currentIndex.value + 1
    emit('frame', nextIndex)
    if (nextIndex === props.model.frames.length - 1) stop()
  }, 1000 / speed.value)
}
function togglePlayback() {
  if (playing.value) {
    stop()
    return
  }
  if (currentIndex.value >= props.model.frames.length - 1) emit('frame', 0)
  start()
}
function setFrame(index: number) {
  stop()
  emit('frame', index)
}
function step(direction: number) {
  setFrame(Math.max(0, Math.min(props.model.frames.length - 1, currentIndex.value + direction)))
}
function onVisibilityChange() {
  if (document.hidden) stop()
}
watch(
  () => props.active,
  (active) => {
    if (!active) stop()
  }
)
watch(
  () => props.model,
  () => {
    stop()
    focusedId.value = props.model.meta.participantId
    eventScope.value = 'all'
    eventType.value = 'all'
  }
)
watch(speed, () => {
  if (playing.value) start()
})
watch(() => props.selectedEventId, stop)
watch(() => props.seekToken, stop)
watch(
  () => props.moment?.id,
  () => {
    stop()
    eventScope.value = 'all'
    eventType.value = 'all'
  }
)
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onBeforeUnmount(() => {
  stop()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.timeline-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 20px;
}
.review-map {
  position: relative;
  width: 100%;
  max-width: 380px;
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 4px;
}
.map-image {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}
.map-player,
.map-event {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 0 !important;
}
.map-player {
  width: 28px;
  height: 28px;
  z-index: 2;
}
.map-player-focus {
  outline: 2px solid var(--la-color-link);
  outline-offset: 3px;
  z-index: 4;
}
.map-badge {
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  line-height: 14px;
  padding: 0 3px;
  border-radius: 2px;
  background: var(--la-color-bg-primary);
  color: var(--la-color-text-primary);
  white-space: nowrap;
}
.map-event {
  width: 24px;
  height: 24px;
  font-size: 24px;
  font-weight: 700;
  z-index: 3;
  text-shadow: 0 1px 2px black;
}
.participant-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.participant-grid :deep(.n-button__content) {
  min-width: 0;
  width: 100%;
  justify-content: flex-start;
}
.player-details {
  border-radius: 4px;
  background: var(--la-card-muted-surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.event-row {
  height: auto;
  min-height: 64px;
  padding: 10px 12px;
}
.event-row :deep(.n-button__content) {
  display: block;
  width: 100%;
}
.event-description {
  white-space: normal;
  word-break: break-word;
  line-height: 1.5;
}
:deep(.n-card-header) {
  flex-wrap: wrap;
  gap: 8px;
}
</style>
