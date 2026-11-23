import { AI_COACH_DEFAULT_ANTHROPIC_MODEL, type AiCoachProvider } from '@shared/shards/ai-coach'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useAiCoachStore = defineStore('shard:ai-coach-renderer', () => {
  const settings = shallowReactive({
    provider: 'anthropic' as AiCoachProvider,
    anthropicModel: AI_COACH_DEFAULT_ANTHROPIC_MODEL as string,
    anthropicBaseUrl: '',
    openaiBaseUrl: '',
    openaiModel: ''
  })

  // 界面只知道密钥有没有填过，拿不到密钥本身。
  const state = shallowReactive({
    hasAnthropicKey: false,
    hasOpenaiKey: false,
    canPersistKeys: false
  })

  return {
    settings,
    state
  }
})
