import { toBasicInfo } from '@shared/data-adapter/match-history/match-basic'
import { toParticipants } from '@shared/data-adapter/match-history/participants'
import type { SgpGameSummary } from '@shared/data-adapter/wrapper'

import { type AkariMetricSample, computeAkariMetrics } from './akari-score'
import {
  type CalibrationResult,
  type StoredCalibration,
  fitAkariWeights
} from './akari-score-calibration'
import { buildAkariScoreInputs } from './akari-score-input'

/** 只用召唤师峡谷 5v5 的常规队列做校准（单双排 / 灵活 / 匹配 / 快速），排除大乱斗等 */
export const CALIBRATION_QUEUES = new Set([420, 440, 400, 430, 490])
export const CALIBRATION_MIN_DURATION_SECONDS = 8 * 60

export interface CalibrationRunOptions {
  games: number
  pageSize?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface CollectedSamples {
  samples: AkariMetricSample[]
  games: number
  skipped: number
}

/**
 * 分页拉取战绩摘要（SGP 形状：{ games: SgpGameSummaryLol[] }），转成相对指标样本。
 * 取页函数由调用方注入（便于测试与跨窗口复用）。
 */
export async function collectCalibrationSamples(
  getPage: (startIndex: number, count: number) => Promise<{ games: any[] }>,
  options: CalibrationRunOptions
): Promise<CollectedSamples> {
  const { games: target, pageSize = 20, onProgress, signal } = options
  const seen = new Set<number>()
  const samples: AkariMetricSample[] = []
  let games = 0
  let skipped = 0

  const pages = Math.ceil(target / pageSize)
  for (let i = 0; i < pages; i++) {
    if (signal?.aborted) break
    const start = i * pageSize
    const count = Math.min(pageSize, target - start)
    let page: any[] = []
    try {
      const res = await getPage(start, count)
      page = Array.isArray(res?.games) ? res.games : []
    } catch {
      break
    }
    let fresh = 0
    for (const raw of page) {
      const gameId = Number(raw?.json?.gameId ?? raw?.gameId)
      if (!Number.isFinite(gameId) || seen.has(gameId)) continue
      seen.add(gameId)
      fresh++
      const summary: SgpGameSummary = { gameId, source: 'sgp', data: raw }
      try {
        const basicInfo = toBasicInfo(summary)
        if (
          !basicInfo.isTwoTeam ||
          !CALIBRATION_QUEUES.has(basicInfo.queueId) ||
          basicInfo.gameDuration < CALIBRATION_MIN_DURATION_SECONDS
        ) {
          skipped++
          continue
        }
        const participants = toParticipants(summary, basicInfo)
        const { inputs, earlySurrender } = buildAkariScoreInputs(summary, participants)
        const gameSamples = computeAkariMetrics(inputs, basicInfo.gameDuration, { earlySurrender })
        if (gameSamples.length === 0) {
          skipped++
          continue
        }
        samples.push(...gameSamples)
        games++
      } catch {
        skipped++
      }
    }
    onProgress?.(Math.min(target, start + count), target)
    if (fresh === 0 || page.length < count) break
  }
  return { samples, games, skipped }
}

export function buildStoredCalibration(
  result: CalibrationResult,
  games: number,
  source: { puuid?: string; name?: string } = {},
  calibratedAt = Date.now()
): StoredCalibration {
  return {
    version: 1,
    calibratedAt,
    games,
    totalSamples: result.totalSamples,
    weights: result.weights,
    report: result.report,
    sourcePuuid: source.puuid,
    sourceName: source.name
  }
}

export async function runCalibration(
  getPage: (startIndex: number, count: number) => Promise<{ games: any[] }>,
  options: CalibrationRunOptions & { source?: { puuid?: string; name?: string } }
): Promise<{ stored: StoredCalibration; collected: CollectedSamples }> {
  const collected = await collectCalibrationSamples(getPage, options)
  const result = fitAkariWeights(collected.samples)
  return {
    stored: buildStoredCalibration(result, collected.games, options.source ?? {}),
    collected
  }
}
