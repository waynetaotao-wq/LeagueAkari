import { describe, expect, it } from 'vitest'

import {
  AKARI_CARRY_LOSS_THRESHOLD,
  AKARI_POSITION_WEIGHTS,
  type AkariScoreInput,
  computeAkariScores,
  normalizePosition
} from './akari-score'

/** 真实对局（2026-09-01 单双排 · 23:59 · 蓝队投降）的摘要数据；视野/控制/推塔摘要未含，置 0 */
function player(
  puuid: string,
  team: string,
  position: string | null,
  win: boolean,
  kda: [number, number, number],
  dmg: number,
  taken: number,
  gold: number,
  cs: number,
  jungle = 0,
  extra: Partial<AkariScoreInput> = {}
): AkariScoreInput {
  return {
    puuid,
    teamIdentifier: team,
    position,
    win,
    kills: kda[0],
    deaths: kda[1],
    assists: kda[2],
    totalDamageDealtToChampions: dmg,
    totalDamageTaken: taken,
    goldEarned: gold,
    cs,
    neutralMinionsKilled: jungle,
    visionScore: 0,
    timeCCingOthers: 0,
    totalDamageToTowers: 0,
    soloKills: null,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    ...extra
  }
}

function realGame(): AkariScoreInput[] {
  return [
    player('acidic', 'B', 'TOP', false, [3, 6, 6], 10763, 18205, 8630, 180),
    player('bumma', 'B', 'JUNGLE', false, [5, 4, 7], 19561, 18779, 10490, 177, 120),
    player('zed', 'B', 'MIDDLE', false, [7, 7, 3], 19693, 19382, 11770, 164),
    player('pakzoqki', 'B', 'BOTTOM', false, [6, 7, 2], 19715, 20320, 10080, 166),
    player('junimo', 'B', 'UTILITY', false, [1, 8, 9], 6443, 24260, 6220, 24),
    player('iubethy', 'R', 'TOP', true, [14, 6, 5], 28602, 41671, 12060, 145),
    player('leoleeoh', 'R', 'JUNGLE', true, [8, 3, 8], 15008, 21287, 12340, 197, 130),
    player('donk666', 'R', 'MIDDLE', true, [3, 5, 5], 12886, 15653, 8890, 186),
    player('biubiubiu', 'R', 'BOTTOM', true, [6, 5, 10], 20615, 14722, 12540, 214),
    player('hideonpsy', 'R', 'UTILITY', true, [1, 3, 20], 9942, 16349, 7680, 28)
  ]
}

const DURATION = 23 * 60 + 59

describe('Akari score', () => {
  it('ranks the dominant top laner as MVP and keeps every rating within 0-10', () => {
    const result = computeAkariScores(realGame(), DURATION)
    expect(result.byPuuid.size).toBe(10)
    expect(result.mvpPuuid).toBe('iubethy')
    const mvp = result.byPuuid.get('iubethy')!
    expect(mvp.isMvp).toBe(true)
    expect(mvp.rating).toBeGreaterThanOrEqual(8)
    for (const s of result.byPuuid.values()) {
      expect(s.rating).toBeGreaterThanOrEqual(0)
      expect(s.rating).toBeLessThanOrEqual(10)
    }
  })

  it('gives SVP to the losing team top scorer and never to the MVP', () => {
    const result = computeAkariScores(realGame(), DURATION)
    expect(result.svpPuuid).not.toBeNull()
    const svp = result.byPuuid.get(result.svpPuuid!)!
    expect(svp.isSvp).toBe(true)
    expect(svp.isMvp).toBe(false)
    const losers = [...result.byPuuid.values()].filter((s) =>
      ['acidic', 'bumma', 'zed', 'pakzoqki', 'junimo'].includes(s.puuid)
    )
    expect(Math.max(...losers.map((s) => s.rating))).toBe(svp.rating)
    // 输方无人达到尽力局阈值（这局蓝队被碾压后投降）
    expect(losers.some((s) => s.isCarryLoss)).toBe(false)
  })

  it('flags a carry loss when a loser scores above the threshold', () => {
    const game = realGame().map((p) =>
      p.puuid === 'zed'
        ? { ...p, kills: 16, deaths: 3, assists: 6, totalDamageDealtToChampions: 42000, goldEarned: 16000 }
        : p
    )
    const result = computeAkariScores(game, DURATION)
    const zed = result.byPuuid.get('zed')!
    expect(zed.rating).toBeGreaterThanOrEqual(AKARI_CARRY_LOSS_THRESHOLD)
    expect(zed.isCarryLoss).toBe(true)
    // 全场最高时记 MVP，不再重复记 SVP
    if (result.mvpPuuid === 'zed') expect(result.svpPuuid).not.toBe('zed')
  })

  it('rewards vision and cc for supports once that data exists', () => {
    const withoutVision = computeAkariScores(realGame(), DURATION)
    const game = realGame().map((p) => ({
      ...p,
      visionScore: p.position === 'UTILITY' ? 60 : 20,
      timeCCingOthers: p.position === 'UTILITY' ? 90 : 25
    }))
    const withVision = computeAkariScores(game, DURATION)
    expect(withVision.byPuuid.get('hideonpsy')!.rating).toBeGreaterThan(
      withoutVision.byPuuid.get('hideonpsy')!.rating
    )
    expect(withoutVision.byPuuid.get('hideonpsy')!.metrics.vision).toBeUndefined()
    expect(withVision.byPuuid.get('hideonpsy')!.metrics.vision).toBeGreaterThan(1)
  })

  it('infers jungle and support when positions are missing (LCU summary path)', () => {
    const game = realGame().map((p) => ({ ...p, position: null }))
    const result = computeAkariScores(game, DURATION)
    expect(result.byPuuid.get('bumma')!.position).toBe('JUNGLE')
    expect(result.byPuuid.get('leoleeoh')!.position).toBe('JUNGLE')
    expect(result.byPuuid.get('junimo')!.position).toBe('UTILITY')
    expect(result.byPuuid.get('hideonpsy')!.position).toBe('UTILITY')
    expect(result.byPuuid.get('zed')!.position).toBe('UNKNOWN')
    expect(result.mvpPuuid).toBe('iubethy')
  })

  it('returns an empty result for non two-team games or zero duration', () => {
    expect(computeAkariScores(realGame(), 0).byPuuid.size).toBe(0)
    const oneTeam = realGame().filter((p) => p.teamIdentifier === 'B')
    expect(computeAkariScores(oneTeam, DURATION).byPuuid.size).toBe(0)
  })

  it('keeps position weights well-formed and normalizes aliases', () => {
    for (const weights of Object.values(AKARI_POSITION_WEIGHTS)) {
      const sum = Object.values(weights).reduce((s, w) => s + w, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    }
    expect(normalizePosition('mid')).toBe('MIDDLE')
    expect(normalizePosition('support')).toBe('UTILITY')
    expect(normalizePosition(null)).toBe('UNKNOWN')
  })
})
