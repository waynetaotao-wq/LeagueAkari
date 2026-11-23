import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { buildReviewBaseline } from './baseline'
import {
  REVIEW_COACH_MAX_EXTREME_ROWS,
  REVIEW_DIGEST_METRIC_LABELS,
  type ReviewCoachContextInput,
  buildReviewCoachContext,
  formatReviewMetric
} from './coach-context'
import { REVIEW_DIGEST_METRIC_KEYS } from './match-digest'
import type { ReviewItemKindResolver } from './match-report'
import {
  addReviewEvent,
  createReviewFixture,
  reviewBuilding,
  reviewLevelUp,
  reviewMonster,
  reviewPurchase,
  reviewSkill,
  reviewTakedown,
  reviewWard,
  reviewWardKill,
  setReviewStats
} from './test-fixtures'
import type { ReviewItemKind, ReviewMatch } from './types'

const ITEM_KINDS: Record<number, ReviewItemKind> = {
  1055: 'starter',
  1036: 'component',
  3158: 'boots',
  6692: 'core'
}
const itemKind: ReviewItemKindResolver = (itemId) => ITEM_KINDS[itemId] ?? null

const names: ReviewCoachContextInput['names'] = {
  champion: (id) => ({ 238: '劫', 103: '阿狸' })[id] ?? `英雄${id}`,
  item: (id) =>
    ({ 1055: '多兰之刃', 1036: '长剑', 3158: '明朗之靴', 6692: '星蚀' })[id] ?? `物品${id}`,
  perk: (id) => `符文${id}`,
  spell: (id) => ({ 4: '闪现', 14: '引燃' })[id] ?? `技能${id}`,
  queue: (id) => (id === 420 ? '单双排位' : `队列${id}`)
}

/** One invented game: a solo kill, a ganked death followed by a lost dragon, a tower and a shop trip. */
function richGame(options: { win?: boolean; gameId?: number } = {}): ReviewMatch {
  const fixture = createReviewFixture({ gameId: options.gameId ?? 4242, win: options.win ?? false })
  const { summary, details } = fixture
  setReviewStats(summary, 8, {
    kills: 1,
    deaths: 1,
    assists: 0,
    champLevel: 13,
    totalMinionsKilled: 190,
    neutralMinionsKilled: 8,
    goldEarned: 9800,
    goldSpent: 9300,
    totalDamageDealtToChampions: 15_400,
    totalDamageTaken: 13_100,
    visionScore: 17,
    wardsPlaced: 2,
    wardsKilled: 1,
    visionWardsBoughtInGame: 1,
    totalTimeSpentDead: 31,
    item0: 6692,
    item1: 3158,
    spell1Id: 4,
    spell2Id: 14,
    summoner1Casts: 3,
    summoner2Casts: 2,
    firstBloodKill: true
  })
  setReviewStats(summary, 3, { kills: 1, deaths: 1, champLevel: 14, item0: 1036 })
  addReviewEvent(details, reviewPurchase(5_000, 1055))
  addReviewEvent(details, reviewSkill(10_000, 1))
  addReviewEvent(details, reviewSkill(95_000, 2))
  addReviewEvent(details, reviewLevelUp(95_000, 2))
  addReviewEvent(details, reviewLevelUp(100_000, 2, 3))
  addReviewEvent(details, reviewWard(130_000))
  addReviewEvent(
    details,
    reviewTakedown(240_000, 8, 3, { position: { x: 8400, y: 8300 }, shutdownBounty: 150 })
  )
  addReviewEvent(details, {
    type: 'CHAMPION_SPECIAL_KILL',
    timestamp: 240_000,
    killerId: 8,
    killType: 'KILL_FIRST_BLOOD',
    position: { x: 8400, y: 8300 }
  })
  addReviewEvent(details, reviewPurchase(300_000, 1036))
  addReviewEvent(details, reviewPurchase(302_000, 3158))
  addReviewEvent(details, reviewWard(420_000, 'CONTROL_WARD'))
  addReviewEvent(details, reviewWardKill(480_000))
  addReviewEvent(
    details,
    reviewTakedown(570_000, 3, 8, {
      assists: [9],
      position: { x: 6700, y: 6600 },
      received: [
        { participantId: 3, type: 'CHAMPION', spellSlot: 0, magicDamage: 320 },
        { participantId: 3, type: 'CHAMPION', spellSlot: 3, magicDamage: 410 },
        { participantId: 9, type: 'CHAMPION', basic: true, physicalDamage: 150 },
        { participantId: 0, type: 'TOWER', physicalDamage: 90 }
      ],
      dealt: [{ participantId: 8, type: 'CHAMPION', physicalDamage: 260 }]
    })
  )
  addReviewEvent(details, reviewMonster(600_000, 'DRAGON', 9, { subType: 'FIRE_DRAGON' }))
  addReviewEvent(details, reviewPurchase(610_000, 6692))
  addReviewEvent(details, reviewBuilding(900_000, 200, 2, { assists: [8] }))
  const parsed = parseReviewMatch(summary, details, fixture.puuid, fixture.sgpServerId, {
    itemKind
  })
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.match
}

