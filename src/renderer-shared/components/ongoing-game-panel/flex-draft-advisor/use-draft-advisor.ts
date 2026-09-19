import { useOngoingGameProvider } from '@renderer-shared/providers/ongoing-game'
import { useInstance } from '@renderer-shared/shards'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { DraftMatchupLoader, type DraftMatchups } from './matchup-loader'
import {
  type DraftRole,
  buildTargetPool,
  getDraftContext,
  inferRole,
  pickCandidates,
  rankBans,
  rankPicks,
  readPlayerHistory
} from './model'

export function useDraftAdvisor() {
  const game = useOngoingGameProvider()
  const leagueClient = useLeagueClientStore()
  const loader = new DraftMatchupLoader(useInstance(ChampionDataRenderer))
  const selectedRole = ref<DraftRole | null>(null)
  const selectedOpponent = ref<string | null>(null)
  const comfortable = ref<number[] | null>(null)
  const refresh = ref(0)
  const loading = ref(false)
  const failed = ref(false)
  const result = shallowRef<DraftMatchups>({ patch: null, samples: {}, failed: [] })
  const resultScope = ref<string | null>(null)
  const context = computed(() => getDraftContext(game, leagueClient.champSelect.session))
  watch(
    () => context.value?.key,
    () => {
      selectedRole.value = null
      selectedOpponent.value = null
      comfortable.value = null
    },
    { flush: 'sync' }
  )
  watch(
    () => context.value?.enemies,
    (enemies) => {
      if (selectedOpponent.value && !enemies?.some((p) => p.puuid === selectedOpponent.value))
        selectedOpponent.value = null
    },
    { flush: 'sync' }
  )
  const histories = computed(() =>
    Object.fromEntries(
      context.value
        ? [context.value.self, ...context.value.enemies].map((player) => [
            player.puuid,
            readPlayerHistory(player.puuid, game.matchHistory[player.puuid]?.data)
          ])
        : []
    )
  )
  const role = computed(
    () =>
      selectedRole.value ??
      context.value?.self.position ??
      inferRole(histories.value[context.value?.self.puuid ?? ''])
  )
  const target = computed(() =>
    context.value
      ? buildTargetPool(context.value, histories.value, role.value, selectedOpponent.value)
      : null
  )
  const currentScope = computed(() =>
    context.value && role.value ? `${context.value.key}:${role.value}` : null
  )
  const candidates = computed(() =>
    context.value
      ? pickCandidates(
          context.value,
          histories.value[context.value.self.puuid],
          role.value,
          comfortable.value,
          leagueClient.champSelect.currentPickableChampionIds,
          leagueClient.champSelect.disabledChampionIds
        )
      : []
  )
  const bans = computed(() =>
    context.value
      ? rankBans(
          context.value,
          histories.value,
          leagueClient.champSelect.currentBannableChampionIds,
          leagueClient.champSelect.disabledChampionIds,
          [context.value.self.hoverChampionId, ...candidates.value.map((p) => p.championId)]
        )
      : []
  )
  const picks = computed(() =>
    target.value
      ? rankPicks(
          candidates.value,
          target.value,
          resultScope.value === currentScope.value ? result.value.samples : {}
        )
      : []
  )
  const championNames = computed(() =>
    Object.fromEntries(Object.values(leagueClient.gameData.champions).map((c) => [c.id, c.name]))
  )
  const pickableIds = computed(() =>
    [...leagueClient.champSelect.currentPickableChampionIds].filter(
      (id) =>
        !leagueClient.champSelect.disabledChampionIds.has(id) &&
        !context.value?.banned.has(id) &&
        !context.value?.locked.has(id) &&
        !context.value?.allyIntents.has(id)
    )
  )
  const playerNames = computed(() =>
    Object.fromEntries(
      (context.value?.enemies ?? []).map((p, i) => [
        p.puuid,
        game.streamerMode ? `#${i + 1}` : p.name
      ])
    )
  )
  const loadedPlayers = computed(
    () => context.value?.enemies.filter((p) => histories.value[p.puuid]?.games > 0).length ?? 0
  )
  const historyLoading = computed(() =>
    [context.value?.self, ...(context.value?.enemies ?? [])].some(
      (p) => p && game.matchHistoryLoadingState[p.puuid] === 'loading'
    )
  )

  watch(
    () =>
      JSON.stringify([
        context.value?.key,
        role.value,
        target.value?.champions.length
          ? candidates.value.map((p) => p.championId).sort((a, b) => a - b)
          : [],
        refresh.value
      ]),
    (_, __, onCleanup) => {
      const controller = new AbortController()
      if (resultScope.value !== currentScope.value)
        result.value = { patch: null, samples: {}, failed: [] }
      resultScope.value = currentScope.value
      failed.value = false
      loading.value = false
      const lane = role.value
      const ids = candidates.value.map((p) => p.championId)
      if (!context.value || !lane || !ids.length || !target.value?.champions.length) {
        result.value = { patch: null, samples: {}, failed: [] }
        return
      }
      loading.value = true
      const timer = setTimeout(async () => {
        try {
          const data = await loader.load(lane, ids, controller.signal, (partial) => {
            if (!controller.signal.aborted) result.value = partial
          })
          if (controller.signal.aborted) return
          result.value = data
          failed.value = data.failed.length > 0 || !data.patch
        } catch {
          if (!controller.signal.aborted) {
            result.value = { patch: null, samples: {}, failed: ids }
            failed.value = true
          }
        } finally {
          if (!controller.signal.aborted) loading.value = false
        }
      }, 250)
      onCleanup(() => {
        clearTimeout(timer)
        controller.abort()
      })
    },
    { immediate: true }
  )
  const interval = setInterval(() => {
    if (context.value) refresh.value += 1
  }, 5 * 60_000)
  onScopeDispose(() => clearInterval(interval))

  function retry() {
    // Successful, current-patch samples remain useful; retry only what is absent or expired.
    refresh.value += 1
  }

  return {
    context,
    histories,
    role,
    target,
    bans,
    picks,
    championNames,
    pickableIds,
    playerNames,
    selectedRole,
    selectedOpponent,
    comfortable,
    loading,
    failed,
    result,
    loadedPlayers,
    historyLoading,
    retry
  }
}
