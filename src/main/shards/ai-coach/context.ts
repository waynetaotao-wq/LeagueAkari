import type { AiCoachChatResult, AiCoachMessage } from '@shared/shards/ai-coach'

import type { AkariIpcMain } from '../ipc'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { AiCoachSettings, AiCoachState } from './state'

/**
 * [lolps] AI 教练
 *
 * 把复盘台整理好的对局资料发给用户自己选择的 AI 服务，流式拿回回答。
 * 服务商、模型、接口地址和密钥都由用户在界面里自己填写：
 * - 密钥只存在主进程。用系统自带的加密保存到单独的文件，不进设置表、不同步给界面、不写日志。
 * - 请求从主进程发出，走程序统一的代理设置。
 * - 日志只记服务商、模型名、状态和用量，不记请求内容和回答内容。
 */
export const AI_COACH_MAIN_NAMESPACE = 'ai-coach-main'

/** 每次连接最多等这么久，服务还不开始回应就算超时（连不上、被墙、代理不通）。 */
export const AI_COACH_CONNECT_TIMEOUT_MS = 2 * 60_000

/** 整个回答的最长时间：长回答加上思考可能要几分钟，再久多半是卡住了。 */
export const AI_COACH_REQUEST_TIMEOUT_MS = 10 * 60_000

/** 回答的片段攒这么久再发给界面一次，免得逐字通信。 */
export const AI_COACH_DELTA_FLUSH_MS = 60

/** 保存加密后密钥的文件名，位于程序的数据目录。 */
export const AI_COACH_CREDENTIAL_FILE = 'ai-coach-credentials.json'

/** 展示给用户的服务商报错最多保留这么多字。 */
export const AI_COACH_MAX_ERROR_MESSAGE_LENGTH = 300

export type AiCoachFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface AiCoachExecuteInput {
  apiKey: string
  model: string
  /** Already validated; never empty. */
  baseUrl: string
  system: string
  /** Already validated: starts and ends with the user, roles alternate. */
  messages: AiCoachMessage[]
  /** Aborts on cancel and on timeout; the caller tells the two apart. */
  signal: AbortSignal
  onDelta: (text: string) => void
  fetch: AiCoachFetch
}

/** One request to one provider. Resolves with a result for every outcome; never rejects. */
export type AiCoachExecutor = (input: AiCoachExecuteInput) => Promise<AiCoachChatResult>

export interface AiCoachMainContext {
  namespace: string
  logger: AkariLogger
  ipc: AkariIpcMain
  mobxUtils: MobxUtilsMain
  settings: AiCoachSettings
  state: AiCoachState
}
