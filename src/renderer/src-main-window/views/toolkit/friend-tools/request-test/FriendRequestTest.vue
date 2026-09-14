<template>
  <FriendRequestTestPanel
    :snapshot="store.state.snapshot"
    :available="available && !disabled"
    :busy="busy"
    :start-error="startError"
    @start="start"
    @pause="command('pause')"
    @resume="command('resume')"
    @stop="command('stop')"
  />
</template>

<script setup lang="ts">
import { useActivated } from '@renderer-shared/composables/useActivated'
import { useInstance } from '@renderer-shared/shards'
import { FriendRequestTestRenderer } from '@renderer-shared/shards/friend-request-test'
import { useFriendRequestTestStore } from '@renderer-shared/shards/friend-request-test/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type {
  FriendRequestTestOptions,
  FriendRequestTestReason
} from '@shared/shards/friend-request-test'
import { computed, ref, watch } from 'vue'

import FriendRequestTestPanel from './FriendRequestTestPanel.vue'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ activeChange: [active: boolean]; relationshipChange: [] }>()
const shard = useInstance(FriendRequestTestRenderer)
const store = useFriendRequestTestStore()
const client = useLeagueClientStore()
const activated = useActivated()
const busy = ref(false)
const startError = ref<FriendRequestTestReason | null>(null)
const available = computed(
  () =>
    activated.value &&
    client.isConnected &&
    !!client.summoner.me?.puuid &&
    client.chat.me?.puuid === client.summoner.me.puuid &&
    ['None', 'Lobby'].includes(client.gameflow.phase ?? '')
)
async function start(options: FriendRequestTestOptions) {
  busy.value = true
  startError.value = null
  try {
    const result = await shard.start(options)
    if (!result.started) startError.value = result.reason
  } catch {
    startError.value = 'request-failed'
  } finally {
    busy.value = false
  }
}
async function command(action: 'pause' | 'resume' | 'stop') {
  busy.value = true
  startError.value = null
  try {
    await shard[action]()
  } catch {
    startError.value = 'request-failed'
  } finally {
    busy.value = false
  }
}
watch(
  activated,
  (value) => {
    if (!value && store.state.snapshot.active) void command('pause')
  },
  { flush: 'sync' }
)
watch(
  () => store.state.snapshot.active,
  (active, before) => {
    emit('activeChange', active)
    if (before && !active) emit('relationshipChange')
  },
  { immediate: true }
)
</script>
