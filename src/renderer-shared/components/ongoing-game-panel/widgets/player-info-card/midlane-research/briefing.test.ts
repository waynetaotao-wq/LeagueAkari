import { describe, expect, it } from 'vitest'

import { type MidDeepResult, analyzeDeep, emptyDeepResult } from './analysis'
import { buildMidlaneBriefing } from './briefing'

function sample(overrides: Partial<MidDeepResult> = {}): MidDeepResult {
  return { ...emptyDeepResult(), deepGames: 20, attemptedGames: 20, ...overrides }
}

describe('中单研究队友提醒', () => {
  it('把游走方向放在首要提醒，最多保留三个有依据的重点', () => {
    const result = buildMidlaneBriefing(
      sample({
        roamGames: 14,
        roamDirs: { bot: 10, top: 4, invade: 0 },
        firstKillGames: 12,
        firstKillBuckets: [0, 0, 8, 4, 0],
        laneDiffGames: 20,
        goldLead10Games: 15,
        goldDiff10Sum: 9000
      })
    )
    expect(result.callout).toBe('这人前期常往下走；中路消失，下路先防。')
    expect(result.signals.map((s) => s.evidence)).toEqual([
      '14/20 场有游走，其中 10 场首次去下路',
      '12/20 场有前期单杀，8 场首次在 6级',
      '10 分钟经济 15/20 场领先，场均 +450'
    ])
  })

  it('按对局首次去向判断，不让同一局反复走某侧改变方向提醒', () => {
    const result = buildMidlaneBriefing(
      sample({
        roamGames: 12,
        roamDirs: { top: 9, bot: 3, invade: 0 },
        roamEpisodes: 50,
        roamEpisodeDirs: { top: 10, bot: 40 }
      })
    )
    expect(result.headline).toBe('前期游走偏上')
    expect(result.signals[0].evidence).toContain('9 场首次去上路')
    const split = buildMidlaneBriefing(
      sample({ roamGames: 12, roamDirs: { top: 6, bot: 6, invade: 0 } })
    )
    expect(split.callout).toContain('两边先防')
  })

  it.each([
    [sample({ deepGames: 3, roamGames: 3, firstKillGames: 3 }), 'insufficient'],
    [sample({ timelineFailures: 10, attemptedGames: 30, roamGames: 20 }), 'incomplete']
  ] as const)('样本少或缺失过多时收起行为判断', (input, status) => {
    const result = buildMidlaneBriefing(input)
    expect(result.status).toBe(status)
    expect(result.signals).toEqual([])
    expect(result.callout).not.toContain('常往')
  })

  it('没有突出信号时不把零游走或低经济推成不会支援、容易抓', () => {
    const result = buildMidlaneBriefing(sample({ laneDiffGames: 20, goldDiff10Sum: -20000 }))
    expect(result.status).toBe('neutral')
    expect(result.callout).toBe('历史记录暂未显示突出倾向，先按这局表现判断。')
    expect(result.signals).toEqual([])
  })

  it('单杀等级缺失或并列时只提醒对拼，不擅自选一个强势等级', () => {
    for (const firstKillBuckets of [
      [0, 0, 0, 0, 0],
      [0, 5, 5, 0, 0]
    ]) {
      const result = buildMidlaneBriefing(sample({ firstKillGames: 10, firstKillBuckets }))
      expect(result.headline).toBe('前期单杀记录较多')
      expect(result.signals[0].evidence).toBe('10/20 场有前期单杀（不限对手）')
    }
  })

  it('经济提醒同时要求独立有效样本、覆盖率、领先场次与均值', () => {
    const healthy = { laneDiffGames: 20, goldLead10Games: 14, goldDiff10Sum: 8000 }
    expect(buildMidlaneBriefing(sample(healthy)).signals[0].kind).toBe('lane')
    for (const overrides of [
      { laneDiffGames: 0, goldLead10Games: 0 },
      { laneDiffGames: 8, goldLead10Games: 8 },
      { laneDiffGames: 10, goldLead10Games: 10 }, // 仅覆盖一半对局
      { goldLead10Games: 1 }, // 一场极端领先不能代表经常领先
      { goldDiff10Sum: 1000 }
    ]) {
      expect(buildMidlaneBriefing(sample({ ...healthy, ...overrides })).signals).toEqual([])
    }
  })

  it('真实统计链路的游走计数可直接生成提醒，失败记录不会混入分母', async () => {
    const games = Array.from({ length: 11 }, (_, i) => ({
      gameId: i + 1,
      gameCreation: 1700000000000 - i,
      gameVersion: '16.18',
      gameDuration: 1800,
      win: true,
      selfPid: 3,
      teamId: 100,
      participantTeams: { 3: 100 },
      enemyMidPid: null
    }))
    const result = await analyzeDeep(games, async (id) => {
      if (id === 11) return { frames: [] }
      return {
        frames: Array.from({ length: 15 }, (_, minute) => ({
          timestamp: minute * 60000,
          participantFrames: {
            3: { position: minute === 6 && id <= 8 ? { x: 12000, y: 2500 } : { x: 7400, y: 7400 } }
          },
          events: []
        }))
      }
    })
    const briefing = buildMidlaneBriefing(result)
    expect(briefing.headline).toBe('前期游走偏下')
    expect(briefing.signals[0].evidence).toBe('8/10 场有游走，其中 8 场首次去下路')
  })
})
