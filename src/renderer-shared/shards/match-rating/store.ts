import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useMatchRatingStore = defineStore('shard:match-rating-renderer', () => {
  const settings = shallowReactive({
    calibration: null as string | null
  })

  return { settings }
})
