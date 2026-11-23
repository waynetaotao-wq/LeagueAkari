import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useRankLogStore = defineStore('shard:rank-log-renderer', () => {
  const settings = shallowReactive({
    enabled: true
  })

  const state = shallowReactive({
    available: false,
    revision: 0,
    syncing: false,
    lastSyncedAt: 0
  })

  return {
    settings,
    state
  }
})
