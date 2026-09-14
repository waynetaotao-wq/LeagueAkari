import { DEFAULT_HTTP_PROXY_SETTING } from '@shared/shards/network'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useNetworkStore = defineStore('shard:network-renderer', () => {
  const settings = shallowReactive({ httpProxy: { ...DEFAULT_HTTP_PROXY_SETTING } })

  return { settings }
})
