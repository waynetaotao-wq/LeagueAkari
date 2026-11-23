import { AI_COACH_DEFAULT_ANTHROPIC_MODEL, type AiCoachProvider } from '@shared/shards/ai-coach'
import { makeAutoObservable } from 'mobx'

/** 这里只有服务商、模型和地址；密钥不在设置里。 */
export class AiCoachSettings {
  provider: AiCoachProvider = 'anthropic'

  anthropicModel: string = AI_COACH_DEFAULT_ANTHROPIC_MODEL

  /** 留空 = Claude 官方地址；填了就是自定义的中转地址 */
  anthropicBaseUrl: string = ''

  openaiBaseUrl: string = ''

  openaiModel: string = ''

  constructor() {
    makeAutoObservable(this)
  }
}

export class AiCoachState {
  /** 是否已经填过密钥；界面只知道有没有，拿不到密钥本身 */
  hasAnthropicKey: boolean = false

  hasOpenaiKey: boolean = false

  /** 系统能否加密保存密钥；不能时密钥只留在内存里，关掉程序就没了 */
  canPersistKeys: boolean = false

  setHasKey(provider: AiCoachProvider, hasKey: boolean) {
    if (provider === 'anthropic') {
      this.hasAnthropicKey = hasKey
    } else {
      this.hasOpenaiKey = hasKey
    }
  }

  setCanPersistKeys(canPersistKeys: boolean) {
    this.canPersistKeys = canPersistKeys
  }

  constructor() {
    makeAutoObservable(this)
  }
}
