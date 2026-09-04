<template>
  <ReviewStudioModal
    v-if="target"
    v-model:show="show"
    :puuid="target.puuid"
    :sgp-server-id="target.sgpServerId"
    :initial-game-id="target.gameId"
    :initial-champion-id="target.championId"
  />
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { AppCommonRenderer } from '@renderer-shared/shards/app-common'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { defineAsyncComponent, ref, shallowRef, watch } from 'vue'

import { parseReviewStudioLink, type ReviewStudioTarget } from './link'

const ReviewStudioModal = defineAsyncComponent(() => import('./ReviewStudioModal.vue'))
const appCommon = useInstance(AppCommonRenderer)
const leagueClient = useLeagueClientStore()
const target = shallowRef<ReviewStudioTarget | null>(null)
const show = ref(false)

appCommon.onRendererLink((url) => {
  const next = parseReviewStudioLink(url)
  if (!next) return
  target.value = next
  show.value = true
})

// [lolps] Closing the modal stops its requests and playback when the logged-in identity changes.
watch(
  () => leagueClient.summoner.me?.puuid,
  () => {
    show.value = false
  }
)
</script>
