import { describe, expect, it } from 'vitest'

import {
  AKARI_CARRY_LOSS_THRESHOLD,
  AKARI_POSITION_WEIGHTS,
  type AkariPositionWeights,
  type AkariScoreInput,
  computeAkariMetrics,
  computeAkariScores,
  normalizePosition,
  setAkariPositionWeights
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
    // 位置归一后碾压级表现约 7.5+（显示 ≈ 12.5+）
    expect(mvp.rating).toBeGreaterThanOrEqual(7.5)
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
        ? {
            ...p,
            kills: 16,
            deaths: 3,
            assists: 6,
            totalDamageDealtToChampions: 42000,
            goldEarned: 16000
          }
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
    // 位置归一口径下，辅助要在"对面辅助 + 位置常态"两条基准上都占优才算视野好
    const game = realGame().map((p) => ({
      ...p,
      visionScore: p.puuid === 'hideonpsy' ? 95 : p.position === 'UTILITY' ? 40 : 20,
      timeCCingOthers: p.puuid === 'hideonpsy' ? 120 : p.position === 'UTILITY' ? 60 : 25
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

  it('credits mitigation to tanks (v2)', () => {
    const plain = computeAkariScores(realGame(), DURATION)
    const game = realGame().map((p) =>
      p.puuid === 'iubethy'
        ? { ...p, damageSelfMitigated: 60000 }
        : { ...p, damageSelfMitigated: 8000 }
    )
    const withMitigation = computeAkariScores(game, DURATION)
    expect(withMitigation.byPuuid.get('iubethy')!.metrics.tank).toBeGreaterThan(
      plain.byPuuid.get('iubethy')!.metrics.tank!
    )
  })

  it('credits heals and shields to enchanter supports (v2)', () => {
    const plain = computeAkariScores(realGame(), DURATION)
    const game = realGame().map((p) =>
      p.puuid === 'hideonpsy'
        ? { ...p, healsOnTeammates: 9000, shieldsOnTeammates: 6000 }
        : { ...p, healsOnTeammates: 200, shieldsOnTeammates: 0 }
    )
    const withSupport = computeAkariScores(game, DURATION)
    expect(plain.byPuuid.get('hideonpsy')!.metrics.support).toBeUndefined()
    expect(withSupport.byPuuid.get('hideonpsy')!.metrics.support).toBeGreaterThan(1.5)
    expect(withSupport.byPuuid.get('hideonpsy')!.rating).toBeGreaterThan(
      plain.byPuuid.get('hideonpsy')!.rating
    )
  })

  it('weighs time spent dead into survival (v2)', () => {
    const cheapDeaths = realGame().map((p) =>
      p.puuid === 'zed' ? { ...p, totalTimeSpentDead: 30 } : { ...p, totalTimeSpentDead: 120 }
    )
    const costlyDeaths = realGame().map((p) =>
      p.puuid === 'zed' ? { ...p, totalTimeSpentDead: 400 } : { ...p, totalTimeSpentDead: 120 }
    )
    expect(
      computeAkariScores(cheapDeaths, DURATION).byPuuid.get('zed')!.metrics.survival
    ).toBeGreaterThan(
      computeAkariScores(costlyDeaths, DURATION).byPuuid.get('zed')!.metrics.survival!
    )
  })

  it('folds objective damage and epic takedowns into one objective metric (v2)', () => {
    const game = realGame().map((p) => ({
      ...p,
      damageDealtToObjectives: p.puuid === 'bumma' ? 30000 : p.position === 'JUNGLE' ? 12000 : 8000,
      epicTakedowns: p.puuid === 'bumma' ? 4 : p.position === 'JUNGLE' ? 2 : 1
    }))
    const result = computeAkariScores(game, DURATION)
    expect(result.byPuuid.get('bumma')!.metrics.objective).toBeGreaterThan(1.4)
    expect(result.byPuuid.get('zed')!.metrics.objective).toBeLessThan(1)
  })

  it('rewards lane dominance only where lane data exists (v2)', () => {
    const game = realGame().map((p) =>
      p.puuid === 'zed'
        ? { ...p, maxCsAdvantageOnLaneOpponent: 40, maxLevelLeadLaneOpponent: 2 }
        : p.puuid === 'donk666'
          ? { ...p, maxCsAdvantageOnLaneOpponent: -20, maxLevelLeadLaneOpponent: 0 }
          : p
    )
    const result = computeAkariScores(game, DURATION)
    expect(result.byPuuid.get('zed')!.metrics.lane).toBeGreaterThan(1.4)
    expect(result.byPuuid.get('donk666')!.metrics.lane).toBeLessThan(1)
    expect(result.byPuuid.get('bumma')!.metrics.lane).toBeUndefined()
  })

  it('skips early-surrender (remake) games entirely', () => {
    const result = computeAkariScores(realGame(), DURATION, { earlySurrender: true })
    expect(result.byPuuid.size).toBe(0)
    expect(result.skipped).toBe('early-surrender')
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

describe('game tags (WeGame-style, strict rules)', () => {
  it('tags the standout winner as carry, the weakest winner as lying, others in a stomp as stomp', () => {
    // 真实对局：红队 32:22 杀、蓝队 24 分钟投降 → 队伍层面碾压
    const game = realGame().map((p) => ({ ...p, gameEndedInSurrender: true }))
    const result = computeAkariScores(game, DURATION)
    expect(result.byPuuid.get('iubethy')!.tag).toBe('carry')
    expect(result.byPuuid.get('iubethy')!.badge).toBe('MVP')
    expect(result.byPuuid.get('donk666')!.tag).toBe('lying')
    expect(result.byPuuid.get('biubiubiu')!.tag).toBe('stomp')
  })

  it('tags losers: effort needs ≥ 10.0 displayed, blame needs team-lowest and clearly below teammates', () => {
    const base = computeAkariScores(realGame(), DURATION)
    // 这局败方最高约 9.9，未达 10.0 → 无尽力局
    expect([...base.byPuuid.values()].some((s) => s.tag === 'effort')).toBe(false)
    // 队内最低且明显低于队友 → 甩锅局；仅一人
    const blamed = [...base.byPuuid.values()].filter((s) => s.tag === 'blame')
    expect(blamed.length).toBeLessThanOrEqual(1)
    const boosted = realGame().map((p) =>
      p.puuid === 'zed'
        ? {
            ...p,
            kills: 16,
            deaths: 3,
            assists: 6,
            totalDamageDealtToChampions: 42000,
            goldEarned: 16000
          }
        : p
    )
    const r2 = computeAkariScores(boosted, DURATION)
    expect(r2.byPuuid.get('zed')!.tag).toBe('effort')
    expect(r2.byPuuid.get('zed')!.isCarryLoss).toBe(true)
  })

  it('marks every member of a team with an AFK as afk, overriding other tags', () => {
    const game = realGame().map((p) =>
      p.teamIdentifier === 'R' ? { ...p, hadAfkTeammate: true } : p
    )
    const result = computeAkariScores(game, DURATION)
    for (const id of ['iubethy', 'leoleeoh', 'donk666', 'biubiubiu', 'hideonpsy']) {
      expect(result.byPuuid.get(id)!.tag).toBe('afk')
    }
    expect(result.byPuuid.get('bumma')!.tag).not.toBe('afk')
  })

  it('does not call a close win a stomp', () => {
    const close = realGame().map((p) =>
      p.teamIdentifier === 'R'
        ? { ...p, kills: 5, deaths: 5, assists: 5 }
        : { ...p, kills: 5, deaths: 5, assists: 5 }
    )
    const result = computeAkariScores(close, DURATION)
    expect([...result.byPuuid.values()].some((s) => s.tag === 'stomp')).toBe(false)
  })
})

describe('display scale', () => {
  it('maps the internal 0-10 rating onto the WeGame-like 17.4 scale without touching thresholds', async () => {
    const { AKARI_RATING_DISPLAY_MAX, formatAkariRating } = await import('./akari-score')
    expect(AKARI_RATING_DISPLAY_MAX).toBe(17.4)
    // WeGame 式分布：平均 7.5，内部满分才 17.4（几乎打不出来），低分端钳到 0
    expect(formatAkariRating(10)).toBe('17.4')
    expect(formatAkariRating(5)).toBe('7.5')
    expect(formatAkariRating(0)).toBe('0.0')
    // 尽力局阈值以显示分定义（≥ 10.0），内部换算约 6.26
    expect(formatAkariRating(AKARI_CARRY_LOSS_THRESHOLD)).toBe('10.0')
  })
})

describe('game tags: stricter stomp / blame rules', () => {
  it('detects a long stomp without surrender through the team gold ratio', () => {
    // 40 分钟 40:22、无投降，但经济领先 30%
    const game = realGame().map((p) => ({
      ...p,
      gameEndedInSurrender: false,
      goldEarned: p.teamIdentifier === 'R' ? Math.round(p.goldEarned * 1.3) : p.goldEarned
    }))
    const result = computeAkariScores(game, 40 * 60)
    const winners = [...result.byPuuid.values()].filter((s) =>
      ['leoleeoh', 'biubiubiu', 'hideonpsy'].includes(s.puuid)
    )
    expect(winners.every((s) => s.tag === 'stomp' || s.tag === 'carry' || s.tag === 'lying')).toBe(
      true
    )
    expect(winners.some((s) => s.tag === 'stomp')).toBe(true)
  })

  it('does not call an even-gold early surrender a stomp', () => {
    const game = realGame().map((p) => ({
      ...p,
      gameEndedInSurrender: true,
      kills: 6,
      deaths: 6,
      assists: 6,
      goldEarned: 10000
    }))
    const result = computeAkariScores(game, 20 * 60)
    expect([...result.byPuuid.values()].some((s) => s.tag === 'stomp')).toBe(false)
  })

  it('never blames anyone when the whole losing team collapsed', () => {
    const game = realGame().map((p) =>
      p.teamIdentifier === 'B'
        ? {
            ...p,
            kills: 0,
            deaths: 9,
            assists: 1,
            totalDamageDealtToChampions: 4000,
            goldEarned: 5000,
            cs: 60
          }
        : p
    )
    const result = computeAkariScores(game, DURATION)
    expect([...result.byPuuid.values()].some((s) => s.tag === 'blame')).toBe(false)
  })
})

describe('carry rule (≥ 11.0, lead over team third by 1.25 internal ≈ 2.5 displayed)', () => {
  it('lets a duo carry both earn the tag while the third stays untagged', () => {
    const game = realGame().map((p) => {
      if (p.puuid === 'biubiubiu') {
        return {
          ...p,
          kills: 12,
          deaths: 2,
          assists: 9,
          totalDamageDealtToChampions: 34000,
          goldEarned: 15500
        }
      }
      return p
    })
    const result = computeAkariScores(game, DURATION)
    expect(result.byPuuid.get('iubethy')!.tag).toBe('carry')
    expect(result.byPuuid.get('biubiubiu')!.tag).toBe('carry')
    expect(result.byPuuid.get('hideonpsy')!.tag).not.toBe('carry')
  })

  it('does not tag the best player of an ordinary win as carry', () => {
    // 赢方五人评分接近（无人明显拉开）：不应出现 carry
    const game = realGame().map((p) =>
      p.teamIdentifier === 'R'
        ? {
            ...p,
            kills: 6,
            deaths: 4,
            assists: 8,
            totalDamageDealtToChampions: 18000,
            totalDamageTaken: 18000,
            goldEarned: 11500
          }
        : p
    )
    const result = computeAkariScores(game, DURATION)
    expect([...result.byPuuid.values()].some((s) => s.tag === 'carry')).toBe(false)
  })
})

describe('score mode routing (sr / aram / mayhem / other)', () => {
  it('resolves modes from gameMode and never confuses mayhem (KIWI) with aram or sr', async () => {
    const { resolveAkariScoreMode } = await import('./akari-score')
    expect(resolveAkariScoreMode({ gameMode: 'CLASSIC', mapId: 11 })).toBe('sr')
    expect(resolveAkariScoreMode({ gameMode: 'ARAM', mapId: 12 })).toBe('aram')
    expect(resolveAkariScoreMode({ gameMode: 'KIWI', mapId: 12 })).toBe('mayhem')
    expect(resolveAkariScoreMode({ gameMode: 'CHERRY', mapId: 30 })).toBeNull()
    expect(resolveAkariScoreMode({ gameMode: 'URF', mapId: 11 })).toBe('sr')
    expect(resolveAkariScoreMode({ gameMode: 'PRACTICETOOL', mapId: 11 })).toBe('sr')
    expect(resolveAkariScoreMode({ gameMode: 'NEXUSBLITZ', mapId: 21 })).toBe('other')
    expect(resolveAkariScoreMode({ gameMode: null, mapId: null })).toBe('other')
  })

  it("uses each mode's own weight table and skips position inference outside sr", async () => {
    const { AKARI_ARAM_WEIGHTS, AKARI_MAYHEM_WEIGHTS, AKARI_POSITION_WEIGHTS, weightsForSample } =
      await import('./akari-score')
    expect(weightsForSample({ mode: 'sr', position: 'TOP' })).toBe(AKARI_POSITION_WEIGHTS.TOP)
    expect(weightsForSample({ mode: 'aram', position: 'UNKNOWN' })).toBe(AKARI_ARAM_WEIGHTS)
    expect(weightsForSample({ mode: 'mayhem', position: 'UNKNOWN' })).toBe(AKARI_MAYHEM_WEIGHTS)
    expect(weightsForSample({ mode: 'other', position: 'UNKNOWN' })).toBe(AKARI_ARAM_WEIGHTS)
    expect(AKARI_MAYHEM_WEIGHTS).not.toBe(AKARI_ARAM_WEIGHTS)

    const game = realGame().map((p) => ({ ...p, position: null, neutralMinionsKilled: 0, cs: 60 }))
    for (const mode of ['aram', 'mayhem', 'other'] as const) {
      const r = computeAkariScores(game, 18 * 60, { mode })
      expect(r.byPuuid.size).toBe(10)
      for (const s of r.byPuuid.values()) {
        expect(s.position).toBe('UNKNOWN')
        expect(Number.isFinite(s.rating)).toBe(true)
      }
    }
    const sr = computeAkariScores(game, 18 * 60, { mode: 'sr' })
    expect([...sr.byPuuid.values()].some((s) => s.position !== 'UNKNOWN')).toBe(true)
  })

  it('mayhem and aram ratings differ for the same raw stats (separate tables really apply)', () => {
    const game = realGame().map((p) => ({ ...p, position: null, neutralMinionsKilled: 0 }))
    const aram = computeAkariScores(game, 18 * 60, { mode: 'aram' })
    const mayhem = computeAkariScores(game, 18 * 60, { mode: 'mayhem' })
    const diff = [...aram.byPuuid.keys()].some(
      (k) => aram.byPuuid.get(k)!.rating !== mayhem.byPuuid.get(k)!.rating
    )
    expect(diff).toBe(true)
  })
})

describe('game rank', () => {
  it('assigns 1..N by rating with MVP at rank 1 and unique ranks', () => {
    const result = computeAkariScores(realGame(), DURATION)
    const ranks = [...result.byPuuid.values()].map((s) => s.rank).sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.byPuuid.get(result.mvpPuuid!)!.rank).toBe(1)
  })

  it('uses the rank tie-break for MVP even when the input order is reversed', () => {
    const game = realGame().map((p) =>
      p.puuid === 'iubethy' ? { ...p, totalDamageDealtToChampions: 10100 } : p
    )
    const forward = computeAkariScores(game, DURATION)
    const reversed = computeAkariScores([...game].reverse(), DURATION)
    expect(forward.byPuuid.get('iubethy')!.rating).toBe(forward.byPuuid.get('hideonpsy')!.rating)
    expect(forward.mvpPuuid).toBe('iubethy')
    expect(reversed).toEqual(forward)
    expect(reversed.byPuuid.get(reversed.mvpPuuid!)!.rank).toBe(1)
  })

  it('resolves identical scores, participation and damage by puuid for both MVP and SVP', () => {
    const game = Array.from({ length: 10 }, (_, i) =>
      player(
        String.fromCharCode(97 + i),
        i < 5 ? 'A' : 'B',
        null,
        i < 5,
        [5, 5, 5],
        20000,
        20000,
        10000,
        150
      )
    )
    const forward = computeAkariScores(game, DURATION, { mode: 'aram' })
    const reversed = computeAkariScores([...game].reverse(), DURATION, { mode: 'aram' })
    expect(forward.mvpPuuid).toBe('a')
    expect(forward.svpPuuid).toBe('f')
    expect(forward.byPuuid.get('a')!.rank).toBe(1)
    expect(reversed).toEqual(forward)
  })
})

describe('partial score data', () => {
  it('preserves known positions when another participant has no position', () => {
    const game = realGame().map((p) => (p.puuid === 'acidic' ? { ...p, position: null } : p))
    const result = computeAkariScores(game, DURATION)
    for (const p of game.filter((p) => p.position !== null)) {
      expect(result.byPuuid.get(p.puuid)!.position).toBe(p.position)
    }
    expect(result.byPuuid.get('acidic')!.position).toBe('UNKNOWN')
  })

  it('fills only unknown positions and does not duplicate a known jungle or support', () => {
    const knownRoles = realGame().map((p) =>
      p.puuid === 'zed' ? { ...p, position: null, neutralMinionsKilled: 200, cs: 0 } : p
    )
    expect(computeAkariScores(knownRoles, DURATION).byPuuid.get('zed')!.position).toBe('UNKNOWN')

    const missingJungle = realGame().map((p) =>
      p.puuid === 'bumma'
        ? { ...p, position: null }
        : p.puuid === 'acidic'
          ? { ...p, neutralMinionsKilled: 200 }
          : p
    )
    const result = computeAkariScores(missingJungle, DURATION)
    expect(result.byPuuid.get('bumma')!.position).toBe('JUNGLE')
    expect(result.byPuuid.get('acidic')!.position).toBe('TOP')
    expect(result.byPuuid.get('junimo')!.position).toBe('UTILITY')
  })

  it('falls back to deaths when time-dead totals are incomplete instead of rewarding missing time', () => {
    const complete = realGame().map((p) => ({ ...p, totalTimeSpentDead: p.deaths * 30 }))
    const partial = complete.map((p) =>
      p.puuid === 'zed' ? { ...p, totalTimeSpentDead: undefined } : p
    )
    const withoutTimes = computeAkariScores(realGame(), DURATION)
    const result = computeAkariScores(partial, DURATION)
    expect(result).toEqual(withoutTimes)
    expect(result.byPuuid.get('zed')!.rating).toBe(
      computeAkariScores(complete, DURATION).byPuuid.get('zed')!.rating
    )
  })

  it('drops incomplete optional submetrics without shrinking denominators or replacing unknowns by zero', () => {
    const partial = realGame().map((p) => ({
      ...p,
      visionScore: 20,
      timeCCingOthers: 30,
      damageSelfMitigated: p.puuid === 'zed' ? undefined : 30000,
      healsOnTeammates: p.puuid === 'zed' ? undefined : 1000,
      shieldsOnTeammates: 0,
      damageDealtToObjectives: p.puuid === 'zed' ? undefined : 10000,
      epicTakedowns: p.puuid === 'zed' ? undefined : 2,
      controlWardsPlaced: p.puuid === 'zed' ? undefined : 4,
      wardTakedowns: 0,
      immobilizations: p.puuid === 'zed' ? undefined : 8,
      turretPlatesTaken: p.puuid === 'zed' ? undefined : 2,
      turretTakedowns: 0
    }))
    const withoutExtras = realGame().map((p) => ({ ...p, visionScore: 20, timeCCingOthers: 30 }))
    expect(computeAkariScores(partial, DURATION)).toEqual(
      computeAkariScores(withoutExtras, DURATION)
    )
  })

  it('keeps complete submetrics, accepts real zeroes, and uses objective participation without damage data', () => {
    const game = realGame().map((p) => ({
      ...p,
      shieldsOnTeammates: p.puuid === 'hideonpsy' ? 6000 : 0,
      healsOnTeammates: p.puuid === 'zed' ? undefined : 100,
      epicTakedowns: p.puuid === 'bumma' ? 3 : 0
    }))
    const samples = computeAkariMetrics(game, DURATION)
    expect(samples.find((p) => p.puuid === 'hideonpsy')!.metrics.support).toBeGreaterThan(1)
    expect(samples.find((p) => p.puuid === 'zed')!.metrics.support).toBe(0)
    expect(samples.find((p) => p.puuid === 'bumma')!.metrics.objective).toBeGreaterThan(1)
    expect(samples.find((p) => p.puuid === 'zed')!.metrics.objective).toBe(0)
  })
})

describe('explicit rating weights', () => {
  it('produces the same result for the same data and explicit weights despite a changed global override', () => {
    const game = realGame()
    const custom = Object.fromEntries(
      Object.entries(AKARI_POSITION_WEIGHTS).map(([position, weights]) => [
        position,
        { ...weights, damage: 1, survival: 0 }
      ])
    ) as AkariPositionWeights
    const expected = computeAkariScores(game, DURATION, {}, AKARI_POSITION_WEIGHTS)
    try {
      setAkariPositionWeights(custom)
      expect(computeAkariScores(game, DURATION, {}, AKARI_POSITION_WEIGHTS)).toEqual(expected)
      expect(computeAkariScores(game, DURATION, {}, custom)).toEqual(
        computeAkariScores(game, DURATION)
      )
      expect(computeAkariScores(game, DURATION, {}, custom)).not.toEqual(expected)
    } finally {
      setAkariPositionWeights(null)
    }
  })
})
