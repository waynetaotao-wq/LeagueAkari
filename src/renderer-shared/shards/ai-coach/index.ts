import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type {
  AiCoachChatRequest,
  AiCoachChatResult,
  AiCoachDeltaEvent,
  AiCoachKeyResult,
  AiCoachProvider
} from '@shared/shards/ai-coach'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import { useAiCoachStore } from './store'

export const AI_COACH_MAIN_NAMESPACE = 'ai-coach-main'
export const AI_COACH_RENDERER_NAMESPACE = 'ai-coach-renderer'

type AiCoachSettingKey =
  'provider' | 'anthropicModel' | 'anthropicBaseUrl' | 'openaiBaseUrl' | 'openaiModel'

/** [lolps] AI 教练：渲染层的设置同步、发问与密钥填写入口 */
@Shard(AiCoachRenderer.id)
export class AiCoachRenderer implements IAkariShardInitDispose {
  static id = AI_COACH_RENDERER_NAMESPACE

  private readonly _deltaListeners = new Map<string, (text: string) => void>()

  constructor(
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) private readonly _piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) private readonly _settingUtils: SettingUtilsRenderer
  ) {}

  async onInit() {
    const store = useAiCoachStore()
    await this._piniaMobxUtils.sync(AI_COACH_MAIN_NAMESPACE, 'settings', store.settings)
    await this._piniaMobxUtils.sync(AI_COACH_MAIN_NAMESPACE, 'state', store.state)

    this._ipc.onEvent(AI_COACH_MAIN_NAMESPACE, 'chat-delta', (event: AiCoachDeltaEvent) => {
      this._deltaListeners.get(event?.requestId)?.(event.text)
    })

    // 窗口重新加载后，上一页留下的请求没人接收了：让它停下，免得占着位置。
    void this._ipc.call(AI_COACH_MAIN_NAMESPACE, 'cancelChat').catch(() => {})
  }

  /** Resolves with the outcome in every case; the pieces of the answer arrive through onDelta. */
  async chat(
    request: AiCoachChatRequest,
    onDelta: (text: string) => void
  ): Promise<AiCoachChatResult> {
    this._deltaListeners.set(request.requestId, onDelta)
    try {
      return await this._ipc.call(AI_COACH_MAIN_NAMESPACE, 'chat', request)
    } finally {
      this._deltaListeners.delete(request.requestId)
    }
  }

  cancel(requestId: string): Promise<boolean> {
    return this._ipc.call(AI_COACH_MAIN_NAMESPACE, 'cancelChat', requestId)
  }

  /** The key leaves this window here once and is never sent back. */
  setApiKey(provider: AiCoachProvider, key: string): Promise<AiCoachKeyResult> {
    return this._ipc.call(AI_COACH_MAIN_NAMESPACE, 'setApiKey', provider, key)
  }

  clearApiKey(provider: AiCoachProvider): Promise<boolean> {
    return this._ipc.call(AI_COACH_MAIN_NAMESPACE, 'clearApiKey', provider)
  }

  setSetting(key: 'provider', value: AiCoachProvider): Promise<unknown>
  setSetting(key: Exclude<AiCoachSettingKey, 'provider'>, value: string): Promise<unknown>
  setSetting(key: AiCoachSettingKey, value: string) {
    return this._settingUtils.set(AI_COACH_MAIN_NAMESPACE, key, value)
  }
}
