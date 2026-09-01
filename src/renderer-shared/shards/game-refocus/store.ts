import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useGameRefocusStore = defineStore('shard:game-refocus-renderer', () => {
  const settings = shallowReactive({
    enabled: true
  })

  const state = shallowReactive({
    supported: false,
    lastTriggeredAt: 0
  })

  return {
    settings,
    state
  }
})
