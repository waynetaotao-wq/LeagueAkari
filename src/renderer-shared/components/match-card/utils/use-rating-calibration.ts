import { useInstance } from '@renderer-shared/shards'
import { MatchRatingRenderer } from '@renderer-shared/shards/match-rating'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, ref } from 'vue'

import { runCalibration } from './akari-score-calibrate-runner'

export const RATING_CALIBRATION_GAMES = 400
export const RATING_CALIBRATION_MIN_GAMES = 20

/**
 * [lolps] 对局评分权重校准（可对任意玩家运行）：
 * 设置页用本人；战绩页可用当前查看的玩家（例如拿王者高手的对局校准）。
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
    abort = new AbortController()
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
          onProgress: (done, total) => (progress.value = [done, total]),
          signal: abort.signal,
          source: { puuid: target.puuid, name: target.name }
        }
      )
      if (collected.games < RATING_CALIBRATION_MIN_GAMES) {
        message.warning(
          `可用的峡谷对局只有 ${collected.games} 场，样本太少，未保存（至少 ${RATING_CALIBRATION_MIN_GAMES} 场）`
        )
        return false
      }
      await mr.saveCalibration(JSON.stringify(stored))
      message.success(
        `已用 ${target.name ? `${target.name} 的` : ''}${collected.games} 场（${stored.totalSamples} 个样本）完成校准`
      )
      return true
    } catch (error) {
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
