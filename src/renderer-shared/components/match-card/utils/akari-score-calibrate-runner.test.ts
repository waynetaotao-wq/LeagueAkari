import { describe, expect, it } from 'vitest'

import {
  CALIBRATION_MIN_DURATION_SECONDS,
  collectCalibrationSamples,
  runCalibration
} from './akari-score-calibrate-runner'

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

/** 最小可用的 SGP 摘要（满足 toBasicInfo / toParticipants / 提取层读取的字段） */
function sgpGame(gameId: number, opts: { queueId?: number; duration?: number; earlySurrender?: boolean; blueWins?: boolean } = {}) {
  const { queueId = 420, duration = 1800, earlySurrender = false, blueWins = gameId % 2 === 0 } = opts
  const participants = [] as any[]
  let pid = 1
  for (const teamId of [100, 200]) {
    const win = teamId === 100 ? blueWins : !blueWins
    for (const teamPosition of POSITIONS) {
      const strong = win ? 1.3 : 0.8
      participants.push({
        puuid: `p-${gameId}-${pid}`,
        participantId: pid,
        riotIdGameName: `n${pid}`,
        riotIdTagline: 'T',
        summonerName: `n${pid}`,
        profileIcon: 1,
        championId: 100 + pid,
        teamId,
        teamPosition,
        playerSubteamId: 0,
        subteamPlacement: 0,
        win,
        gameEndedInEarlySurrender: earlySurrender,
        gameEndedInSurrender: false,
        teamEarlySurrendered: false,
        champLevel: 15,
        kills: Math.round(4 * strong),
        deaths: Math.round(5 / strong),
        assists: Math.round(6 * strong),
        goldEarned: Math.round(11000 * strong),
        goldSpent: 10000,
        totalMinionsKilled: teamPosition === 'UTILITY' ? 30 : 180,
        neutralMinionsKilled: teamPosition === 'JUNGLE' ? 120 : 0,
        totalDamageDealtToChampions: Math.round(18000 * strong),
        physicalDamageDealtToChampions: 9000,
        magicDamageDealtToChampions: 9000,
        trueDamageDealtToChampions: 0,
        totalDamageTaken: 18000,
        physicalDamageTaken: 9000,
        magicDamageTaken: 9000,
        trueDamageTaken: 0,
        damageDealtToTurrets: 3000,
        damageDealtToObjectives: 9000,
        damageSelfMitigated: 12000,
        totalTimeSpentDead: 90,
        totalHeal: 2000,
        totalHealsOnTeammates: teamPosition === 'UTILITY' ? 4000 : 100,
        totalDamageShieldedOnTeammates: teamPosition === 'UTILITY' ? 3000 : 0,
        visionScore: teamPosition === 'UTILITY' ? 60 : 20,
        timeCCingOthers: 25,
        turretTakedowns: 2,
        objectivesStolen: 0,
        item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0,
        roleBoundItem: 0,
        spell1Id: 4, spell2Id: 14,
        playerAugment1: 0, playerAugment2: 0, playerAugment3: 0, playerAugment4: 0, playerAugment5: 0, playerAugment6: 0,
        allInPings: 0, assistMePings: 0, basicPings: 0,
        perks: { statPerks: { offense: 0, flex: 0, defense: 0 }, styles: [] },
        challenges: {
          dragonTakedowns: 1, baronTakedowns: 0, riftHeraldTakedowns: 0,
          maxCsAdvantageOnLaneOpponent: win ? 20 : -20, maxLevelLeadLaneOpponent: win ? 1 : 0,
          controlWardsPlaced: 2, wardTakedowns: 3, enemyChampionImmobilizations: 10, turretPlatesTaken: 2
        }
      })
      pid++
    }
  }
  return {
    metadata: {},
    json: {
      gameId,
      gameVersion: '16.17.1',
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      queueId,
      mapId: 11,
      gameCreation: 1_700_000_000_000 + gameId,
      gameDuration: duration,
      endOfGameResult: 'GameComplete',
      participants,
      teams: []
    }
  }
}

describe('calibration runner', () => {
  it('pages through history, filters queues / remakes / short games and dedupes', async () => {
    const pool = [
      sgpGame(1),
      sgpGame(2),
      sgpGame(3, { queueId: 450 }), // 大乱斗：跳过
      sgpGame(4, { duration: CALIBRATION_MIN_DURATION_SECONDS - 1 }), // 过短：跳过
      sgpGame(5, { earlySurrender: true }), // 重开：跳过
      sgpGame(6)
    ]
    const calls: Array<[number, number]> = []
    const getPage = async (start: number, count: number) => {
      calls.push([start, count])
      // 第二页故意重复第 1 局，验证去重
      const slice = start === 0 ? pool.slice(0, 4) : [pool[0], ...pool.slice(4)]
      return { games: slice.slice(0, count) }
    }
    const progress: number[] = []
    const collected = await collectCalibrationSamples(getPage, {
      games: 8,
      pageSize: 4,
      onProgress: (d) => progress.push(d)
    })
    expect(calls).toEqual([[0, 4], [4, 4]])
    expect(collected.games).toBe(3)
    expect(collected.skipped).toBe(3)
    expect(collected.samples.length).toBe(30)
    expect(progress[progress.length - 1]).toBe(8)
  })

  it('stops on empty page and produces a stored calibration with fitted weights', async () => {
    const pool = Array.from({ length: 60 }, (_, i) => sgpGame(i + 1))
    const getPage = async (start: number, count: number) => ({ games: pool.slice(start, start + count) })
    const { stored, collected } = await runCalibration(getPage, { games: 200, pageSize: 20 })
    expect(collected.games).toBe(60)
    expect(stored.version).toBe(1)
    expect(stored.games).toBe(60)
    expect(stored.totalSamples).toBe(600)
    for (const pos of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const) {
      expect(stored.report[pos].samples).toBe(120)
      const sum = Object.values(stored.weights[pos]).reduce((s, w) => s + w, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    }
  })

  it('aborts early when the signal is cancelled', async () => {
    const controller = new AbortController()
    let pages = 0
    const getPage = async (start: number, count: number) => {
      pages++
      controller.abort()
      return { games: Array.from({ length: count }, (_, i) => sgpGame(start + i + 1)) }
    }
    await collectCalibrationSamples(getPage, { games: 100, pageSize: 20, signal: controller.signal })
    expect(pages).toBe(1)
  })
})
