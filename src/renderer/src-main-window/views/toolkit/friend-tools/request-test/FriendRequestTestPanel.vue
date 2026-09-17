<template>
  <SettingsSection :title="t('title')" :footer="t('footer')">
    <SettingsRow :label="t('target')" :label-description="t('targetHint')" control-full-line>
      <NInput
        v-model:value="options.riotId"
        :disabled="locked"
        :placeholder="t('placeholder')"
        :maxlength="100"
        clearable
        size="small"
        class="w-full!"
        :input-props="{ 'aria-label': t('target') }"
      />
    </SettingsRow>
    <SettingsRow :label="t('timing')" :label-description="t('timingHint')" control-full-line>
      <div class="flex w-full flex-wrap gap-4">
        <div class="min-w-40 flex-1">
          <div class="mb-1 text-xs">{{ t('duration') }}</div>
          <NInputNumber
            v-model:value="duration"
            :disabled="locked"
            :min="1"
            :max="FRIEND_REQUEST_TEST_LIMITS.maxDurationMinutes"
            :precision="0"
            size="small"
            :input-props="{ 'aria-label': t('duration') }"
          />
        </div>
        <div class="min-w-40 flex-1">
          <div class="mb-1 text-xs">{{ t('interval') }}</div>
          <NInputNumber
            v-model:value="interval"
            :disabled="locked"
            :min="FRIEND_REQUEST_TEST_LIMITS.minIntervalSeconds"
            :max="FRIEND_REQUEST_TEST_LIMITS.maxIntervalSeconds"
            :step="0.1"
            size="small"
            :input-props="{ 'aria-label': t('interval') }"
          />
        </div>
      </div>
    </SettingsRow>
    <SettingsRow :label="t('accepted')" :label-description="t('acceptedHint')">
      <NSwitch
        v-model:value="options.removeAccepted"
        :disabled="locked"
        :aria-label="t('accepted')"
      />
    </SettingsRow>
    <div class="p-3">
      <NCheckbox v-model:checked="options.consented" :disabled="locked" size="small">{{
        t('consent')
      }}</NCheckbox>
      <div class="mt-3 flex flex-wrap gap-2">
        <NButton
          v-if="!snapshot.active"
          type="primary"
          size="small"
          :loading="busy"
          :disabled="!canStart"
          @click="start('start')"
          >{{ t('start') }}</NButton
        >
        <NButton
          v-else-if="snapshot.paused"
          type="primary"
          size="small"
          :disabled="busy || !available"
          @click="$emit('resume')"
          >{{ t('resume') }}</NButton
        >
        <NButton
          v-else
          size="small"
          :disabled="busy || snapshot.phase === 'stopping'"
          @click="$emit('pause')"
          >{{ t('pause') }}</NButton
        >
        <NButton
          v-if="snapshot.active"
          type="warning"
          size="small"
          :disabled="busy || snapshot.phase === 'stopping'"
          @click="$emit('stop')"
          >{{ t('stop') }}</NButton
        >
        <NButton
          v-if="!snapshot.active"
          size="small"
          :disabled="!canStart"
          @click="start('withdrawPending')"
          >{{ t('withdrawPending') }}</NButton
        >
      </div>
      <div v-if="!snapshot.active" class="mt-2 text-xs text-black/60 dark:text-white/60">
        {{ t('withdrawPendingHint') }}
      </div>
      <div
        v-if="!available && !snapshot.active"
        class="mt-2 text-xs text-black/60 dark:text-white/60"
      >
        {{ t('unavailable') }}
      </div>
      <NAlert v-if="startError" type="warning" :show-icon="false" class="mt-3">{{
        t(`reasons.${startError}`)
      }}</NAlert>
      <div
        v-if="snapshot.phase !== 'idle'"
        class="mt-4 rounded border border-black/10 p-3 dark:border-white/10"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold" role="status" aria-live="polite">{{
            snapshot.paused
              ? t('paused')
              : snapshot.phase === 'confirming' && snapshot.pendingOperation
                ? t(`confirmations.${snapshot.pendingOperation}`)
                : t(`phases.${snapshot.phase}`)
          }}</span>
          <span v-if="snapshot.mode === 'withdraw-only'" class="text-xs">{{
            t('withdrawOnlyTask')
          }}</span>
          <span v-else class="font-mono text-sm">{{
            t(snapshot.active ? 'remaining' : 'remainingAtEnd', {
              time: formatTime(snapshot.remainingMs)
            })
          }}</span>
        </div>
        <div v-if="snapshot.target" class="mt-1 text-xs break-all">
          {{ snapshot.target.gameName }}#{{ snapshot.target.tagLine }}
        </div>
        <div
          v-if="snapshot.active && snapshot.phase === 'waiting' && snapshot.waitRemainingMs > 0"
          class="mt-1 text-xs text-black/60 dark:text-white/60"
        >
          {{ t('nextAction', { time: formatTime(snapshot.waitRemainingMs) }) }}
        </div>
        <div v-if="snapshot.active && snapshot.phase === 'confirming'" class="mt-2 text-xs">
          {{ t('confirmationHint') }}
        </div>
        <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <span>{{ t('sent', { count: snapshot.sent }) }}</span>
          <span>{{ t('withdrawn', { count: snapshot.withdrawn }) }}</span>
          <span>{{ t('removed', { count: snapshot.removed }) }}</span>
        </div>
        <div class="mt-2 text-xs text-black/60 dark:text-white/60">{{ t('countsHint') }}</div>
        <div v-if="snapshot.lastSendIntervalMs !== null" class="mt-2 text-xs">
          {{ t('actualInterval', { seconds: (snapshot.lastSendIntervalMs / 1000).toFixed(3) }) }}
        </div>
        <div v-if="snapshot.httpStatus !== null" class="mt-2 text-xs">
          {{
            t('httpFailure', {
              status: snapshot.httpStatus,
              operation: snapshot.lastOperation ? t(`operations.${snapshot.lastOperation}`) : ''
            })
          }}
        </div>
        <NAlert v-if="snapshot.reason" :type="resultType" :show-icon="false" class="mt-3">
          <div class="font-medium">{{ t('endedReason') }}</div>
          <div>{{ t(`reasons.${snapshot.reason}`) }}</div>
        </NAlert>
        <div v-if="snapshot.target" class="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-medium">{{ t('relationshipTitle') }}</span>
            <NButton
              v-if="!snapshot.active"
              size="tiny"
              :loading="snapshot.refreshing"
              :disabled="!available || busy || snapshot.refreshing"
              @click="$emit('refreshRelationship')"
              >{{ t('refreshRelationship') }}</NButton
            >
          </div>
          <div class="mt-2 text-sm" role="status" aria-live="polite">
            {{ snapshot.refreshing ? t('refreshing') : t(`relationships.${relationshipKey}`) }}
          </div>
          <div
            v-if="snapshot.relationship && !refreshError"
            class="mt-1 text-xs text-black/60 dark:text-white/60"
          >
            {{
              t(snapshot.active ? 'relationshipCheckedDuringRun' : 'relationshipChecked', {
                time: formatCheckedTime(snapshot.relationship.checkedAt)
              })
            }}
          </div>
          <NAlert v-if="refreshError" type="warning" :show-icon="false" class="mt-2">
            {{ t('refreshFailed') }} {{ t(`reasons.${refreshError}`) }}
          </NAlert>
          <div
            v-if="!snapshot.active && !snapshot.refreshing && !refreshError"
            class="mt-2 text-xs leading-5"
          >
            {{ t(`nextSteps.${relationshipKey}`) }}
          </div>
        </div>
        <div v-if="snapshot.chatError" class="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {{
            t('chatFailure', {
              code: snapshot.chatError.code,
              category: snapshot.chatError.category
            })
          }}
        </div>
        <div
          v-if="
            snapshot.paused ||
            (!snapshot.active && snapshot.mayHaveRelationship && !snapshot.relationship)
          "
          class="mt-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {{ t('relationshipLeft') }}
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import SettingsSection from '@renderer-shared/components/SettingsSection.vue'
import {
  FRIEND_REQUEST_TEST_LIMITS,
  type FriendRequestTestOptions,
  type FriendRequestTestReason,
  type FriendRequestTestSnapshot
} from '@shared/shards/friend-request-test'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCheckbox, NInput, NInputNumber, NSwitch } from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{
  snapshot: FriendRequestTestSnapshot
  available: boolean
  busy: boolean
  startError: FriendRequestTestReason | null
  refreshError?: FriendRequestTestReason | null
}>()
const emit = defineEmits<{
  start: [options: FriendRequestTestOptions]
  withdrawPending: [options: FriendRequestTestOptions]
  pause: []
  resume: []
  stop: []
  refreshRelationship: []
}>()
const { t } = useTranslation(undefined, { keyPrefix: 'toolkit.friendRequestTest' })
const options = reactive({ riotId: '', removeAccepted: false, consented: false })
const duration = ref<number | null>(5)
const interval = ref<number | null>(30)
const locked = computed(() => props.snapshot.active || props.snapshot.refreshing || props.busy)
const relationshipKey = computed(() => {
  const relationship = props.refreshError ? null : props.snapshot.relationship
  if (!relationship) return 'unknown'
  if (relationship.isFriend && relationship.direction) return 'syncing'
  if (relationship.isFriend) return 'friend'
  return relationship.direction ?? 'none'
})
const resultType = computed(() => {
  if (props.snapshot.phase === 'failed') return 'error'
  if (['finished', 'withdrawn-only', 'no-outgoing-request'].includes(props.snapshot.reason ?? ''))
    return 'success'
  return 'warning'
})
const canStart = computed(() => {
  const parts = options.riotId.trim().split('#')
  return (
    props.available &&
    !locked.value &&
    options.consented &&
    parts.length === 2 &&
    parts.every((part) => part.trim()) &&
    duration.value !== null &&
    Number.isInteger(duration.value) &&
    duration.value >= 1 &&
    duration.value <= FRIEND_REQUEST_TEST_LIMITS.maxDurationMinutes &&
    interval.value !== null &&
    Number.isFinite(interval.value) &&
    interval.value >= FRIEND_REQUEST_TEST_LIMITS.minIntervalSeconds &&
    interval.value <= FRIEND_REQUEST_TEST_LIMITS.maxIntervalSeconds
  )
})
watch(
  () => props.snapshot.options,
  (saved) => {
    if (saved) {
      options.riotId = saved.riotId
      options.removeAccepted = saved.removeAccepted
      options.consented = saved.consented
      duration.value = saved.durationMinutes
      interval.value = saved.intervalSeconds
    }
  },
  { immediate: true }
)
const start = (action: 'start' | 'withdrawPending') => {
  if (canStart.value) {
    const payload = {
      ...options,
      durationMinutes: duration.value!,
      intervalSeconds: interval.value!
    }
    if (action === 'start') emit('start', payload)
    else emit('withdrawPending', payload)
  }
}
const formatTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const formatCheckedTime = (timestamp: number) => new Date(timestamp).toLocaleString()
</script>
