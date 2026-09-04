import { useInstance } from '@renderer-shared/shards'
import { MatchRatingRenderer } from '@renderer-shared/shards/match-rating'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, ref } from 'vue'

import { runCalibration, throwIfCalibrationAborted } from './akari-score-calibrate-runner'

export const RATING_CALIBRATION_GAMES = 400
export const RATING_CALIBRATION_MIN_GAMES = 20

/**
 * [lolps] 对局评分权重校准（可对任意玩家运行）：
 * 设置页用本人；战绩页可用当前查看的玩家，所学是这些对局的胜负相关性。
 */
export function useRatingCalibration() {
  const sgp = useInstance(SgpRenderer)
  const sgps = useSgpStore()
  const mr = useInstance(MatchRatingRenderer)
  const message = useMessage()

  const calibrating = ref(false)
  const progress = ref<[number, number]>([0, 0])
  let abort: AbortController | null = null

  const progressText = computed(() => {
    const [done, total] = progress.value
    return total > 0 ? `拉取 ${done}/${total}…` : '准备中…'
  })

  async function calibrate(target: { puuid: string; sgpServerId?: string; name?: string }) {
    if (calibrating.value || !target.puuid) return false
    calibrating.value = true
    progress.value = [0, RATING_CALIBRATION_GAMES]
    abort?.abort()
    const controller = new AbortController()
    abort = controller
    const serverId = target.sgpServerId || sgps.availability.sgpServerId
    try {
      const { stored, collected } = await runCalibration(
        (startIndex, count) =>
          sgp.api.matchHistoryQuery
            .getMatchHistorySummaryByPlayerPuuid(target.puuid, {
              startIndex,
              count,
              __sgpServerId: serverId
            })
            .then((r) => r.data),
        {
          games: RATING_CALIBRATION_GAMES,
          onProgress: (done, total) => {
            if (!controller.signal.aborted) progress.value = [done, total]
          },
          signal: controller.signal,
          source: { puuid: target.puuid, name: target.name }
        }
      )
      throwIfCalibrationAborted(controller.signal)
      if (collected.games < RATING_CALIBRATION_MIN_GAMES) {
        message.warning(
          `可用的峡谷对局只有 ${collected.games} 场，样本太少，未保存（至少 ${RATING_CALIBRATION_MIN_GAMES} 场）`
        )
        return false
      }
      const json = JSON.stringify(stored)
      throwIfCalibrationAborted(controller.signal)
      await mr.saveCalibration(json)
      if (controller.signal.aborted) return false
      message.success(
        `已用 ${target.name ? `${target.name} 的` : ''}${stored.trainingGames} 场训练（${stored.totalSamples} 个样本）完成校准${stored.validation ? `，另 ${stored.validation.games} 场用于独立验证` : '，尚无独立验证'}`
      )
      return true
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
        return false
      message.error(`校准失败：${String(error)}`)
      return false
    } finally {
      calibrating.value = false
    }
  }

  onBeforeUnmount(() => {
    abort?.abort()
  })

  return { calibrating, progress, progressText, calibrate }
}
