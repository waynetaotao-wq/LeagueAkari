import { describe, expect, it } from 'vitest'

import { computeAkariAchievements } from './akari-achievements'
import type { AkariScoreInput } from './akari-score'

function p(puuid: string, team: string, extra: Partial<AkariScoreInput> = {}): AkariScoreInput {
  return {
    puuid,
    teamIdentifier: team,
    position: null,
    win: team === 'A',
    kills: 2,
    deaths: 3,
    assists: 4,
    totalDamageDealtToChampions: 10000,
    totalDamageTaken: 10000,
    goldEarned: 9000,
    cs: 150,
    neutralMinionsKilled: 0,
    visionScore: 20,
    timeCCingOthers: 20,
    totalDamageToTowers: 2000,
    soloKills: null,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    ...extra
  }
}

describe('computeAkariAchievements', () => {
  it('awards unique maxima and milestones, skipping ties and low thresholds', () => {
    const inputs = [
      p('a', 'A', { kills: 12, totalDamageDealtToChampions: 30000, largestKillingSpree: 9, firstBloodKill: true, tripleKills: 1 }),
      p('b', 'A', { assists: 15, visionScore: 70, deaths: 0 }),
      p('c', 'A'),
      p('d', 'B', { kills: 4 }), // 击杀 4 未达门槛（且非最多）
      p('e', 'B', { cs: 150 }) // 与其他人并列补兵 → 不发
    ]
    const out = computeAkariAchievements(inputs, 30 * 60)
    const keys = (id: string) => (out.get(id) ?? []).map((a) => a.key)
    expect(keys('a')).toEqual(['triple', 'legendary', 'firstBlood', 'kills', 'damage'])
    expect(keys('b')).toEqual(['flawless', 'assists', 'vision'])
    // 参团率按各自队伍击杀数算：d (4+4)/6 = 1.33 全场最高
    expect(keys('d')).toEqual(['kp'])
    expect(keys('e')).not.toContain('cs')
    // 承伤/经济/塔伤/控制全员并列 → 无人获得
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(keys(id)).not.toContain('tank')
      expect(keys(id)).not.toContain('gold')
    }
  })

  it('does not award flawless in short games and orders milestones first', () => {
    const inputs = [p('a', 'A', { deaths: 0, pentaKills: 1, kills: 9 }), p('b', 'B')]
    const out = computeAkariAchievements(inputs, 10 * 60)
    const keys = (out.get('a') ?? []).map((a) => a.key)
    expect(keys[0]).toBe('penta')
    expect(keys).not.toContain('flawless')
  })
})
