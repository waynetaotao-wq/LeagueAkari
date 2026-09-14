import { createFriendRequestTestSnapshot } from '@shared/shards/friend-request-test'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useFriendRequestTestStore = defineStore('shard:friend-request-test-renderer', () => {
  const state = shallowReactive({ snapshot: createFriendRequestTestSnapshot() })
  return { state }
})
