import { toBasicInfo } from '@shared/data-adapter/match-history/match-basic'
import { toParticipants } from '@shared/data-adapter/match-history/participants'
import type { SgpGameSummary } from '@shared/data-adapter/wrapper'

import { type AkariMetricSample, computeAkariMetrics } from './akari-score'
import {
  type CalibrationGameSamples,
  type StoredCalibration,
  type ValidatedCalibrationResult,
  fitAkariWeightsWithValidation
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
  matches: CalibrationGameSamples[]
  games: number
  skipped: number
}

export function throwIfCalibrationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const error = new Error('校准已取消')
  error.name = 'AbortError'
  throw error
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
  const matches: CalibrationGameSamples[] = []
  let games = 0
  let skipped = 0

  const pages = Math.ceil(target / pageSize)
  for (let i = 0; i < pages; i++) {
    throwIfCalibrationAborted(signal)
    const start = i * pageSize
    const count = Math.min(pageSize, target - start)
    let page: any[] = []
    try {
      const res = await getPage(start, count)
      throwIfCalibrationAborted(signal)
      if (!Array.isArray(res?.games)) throw new Error('战绩数据格式异常，未保存校准')
      page = res.games
    } catch (error) {
      throwIfCalibrationAborted(signal)
      throw error
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
          basicInfo.gameMode !== 'CLASSIC' ||
          basicInfo.mapId !== 11 ||
          !CALIBRATION_QUEUES.has(basicInfo.queueId) ||
          basicInfo.gameDuration < CALIBRATION_MIN_DURATION_SECONDS ||
          basicInfo.endOfGameResult?.startsWith('Abort_')
        ) {
          skipped++
          continue
        }
        const participants = toParticipants(summary, basicInfo)
        if (
          participants.length !== 10 ||
          new Set(participants.map((p) => p.puuid)).size !== 10 ||
          new Set(participants.map((p) => p.participantId)).size !== 10 ||
          participants.filter((p) => p.teamId === 100).length !== 5 ||
          participants.filter((p) => p.teamId === 200).length !== 5
        ) {
          skipped++
          continue
        }
        const { inputs, earlySurrender } = buildAkariScoreInputs(summary, participants)
        const gameSamples = computeAkariMetrics(inputs, basicInfo.gameDuration, {
          earlySurrender,
          mode: 'sr'
        })
        if (gameSamples.length === 0) {
          skipped++
          continue
        }
        samples.push(...gameSamples)
        matches.push({ gameId, samples: gameSamples })
        games++
      } catch {
        skipped++
      }
    }
    onProgress?.(Math.min(target, start + count), target)
    if (fresh === 0 || page.length < count) break
  }
  throwIfCalibrationAborted(signal)
  return { samples, matches, games, skipped }
}

export function buildStoredCalibration(
  result: ValidatedCalibrationResult,
  games: number,
  source: { puuid?: string; name?: string } = {},
  calibratedAt = Date.now()
): StoredCalibration {
  return {
    version: 2,
    calibratedAt,
    games,
    trainingGames: result.trainingGames,
    totalSamples: result.totalSamples,
    weights: result.weights,
    report: result.report,
    validation: result.validation,
    sourcePuuid: source.puuid,
    sourceName: source.name
  }
}

export async function runCalibration(
  getPage: (startIndex: number, count: number) => Promise<{ games: any[] }>,
  options: CalibrationRunOptions & {
    source?: { puuid?: string; name?: string }
  }
): Promise<{ stored: StoredCalibration; collected: CollectedSamples }> {
  const collected = await collectCalibrationSamples(getPage, options)
  throwIfCalibrationAborted(options.signal)
  const result = fitAkariWeightsWithValidation(collected.matches)
  throwIfCalibrationAborted(options.signal)
  return {
    stored: buildStoredCalibration(result, collected.games, options.source ?? {}),
    collected
  }
}
