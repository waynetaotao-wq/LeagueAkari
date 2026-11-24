import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { buildReviewBaseline } from './baseline'
import { buildReviewCoachCatalogue } from './coach-catalogue'
import {
  REVIEW_COACH_MAX_EXTREME_ROWS,
  REVIEW_DIGEST_METRIC_LABELS,
  type ReviewCoachContextInput,
  buildReviewCoachContext,
  formatReviewMetric
} from './coach-context'
import type { ReviewLoadoutHistory, ReviewLoadoutStatistics } from './coach-statistics'
import { REVIEW_DIGEST_METRIC_KEYS } from './match-digest'
import type { ReviewItemKindResolver } from './match-report'
import {
  addReviewEvent,
  createReviewFixture,
  reviewBountyEnd,
  reviewBountyStart,
  reviewBuilding,
  reviewLevelUp,
  reviewMonster,
  reviewPlate,
  reviewPurchase,
  reviewSkill,
  reviewSoul,
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
  6692: 'core',
  3340: 'trinket'
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

/**
 * One invented game: a solo kill, a ganked death followed by a lost dragon, a tower and a shop trip.
 * `prepare` can change the raw summary and timeline before they are parsed.
 */
function richGame(
  options: {
    win?: boolean
    gameId?: number
    prepare?: (fixture: ReturnType<typeof createReviewFixture>) => void
  } = {}
): ReviewMatch {
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
    reviewTakedown(240_000, 8, 3, {
      position: { x: 8400, y: 8300 },
      shutdownBounty: 150,
      received: [
        { participantId: 8, spellSlot: 0, physicalDamage: 200 },
        { participantId: 8, basic: true, physicalDamage: 120 },
        { participantId: 8, spellSlot: 5, spellName: 'summonerdot', trueDamage: 80 },
        { type: 'MINION', physicalDamage: 40 }
      ]
    })
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
  options.prepare?.(fixture)
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

  it('describes the own takedown with place, credit, gold and the damage the player did', () => {
    const { text } = build()
    expect(text).toContain('## 击杀与助攻（共 1 次；')
    expect(text).toContain(
      '4:00 中路敌方半场：击杀 阿狸（中单），没有队友参与（单杀），击杀金币 300，终结赏金 150，一血。本人对其造成 400〔普攻 120、Q 200、召唤师技能 80，其中点燃 80〕，占记录里其所受伤害 440 的 91%。'
    )
  })

  it('says so when the damage list of a takedown has nothing by the player', () => {
    const match = richGame()
    match.report!.takedowns[0].damage = null
    expect(build({ match }).text).toContain('一血。伤害清单里没有本人对其造成的伤害。')
  })

  it('describes the own death with its damage sources and what was lost afterwards', () => {
    const { text } = build()
    const section = text.split('## ').find((part) => part.startsWith('阵亡'))!

    expect(section).toContain('9:30 中路己方半场：阿狸（中单）击杀，英雄109（打野）助攻。')
    expect(section).toContain(
      '承受伤害 970，来源：阿狸（中单） 730〔Q 320、R 410〕；英雄109（打野） 150〔普攻 150〕；防御塔 90。按类型：物理 240、魔法 730、真实 0。'
    )
    // The record has no wider list, so no line gives its totals; only the heading mentions it.
    expect(section.split('\n').slice(1).join('\n')).not.toContain('「团战」清单')
    expect(section.split('\n')[0]).toContain('同一条记录里还有一份官方叫「团战」的清单')
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
    // The first purchase of the game is the starting item, not a recall.
    expect(text).toContain('0:05 开局购买：多兰之刃')
    expect(text).toContain('5:00 回城：长剑、明朗之靴')
    expect(text).toContain('10:10 阵亡后：星蚀')
    expect(text).toContain('成装完成时间（成装指由散件合成的大件，鞋另算）：星蚀 10:10。')
    expect(text).toContain('第一双升级鞋：明朗之靴 5:02。')
    expect(text).toContain('加点顺序：Q W。')
    // The time of a stop is its first purchase, which the heading says.
    expect(text).toContain('时间是这次停留里第一笔买卖的时刻')
  })

  it('says which final items were never bought, for the player and the lane opponent', () => {
    const match = richGame({
      // A boot that was upgraded for free and an item the opponent never paid for.
      prepare: ({ summary }) => setReviewStats(summary, 8, { item2: 3172 })
    })
    const { text } = build({ match })
    const own = text.split('## ').find((part) => part.startsWith('出装与回城'))!
    const opponent = text.split('## ').find((part) => part.startsWith('对位的出装与回城'))!

    expect(own).toContain(
      '局末装备里没有购买记录的：物品3172。它们不是在商店买的，是别的装备变成的，或者任务、符文给的。什么时候得到的，时间线里看不出来。'
    )
    // The opponent ends with a long sword and has no purchase at all in the timeline.
    expect(opponent).toContain('局末装备里没有购买记录的：长剑。')
    // Nothing of the kind is said when every final item was bought.
    expect(
      build()
        .text.split('## ')
        .find((part) => part.startsWith('出装与回城'))!
    ).not.toContain('没有购买记录')
  })

  it('explains that a support’s starting item is missing from the purchases', () => {
    const match = richGame()
    const note = '辅助开局的那件辅助装是系统自动给的'
    expect(build({ match }).text).not.toContain(note)

    match.report!.players.find((player) => player.participantId === 8)!.position = 'UTILITY'
    const section = build({ match })
      .text.split('## ')
      .find((part) => part.startsWith('出装与回城'))!
    expect(section).toContain(note)
  })

  it('reports level timings, vision by phase and the summoner spells', () => {
    const { text } = build()
    expect(text).toContain('2 级 1:35 / 1:40')
    expect(text).toContain('0–10 分钟：放置 2（饰品眼 1、控制守卫 1），清除 1。')
    expect(text).toContain('召唤师技能 闪现 3 次、引燃 2 次。')
  })

  it('lists what all ten players took, own team first', () => {
    const { text } = build()
    const section = text.split('## ').find((part) => part.startsWith('十人的符文'))!
    const lines = section.trimEnd().split('\n').slice(1)

    expect(lines).toHaveLength(10)
    // The fixture has no rune page; the summary's spells and items are still listed.
    expect(lines[2]).toBe(
      '我方 中单 劫（本人）：符文未知；召唤师技能 闪现、引燃；装备 星蚀、明朗之靴。'
    )
    expect(lines[7]).toBe('敌方 中单 阿狸：符文未知；召唤师技能 无；装备 长剑。')
  })

  it('says how the other lanes stood at each checkpoint', () => {
    const { text } = build()
    const section = text.split('## ').find((part) => part.startsWith('对线与节奏'))!

    expect(section).toContain(
      '各路经济差（我方减敌方同位置的人）：5 分钟 上单 +150、打野 +150、中单 +300、下路 +150、辅助 +150；10 分钟 上单 +300、打野 +300、中单 +600、下路 +300、辅助 +300；'
    )
    // The game lasts 25 minutes: the last checkpoint closes the sentence.
    expect(section).toMatch(
      /25 分钟 上单 \+750、打野 \+750、中单 \+1500、下路 \+750、辅助 \+750。\s*$/
    )
  })

  it('lists every minute with the cumulative numbers of the player and the lane opponent', () => {
    const { text, sections } = build()
    const title = sections.find((entry) => entry.startsWith('逐分钟数据'))!
    const lines = text.split(`## ${title}\n`)[1].split('\n\n')[0].split('\n')

    // One line that explains the columns, then one row per snapshot of the 25-minute game.
    expect(lines).toHaveLength(26)
    expect(lines[0]).toContain(
      '时间｜本人 经济、身上还没花的金币、补刀、等级、血量/上限、累计对英雄伤害、累计承受伤害（「受」，含小兵、野怪和防御塔打的）、击杀-死亡-助攻'
    )
    expect(lines[0]).toContain(
      '｜对位 经济、补刀、等级、血量/上限、累计对英雄伤害、累计承受伤害｜本人减对位的经济差、补刀差'
    )
    // The solo kill at 4:00 is on the 4:00 row, and the opponent it killed is dead in that row;
    // purse, health and damage are not in this record.
    expect(lines[4]).toBe(
      '4:00｜本人 1940金 身上? 32刀 3级 血? ?伤 受? 1-0-0｜对位 1700金 28刀 3级 阵亡 ?伤 受?｜差 +240金 +4刀｜团队 +720｜人头 1:0'
    )
    // The death at 9:30 shows from the 10:00 row on.
    expect(lines[9]).toContain('9:00｜本人 3740金 身上? 72刀 5级 血? ?伤 受? 1-0-0｜')
    expect(lines[10]).toBe(
      '10:00｜本人 4100金 身上? 80刀 6级 血? ?伤 受? 1-1-0｜对位 3500金 70刀 6级 血? ?伤 受?｜差 +600金 +10刀｜团队 +1800｜人头 1:1'
    )
    expect(lines[25]).toContain('25:00｜本人 9500金 ')
  })

  it('writes the purse, the health and the damage where the timeline records them', () => {
    const match = richGame()
    const of = (participantId: number) =>
      match.frames[6].participants.find((entry) => entry.participantId === participantId)!
    Object.assign(of(8), {
      unspentGold: 1350.4,
      damage: 2400,
      damageTaken: 1900.2,
      health: 611.6,
      healthMax: 1480
    })
    // Dead at the snapshot: health 0 is written as it is.
    Object.assign(of(3), { health: 0, healthMax: 1320 })
    const { text } = build({ match })

    expect(text).toContain(
      '6:00｜本人 2660金 身上1350 48刀 4级 血612/1480 2400伤 受1900 1-0-0｜对位 2300金 42刀 4级 血0/1320 ?伤 受?｜'
    )
  })

  it('drops the opponent columns when no lane opponent could be identified', () => {
    const match = richGame()
    match.meta.opponentId = null
    match.meta.opponentChampionId = null
    for (const frame of match.frames)
      Object.assign(frame, { personalGoldDiff: null, personalCsDiff: null })
    const { text } = build({ match })
    const section = text.split('## ').find((part) => part.startsWith('逐分钟数据'))!

    expect(section).not.toContain('对位')
    expect(section).toContain(
      '4:00｜本人 1940金 身上? 32刀 3级 血? ?伤 受? 1-0-0｜团队 +720｜人头 1:0'
    )
  })

  it('lists where all ten players were each minute, in the order of the line-ups', () => {
    const match = richGame()
    const move = (minute: number, participantId: number, values: object) =>
      Object.assign(
        match.frames[minute].participants.find((entry) => entry.participantId === participantId)!,
        values
      )
    // 7:00 — the player is at his fountain, his jungler in the enemy top jungle, the enemy
    // mid in the river on the dragon side, the enemy support dead, the enemy top unrecorded.
    move(7, 8, { position: { x: 800, y: 900 } })
    move(7, 10, { position: { x: 5200, y: 11_400 } })
    move(7, 3, { position: { x: 9800, y: 4600 } })
    move(7, 7, { alive: false })
    move(7, 1, { position: null })
    const { text, sections } = build({ match })
    const title = sections.find((entry) => entry.startsWith('逐分钟位置'))!
    const lines = text.split(`## ${title}\n`)[1].split('\n\n')[0].split('\n')

    expect(lines).toHaveLength(27)
    // Both halves of a row are named from the reviewed player's side, and the header says so.
    expect(lines[0]).toContain('区域一律从本人一方的视角命名，敌方那一半的格子也一样')
    expect(lines[0]).toContain('敌方英雄写着「己方上半野区」就是进了我方的野区')
    expect(lines[1]).toBe(
      '每行依次是：时间｜我方 上单 英雄102、打野 英雄110、中单 劫（本人）、下路 英雄104、辅助 英雄106｜敌方 上单 英雄101、打野 英雄109、中单 阿狸、下路 英雄105、辅助 英雄107。每格前面的字是位置：上 = 上单、野 = 打野、中 = 中单、下 = 下路、辅 = 辅助，本人的那一格写「本人」。'
    )
    // Every cell says whose it is, and the places are named as in the kill and death sections.
    expect(lines[2]).toBe(
      '1:00｜上 中路己方半场、野 中路己方半场、本人 中路己方半场、下 中路己方半场、辅 中路己方半场｜上 中路己方半场、野 中路己方半场、中 中路己方半场、下 中路己方半场、辅 中路己方半场'
    )
    expect(lines[8]).toBe(
      '7:00｜上 中路己方半场、野 敌方上半野区、本人 己方基地、下 中路己方半场、辅 中路己方半场｜上 未知、野 中路己方半场、中 下河道（小龙侧）、下 中路己方半场、辅 阵亡'
    )
  })

  it('names a fight after the places of its kills, not after a point between them', () => {
    const match = richGame()
    const fight = {
      start: 700_000,
      end: 709_000,
      // The centre of the kills lies in the enemy jungle, where nothing happened.
      point: { x: 10_867, y: 5367 },
      killPoints: [
        { x: 9800, y: 4600 },
        { x: 9900, y: 4700 },
        { x: 12_900, y: 6800 }
      ],
      kills: 2,
      deaths: 1,
      allies: 3,
      enemies: 2,
      ownKills: 1,
      ownAssists: 0,
      ownDeathOrder: null,
      objectivesAfter: []
    }
    match.report!.fights = [
      fight,
      { ...fight, start: 800_000, end: 800_000, killPoints: [] },
      // Two enemies and one teammate died, but one on each side died to a turret.
      { ...fight, start: 900_000, end: 905_000, enemyExecutions: 1, allyExecutions: 1 }
    ]
    const section = build({ match })
      .text.split('## ')
      .find((part) => part.startsWith('交战'))!

    expect(section).toContain(
      '第 1 场 11:40–11:49 下河道（小龙侧）、下路敌方半场一带：我方击杀 2、敌方击杀 1；卷入 我方 3 名、敌方 2 名；本人 1 杀 0 助，存活。'
    )
    // What a fight is and what "卷入" counts is explained once, in the heading.
    const heading = section.split('\n')[0]
    expect(heading).toContain('15 秒内、相距不远的击杀归为同一场')
    expect(heading).toContain('至少 2 次击杀、或者一次击杀但卷入至少 6 人才算一场')
    expect(heading).toContain('「卷入」只数被记上击杀、助攻或被击杀的人')
    // Without located kills the centre is all there is.
    expect(section).toContain('第 2 场 13:20–13:20 敌方下半野区：')
    // An execution is nobody's kill here, as in the kill list and the per-minute score.
    expect(section).toContain(
      '第 3 场 15:00–15:05 下河道（小龙侧）、下路敌方半场一带：我方击杀 1、敌方击杀 0，另有敌方 1 人、我方 1 人被处决；卷入'
    )
  })

  it('says so when a death record has damage taken but none dealt', () => {
    const match = richGame()
    match.report!.deaths[0].damageDealt = null
    const withSources = build({ match }).text
    expect(withSources).toContain(
      '击杀记录里没有本人阵亡前打出的伤害（可能没有打出，也可能没有记录）。'
    )

    // A record without any damage entries already says that nothing was recorded.
    match.report!.deaths[0].sources = []
    const bare = build({ match }).text
    expect(bare).toContain('这次阵亡没有伤害来源记录。')
    expect(bare).not.toContain('击杀记录里没有本人阵亡前打出的伤害')
  })

  it('puts the per-minute tables after the event sections and before the comparisons', () => {
    const { sections } = build()
    const index = (start: string) => sections.findIndex((entry) => entry.startsWith(start))

    expect(index('逐分钟数据')).toBeGreaterThan(index('视野'))
    expect(index('逐分钟位置')).toBe(index('逐分钟数据') + 1)
    expect(index('官方挑战统计') === -1 || index('官方挑战统计') > index('逐分钟位置')).toBe(true)
    expect(index('程序标出的关键片段')).toBeGreaterThan(index('逐分钟位置'))
  })

  it('says so when the timeline has no snapshots or no positions', () => {
    const match = richGame()
    const bare = build({ match: { ...match, frames: [] } }).text
    expect(bare).toContain('时间线里没有可用的分钟快照。')
    expect(bare).toContain('时间线里没有位置记录。')

    for (const frame of match.frames)
      for (const entry of frame.participants) Object.assign(entry, { position: null })
    const unplaced = build({ match }).text
    expect(unplaced).toContain('时间线里没有位置记录。')
    expect(unplaced).toContain('4:00｜本人 1940金')
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
      // The first completed item usually comes around twelve minutes; here it came at 10:10.
      other.digest!.metrics.firstCoreAt = 700_000 + index * 4000
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
    // A time of this game is a clock; the usual times are not moments of this game.
    expect(section).toContain(
      '- 第一件成装时间：本局 10:10，平时中位数 11 分 54 秒（中间一半的对局在 11 分 49 秒 到 11 分 59 秒 之间，6 局）'
    )
    // What is close to the usual is counted, not listed.
    expect(section).toMatch(/其余 \d+ 项落在平时中间一半的范围里，不逐个列出。/)
    expect(section).not.toContain('与平时相近的项目')
    expect(section).not.toContain('到 2 级相对对位的先后')
    // The fight numbers follow the fight rule, which is said where they are read.
    expect(section).toContain('单独的一次击杀不算交战')
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

  it('names the dragon soul and tells what a shop stop without a purchase was', () => {
    const match = richGame()
    match.report!.teams[0].soul = 'Chemtech'
    match.report!.teams[1].soul = 'SomethingNew'
    match.report!.build.visits.push(
      { timestamp: 700_000, afterDeath: false, itemIds: [] },
      { timestamp: 760_000, afterDeath: false, itemIds: [], soldIds: [1055] },
      { timestamp: 820_000, afterDeath: false, itemIds: [1036], soldIds: [3158] }
    )
    const { text } = build({ match })

    expect(text).toContain('龙魂 炼金')
    expect(text).toContain('龙魂 SomethingNew')
    expect(text).toContain('11:40 回城：没有留下买卖（操作之后又撤销了）')
    expect(text).toContain('12:40 回城：没有买东西，只卖出 多兰之刃')
    expect(text).toContain('13:40 回城：长剑；卖出 明朗之靴')
  })

  it('counts an elder dragon apart from the elemental ones in the team line', () => {
    const match = richGame()
    Object.assign(match.report!.teams[1], {
      dragons: 2,
      dragonTypes: ['FIRE_DRAGON', 'ELDER_DRAGON']
    })
    const section = build({ match })
      .text.split('## ')
      .find((part) => part.startsWith('队伍资源'))!

    expect(section).toContain('小龙与远古巨龙共 2（炼狱、远古）')
    expect(section).toMatch(/我方：防御塔 [^、]+、水晶 [^、]+、小龙 /)

    // An objective the summary does not carry at all is left out, not written as unknown.
    expect(section).not.toContain('厄塔汗')
    match.report!.teams[0].atakhans = 1
    expect(build({ match }).text).toContain('男爵 未知、厄塔汗 1；一血')
  })

  it('splits the damage to objectives into turrets and epic monsters', () => {
    const line = (values: object) =>
      build({ match: richGame({ prepare: ({ summary }) => setReviewStats(summary, 8, values) }) })
        .text.split('\n')
        .find((entry) => entry.startsWith('伤害构成'))!

    // The server's "objectives" number is these two added up (give or take a point of rounding),
    // so the two parts are written, each from its own field.
    expect(
      line({
        damageDealtToTurrets: 2335,
        damageDealtToEpicMonsters: 164,
        damageDealtToObjectives: 2500
      })
    ).toContain('对防御塔 2335、对史诗野怪 164。')
    expect(line({ damageDealtToTurrets: 2335, damageDealtToEpicMonsters: 0 })).toContain(
      '对防御塔 2335、对史诗野怪 0。'
    )
    // Nothing is worked out from the total when the summary lacks the field.
    expect(line({ damageDealtToTurrets: 2335, damageDealtToObjectives: 2500 })).toContain(
      '对防御塔 2335、对史诗野怪 未知。'
    )
  })

  it('does not report a longest life of zero seconds for a player who never died', () => {
    const untouched = richGame({
      prepare: ({ summary }) =>
        setReviewStats(summary, 8, { deaths: 0, longestTimeSpentLiving: 0, totalTimeSpentDead: 0 })
    })
    // The fixture still has the kill event, so only the summary line is looked at here.
    const line = (match: ReviewMatch) =>
      build({ match })
        .text.split('\n')
        .find((entry) => entry.startsWith('野怪补刀'))!

    expect(line(untouched)).toContain('阵亡时间合计 0 秒，整局没有阵亡；最大连杀')
    expect(
      line(
        richGame({
          prepare: ({ summary }) => setReviewStats(summary, 8, { longestTimeSpentLiving: 612 })
        })
      )
    ).toContain('最长存活 612 秒')
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
    expect(build().text.length).toBeLessThan(14_000)
  })
})

// ── 带了什么：符文、召唤师技能、出装 ─────────────────────────────────────

const perk = (id: number, name: string, longDesc: string, stats: string[] = [], shortDesc = '') =>
  [id, { id, name, longDesc, shortDesc: shortDesc || longDesc, endOfGameStatDescs: stats }] as const
const slot = (type: string, perks: number[]) => ({ type, slotLabel: '', perks })
const shardSlots = [
  slot('kStatMod', [5008, 5005, 5007]),
  slot('kStatMod', [5008, 5010, 5001]),
  slot('kStatMod', [5011, 5013, 5001])
]
/** A cut-down copy of the client's game data, in the client's own markup. */
const catalogue = buildReviewCoachCatalogue({
  perks: Object.fromEntries([
    perk(
      8112,
      '死亡电刑',
      "3秒内命中三次造成额外<b>适性伤害</b>。<br>冷却时间：20秒<br><br><i>'雷电将引发灾厄。'</i>",
      ['已造成伤害合计：@eogvar1@'],
      '三次命中造成额外伤害。'
    ),
    perk(
      8128,
      '灵魂收割',
      '对生命值低于50%的英雄造成适性伤害。<br>冷却时间：35秒',
      [],
      '收割低血量英雄。'
    ),
    perk(8143, '即刻冲击', '位移后造成<trueDamage>20-80真实伤害</trueDamage>。', [
      '额外伤害：@eogvar1@'
    ]),
    perk(8126, '凌虐', '伤害行动受限的英雄时造成额外真实伤害。'),
    perk(8140, '恐怖纪念品', '每次击杀或助攻收集1个纪念品。', ['已收集纪念品：@eogvar1@']),
    perk(8137, '第六感', '感知附近的守卫。'),
    perk(8135, '宝藏猎人', '首次击杀每个敌人获得额外金钱。', [
      '总计层数：@eogvar2@',
      '已搜集金钱：@eogvar1@'
    ]),
    perk(8106, '终焉猎人', '终极技能获得技能加速。'),
    perk(
      8369,
      '先发制人',
      '率先攻击时造成 <truedamage>7%</truedamage>额外伤害并获得金钱。<br>冷却时间：<scaleLevel>25-15</scaleLevel>秒',
      ['造成伤害： @eogvar1@', '获得金钱： @eogvar2@']
    ),
    perk(8304, '魔法灵靴', '12 分钟时获得一双免费的鞋子。', [
      '鞋子送达时间：@eogvar1@:@eogvar2@@eogvar3@'
    ]),
    perk(8306, '海克斯充能闪现', '闪现冷却时可以引导闪现。'),
    perk(8345, '干粮快递', '每2分钟获得一块干粮，直到6分钟。', [
      '已获得干粮：@eogvar1@',
      '总计治疗：@eogvar3@'
    ]),
    perk(8313, '三重补药', '到达3、6、9级时各获得一瓶药剂。'),
    perk(8347, '银河视界', '+<attention>18</attention> 召唤师技能疾速', ['--']),
    perk(8316, '万事通', '每种不同属性提供技能加速。'),
    perk(5008, '适性之力', '+9 适性之力'),
    perk(5005, '攻速', '+10% 攻击速度'),
    perk(5007, '技能疾速', '+8技能疾速'),
    perk(5010, '移动速度', '+2.5%移动速度'),
    perk(5001, '生命系数', '+10-180 生命 (随等级提升)'),
    perk(5011, '生命值', '+65生命值'),
    perk(5013, '韧性和减速抗性', '+15%韧性和减速抗性')
  ]) as never,
  styles: {
    8300: {
      id: 8300,
      name: '启示',
      tooltip: '创新玩法，改变游戏规则',
      slots: [
        slot('kKeyStone', [8369]),
        slot('kMixedRegularSplashable', [8306, 8304]),
        slot('kMixedRegularSplashable', [8313, 8345]),
        slot('kMixedRegularSplashable', [8347, 8316]),
        ...shardSlots
      ]
    },
    8100: {
      id: 8100,
      name: '征服',
      tooltip: '锁定目标，造成爆发伤害',
      slots: [
        slot('kKeyStone', [8112, 8128]),
        slot('kMixedRegularSplashable', [8126, 8143]),
        slot('kMixedRegularSplashable', [8137, 8140]),
        slot('kMixedRegularSplashable', [8135, 8106]),
        ...shardSlots
      ]
    }
  } as never,
  items: {
    1055: {
      name: '多兰之刃',
      priceTotal: 450,
      description:
        '<mainText><stats><attention> 10</attention> 物理攻击<br><attention> 80</attention> 生命</stats><br><br></mainText>'
    },
    1036: {
      name: '长剑',
      priceTotal: 350,
      description: '<mainText><stats><attention> 10</attention> 物理攻击</stats><br><br></mainText>'
    },
    3158: {
      name: '明朗之靴',
      priceTotal: 900,
      description:
        '<mainText><stats><attention> 10</attention> 技能疾速<br><attention> 45</attention> 移动速度</stats><br><br><passive>洞察</passive><br>获得10召唤师技能加速。<br><br></mainText>'
    },
    6692: {
      name: '星蚀',
      priceTotal: 2900,
      description:
        '<mainText><stats><attention> 60</attention> 物理攻击<br><attention> 15</attention> 技能疾速</stats><br><br><passive>不落之月</passive><br>2秒内命中两次，提供一道<shield>护盾</shield>，持续0秒。</mainText>'
    },
    3157: {
      name: '中娅沙漏',
      priceTotal: 3250,
      description:
        '<mainText><stats><attention> 105</attention>  魔法攻击<br><attention> 50</attention>  物理防御</stats><br><br><active>时间暂停</active><br>进入<keyword>凝滞</keyword>状态，持续2.5秒。</mainText>'
    }
  } as never,
  spells: {
    4: {
      id: 4,
      name: '闪现',
      cooldown: 300,
      description: '瞬间传送一小段距离。',
      gameModes: ['CLASSIC', 'ARAM']
    },
    14: {
      id: 14,
      name: '引燃',
      cooldown: 180,
      description: '持续造成真实伤害，并降低治疗效果。',
      gameModes: ['CLASSIC']
    },
    12: {
      id: 12,
      name: '传送',
      cooldown: 300,
      description: '传送至一个友方单位身边。',
      gameModes: ['CLASSIC']
    },
    // Not available on the rift.
    32: { id: 32, name: '标记', cooldown: 80, description: '投掷雪球。', gameModes: ['ARAM'] }
  } as never,
  champions: {
    238: { id: 238, name: '劫', roles: ['assassin'] },
    103: { id: 103, name: '阿狸', roles: ['mage', 'assassin'] }
  } as never
})

const selection = (id: number, var1 = 0, var2 = 0, var3 = 0) => ({ perk: id, var1, var2, var3 })
const withLoadout = (fixture: ReturnType<typeof createReviewFixture>) => {
  setReviewStats(fixture.summary, 8, {
    perks: {
      statPerks: { offense: 5008, flex: 5010, defense: 5001 },
      styles: [
        {
          description: 'primaryStyle',
          style: 8100,
          selections: [
            selection(8112, 2782),
            selection(8143, 1895),
            selection(8140, 14),
            selection(8135, 450, 5)
          ]
        },
        {
          description: 'subStyle',
          style: 8300,
          selections: [selection(8304, 9, 4, 5), selection(8345, 3, 0, 183)]
        }
      ]
    },
    physicalDamageDealtToChampions: 12_000,
    magicDamageDealtToChampions: 2400,
    trueDamageDealtToChampions: 1000,
    physicalDamageTaken: 5000,
    magicDamageTaken: 7000,
    trueDamageTaken: 500
  })
  setReviewStats(fixture.summary, 3, {
    spell1Id: 4,
    spell2Id: 12,
    totalDamageDealtToChampions: 10_000,
    physicalDamageDealtToChampions: 500,
    magicDamageDealtToChampions: 9000,
    trueDamageDealtToChampions: 500
  })
}
// In the app every name comes from the same game data as the texts.
const namedRunes: ReviewCoachContextInput['names'] = {
  ...names,
  perk: (id) => catalogue.rune(id)?.name ?? `符文${id}`,
  item: (id) => catalogue.item(id)?.name ?? `物品${id}`,
  spell: (id) => catalogue.spell(id)?.name ?? `技能${id}`
}
const buildLoadout = (
  overrides: Partial<ReviewCoachContextInput> = {},
  prepare: (fixture: ReturnType<typeof createReviewFixture>) => void = () => {}
) =>
  build({
    match: richGame({
      prepare: (fixture) => {
        withLoadout(fixture)
        prepare(fixture)
      }
    }),
    names: namedRunes,
    catalogue,
    ...overrides
  })
const sectionOf = (text: string, start: string) =>
  (text.split('## ').find((part) => part.startsWith(start)) ?? '').trimEnd()

describe('buildReviewCoachContext: runes, summoner spells and items', () => {
  it('explains each rune of the player with the numbers this game recorded for it', () => {
    const lines = sectionOf(buildLoadout().text, '本人的符文').split('\n').slice(1)

    expect(lines).toEqual([
      '主系【征服】（锁定目标，造成爆发伤害），副系【启示】（创新玩法，改变游戏规则）。',
      '对照用的全局数字：时长 25:00；本人对英雄伤害 15400、治疗 未知、承伤 13100、总经济 9800、击杀加助攻 1 次。',
      // The lore quote at the end of the client's text is dropped.
      '- 基石 死亡电刑：3秒内命中三次造成额外适性伤害。 冷却时间：20秒〔本局记录：已造成伤害合计：2782〕',
      '- 主系第 1 行 即刻冲击：位移后造成20-80真实伤害。〔本局记录：额外伤害：1895〕',
      '- 主系第 2 行 恐怖纪念品：每次击杀或助攻收集1个纪念品。〔本局记录：已收集纪念品：14〕',
      // The labels decide which number is which: here the second one comes first.
      '- 主系第 3 行 宝藏猎人：首次击杀每个敌人获得额外金钱。〔本局记录：总计层数：5；已搜集金钱：450〕',
      // Minutes, then the tens and the ones of the seconds.
      '- 副系第 1 行 魔法灵靴：12 分钟时获得一双免费的鞋子。〔本局记录：鞋子送达时间：9:45〕',
      '- 副系第 2 行 干粮快递：每2分钟获得一块干粮，直到6分钟。〔本局记录：已获得干粮：3；总计治疗：183〕',
      '- 属性碎片：适性之力（+9 适性之力）、移动速度（+2.5%移动速度）、生命系数（+10-180 生命 (随等级提升)）。'
    ])
  })

  it('lists every rune of the client by tree and row and marks the ones taken', () => {
    const lines = sectionOf(buildLoadout().text, '符文一览').split('\n').slice(1)

    expect(lines[0]).toContain('副系从另一个系的三行里选两个，必须在不同的行，不能选基石')
    expect(lines.slice(1)).toEqual([
      '【征服】锁定目标，造成爆发伤害',
      '基石：死亡电刑 ✔——3秒内命中三次造成额外适性伤害。 冷却时间：20秒',
      '基石：灵魂收割——对生命值低于50%的英雄造成适性伤害。 冷却时间：35秒',
      '第 1 行：凌虐——伤害行动受限的英雄时造成额外真实伤害。｜即刻冲击 ✔——位移后造成20-80真实伤害。',
      '第 2 行：第六感——感知附近的守卫。｜恐怖纪念品 ✔——每次击杀或助攻收集1个纪念品。',
      '第 3 行：宝藏猎人 ✔——首次击杀每个敌人获得额外金钱。｜终焉猎人——终极技能获得技能加速。',
      '【启示】创新玩法，改变游戏规则',
      '基石：先发制人——率先攻击时造成 7%额外伤害并获得金钱。 冷却时间：25-15秒',
      '第 1 行：海克斯充能闪现——闪现冷却时可以引导闪现。｜魔法灵靴 ✔——12 分钟时获得一双免费的鞋子。',
      '第 2 行：三重补药——到达3、6、9级时各获得一瓶药剂。｜干粮快递 ✔——每2分钟获得一块干粮，直到6分钟。',
      '第 3 行：银河视界——+18 召唤师技能疾速｜万事通——每种不同属性提供技能加速。',
      // The same shard in two rows is marked only in the row it was taken from.
      '属性碎片：第 1 行 适性之力 ✔（+9 适性之力）｜攻速（+10% 攻击速度）｜技能疾速（+8技能疾速）；第 2 行 适性之力（+9 适性之力）｜移动速度 ✔（+2.5%移动速度）｜生命系数（+10-180 生命 (随等级提升)）；第 3 行 生命值（+65生命值）｜韧性和减速抗性（+15%韧性和减速抗性）｜生命系数 ✔（+10-180 生命 (随等级提升)）。'
    ])
  })

  it('names the runes without their texts when the client’s game data is missing', () => {
    const { text, sections } = buildLoadout({ catalogue: null })

    expect(sectionOf(text, '本人的符文')).toContain(
      '- 基石 死亡电刑〔客户端里查不到这颗符文的说明〕'
    )
    expect(sections.some((title) => title.startsWith('符文一览'))).toBe(false)
    expect(sections.some((title) => title.startsWith('装备说明'))).toBe(false)
    expect(text).toContain('这一次没有取到客户端里符文、装备和召唤师技能的说明文字')
  })

  it('says that a game has no rune record instead of leaving the section out', () => {
    expect(sectionOf(build().text, '本人的符文')).toContain('战绩里没有本人的符文记录。')
  })

  it('gives the summoner spells with their use, Ignite’s damage and what else could be taken', () => {
    const lines = sectionOf(buildLoadout().text, '召唤师技能').split('\n').slice(1)

    expect(lines).toEqual([
      '本人：闪现（基础冷却 300 秒）这局用了 3 次；引燃（基础冷却 180 秒）这局用了 2 次。每次是什么时候用的，战绩里没有。',
      '点燃的伤害：本人参与的 1 次击杀里，有 1 次的伤害记录里本人的点燃打出了伤害，合计 80（各次见「击杀与助攻」）。没有换来击杀的点燃没有记录。',
      '对位 阿狸：闪现、传送。',
      '峡谷里可以带的召唤师技能（冷却是客户端标的基础值，没有算上召唤师技能急速）：',
      '- 闪现 ✔（300 秒）：瞬间传送一小段距离。',
      '- 传送（300 秒）：传送至一个友方单位身边。',
      '- 引燃 ✔（180 秒）：持续造成真实伤害，并降低治疗效果。'
    ])
  })

  it('counts takedowns after a teleport when the server counted any', () => {
    const { text } = buildLoadout({}, ({ summary }) =>
      setReviewStats(summary, 8, { challenges: { teleportTakedowns: 2 } })
    )
    expect(sectionOf(text, '召唤师技能')).toContain('官方计数：传送后参与击杀 2 次。')
  })

  it('splits damage by type for the player and for both teams', () => {
    const lines = sectionOf(buildLoadout().text, '伤害类型').split('\n').slice(1)

    expect(lines[0]).toBe(
      '本人承受的伤害按类型（含小兵、野怪和防御塔打的）：物理 5000、魔法 7000、真实 500，即 物理 40%、魔法 56%、真实 4%。'
    )
    // Four enemies lack the numbers, so the team total is unknown; the one who has them is given.
    expect(lines[1]).toContain('敌方五人对英雄的伤害：合计未知。')
    expect(lines[1]).toContain('中单 阿狸 物理 5%、魔法 90%、真实 5%（共 10000）')
    expect(lines[2]).toContain('中单 劫 物理 78%、魔法 16%、真实 6%（共 15400）')
  })

  it('adds up a team’s damage by type when all five report it', () => {
    const { text } = buildLoadout({}, ({ summary }) => {
      for (const participantId of [1, 9, 5, 7])
        setReviewStats(summary, participantId, {
          // The summary rounds each type on its own, so the three need not add up to the total.
          totalDamageDealtToChampions: 2501,
          physicalDamageDealtToChampions: 2000,
          magicDamageDealtToChampions: 250,
          trueDamageDealtToChampions: 250
        })
    })
    // 8500 physical, 10000 magic, 1500 true; the total is the one of the final stat lines.
    expect(sectionOf(text, '伤害类型')).toContain(
      '敌方五人对英雄的伤害：物理 43%、魔法 50%、真实 8%（共 20004）。'
    )
  })

  it('follows the lane opponent’s shopping in the same words as the player’s', () => {
    const { text } = buildLoadout({}, ({ details, summary }) => {
      addReviewEvent(details, reviewPurchase(4000, 1055, 3))
      addReviewEvent(details, reviewPurchase(250_000, 3157, 3))
      setReviewStats(summary, 3, { item0: 3157 })
    })
    const lines = sectionOf(text, '对位的出装与回城').split('\n')

    expect(lines[0]).toContain('对位是敌方 中单 阿狸')
    expect(lines.slice(1)).toEqual([
      '0:04 开局购买：多兰之刃',
      // The player killed the opponent at 4:00; this is the opponent's respawn.
      '4:10 阵亡后：中娅沙漏',
      '成装完成时间：未知（物品库不可用，或这一局没有做出成装）。'
    ])
  })

  it('quotes the items of both laners with stats and effects, unknown numbers hidden', () => {
    const { text } = buildLoadout({}, ({ details, summary }) => {
      addReviewEvent(details, reviewPurchase(250_000, 3157, 3))
      setReviewStats(summary, 3, { item0: 3157 })
    })
    const lines = sectionOf(text, '装备说明').split('\n').slice(1)

    expect(lines).toEqual([
      '- 多兰之刃〔本人〕（450 金）：10 物理攻击、80 生命',
      '- 明朗之靴〔本人〕（900 金）：10 技能疾速、45 移动速度。洞察：获得10召唤师技能加速。',
      // The client gives 0 for a number that depends on level: it is not passed on as a zero.
      '- 星蚀〔本人〕（2900 金）：60 物理攻击、15 技能疾速。不落之月：2秒内命中两次，提供一道护盾，持续若干秒。',
      '- 中娅沙漏〔对位〕（3250 金）：105 魔法攻击、50 物理防御。时间暂停：进入凝滞状态，持续2.5秒。'
    ])
  })

  it('shows what both laners were building at the checkpoints', () => {
    const match = richGame({ prepare: withLoadout })
    const set = (minute: number, participantId: number, values: object) =>
      Object.assign(
        match.frames[minute].participants.find((entry) => entry.participantId === participantId)!,
        values
      )
    set(10, 8, {
      attackDamage: 131.4,
      abilityPower: 0,
      armor: 52,
      magicResist: 38,
      healthMax: 1480
    })
    set(10, 3, { attackDamage: 70, abilityPower: 96, armor: 61, magicResist: 36, healthMax: 1390 })
    set(10, 1, { armor: 88, magicResist: 45, healthMax: 1900 })
    const lines = sectionOf(build({ match, names: namedRunes, catalogue }).text, '属性快照')
      .split('\n')
      .slice(1)

    expect(lines).toEqual([
      '每行依次是：时间｜本人的攻击力、法术强度、护甲、魔抗、生命上限｜对位的同样五项｜敌方其余几人的 护甲/魔抗/生命上限（上 = 上单、野 = 打野、中 = 中单、下 = 下路、辅 = 辅助）。',
      // Only the snapshot that has the numbers is listed.
      '10:00｜本人 攻击 131 法强 0 护甲 52 魔抗 38 生命上限 1480｜对位 攻击 70 法强 96 护甲 61 魔抗 36 生命上限 1390｜上 88/45/1900、野 ?/?/?、下 ?/?/?、辅 ?/?/?'
    ])
  })

  it('leaves the stat snapshots out when the timeline has none', () => {
    expect(build().sections.some((title) => title.startsWith('属性快照'))).toBe(false)
  })

  it('lists every kill of the game, not only the player’s', () => {
    const { text } = buildLoadout({}, ({ details, summary }) => {
      addReviewEvent(
        details,
        reviewTakedown(700_000, 9, 4, { assists: [7, 5], position: { x: 12_900, y: 2100 } })
      )
      addReviewEvent(details, reviewTakedown(760_000, 0, 6, { position: { x: 12_900, y: 2100 } }))
      setReviewStats(summary, 4, { deaths: 1 })
      setReviewStats(summary, 6, { deaths: 1 })
    })
    const section = sectionOf(text, '全场击杀')

    expect(section.split('\n')[0]).toContain('共 4 次')
    expect(section.split('\n').slice(1)).toEqual([
      '4:00 中路敌方半场：我方 劫（本人） 杀 敌方 阿狸，终结赏金 150',
      '9:30 中路己方半场：敌方 阿狸 杀 我方 劫（本人）（助攻 英雄109）',
      '11:40 下路敌方半场：敌方 英雄109 杀 我方 英雄104（助攻 英雄105、英雄107）',
      '12:40 下路敌方半场：我方 英雄106 被处决'
    ])
  })

  it('passes on the multi-kills and aces the timeline marks', () => {
    const { text } = buildLoadout({}, ({ details, summary }) => {
      // The enemy jungler kills two at the same instant and a third two seconds later.
      for (const [timestamp, victimId] of [
        [700_000, 4],
        [700_000, 6],
        [702_000, 2]
      ])
        addReviewEvent(details, reviewTakedown(timestamp, 9, victimId))
      const special = (timestamp: number, killType: 'KILL_MULTI' | 'KILL_ACE', length?: number) =>
        addReviewEvent(details, {
          type: 'CHAMPION_SPECIAL_KILL',
          timestamp,
          killerId: 9,
          position: { x: 7500, y: 7500 },
          killType,
          ...(length ? { multiKillLength: length } : {})
        })
      special(700_000, 'KILL_MULTI', 2)
      special(702_000, 'KILL_MULTI', 3)
      special(702_000, 'KILL_ACE')
      for (const participantId of [4, 6, 2]) setReviewStats(summary, participantId, { deaths: 1 })
    })
    const lines = sectionOf(text, '全场击杀').split('\n')

    expect(lines[0]).toContain('「双杀」「团灭对方」是时间线自己的标记')
    // The mark of two simultaneous kills is written once, on the second line.
    expect(lines.slice(3)).toEqual([
      '11:40 中路敌方半场：敌方 英雄109 杀 我方 英雄104',
      '11:40 中路敌方半场：敌方 英雄109 杀 我方 英雄106，双杀',
      '11:42 中路敌方半场：敌方 英雄109 杀 我方 英雄102，三杀，团灭对方'
    ])
  })

  it('reports plates, objective bounties and the element of the rift with the team resources', () => {
    const { text } = buildLoadout({}, ({ details }) => {
      for (const event of [
        reviewPlate(300_000, 200, 'MID_LANE', 8),
        reviewPlate(420_000, 200, 'MID_LANE'),
        reviewPlate(500_000, 100, 'TOP_LANE', 1),
        reviewSoul(729_000, 'Chemtech', 0),
        reviewBountyStart(800_000, 100),
        reviewBountyEnd(960_000, 100),
        reviewBountyStart(1_200_000, 200, 1_230_000)
      ])
        addReviewEvent(details, event)
    })
    const section = sectionOf(text, '队伍资源')

    expect(section).toContain('峡谷元素：炼金，12:09 定下')
    expect(section).toContain(
      '防御塔镀层：上路 我方打掉 0 层、敌方打掉 1 层；中路 我方打掉 2 层、敌方打掉 0 层。记录的击破者是本人的有 1 层：5:00 中路。「官方挑战统计」里的「参与拿下镀层」把协助的也算上，所以不会比这个数小。'
    )
    expect(section).toContain(
      '目标赏金（落后的一方拿下地图资源有额外金币的时段）：13:35–16:00 我方可以领；20:30–对局结束 敌方可以领。'
    )
  })

  it.each([
    [
      'MIDDLE.PRIMARY.MIDDLE.TOP.FILL',
      'MIDDLE',
      '位置分配：这局打的是本人排队时的首选位置（首选 中单、次选 上单）。'
    ],
    [
      'MIDDLE.SECONDARY.TOP.MIDDLE',
      'MIDDLE',
      '位置分配：这局打的是本人排队时的次选位置（首选 上单、次选 中单）。'
    ],
    [
      'MIDDLE.AUTOFILL.TOP.JUNGLE',
      'MIDDLE',
      '位置分配：这局是被补位的，打的不是本人排队时选的位置（首选 上单、次选 打野）。'
    ],
    [
      'MIDDLE.FILL_PRIMARY.FILL.UNSELECTED',
      'MIDDLE',
      '位置分配：本人排队时首选的就是补位（首选 补位）。'
    ],
    [
      'MIDDLE.PRIMARY.MIDDLE.TOP',
      'TOP',
      '位置分配：这局打的是本人排队时的首选位置（首选 中单、次选 上单）。匹配分到的是上单，实际打的是中单。'
    ]
  ])('says how the role was assigned for %s', (preferences, assigned, expected) => {
    const { text } = buildLoadout({}, ({ summary }) =>
      setReviewStats(summary, 8, {
        selectedRolePreferences: preferences,
        positionAssignedByMatchmaking: assigned
      })
    )
    expect(sectionOf(text, '对局概况')).toContain(expected)
  })

  it('names players the server flagged as away, and the pings the player used', () => {
    const { text } = buildLoadout({}, ({ summary }) => {
      setReviewStats(summary, 4, { wasAfk: true })
      setReviewStats(summary, 8, {
        enemyMissingPings: 5,
        onMyWayPings: 12,
        assistMePings: 0,
        retreatPings: 3,
        dangerPings: 1
      })
    })

    expect(sectionOf(text, '对局概况')).toContain('官方标记的挂机玩家：我方 下路 英雄104。')
    // Kinds whose names do not map cleanly onto an in-game ping keep the server's own name,
    // so that none of them hides behind "other".
    expect(sectionOf(text, '本人的补充数据')).toContain(
      '发出的信号：敌人不见了 5、正在路上 12；官方只给了英文名、对不上游戏里具体哪种信号的：dangerPings 1、retreatPings 3。'
    )
  })

  it('writes a share as a percentage and drops role-specific counters that are zero', () => {
    const { text } = buildLoadout({}, ({ summary }) =>
      setReviewStats(summary, 8, {
        challenges: {
          soloKills: 0,
          turretPlatesTaken: 3,
          controlWardTimeCoverageInRiverOrEnemyHalf: 0.56,
          initialCrabCount: 0,
          wardsGuarded: 2,
          // Counters whose meaning could not be pinned down, or that repeat a number given
          // elsewhere, are not passed on: they only read as contradictions.
          laningPhaseGoldExpAdvantage: 0,
          abilityUses: 371,
          epicMonsterSteals: 0,
          bountyGold: 852.5,
          visionScoreAdvantageLaneOpponent: -0.3
        }
      })
    )
    const [heading, line] = sectionOf(text, '官方挑战统计').split('\n')

    expect(heading).toContain('和上面按事件数出来的数对不上时，以上面的为准')
    expect(line).toBe(
      '单杀 0；参与拿下镀层（协助的也算） 3；控制守卫在河道或敌方半区的覆盖时间 56%；保护己方守卫 2。'
    )
  })
})

const option = (ids: number[], games: number, wins: number, pickRate: number | null) => ({
  ids,
  games,
  wins,
  pickRate
})
const statistics: ReviewLoadoutStatistics = {
  region: 'kr',
  tier: 'emerald_plus',
  patch: '16.17',
  samePatch: true,
  champion: { games: 12_000, winRate: 0.501, pickRate: 0.042 },
  matchup: { games: 400, wins: 188 },
  general: {
    runePages: [
      {
        primaryStyle: 8100,
        secondaryStyle: 8300,
        primary: [8112, 8143, 8140, 8135],
        secondary: [8304, 8345],
        shards: [5008, 5008, 5001],
        games: 5000,
        wins: 2550,
        pickRate: 0.42
      },
      {
        primaryStyle: 8300,
        secondaryStyle: 8100,
        primary: [8369, 8304, 8345, 8347],
        secondary: [8143, 8106],
        shards: [5008, 5008, 5001],
        games: 2400,
        wins: 1248,
        pickRate: 0.2
      },
      {
        primaryStyle: 8100,
        secondaryStyle: 8300,
        primary: [8112, 8126, 8140, 8106],
        secondary: [8304, 8347],
        shards: [],
        games: 1000,
        wins: 480,
        pickRate: 0.08
      }
    ],
    spells: [option([14, 4], 9000, 4545, 0.75), option([4, 12], 1500, 735, 0.125)],
    starting: [option([1055], 8000, 4000, 0.67)],
    boots: [option([3158], 7000, 3570, 0.58)],
    core: [option([6692, 3157, 1036], 900, 480, 0.075)],
    late: [option([3157], 3000, 1560, null)]
  },
  versus: {
    runePages: [],
    spells: [option([4, 12], 120, 66, 0.3)],
    starting: [],
    boots: [],
    core: [],
    late: []
  }
}

describe('buildReviewCoachContext: what others and the player usually take', () => {
  it('says plainly when there are no statistics and no history', () => {
    const { text } = buildLoadout()

    expect(sectionOf(text, '同段位统计')).toContain('不要引用使用率和胜率，也不要自己估一个')
    expect(sectionOf(text, '本人以往的带法')).toContain('看不出以往带什么')
  })

  it('lists the common setups with their samples and marks what the player took', () => {
    const lines = sectionOf(buildLoadout({ statistics }).text, '同段位统计').split('\n')

    expect(lines[0]).toContain('只是相关，不是因果')
    expect(lines[1]).toBe('口径：韩国、翡翠及以上的排位，版本 16.17（就是这一局的版本）。')
    // How to read the numbers comes before them: what the samples are, and which win rates
    // run high by construction.
    expect(lines[2]).toMatch(/^读法：/)
    expect(lines[2]).toContain('分母不完全相同，不要拿不同类别的局数互相除')
    expect(lines[2]).toContain('没列出来的不等于没人带')
    expect(lines[2]).toContain('这两类的胜率不要和英雄的总体胜率比')
    expect(lines.slice(3)).toEqual([
      '劫 中单：胜率 50.1%，登场率 4.2%，样本 12000 局。对 阿狸：胜率 47%（400 局）。',
      '按基石合计（只合计下面列出的这几套符文页）：死亡电刑 胜率 50.5%（6000 局）；先发制人 胜率 52%（2400 局）。',
      '符文页 1：【征服】死亡电刑、即刻冲击、恐怖纪念品、宝藏猎人｜【启示】魔法灵靴、干粮快递｜碎片 适性之力、适性之力、生命系数——使用率 42%，胜率 51%（5000 局） ← 六颗符文与本人这局相同',
      '符文页 2：【启示】先发制人、魔法灵靴、干粮快递、银河视界｜【征服】即刻冲击、终焉猎人｜碎片 适性之力、适性之力、生命系数——使用率 20%，胜率 52%（2400 局）',
      '符文页 3：【征服】死亡电刑、凌虐、恐怖纪念品、终焉猎人｜【启示】魔法灵靴、银河视界——使用率 8%，胜率 48%（1000 局） ← 基石与本人这局相同',
      // The two spells are the same pair whichever key they sit on.
      '召唤师技能：引燃+闪现——使用率 75%，胜率 50.5%（9000 局） ← 本人这局；闪现+传送——使用率 12.5%，胜率 49%（1500 局）。',
      '出门装：多兰之刃——使用率 67%，胜率 50%（8000 局） ← 本人这局。',
      '鞋：明朗之靴——使用率 58%，胜率 51%（7000 局） ← 本人这局。',
      '前三件成装：星蚀 → 中娅沙漏 → 长剑——使用率 7.5%，胜率 53.3%（900 局）。',
      '单件装备（出过它的对局，不分第几件出）：中娅沙漏——胜率 52%（3000 局）。',
      // No rune rows for this opponent, so nothing is said about how they would be counted.
      '只看对 阿狸 的对局（样本小得多，胜率的波动很大）：',
      '召唤师技能：闪现+传送——使用率 30%，胜率 55%（120 局）。'
    ])
    expect(lines[2]).toContain('不到 30 局的带法不列')
  })

  it('does not pass off the total of a keystone and a secondary tree as the numbers of one page', () => {
    const grouped: ReviewLoadoutStatistics = {
      ...statistics,
      versus: {
        ...statistics.versus!,
        runePages: [
          {
            ...statistics.general.runePages[0],
            games: 196,
            wins: 93,
            pickRate: 0.587,
            groupTotal: true
          },
          // The same two trees under another keystone: the source counts that as a row of its
          // own (seen in a real answer, where three rows shared both trees).
          {
            ...statistics.general.runePages[0],
            primary: [8128, 8143, 8140, 8135],
            games: 60,
            wins: 33,
            pickRate: 0.18,
            groupTotal: true
          },
          {
            ...statistics.general.runePages[1],
            games: 42,
            wins: 25,
            pickRate: 0.126,
            groupTotal: true
          }
        ]
      }
    }
    const block = sectionOf(buildLoadout({ statistics: grouped }).text, '同段位统计')
      .split('只看对 阿狸 的对局')[1]
      .split('\n')

    expect(block.slice(0, 4)).toEqual([
      '（样本小得多，胜率的波动很大。这一份里符文按「基石加副系」合计：一行是同一个基石、同一个副系的全部带法，不是某一页）：',
      '符文组合 1：基石 死亡电刑、副系【启示】的全部带法合计——使用率 58.7%，胜率 47.4%（196 局） ← 本人这局的基石和副系与此相同。其中最常见的一页：【征服】死亡电刑、即刻冲击、恐怖纪念品、宝藏猎人｜【启示】魔法灵靴、干粮快递｜碎片 适性之力、适性之力、生命系数',
      // Told apart by the keystone, and not marked as the player's: he took the other one.
      '符文组合 2：基石 灵魂收割、副系【启示】的全部带法合计——使用率 18%，胜率 55%（60 局）。其中最常见的一页：【征服】灵魂收割、即刻冲击、恐怖纪念品、宝藏猎人｜【启示】魔法灵靴、干粮快递｜碎片 适性之力、适性之力、生命系数',
      '符文组合 3：基石 先发制人、副系【征服】的全部带法合计——使用率 12.6%，胜率 59.5%（42 局）。其中最常见的一页：【启示】先发制人、魔法灵靴、干粮快递、银河视界｜【征服】即刻冲击、终焉猎人｜碎片 适性之力、适性之力、生命系数'
    ])
    // One row per keystone: adding up by keystone would only repeat the rows. And a total says
    // nothing about the exact six runes.
    expect(block.join('\n')).not.toContain('按基石合计')
    expect(block.join('\n')).not.toContain('六颗')
  })

  it('adds up a keystone that the matchup rows list with more than one secondary tree', () => {
    const grouped: ReviewLoadoutStatistics = {
      ...statistics,
      versus: {
        ...statistics.versus!,
        runePages: [
          {
            ...statistics.general.runePages[0],
            games: 196,
            wins: 93,
            pickRate: 0.587,
            groupTotal: true
          },
          {
            ...statistics.general.runePages[0],
            secondaryStyle: 8000,
            secondary: [9111, 8014],
            games: 104,
            wins: 57,
            pickRate: 0.311,
            groupTotal: true
          },
          {
            ...statistics.general.runePages[1],
            games: 34,
            wins: 20,
            pickRate: 0.102,
            groupTotal: true
          }
        ]
      }
    }
    const block = sectionOf(buildLoadout({ statistics: grouped }).text, '同段位统计')
      .split('只看对 阿狸 的对局')[1]
      .split('\n')

    // 93 + 57 wins over 196 + 104 games for the keystone the player took, whatever came with it.
    expect(block[1]).toBe(
      '按基石合计（只合计下面列出的这几行）：死亡电刑 胜率 50%（300 局）；先发制人 胜率 58.8%（34 局）。'
    )
    expect(block[2]).toMatch(
      /^符文组合 1：基石 死亡电刑、副系【启示】.* ← 本人这局的基石和副系与此相同。/
    )
    expect(block[3]).toMatch(
      /^符文组合 2：基石 死亡电刑、副系【符文系 8000】的全部带法合计——使用率 31.1%，胜率 54.8%（104 局） ← 基石与本人这局相同，副系不同。/
    )
  })

  it('says so when the source has no overall numbers for the role', () => {
    const offRole: ReviewLoadoutStatistics = {
      ...statistics,
      champion: { games: null, winRate: null, pickRate: null },
      matchup: null,
      versus: null
    }
    const section = sectionOf(buildLoadout({ statistics: offRole }).text, '同段位统计')

    expect(section).toContain(
      '劫 中单：来源没有给这个位置的总体胜率和样本数（它只给这个英雄常打的位置列），下面各表是这个位置的，样本比常打的位置小得多。对 阿狸 的对局来源没有单独列出。'
    )
    expect(section).not.toContain('未知')
  })

  it('says so when none of the listed rune pages is the one the player took', () => {
    const others = {
      ...statistics,
      general: { ...statistics.general, runePages: statistics.general.runePages.slice(1) }
    }
    const section = sectionOf(buildLoadout({ statistics: others }).text, '同段位统计')

    expect(section).toContain('上面列出的符文页里，没有哪一套和本人这局的六颗完全相同。')
    expect(sectionOf(buildLoadout({ statistics }).text, '同段位统计')).not.toContain(
      '没有哪一套和本人这局的六颗完全相同'
    )
  })

  it('compares the starting items without the trinket, which the statistics leave out', () => {
    const { text } = buildLoadout({ statistics }, ({ details }) =>
      addReviewEvent(details, reviewPurchase(6000, 3340))
    )

    expect(sectionOf(text, '出装与回城')).toContain('0:05 开局购买：多兰之刃、物品3340')
    expect(sectionOf(text, '同段位统计')).toContain(
      '出门装：多兰之刃——使用率 67%，胜率 50%（8000 局） ← 本人这局。'
    )
  })

  it('says which patch the numbers are from when it is not the game’s', () => {
    const { text } = buildLoadout({
      statistics: { ...statistics, patch: '16.23', samePatch: false, matchup: null, versus: null }
    })
    const section = sectionOf(text, '同段位统计')

    expect(section).toContain(
      '版本 16.23（这一局是 16.17，来源已经没有那个版本的统计，用的是它现有的最新版本）'
    )
    expect(section).toContain('对 阿狸 的对局来源没有单独列出。')
    expect(section).toContain('只看对 阿狸 的对局：来源的样本不够，没有单独的统计。')
  })

  it('describes the common items that neither laner bought', () => {
    const lines = sectionOf(buildLoadout({ statistics }).text, '装备说明').split('\n')
    expect(lines).toContain(
      '- 中娅沙漏〔统计里常见〕（3250 金）：105 魔法攻击、50 物理防御。时间暂停：进入凝滞状态，持续2.5秒。'
    )
  })

  it('tells how the player set the champion up before, and against this opponent', () => {
    const record = (ids: number[], games: number, wins: number) => ({ ids, games, wins })
    const history: ReviewLoadoutHistory = {
      champion: {
        games: 23,
        wins: 12,
        keystones: [record([8112], 18, 10), record([8369], 5, 2)],
        pages: [record([8112, 8143, 8140, 8135, 8304, 8345], 9, 6)],
        spells: [record([4, 14], 20, 11), record([4, 12], 3, 1)],
        firstItems: [record([6692], 15, 9)],
        corePaths: [record([6692, 3157, 1036], 4, 3)]
      },
      matchup: {
        games: 2,
        wins: 1,
        keystones: [record([8369], 2, 1)],
        pages: [],
        spells: [record([4, 12], 2, 1)],
        firstItems: [],
        corePaths: []
      },
      runes: []
    }
    const lines = sectionOf(buildLoadout({ history }).text, '本人以往的带法').split('\n').slice(1)

    expect(lines).toEqual([
      '本机档案里本人用 劫 打 中单 的另外 23 局（12 胜），不含这一局：',
      '基石：死亡电刑 18 局 10 胜；先发制人 5 局 2 胜。',
      // The keystone and the three runes below it, then the two of the second tree.
      '整套符文（只算存档时记下了整页符文的对局）：〔死亡电刑、即刻冲击、恐怖纪念品、宝藏猎人｜魔法灵靴、干粮快递〕9 局 6 胜。',
      '召唤师技能：闪现+引燃 20 局 11 胜；闪现+传送 3 局 1 胜。',
      '第一件成装：星蚀 15 局 9 胜。',
      '前三件成装（只算出满三件的对局）：星蚀 → 中娅沙漏 → 长剑 4 局 3 胜。',
      '其中对 阿狸 的 2 局（1 胜）：',
      '基石：先发制人 2 局 1 胜。',
      '召唤师技能：闪现+传送 2 局 1 胜。'
    ])
  })

  it('sets each rune’s number of this game against the player’s earlier games with it', () => {
    const none = {
      games: 0,
      wins: 0,
      keystones: [],
      pages: [],
      spells: [],
      firstItems: [],
      corePaths: []
    }
    const history: ReviewLoadoutHistory = {
      champion: { ...none, games: 4, wins: 2 },
      matchup: null,
      runes: [
        // 死亡电刑: the damage in three earlier games.
        {
          id: 8112,
          samples: [
            { stats: [1800, 0, 0], duration: 1500 },
            { stats: [2400, 0, 0], duration: 1800 },
            { stats: [3100, 0, 0], duration: 2100 }
          ]
        },
        // 魔法灵靴: a time. One game never got the boots, which is not a time of 0:00.
        {
          id: 8304,
          samples: [
            { stats: [10, 3, 0], duration: 1500 },
            { stats: [11, 1, 0], duration: 1800 },
            { stats: [0, 0, 0], duration: 600 }
          ]
        },
        // Two games are too few to call anything usual.
        {
          id: 8143,
          samples: [
            { stats: [900, 0, 0], duration: 1500 },
            { stats: [1000, 0, 0], duration: 1500 }
          ]
        }
      ]
    }
    const lines = sectionOf(buildLoadout({ history }).text, '本人的符文').split('\n')
    const lineOf = (name: string) => lines.find((line) => line.includes(` ${name}：`))!

    expect(lineOf('死亡电刑')).toMatch(
      /〔本局记录：已造成伤害合计：2782〕〔本人以往带这颗符文的 3 局的中位数：已造成伤害合计：2400；这些局的时长中位数 30 分 0 秒〕$/
    )
    expect(lineOf('魔法灵靴')).toMatch(
      /〔本局记录：鞋子送达时间：9:45〕〔本人以往带这颗符文的 3 局的中位数：鞋子送达时间：10 分 50 秒（另有 1 局没有达成）；这些局的时长中位数 25 分 0 秒〕$/
    )
    expect(lineOf('即刻冲击')).toMatch(/〔本局记录：额外伤害：1895〕$/)
    // A rune without an earlier record says nothing more.
    expect(lineOf('恐怖纪念品')).toMatch(/〔本局记录：已收集纪念品：14〕$/)
  })

  it('keeps the whole document within what a model reads in one go', () => {
    const { text, sections } = buildLoadout({ statistics })

    expect(sections.at(-1)).toBe('这份资料不包含的东西')
    expect(sections.at(-2)).toMatch(/^符文一览/)
    expect(text.length).toBeLessThan(20_000)
  })
})

describe('buildReviewCoachContext: what a careful reader could get wrong', () => {
  const frameOf = (match: ReviewMatch, minute: number, participantId: number) =>
    match.frames[minute].participants.find((entry) => entry.participantId === participantId)!

  it('writes a dead laner as dead in the per-minute table, whatever health the body reports', () => {
    const match = richGame()
    Object.assign(frameOf(match, 10, 8), { health: 12, healthMax: 1948, alive: false })
    Object.assign(frameOf(match, 10, 3), { health: 640, healthMax: 1500 })
    Object.assign(frameOf(match, 11, 3), { health: 31, healthMax: 1500, alive: false })
    const section = sectionOf(build({ match }).text, '逐分钟数据')

    expect(section).toContain(
      '10:00｜本人 4100金 身上? 80刀 6级 阵亡 ?伤 受? 1-1-0｜对位 3500金 70刀 6级 血640/1500 '
    )
    expect(section).toContain('｜对位 3800金 77刀 6级 阵亡 ?伤 受?｜')
    expect(section.split('\n')[1]).toContain(
      '血量那一格写「阵亡」表示快照那一刻是死的（按击杀记录判断）'
    )
    expect(section.split('\n')[1]).toContain('人头只数被英雄击杀的')
  })

  it('starts each checkpoint line with the time of its snapshot', () => {
    const lines = sectionOf(build().text, '对线与节奏').split('\n')

    expect(lines[0]).toContain('行首是那张分钟快照的时刻')
    expect(lines[1]).toMatch(/^5:00：本人 经济 2300、补刀 40、等级 3、/)
    expect(lines[2]).toMatch(/^10:00：本人 经济 4100、/)
    // An opponent who never got there is written like the player.
    expect(sectionOf(build().text, '对线与节奏')).not.toContain('未到或未知')
  })

  it('says which snapshot a distance to an objective was read from', () => {
    const match = richGame()
    Object.assign(match.report!.objectives[0], { distance: 2100, snapshotOffset: -21_000 })
    match.report!.objectives.push(
      { ...match.report!.objectives[1], timestamp: 960_000, distance: 9000, snapshotOffset: 0 },
      // The enemy took it, but the record lists the player among those who fought it.
      {
        ...match.report!.objectives[0],
        timestamp: 1_200_000,
        kind: 'baron',
        detail: null,
        contested: true,
        sinceDeath: null,
        distance: null,
        snapshotOffset: null
      },
      // Nobody took the herald.
      {
        ...match.report!.objectives[0],
        timestamp: 1_185_000,
        kind: 'herald',
        detail: null,
        own: null,
        unclaimed: true,
        sinceDeath: null
      }
    )
    const section = sectionOf(build({ match }).text, '地图资源时间线')

    expect(section).toContain(
      '10:00 炼狱小龙：敌方拿下，本人 30 秒前刚阵亡，本人在附近（按 9:39 的快照，比事件早 21 秒）。'
    )
    expect(section).toContain(
      '16:00 中路外塔：我方拿下，本人有参与，本人离得很远（按同一时刻的快照）。'
    )
    expect(section).toContain(
      '20:00 纳什男爵：敌方拿下，记录的参与者里也有本人（打到过它，但被敌方拿走）。'
    )
    expect(section).toContain(
      '19:45 峡谷先锋：没有哪一方拿下，是它到时间自己离场了（记录里的击杀方是中立）。'
    )
    expect(section.split('\n')[0]).toContain('快照里本人是阵亡状态的不写远近')

    // The gap is counted between the two clocks as written, so the line agrees with itself:
    // 10:09.7 against a snapshot at 10:00.2 is nine seconds on the clock, not ten.
    Object.assign(match.report!.objectives[0], { timestamp: 609_700, snapshotOffset: -9500 })
    expect(sectionOf(build({ match }).text, '地图资源时间线')).toContain(
      '10:09 炼狱小龙：敌方拿下，本人 30 秒前刚阵亡，本人在附近（按 10:00 的快照，比事件早 9 秒）。'
    )
    // Within the same second it is the same moment.
    Object.assign(match.report!.objectives[0], { timestamp: 600_100, snapshotOffset: 400 })
    expect(sectionOf(build({ match }).text, '地图资源时间线')).toContain(
      '本人在附近（按同一时刻的快照）。'
    )
  })

  it('adds the shutdown gold to a death and leaves gold out of an execution', () => {
    const match = richGame()
    match.deaths![0].shutdownBounty = 450
    expect(sectionOf(build({ match }).text, '阵亡')).toContain(
      '送出击杀金币 300，另有终结赏金 450。'
    )

    match.deaths![0].killer = null
    const executed = sectionOf(build({ match }).text, '阵亡')
    expect(executed).toContain('被防御塔、小兵或野怪处决')
    expect(executed).not.toContain('送出击杀金币')
    // And no level is made up for a killer that does not exist.
    expect(executed).toMatch(/当时等级：本人 \d+。/)
  })

  it('gives the wider list of a death record only when it says more than the plain one', () => {
    const match = richGame()
    Object.assign(match.report!.deaths[0], { fightDamageTaken: 2188, fightDamageDealt: 260 })
    expect(sectionOf(build({ match }).text, '阵亡')).toContain(
      '阵亡前打出伤害 260。按「团战」清单：承受 2188、打出 260。'
    )

    // The same totals as the plain list add nothing.
    Object.assign(match.report!.deaths[0], { fightDamageTaken: 970, fightDamageDealt: 260 })
    expect(sectionOf(build({ match }).text, '阵亡').split('\n').slice(1).join('\n')).not.toContain(
      '「团战」清单'
    )
  })

  it('says when nothing was bought after a death', () => {
    // In the invented game the player buys 40 seconds after dying.
    expect(sectionOf(build().text, '阵亡')).not.toContain('没有买下东西的记录')

    const match = richGame()
    match.report!.build.visits = match.report!.build.visits.filter((visit) => !visit.afterDeath)
    expect(sectionOf(build({ match }).text, '阵亡')).toContain(
      '这次阵亡之后没有紧接着买下东西的记录（当时身上有多少钱，见「逐分钟数据」）。'
    )

    // A death in the last seconds of the game says nothing about shopping.
    match.report!.deaths[0].timestamp = 1_480_000
    expect(sectionOf(build({ match }).text, '阵亡')).not.toContain('没有买下东西的记录')
  })

  it('tells who gained in a gold swing the program marked', () => {
    const match = richGame()
    match.moments = [
      {
        id: 'swing',
        kind: 'gold-gain',
        title: '对位经济建立或扩大优势',
        description: '对位经济差在这段时间增加 2361 金币；相关事件供定位录像，不能单独证明原因。',
        start: 1_440_000,
        end: 1_500_000,
        eventIds: [],
        scope: 'personal',
        before: 2416,
        after: 4777
      },
      {
        id: 'team',
        kind: 'gold-swing',
        title: '团队经济优势明显缩水',
        description: '团队经济差在这段时间减少 2600 金币。',
        start: 600_000,
        end: 840_000,
        eventIds: [],
        scope: 'team',
        before: 1800,
        after: -800
      }
    ]
    const section = sectionOf(build({ match }).text, '程序标出的关键片段')

    expect(section).toContain('不能单独证明原因。（本人减对位的经济差：+2416 → +4777）')
    expect(section).toContain('减少 2600 金币。（我方减敌方的团队经济差：+1800 → -800）')
  })

  it('says outright that nothing is known about the recent form', () => {
    const { text, sections } = build()

    expect(sections).toContain('近期排位状态')
    expect(sectionOf(text, '近期排位状态')).toContain('段位、连胜连败和胜点变化都不知道，不要提')
    // With a rank log the section carries its source in the title instead.
    expect(
      build({
        form: {
          rank: null,
          recent: null,
          streak: null,
          lpDelta: null,
          sessionIndex: 1,
          lossesBefore: 0
        }
      }).sections
    ).toContain('近期排位状态（来自本机的上分日志）')
  })

  it('tells two different items with the same name apart by their price', () => {
    const twins = {
      ...catalogue,
      runeTrees: catalogue.runeTrees,
      riftSpells: catalogue.riftSpells,
      item: (id: number) =>
        id === 2020
          ? { name: '残暴之力', price: 1337, stats: ['25 物理攻击'], effects: '', from: [] }
          : id === 3134
            ? { name: '残暴之力', price: 1000, stats: ['20 物理攻击'], effects: '', from: [] }
            : catalogue.item(id)
    }
    const { text } = buildLoadout(
      {
        catalogue: twins,
        names: { ...namedRunes, item: (id) => twins.item(id)?.name ?? `物品${id}` }
      },
      ({ details }) => {
        addReviewEvent(details, reviewPurchase(420_000, 2020))
        addReviewEvent(details, reviewPurchase(700_000, 3134))
      }
    )

    expect(sectionOf(text, '出装与回城')).toContain('7:00 回城：残暴之力（总价 1337）')
    expect(sectionOf(text, '出装与回城')).toContain('11:40 回城：残暴之力（总价 1000）')
    // Names that are not shared stay as they are.
    expect(sectionOf(text, '出装与回城')).toContain('0:05 开局购买：多兰之刃')
    expect(text).not.toMatch(/多兰之刃（总价/)
  })

  it('times a final item that was never bought by the moment its source left the inventory', () => {
    // The upgraded boots are made from the pair he bought, and the mid item from two parts.
    const upgrades = {
      ...catalogue,
      runeTrees: catalogue.runeTrees,
      riftSpells: catalogue.riftSpells,
      item: (id: number) =>
        id === 3172
          ? { name: '绯色明悟', price: 900, stats: [], effects: '', from: [3158] }
          : id === 2522
            ? { name: '破碎的护腕', price: 1600, stats: [], effects: '', from: [1052, 1029] }
            : catalogue.item(id)
    }
    const match = richGame({
      prepare: (fixture) => {
        withLoadout(fixture)
        setReviewStats(fixture.summary, 8, { item2: 3172, item3: 2522 })
        // The bought boots leave the inventory once, at 10:25.
        addReviewEvent(fixture.details, {
          type: 'ITEM_DESTROYED',
          timestamp: 625_000,
          participantId: 8,
          itemId: 3158
        })
      }
    })
    const input = {
      match,
      catalogue: upgrades,
      names: { ...namedRunes, item: (id: number) => upgrades.item(id)?.name ?? `物品${id}` }
    }

    expect(match.report!.build.destroyed).toEqual({ 3158: { timestamp: 625_000, count: 1 } })
    expect(sectionOf(build(input).text, '出装与回城')).toContain(
      '局末装备里没有购买记录的：绯色明悟、破碎的护腕。它们不是在商店买的，是别的装备变成的，或者任务、符文给的。明朗之靴 在 10:25 从物品栏消失，绯色明悟 就是那一刻换上的。破碎的护腕 什么时候得到的，时间线里看不出来。'
    )

    // A source that left the inventory twice does not say which time it was.
    match.report!.build.destroyed = { 3158: { timestamp: 900_000, count: 2 } }
    expect(sectionOf(build(input).text, '出装与回城')).toContain(
      '或者任务、符文给的。什么时候得到的，时间线里看不出来。'
    )
  })

  it('describes the kits of the player’s champion and of the enemies it could read', () => {
    const kits = {
      ...catalogue,
      runeTrees: catalogue.runeTrees,
      riftSpells: catalogue.riftSpells,
      champion: (id: number) =>
        id === 238
          ? {
              attack: '近战',
              damage: '物理',
              ratings: [
                { label: '伤害', value: 3 },
                { label: '坦度', value: 1 }
              ],
              abilities: [
                {
                  key: '被动',
                  name: '影忍法！灭魂劫',
                  description: '普攻对低生命值的敌人造成额外魔法伤害。',
                  cooldowns: []
                },
                {
                  key: 'Q',
                  name: '影奥义！诸刃',
                  description: '劫和他的影子投出手里剑。',
                  cooldowns: [6]
                },
                {
                  key: 'R',
                  name: '禁奥义！瞬狱影杀阵',
                  description: '劫标记目标并冲向它。',
                  cooldowns: [120, 100, 80]
                }
              ]
            }
          : id === 103
            ? {
                attack: '远程',
                damage: '魔法',
                ratings: [],
                // A charge ability reports a cooldown of zero, which is not written.
                abilities: [{ key: 'R', name: '灵魄突袭', description: '', cooldowns: [0] }]
              }
            : null
    }
    const lines = sectionOf(buildLoadout({ catalogue: kits }).text, '英雄技能').split('\n')

    expect(lines[0]).toContain('对面有没有治疗、护盾、控制、位移，从这里看，不要凭记忆')
    expect(lines.slice(1)).toEqual([
      '我方 中单 劫（本人）〔刺客；近战；以物理伤害为主；客户端的评级（1 到 3）：伤害 3、坦度 1〕',
      '- 被动 影忍法！灭魂劫：普攻对低生命值的敌人造成额外魔法伤害。',
      '- Q 影奥义！诸刃（冷却 6 秒）：劫和他的影子投出手里剑。',
      '- R 禁奥义！瞬狱影杀阵（冷却 120/100/80 秒）：劫标记目标并冲向它。',
      '敌方 中单 阿狸〔法师、刺客；远程；以魔法伤害为主〕',
      '- R 灵魄突袭：客户端没有给说明',
      // The ones it could not read are named, so that nobody fills them in from memory.
      '没有取到技能说明的：敌方 上单 英雄101、敌方 打野 英雄109、敌方 下路 英雄105、敌方 辅助 英雄107。这几个英雄的技能不要凭记忆下结论。'
    ])
  })

  it('says that no kit could be read, and leaves the section out without the client’s data', () => {
    expect(sectionOf(buildLoadout().text, '英雄技能')).toContain(
      '这一次没有取到客户端里的英雄技能说明；对面英雄的技能不要凭记忆下结论。'
    )
    expect(
      buildLoadout({ catalogue: null }).sections.some((title) => title.startsWith('英雄技能'))
    ).toBe(false)
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
