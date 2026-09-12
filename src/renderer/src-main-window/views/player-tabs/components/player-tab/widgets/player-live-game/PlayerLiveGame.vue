<template>
  <LiveGameCard
    :state="state"
    :queue-name="queueName"
    :reason="reason"
    :can-launch="canLaunch"
    :launching="launching"
    @refresh="refresh"
    @spectate="spectate"
  />
</template>
<script setup lang="ts">
import { useActivated } from '@renderer-shared/composables/useActivated'
import { useInstance } from '@renderer-shared/shards'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { useDocumentVisibility } from '@vueuse/core'
import { useTranslation } from 'i18next-vue'
import { useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { usePlayerTab } from '../../context'
import { PlayerLiveGameController, emptyLiveGameState } from './controller'
import LiveGameCard from './LiveGameCard.vue'

const { puuid, sgpServerId, isCrossRegion, isCurrentTab, isSelfTab } = usePlayerTab()
const lc = useInstance(LeagueClientRenderer)
const sgp = useInstance(SgpRenderer)
const lcs = useLeagueClientStore()
const sgps = useSgpStore()
const { t } = useTranslation()
const message = useMessage()
const state = shallowRef(emptyLiveGameState())
const launching = ref(false)
const active = useActivated()
const visible = useDocumentVisibility()
const canQuerySgp = computed(
  () => Boolean(sgps.leagueServers.servers[sgpServerId.value]?.common) && sgps.isTokenReady
)
const canLaunch = computed(
  () =>
    lcs.isConnected &&
    !isSelfTab.value &&
    !isCrossRegion.value &&
    ['None', 'Lobby'].includes(lcs.gameflow.phase ?? '')
)
const identity = () => ({
  puuid: puuid.value,
  sgpServerId: sgpServerId.value,
  crossRegion: isCrossRegion.value
})
const controller = new PlayerLiveGameController({
  getGame: async (who, signal) => {
    if (!canQuerySgp.value) throw new Error('Game status source unavailable')
    return (await sgp.api.gsm.getByPuuid(who.puuid, { __sgpServerId: who.sgpServerId, signal }))
      .data
  },
  getFriends: async (signal) => {
    if (!lcs.isConnected) return []
    return (await lc.api.chat.getFriends({ signal })).data
  },
  launch: (id, key) => lc.api.spectator.launchSpectator(id, key),
  canLaunch: () => canLaunch.value,
  publish: (next) => {
    state.value = next
  }
})
const queueName = computed(() =>
  state.value.queueId ? lcs.gameData.queueName(state.value.queueId) : ''
)
const reason = computed(() => {
  if (!lcs.isConnected) return 'disconnected'
  if (state.value.status === 'unknown')
    return isCrossRegion.value && !canQuerySgp.value ? 'crossRegion' : 'unknown'
  if (state.value.status === 'in-game') {
    if (!state.value.canSpectate) return 'noGrant'
    if (!canLaunch.value) return 'busy'
  }
  return state.value.source === 'sgp' ? 'server' : 'friend'
})
async function refresh() {
  if (!launching.value && puuid.value) await controller.refresh(identity())
}
async function spectate() {
  if (launching.value || !state.value.gameId) return
  const expected = state.value.gameId
  launching.value = true
  try {
    const launched = await controller.spectate(identity(), expected)
    if (launched) message.success(() => t('playerTabs.liveGame.launchRequested'))
    else message.warning(() => t('playerTabs.liveGame.changed'))
  } catch {
    message.error(() => t('playerTabs.liveGame.launchFailed'))
  } finally {
    launching.value = false
  }
}
let timer: ReturnType<typeof setInterval> | undefined
watch(
  [puuid, sgpServerId, isCurrentTab, active, visible, () => lcs.isConnected, canQuerySgp],
  () => {
    clearInterval(timer)
    controller.stop()
    if (!isCurrentTab.value || !active.value || visible.value !== 'visible' || !lcs.isConnected)
      return
    void refresh()
    timer = setInterval(() => {
      if (!state.value.loading) void refresh()
    }, 30_000)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  clearInterval(timer)
  controller.stop()
})
</script>
