import { type ComputedRef, type InjectionKey, inject, provide } from 'vue'

import type { MidDeepResult, MidLadderResult } from './analysis'

export interface MidResult {
  ladder: MidLadderResult
  deep: MidDeepResult
}

export interface MidResearchState {
  phase: 'idle' | 'list' | 'deep' | 'done' | 'error'
  progressDone: number
  progressTotal: number
  result: MidResult | null
}

export interface MidlaneResearch {
  visible: ComputedRef<boolean>
  championId: ComputedRef<number | null>
  isOpponent: ComputedRef<boolean>
  identity: ComputedRef<string>
  state: MidResearchState
  retry: () => Promise<void>
}

const key: InjectionKey<MidlaneResearch> = Symbol('midlane-research')

/** 每张玩家卡片只创建一份研究，头像与研究条共用结果和请求生命周期。 */
export function provideMidlaneResearch(value: MidlaneResearch) {
  provide(key, value)
}

export function useMidlaneResearch() {
  return inject(key, null)
}