const build = (overrides: Partial<ReviewCoachContextInput> = {}) =>
  buildReviewCoachContext({
    match: richGame(),
    baseline: null,
    form: null,
    tips: [],
    names,
    ...overrides
  })

describe('buildReviewCoachContext', () => {
  it('opens with what the game was and who played what, without any player identity', () => {
    const { text, sections } = build()

    expect(sections[0]).toBe('对局概况')
    expect(text).toContain('版本 16.17；单双排位；时长 25:00；本人失败')
    expect(text).toContain('本人：劫，中单，蓝色方。对位：阿狸。')
    expect(text).toContain(
      '蓝色方（我方）：上单 英雄102、打野 英雄110、中单 劫（本人）、下路 英雄104、辅助 英雄106。'
    )
    expect(text).toContain(
      '红色方（敌方）：上单 英雄101、打野 英雄109、中单 阿狸、下路 英雄105、辅助 英雄107。'
    )
    // 名字和账号标识一个都不能出现。
    expect(text).not.toMatch(/Player\d|player-\d|TEST/)
  })

  it('lists all ten final stat lines, own team first', () => {
    const { text } = build()
    const section = text.split('## ').find((part) => part.startsWith('最终数据'))!
    const lines = section.split('\n').slice(1).filter(Boolean)

    expect(lines).toHaveLength(10)
    expect(lines.map((line) => line.split('｜')[0])).toEqual([
      '我方 上单 英雄102',
      '我方 打野 英雄110',
      '我方 中单 劫（本人）',
      '我方 下路 英雄104',
      '我方 辅助 英雄106',
      '敌方 上单 英雄101',
      '敌方 打野 英雄109',
      '敌方 中单 阿狸',
      '敌方 下路 英雄105',
      '敌方 辅助 英雄107'
    ])
    expect(section).toContain(
      '我方 中单 劫（本人）｜KDA 1/1/0｜等级 13｜补刀 198｜经济 9800｜对英雄伤害 15400｜承伤 13100｜视野得分 17'
    )
  })

  it('writes unknown instead of zero for numbers the record does not carry', () => {
    const { text } = build()
    expect(text).toMatch(/敌方 上单 英雄101｜KDA 未知\/0\/未知｜等级 未知/)
  })

  it('describes the own takedown with place, credit and gold', () => {
    const { text } = build()
    expect(text).toContain('## 击杀与助攻（共 1 次）')
    expect(text).toContain(
      '4:00 中路敌方半场：击杀 阿狸（中单），没有队友参与（单杀），击杀金币 300，终结赏金 150，一血。'
    )
  })

  it('describes the own death with its damage sources and what was lost afterwards', () => {
    const { text } = build()
    const section = text.split('## ').find((part) => part.startsWith('阵亡'))!

    expect(section).toContain('9:30 中路己方半场：阿狸（中单）击杀，英雄109（打野）助攻。')
    expect(section).toContain(
      '承受伤害 970，来源：阿狸（中单） 730〔Q 320、R 410〕；英雄109（打野） 150〔普攻 150〕；防御塔 90。'
    )
    expect(section).toContain('不在任何一场交战里。')
    expect(section).toContain('阵亡前打出伤害 260。')
    expect(section).toContain('此后 90 秒内敌方拿下：炼狱小龙。')
  })

  it('lists objectives with ownership, own part and how recently the player died', () => {
    const { text } = build()
    expect(text).toMatch(/10:00 炼狱小龙：敌方拿下，本人 30 秒前刚阵亡/)
    expect(text).toMatch(/15:00 中路外塔：我方拿下，本人有参与/)
  })

  it('groups purchases by shop visit and names the completed items', () => {
    const { text } = build()
    expect(text).toContain('0:05 回城：多兰之刃')
    expect(text).toContain('5:00 回城：长剑、明朗之靴')
    expect(text).toContain('10:10 阵亡后：星蚀')
    expect(text).toContain('成装完成时间：星蚀 10:10。')
    expect(text).toContain('第一双升级鞋：明朗之靴 5:02。')
    expect(text).toContain('加点顺序：Q W。')
  })

  it('reports level timings, vision by phase and the summoner spells', () => {
    const { text } = build()
    expect(text).toContain('2 级 1:35 / 1:40')
    expect(text).toContain('0–10 分钟：放置 2（饰品眼 1、控制守卫 1），清除 1。')
    expect(text).toContain('召唤师技能 闪现 3 次、引燃 2 次。')
    expect(text).toContain('局末装备：星蚀、明朗之靴')
    expect(text).toContain('对位的局末装备：长剑')
  })

  it('says so when no lane opponent could be identified', () => {
    const match = richGame()
    match.meta.opponentId = null
    match.meta.opponentChampionId = null
    expect(build({ match }).text).toContain('未能唯一确认同位置对手')
  })

  it('warns that event lists may be short when the log could not be reconciled', () => {
    const match = richGame()
    match.report!.complete = false
    expect(build({ match }).text).toContain('次数只是下限')
  })

  it('stops early for an archived game without a report', () => {
    const match = { ...richGame(), report: null }
    const { text, sections } = build({ match })
    expect(sections).toEqual(['对局概况', '资料缺失'])
    expect(text).toContain('请先重新读取这一局')
  })

  it('states plainly that there is no baseline to compare with', () => {
    const { text } = build()
    expect(text).toContain('可比的对局不足 5 局')
    expect(text).toContain('不要凭空假设')
  })

  it('compares the game with the player baseline and marks what stands out', () => {
    const match = richGame()
    const others = [1, 2, 3, 4, 5, 6].map((index) => {
      const other = richGame({ gameId: 5000 + index, win: index % 2 === 0 })
      other.digest!.metrics.deaths = 4 + index
      other.digest!.metrics.csPerMinute = 6 + index / 10
      return other
    })
    const baseline = buildReviewBaseline(others, 'champion')!
    const { text } = build({ match, baseline })
    const section = text.split('## ').find((part) => part.startsWith('与本人平时的对比'))!

    expect(section).toContain('同英雄同位置（劫 中单）的另外 6 局，其中 3 胜')
    expect(section).toContain(
      '- 死亡：本局 1，平时中位数 7.5（中间一半的对局在 6.3 到 8.8 之间，6 局） → 比平时好。'
    )
    expect(section).toContain(
      '- 每分钟补刀：本局 7.9，平时中位数 6.3（中间一半的对局在 6.2 到 6.5 之间，6 局） → 比平时好。'
    )
    expect(section).toContain('与平时相近的项目：')
    expect(section).toContain('到 2 级相对对位的先后 早 5 秒')
  })

  it('separates what stands out from what merely leans away from the usual', () => {
    const match = richGame()
    const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => {
      const other = richGame({ gameId: 6000 + index })
      // 本局 190 刀出头：补刀高于大多数对局但不是最高的一档；阵亡数低于全部对局。
      other.digest!.metrics.cs = index <= 8 ? 150 + index : 230 + index
      other.digest!.metrics.deaths = 5 + index
      return other
    })
    const section = build({ match, baseline: buildReviewBaseline(others, 'champion')! })
      .text.split('## ')
      .find((part) => part.startsWith('与本人平时的对比'))!

    expect(section).toContain(
      '最突出的项目（比这些对局里至少九成都高，或都低；按偏离幅度从大到小）：'
    )
    expect(section).toMatch(/- 死亡：本局 1，.* → 比平时好。/)
    expect(section).not.toMatch(/- 补刀：/)
    expect(section).toMatch(/略高于平时的项目：.*补刀 198（平时 155\.5）/)
    expect(section).toContain('样本只有 10 局，单独一项偏离可能只是偶然')
  })

  it('spells out only the most unusual numbers and lists the rest briefly', () => {
    const match = richGame()
    const keys = Object.keys(match.digest!.metrics).filter(
      (key) => typeof match.digest!.metrics[key] === 'number'
    )
    // 让本局的每个数字都高于平时的全部对局，幅度各不相同。
    const others = [1, 2, 3, 4, 5, 6].map((index) => {
      const other = richGame({ gameId: 7000 + index })
      keys.forEach((key, order) => {
        other.digest!.metrics[key] = match.digest!.metrics[key]! - (order + 2) * 10 - index
      })
      return other
    })
    const section = build({ match, baseline: buildReviewBaseline(others, 'champion')! })
      .text.split('## ')
      .find((part) => part.startsWith('与本人平时的对比'))!
    const spelled = section.split('\n').filter((line) => line.startsWith('- '))

    expect(keys.length).toBeGreaterThan(REVIEW_COACH_MAX_EXTREME_ROWS)
    expect(spelled).toHaveLength(REVIEW_COACH_MAX_EXTREME_ROWS)
    expect(section).toContain('同样处在最高或最低一档、幅度较小的项目：')
    // 幅度最大的排在最前面。
    const deviations = spelled.map((line) => {
      const [value, median] = [...line.matchAll(/(-?\d+(?:\.\d+)?)/g)].map((found) =>
        Number(found[1])
      )
      return Math.abs(value - median)
    })
    expect(deviations[0]).toBeGreaterThanOrEqual(deviations.at(-1)!)
  })

  it('says none instead of dropping a list that is empty', () => {
    const match = richGame()
    match.report!.deaths = []
    match.deaths = []
    match.report!.takedowns = []
    match.report!.objectives = []
    match.moments = []
    const { text } = build({ match })

    expect(text).toContain('## 阵亡（共 0 次')
    expect(text).toContain('这一局本人没有阵亡。')
    expect(text).toContain('这一局本人没有击杀也没有助攻。')
    expect(text).toContain('时间线里没有防御塔、水晶或史诗野怪被拿下的记录。')
    expect(text).toContain('没有符合条件的交战。')
    expect(text).toContain('按现有规则没有标出关键片段。')
  })

  it('names the dragon soul and marks a shop stop that only had an undone purchase', () => {
    const match = richGame()
    match.report!.teams[0].soul = 'Chemtech'
    match.report!.teams[1].soul = 'SomethingNew'
    match.report!.build.visits.push({ timestamp: 700_000, afterDeath: false, itemIds: [] })
    const { text } = build({ match })

    expect(text).toContain('龙魂 炼金')
    expect(text).toContain('龙魂 SomethingNew')
    expect(text).toContain('11:40 回城：只有买了又撤销的操作')
  })

  it('adds recent form and matchup notes when they are known', () => {
    const { text, sections } = build({
      form: {
        rank: '黄金 II · 40 胜点',
        recent: { games: 20, wins: 9 },
        streak: { win: false, length: 3 },
        lpDelta: -19,
        sessionIndex: 4,
        lossesBefore: 2
      },
      tips: ['三级前别和阿狸换血', '六级后注意魅惑']
    })

    expect(text).toContain('当前段位：黄金 II · 40 胜点。')
    expect(text).toContain('最近 20 场计入胜负的排位：9 胜 11 负。')
    expect(text).toContain('目前 3 连败。')
    expect(text).toContain('这一局的胜点变化：-19。')
    expect(text).toContain('这一局是连着打的第 4 局，开打前已经连败 2 场。')
    expect(text).toContain('- 三级前别和阿狸换血')
    expect(sections.at(-1)).toBe('这份资料不包含的东西')
  })

  it('leaves out parts of the form that are unknown', () => {
    const { text } = build({
      form: {
        rank: null,
        recent: null,
        streak: null,
        lpDelta: null,
        sessionIndex: 1,
        lossesBefore: 0
      }
    })
    expect(text).toContain('这一局是连着打的第 1 局。')
    expect(text).not.toContain('当前段位')
    expect(text).not.toContain('胜点变化')
  })

  it('always closes with what the data cannot show', () => {
    const { text } = build()
    expect(text).toContain('看不到分钟之内的走位')
    expect(text).toContain('没有技能是否命中')
  })

  it('stays within a size a model reads comfortably', () => {
    expect(build().text.length).toBeLessThan(12_000)
  })
})

describe('metric wording', () => {
  it('has a label for every digest metric', () => {
    expect(Object.keys(REVIEW_DIGEST_METRIC_LABELS).toSorted()).toEqual(
      [...REVIEW_DIGEST_METRIC_KEYS].toSorted()
    )
    expect(new Set(Object.values(REVIEW_DIGEST_METRIC_LABELS)).size).toBeGreaterThan(70)
  })

  it.each([
    [754_000, 'time', '12:34'],
    [95, 'seconds', '95 秒'],
    [0.284, 'share', '28%'],
    [7.86, 'rate', '7.9'],
    [-412.4, 'diff', '-412.4'],
    [350, 'diff', '+350'],
    [12, 'count', '12'],
    [9800, 'gold', '9800']
  ] as const)('writes %d as %s: %s', (value, unit, expected) => {
    expect(formatReviewMetric(value, unit)).toBe(expected)
  })
})
