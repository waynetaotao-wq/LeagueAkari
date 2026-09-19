<template>
  <FriendRequestTestPanel
    :snapshot="store.state.snapshot"
    :available="available && !disabled"
    :busy="busy"
    :start-error="startError"
    :refresh-error="refreshError"
    @start="(options) => submit(() => shard.start(options))"
    @withdraw-pending="(options) => submit(() => shard.withdrawPending(options))"
    @pause="command('pause')"
    @resume="command('resume')"
    @stop="command('stop')"
    @refresh-relationship="refreshRelationship"
  />
</template>

<script setup lang="ts">
import { useActivated } from '@renderer-shared/composables/useActivated'
import { useInstance } from '@renderer-shared/shards'
import { FriendRequestTestRenderer } from '@renderer-shared/shards/friend-request-test'
import { useFriendRequestTestStore } from '@renderer-shared/shards/friend-request-test/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type {
  FriendRequestTestReason,
  FriendRequestTestStartResult
} from '@shared/shards/friend-request-test'
import { computed, ref, watch } from 'vue'

import FriendRequestTestPanel from './FriendRequestTestPanel.vue'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ activeChange: [active: boolean]; relationshipChange: [] }>()
const shard = useInstance(FriendRequestTestRenderer)
const store = useFriendRequestTestStore()
const client = useLeagueClientStore()
const activated = useActivated()
const pendingCommands = ref(0)
const busy = computed(() => pendingCommands.value > 0)
let pausingWhenAway: Promise<void> | null = null
const startError = ref<FriendRequestTestReason | null>(null)
const refreshError = ref<FriendRequestTestReason | null>(null)
const available = computed(
  () =>
    activated.value &&
    client.isConnected &&
    !!client.summoner.me?.puuid &&
    client.chat.me?.puuid === client.summoner.me.puuid &&
    ['None', 'Lobby'].includes(client.gameflow.phase ?? '')
)
async function submit(action: () => Promise<FriendRequestTestStartResult>) {
  if (busy.value || !available.value || props.disabled) return
  pendingCommands.value++
  startError.value = null
  refreshError.value = null
  try {
    const result = await action()
    if (!result.started) startError.value = result.reason
    else await pauseWhenAway()
  } catch {
    startError.value = 'request-failed'
  } finally {
    pendingCommands.value--
  }
}
async function refreshRelationship() {
  if (busy.value || !available.value || props.disabled) return
  pendingCommands.value++
  refreshError.value = null
  try {
    const result = await shard.refreshRelationship()
    if (!result.refreshed) refreshError.value = result.reason
  } catch {
    refreshError.value = 'request-failed'
  } finally {
    pendingCommands.value--
  }
}
async function command(action: 'pause' | 'resume' | 'stop') {
  if (action === 'resume' && (!available.value || props.disabled)) return
  pendingCommands.value++
  startError.value = null
  try {
    await shard[action]()
    if (action === 'resume') await pauseWhenAway()
  } catch {
    startError.value = 'request-failed'
  } finally {
    pendingCommands.value--
  }
}
function pauseWhenAway(): Promise<void> | undefined {
  if (activated.value) return
  // A start/resume reply can arrive after deactivation or even unmount. Vue's
  // lifecycle watcher alone cannot cover that interval before state sync arrives.
  return (pausingWhenAway ??= command('pause').finally(() => {
    pausingWhenAway = null
  }))
}
watch(
  [activated, () => store.state.snapshot.active, () => store.state.snapshot.paused],
  ([present, active, paused]) => {
    if (!present && active && !paused) void pauseWhenAway()
  },
  { flush: 'sync' }
)
watch(
  () => busy.value || store.state.snapshot.active || store.state.snapshot.refreshing,
  (active, before) => {
    emit('activeChange', active)
    if (before && !active) emit('relationshipChange')
  },
  { immediate: true, flush: 'sync' }
)
</script>
