import { AiCoachRenderer } from '@renderer-shared/shards/ai-coach'
import { useAiCoachStore } from '@renderer-shared/shards/ai-coach/store'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { RankLogRenderer } from '@renderer-shared/shards/rank-log'
import { useRankLogStore } from '@renderer-shared/shards/rank-log/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { AkariManager } from '@shared/akari-shard'
import type { ChampionDataDetails, ChampionDataQuery } from '@shared/data-adapter/champion-data'
import type {
  AiCoachChatRequest,
  AiCoachChatResult,
  AiCoachProvider
} from '@shared/shards/ai-coach'
import { type RankLogEntryDto, fromAbsoluteLp } from '@shared/shards/rank-log'
import type {
  ChampionSimple,
  Item,
  Perk,
  Style,
  SummonerSpell
} from '@shared/types/league-client/game-data'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { NButton, NTag } from 'naive-ui'
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

import ReviewStudioModal from './ReviewStudioModal.vue'
import { parseReviewMatch } from './analysis'
import { writeReviewArchive } from './archive'
import { isReviewCoreItem } from './match-facts'
import { classifyReviewItem } from './match-report'
import {
  addReviewEvent,
  createReviewFixture,
  reviewBuilding,
  reviewDragon,
  reviewKill,
  reviewLevelUp,
  reviewMonster,
  reviewPlate,
  reviewPurchase,
  reviewSkill,
  reviewTakedown,
  reviewWard,
  reviewWardKill
} from './test-fixtures'

// Synthetic fixtures only. All history and note IO stays in this story's memory.
function fixtures(partial: boolean) {
  return Array.from({ length: 18 }, (_, index) => {
    const fixture = createReviewFixture({ gameId: 90_000 + index, win: index % 3 === 0 })
    fixture.summary.json.gameCreation = Date.UTC(2026, 8, 12, 12) - index * 3_600_000
    const championIds = [238, 122, 64, 51, 412, index % 2 ? 7 : 103, 114, 245, 222, 117]
    fixture.summary.json.participants.forEach((participant, i) => {
      participant.championId = championIds[i]
    })
    for (const frame of fixture.details.json.frames) {
      const minute = frame.timestamp / 60_000
      for (const player of Object.values(frame.participantFrames)) {
        const lane = player.participantId % 3
        player.position = {
          x: 2000 + ((minute * 235 + player.participantId * 730) % 10000),
          y: 2500 + ((minute * 340 + lane * 3100) % 9500)
        }
        if (player.participantId === 3 && minute >= 16)
          player.totalGold += Math.min(minute - 15, 5) * 410
      }
    }
    addReviewEvent(fixture.details, reviewKill(1_031_000, 8, 450))
    addReviewEvent(fixture.details, reviewDragon(1_080_000))
    addReviewEvent(fixture.details, reviewKill(1_177_000, 8))
    fixture.summary.json.participants.find((p) => p.participantId === 8)!.deaths = 2
    if (partial) {
      fixture.details.json.frames = fixture.details.json.frames.filter(
        (frame) => ![600_000, 660_000, 900_000].includes(frame.timestamp)
      )
      fixture.summary.json.participants.find((p) => p.participantId === 8)!.deaths = 3
    }
    return fixture
  })
}

const stats = (...lines: string[]) =>
  `<mainText><stats>${lines.join('<br>')}</stats><br><br></mainText>`
const STORY_ITEMS = Object.fromEntries(
  [
    {
      id: 1055,
      name: '多兰之刃',
      description: stats('<attention> 10</attention> 攻击力', '<attention> 80</attention> 生命值'),
      priceTotal: 450,
      from: [] as number[],
      categories: ['Damage']
    },
    {
      id: 1036,
      name: '长剑',
      description: stats('<attention> 10</attention> 攻击力'),
      priceTotal: 350,
      from: [] as number[],
      categories: ['Damage']
    },
    {
      id: 3158,
      name: '明朗之靴',
      description: stats(
        '<attention> 10</attention> 技能急速',
        '<attention> 45</attention> 移动速度'
      ),
      priceTotal: 900,
      from: [1001],
      categories: ['Boots']
    },
    {
      id: 6699,
      name: '幽梦之灵',
      description:
        '<mainText><stats><attention> 55</attention> 攻击力<br><attention>18</attention> 穿甲</stats><br><br><active>幽影疾步</active><br>获得<speed>0移动速度</speed>，持续6秒。</mainText>',
      priceTotal: 3000,
      from: [1036, 1036],
      categories: ['Damage']
    }
  ].map((item) => [item.id, item as unknown as Item])
)

// A cut-down rune book, spell list and champion list for the coach stories. Invented wording:
// it only has to look like the client's game data.
const rune = (id: number, name: string, text: string, stat?: string) => ({
  id,
  name,
  shortDesc: text,
  longDesc: text,
  endOfGameStatDescs: stat ? [stat] : []
})
const STORY_PERKS = Object.fromEntries(
  [
    rune(
      8112,
      '电刑',
      '3秒内命中同一英雄三次，造成额外<b>自适应伤害</b>。<br>冷却时间：20秒',
      '已造成伤害合计：@eogvar1@'
    ),
    rune(
      8128,
      '黑暗收割',
      '对生命值低于50%的英雄造成额外伤害并收割灵魂。<br>冷却时间：35秒',
      '已造成伤害合计：@eogvar1@'
    ),
    rune(8143, '猛然冲击', '位移或脱离潜行后，下一次伤害造成额外真实伤害。', '额外伤害：@eogvar1@'),
    rune(8126, '恶意中伤', '伤害行动受限的英雄时造成额外真实伤害。', '总伤害：@eogvar1@'),
    rune(
      8140,
      '恐怖纪念品',
      '每次参与击杀收集一个纪念品，提供饰品急速。',
      '已收集纪念品：@eogvar1@'
    ),
    rune(8137, '第六感', '感知附近没有被发现的守卫。', '已感知守卫：@eogvar1@'),
    rune(8106, '终极猎人', '大招获得技能急速，每层赏金猎人再提高一些。', '总叠加层数：@eogvar1@'),
    rune(8135, '寻宝猎人', '首次击杀每名敌方英雄时获得额外金币。', '已搜集金钱：@eogvar1@'),
    rune(
      8369,
      '先攻',
      '率先对英雄出手时造成额外伤害并获得金币。<br>冷却时间：25-15秒',
      '造成伤害：@eogvar1@'
    ),
    rune(
      8304,
      '神奇之鞋',
      '12分钟时获得一双免费的鞋子。',
      '鞋子送达时间：@eogvar1@:@eogvar2@@eogvar3@'
    ),
    rune(8306, '海克斯科技闪现罗网', '闪现冷却时可以引导一次海克斯闪现。'),
    rune(8345, '饼干配送', '每2分钟获得一块饼干，直到6分钟。', '已获得干粮：@eogvar1@'),
    rune(8313, '三重补药', '在3、6、9级各获得一瓶药剂。'),
    rune(8347, '星界洞悉', '+18 召唤师技能急速，+10 装备急速。'),
    rune(8316, '多面手', '每从装备获得一种不同的属性，获得技能急速。'),
    rune(5008, '适应之力', '+9 适应之力'),
    rune(5005, '攻击速度', '+10% 攻击速度'),
    rune(5007, '技能急速', '+8 技能急速'),
    rune(5010, '移动速度', '+2.5% 移动速度'),
    rune(5001, '成长生命值', '+10-180 生命值（随等级提升）'),
    rune(5011, '生命值', '+65 生命值'),
    rune(5013, '韧性和减速抗性', '+15% 韧性和减速抗性')
  ].map((entry) => [entry.id, entry as unknown as Perk])
)
const runeSlot = (type: string, perks: number[]) => ({ type, slotLabel: '', perks })
const SHARD_SLOTS = [
  runeSlot('kStatMod', [5008, 5005, 5007]),
  runeSlot('kStatMod', [5008, 5010, 5001]),
  runeSlot('kStatMod', [5011, 5013, 5001])
]
const STORY_STYLES = {
  8100: {
    id: 8100,
    name: '主宰',
    tooltip: '爆发伤害与接近目标',
    slots: [
      runeSlot('kKeyStone', [8112, 8128]),
      runeSlot('kMixedRegularSplashable', [8126, 8143]),
      runeSlot('kMixedRegularSplashable', [8137, 8140]),
      runeSlot('kMixedRegularSplashable', [8135, 8106]),
      ...SHARD_SLOTS
    ]
  },
  8300: {
    id: 8300,
    name: '启迪',
    tooltip: '创造性的工具与打破规则',
    slots: [
      runeSlot('kKeyStone', [8369]),
      runeSlot('kMixedRegularSplashable', [8306, 8304]),
      runeSlot('kMixedRegularSplashable', [8313, 8345]),
      runeSlot('kMixedRegularSplashable', [8347, 8316]),
      ...SHARD_SLOTS
    ]
  }
} as unknown as Record<number, Style>
const STORY_SPELLS = Object.fromEntries(
  [
    { id: 4, name: '闪现', cooldown: 300, description: '向光标方向传送一小段距离。' },
    { id: 12, name: '传送', cooldown: 300, description: '引导后传送到友方单位身边。' },
    { id: 14, name: '引燃', cooldown: 180, description: '持续造成真实伤害，并降低目标受到的治疗。' }
  ].map((spell) => [spell.id, { ...spell, gameModes: ['CLASSIC'] } as unknown as SummonerSpell])
)
const STORY_CHAMPIONS = Object.fromEntries(
  (
    [
      [238, '劫', ['assassin']],
      [103, '阿狸', ['mage', 'assassin']],
      [61, '奥莉安娜', ['mage']],
      [7, '乐芙兰', ['assassin', 'mage']],
      [245, '艾克', ['assassin', 'mage']],
      [122, '德莱厄斯', ['fighter', 'tank']],
      [64, '李青', ['fighter', 'assassin']],
      [51, '凯特琳', ['marksman']],
      [412, '锤石', ['support', 'tank']],
      [114, '菲奥娜', ['fighter']],
      [59, '嘉文四世', ['tank', 'fighter']],
      [222, '金克丝', ['marksman']],
      [117, '璐璐', ['support', 'mage']]
    ] as const
  ).map(([id, name, roles]) => [id, { id, name, roles } as unknown as ChampionSimple])
)

/** A stand-in for the client's full champion entry: the coach reads the kits from these. */
const storyChampionDetails = (id: number) => {
  const champion = STORY_CHAMPIONS[id] as unknown as { name: string; roles: string[] } | undefined
  const name = champion?.name ?? `英雄 ${id}`
  const mage = champion?.roles.includes('mage')
  return {
    id,
    name,
    tacticalInfo: {
      style: 1,
      difficulty: 2,
      damageType: mage ? 'kMagic' : 'kPhysical',
      attackType: champion?.roles.includes('marksman') || mage ? 'ranged' : 'melee'
    },
    playstyleInfo: { damage: 3, durability: 1, crowdControl: 2, mobility: 2, utility: 1 },
    passive: { name: `${name}的被动`, description: '演示用的被动说明。' },
    spells: (['q', 'w', 'e', 'r'] as const).map((spellKey, index) => ({
      spellKey,
      name: `${name}的 ${spellKey.toUpperCase()}`,
      description: '演示用的技能说明。',
      cooldownCoefficients: index === 3 ? [120, 100, 80, 80, 80, 80] : [8, 8, 8, 8, 8, 8],
      maxLevel: index === 3 ? 3 : 5
    }))
  }
}

const storyPerformance = (games: number, wins: number, pickRate: number | null = null) => ({
  games,
  wins,
  winRate: wins / games,
  pickRate,
  rank: null,
  averagePlacement: null,
  firstPlaceRate: null
})
/** What the stand-in statistics source says about one champion in the middle lane. */
function storyStatistics(championId: number, patch: string): ChampionDataDetails {
  return {
    metadata: { source: 'opgg', mode: 'ranked', patch, dataDate: null, updatedAt: null },
    championId,
    summary: {
      championId,
      position: 'middle',
      performance: {
        games: 16_860,
        wins: null,
        winRate: 0.504,
        pickRate: 0.073,
        banRate: null,
        kda: null,
        rank: null,
        rankChange: null,
        strengthTier: null,
        averagePlacement: null,
        firstPlaceRate: null
      },
      counterChampionIds: []
    },
    sections: {
      matchups: [103, 61, 7, 245].map((opponent, index) => ({
        championId: opponent,
        relationship: 'unknown' as const,
        performance: storyPerformance(260 + index * 40, 128 + index * 22)
      })),
      summonerSpells: [
        { spellIds: [4, 14], performance: storyPerformance(11_900, 6045, 0.78) },
        { spellIds: [4, 12], performance: storyPerformance(2360, 1138, 0.155) }
      ],
      runePages: [
        {
          primaryStyleId: 8300,
          secondaryStyleId: 8100,
          primaryRuneIds: [8369, 8304, 8345, 8347],
          secondaryRuneIds: [8143, 8106],
          statShardIds: [5008, 5008, 5011],
          performance: storyPerformance(8420, 4336, 0.5)
        },
        {
          primaryStyleId: 8100,
          secondaryStyleId: 8300,
          primaryRuneIds: [8112, 8143, 8140, 8106],
          secondaryRuneIds: [8304, 8345],
          statShardIds: [5008, 5008, 5011],
          performance: storyPerformance(1660, 754, 0.1)
        }
      ],
      itemBuilds: [
        {
          slot: 'starting',
          options: [{ itemIds: [1055], performance: storyPerformance(6850, 3473, 0.44) }]
        },
        {
          slot: 'boots',
          options: [{ itemIds: [3158], performance: storyPerformance(12_100, 6232, 0.8) }]
        },
        { slot: 'last', options: [{ itemIds: [6699], performance: storyPerformance(9180, 4856) }] }
      ]
    }
  }
}

/**
 * Thirty synthetic games with deaths, purchases, wards and plates, so the cross-game views have
 * something to show. Lost games die earlier and more often around the bottom river and finish
 * their first item later — an invented pattern for checking the interface, not real play.
 * With `mixed`, a third of the games are flex queue and the oldest twelve are one patch older, so the
 * default solo-queue / latest-patch filter leaves most of them out.
 */
function patternFixtures(mixed = false) {
  let seed = 20261114
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const between = (low: number, high: number) => low + random() * (high - low)
  const near = (x: number, y: number, spread = 700) => ({
    x: Math.round(x + between(-spread, spread)),
    y: Math.round(y + between(-spread, spread))
  })
  return Array.from({ length: 30 }, (_, index) => {
    const win = index % 15 < 8
    const fixture = createReviewFixture({ gameId: 70_000 + index, win, duration: 1680 })
    const { summary, details } = fixture
    summary.json.gameCreation = Date.UTC(2026, 10, 12, 20) - index * 5_400_000
    summary.json.gameVersion = mixed && index >= 18 ? '16.21.1' : '16.22.1'
    if (mixed && index % 3 === 1) summary.json.queueId = 440
    const championIds = [238, 122, 64, 51, 412, [103, 61, 7, 245][index % 4], 114, 59, 222, 117]
    summary.json.participants.forEach((participant, i) => {
      participant.championId = championIds[i]
      // Every third game is played from the red side.
      if (index % 3 === 2) participant.teamId = participant.teamId === 100 ? 200 : 100
    })
    const csPerMinute = win ? between(7.6, 8.8) : between(6.4, 7.8)
    const goldPerMinute = win ? between(360, 420) : between(250, 330)
    for (const frame of details.json.frames) {
      const minute = frame.timestamp / 60_000
      const own = frame.participantFrames['8']
      own.minionsKilled = Math.round(minute * csPerMinute)
      own.totalGold = Math.round(500 + minute * goldPerMinute)
    }
    const roam = Math.floor(between(5, 11))
    if (random() < (win ? 0.75 : 0.4)) {
      details.json.frames[roam].participantFrames['8'].position = near(9000, 1600, 300)
      details.json.frames[roam + 1].participantFrames['8'].position = near(10200, 1500, 300)
    }
    const spots = win
      ? [near(7500, 7500), near(8800, 8400), near(5000, 10400), near(9800, 4500)]
      : [near(9800, 4500, 500), near(9600, 4900, 500), near(7600, 7300), near(10300, 5200, 500)]
    const deaths = Math.round(win ? between(2, 5) : between(5, 8))
    for (let n = 0; n < deaths; n++) {
      const early = n < (win ? 1 : 3)
      const ganked = random() < (win ? 0.3 : 0.55)
      addReviewEvent(details, {
        type: 'CHAMPION_KILL',
        timestamp: Math.round(early ? between(280_000, 760_000) : between(800_000, 1_600_000)),
        killerId: ganked ? 9 : 3,
        victimId: 8,
        assistingParticipantIds: ganked ? [3] : random() < 0.25 ? [7] : [],
        position: early
          ? spots[n % spots.length]
          : near(between(3500, 11500), between(3500, 11500)),
        bounty: 300,
        shutdownBounty: 0,
        killStreakLength: 0,
        victimDamageReceived: []
      })
    }
    summary.json.participants.find((participant) => participant.participantId === 8)!.deaths =
      deaths
    for (const event of [
      reviewPurchase(6_000, 1055),
      reviewPurchase(Math.round(win ? between(230_000, 330_000) : between(170_000, 260_000)), 1036),
      reviewPurchase(Math.round(win ? between(540_000, 660_000) : between(680_000, 840_000)), 6699),
      reviewPurchase(900_000, 3158),
      ...Array.from({ length: Math.round(between(2, 5)) }, () =>
        reviewWard(Math.round(between(90_000, 590_000)))
      ),
      ...Array.from({ length: Math.round(win ? between(2, 5) : between(0, 2)) }, () =>
        reviewPlate(Math.round(between(240_000, 820_000)), index % 3 === 2 ? 100 : 200)
      ),
      ...Array.from({ length: Math.round(win ? between(0, 2) : between(1, 4)) }, () =>
        reviewPlate(Math.round(between(240_000, 820_000)), index % 3 === 2 ? 200 : 100)
      )
    ])
      addReviewEvent(details, event)
    return fixture
  })
}

/**
 * Gives one synthetic game a full stat line, level-ups, ability points, objectives and own
 * takedowns, so the single-game "full data" page has every section filled. Invented numbers.
 */
function withReportData(fixture: ReturnType<typeof createReviewFixture>) {
  const { summary, details } = fixture
  const selection = (perk: number) => ({ perk, var1: 0, var2: 0, var3: 0 })
  summary.json.participants.forEach((participant, index) => {
    const own = participant.participantId === 8
    Object.assign(participant, {
      kills: own ? 7 : 2 + (index % 4),
      assists: 3 + (index % 5),
      champLevel: 13 + (index % 4),
      totalMinionsKilled: 150 + index * 9,
      neutralMinionsKilled: index % 5 === 2 ? 120 : 4,
      goldEarned: 9000 + index * 420,
      goldSpent: 8600 + index * 400,
      totalDamageDealtToChampions: 12_000 + index * 1500,
      totalDamageTaken: 14_000 + index * 900,
      visionScore: 14 + index * 3,
      wardsPlaced: 6 + index,
      wardsKilled: index % 3,
      visionWardsBoughtInGame: index % 3,
      totalTimeSpentDead: 60 + index * 12,
      item0: 6699,
      item1: 3158,
      item2: 1036,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      spell1Id: 4,
      spell2Id: 14,
      spell1Casts: 90 + index,
      spell2Casts: 40 + index,
      spell3Casts: 55 + index,
      spell4Casts: 8,
      summoner1Casts: 4,
      summoner2Casts: 3,
      perks: {
        statPerks: { offense: 5008, flex: 5008, defense: 5011 },
        styles: [
          {
            description: 'primaryStyle',
            style: 8100,
            selections: [8112, 8143, 8140, 8106].map(selection)
          },
          { description: 'subStyle', style: 8300, selections: [8304, 8345].map(selection) }
        ]
      },
      challenges: {
        soloKills: own ? 2 : 0,
        skillshotsHit: 30 + index,
        skillshotsDodged: 20 + index,
        turretPlatesTaken: index % 4
      }
    })
  })
  const point = (participantId: number) =>
    summary.json.participants.find((participant) => participant.participantId === participantId)!
  point(3).deaths = 1
  point(9).deaths = 1
  for (const event of [
    reviewLevelUp(95_000, 2),
    reviewLevelUp(100_000, 2, 3),
    reviewLevelUp(165_000, 3),
    reviewLevelUp(330_000, 6),
    reviewLevelUp(352_000, 6, 3),
    reviewLevelUp(790_000, 11),
    reviewLevelUp(760_000, 11, 3),
    ...[1, 2, 3, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2].map((slot, index) =>
      reviewSkill(20_000 + index * 62_000, slot)
    ),
    reviewTakedown(205_000, 8, 3, { position: { x: 7300, y: 7400 } }),
    reviewTakedown(905_000, 8, 9, { assists: [10, 2], position: { x: 9700, y: 4600 } }),
    reviewMonster(370_000, 'DRAGON', 10, { subType: 'FIRE_DRAGON', assists: [8] }),
    reviewMonster(750_000, 'RIFTHERALD', 9, { position: { x: 5000, y: 10_400 } }),
    reviewBuilding(840_000, 200, 8, { assists: [10] }),
    reviewMonster(1_320_000, 'BARON_NASHOR', 9, { position: { x: 5000, y: 10_400 } }),
    reviewWardKill(505_000),
    reviewWardKill(1_105_000, 'CONTROL_WARD')
  ])
    addReviewEvent(details, event)
  addReviewEvent(details, {
    type: 'CHAMPION_SPECIAL_KILL',
    timestamp: 205_000,
    killerId: 8,
    position: { x: 7300, y: 7400 },
    killType: 'KILL_FIRST_BLOOD'
  })
  return fixture
}

/**
 * An invented rank log: games backfilled without points, a starting point, two weeks of play with a
 * remake, a dodge penalty, a gap and a change whose game is still unknown, plus a few flex games.
 * With `lossStreak` the last three games are losses that ended within the hour.
 */
function rankLogEntries(lossStreak: boolean): RankLogEntryDto[] {
  let seed = 20261123
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const HOUR = 3_600_000
  const champions = [238, 103, 61, 7, 245, 84]
  const entries: RankLogEntryDto[] = []
  let id = 1
  const add = (values: Partial<RankLogEntryDto> & Pick<RankLogEntryDto, 'kind' | 'occurredAt'>) =>
    entries.push({
      id: id++,
      queueType: 'RANKED_SOLO_5x5',
      observedAt: null,
      gameId: null,
      gameCreation: null,
      gameDuration: null,
      championId: null,
      position: null,
      win: null,
      remake: null,
      kills: null,
      deaths: null,
      assists: null,
      cs: null,
      games: null,
      lpDelta: null,
      tier: null,
      division: null,
      leaguePoints: null,
      absoluteLp: null,
      provisional: null,
      wins: null,
      losses: null,
      ...values
    })
  const facts = (endedAt: number, win: boolean) => {
    const duration = Math.round(1300 + random() * 900)
    return {
      occurredAt: endedAt,
      gameId: 80_000 + id,
      gameCreation: endedAt - duration * 1000 - 5 * 60_000,
      gameDuration: duration,
      championId: champions[Math.floor(random() * champions.length)],
      position: 'MIDDLE',
      win,
      remake: false,
      kills: Math.round(2 + random() * (win ? 10 : 6)),
      deaths: Math.round(1 + random() * (win ? 5 : 8)),
      assists: Math.round(2 + random() * 10),
      cs: Math.round((duration / 60) * (6.2 + random() * 2))
    }
  }
  let absoluteLp = 1362
  let wins = 31
  let losses = 29
  const reading = (observedAt: number) => ({
    observedAt,
    ...fromAbsoluteLp(absoluteLp),
    absoluteLp,
    provisional: false,
    wins,
    losses
  })
  const start = Date.now() - 13 * 24 * HOUR
  // 装上功能之前的对局：只有胜负。
  for (let index = 0; index < 4; index++)
    add({ kind: 'game', ...facts(start - (index + 1) * 5 * HOUR, index % 2 === 0) })
  add({ kind: 'baseline', occurredAt: start, ...reading(start) })

  let clock = start + 3 * HOUR
  const play = (win: boolean) => {
    clock += 40 * 60_000
    const lpDelta = win ? Math.round(20 + random() * 4) : -Math.round(17 + random() * 4)
    absoluteLp += lpDelta
    if (win) wins++
    else losses++
    add({ kind: 'game', ...facts(clock, win), lpDelta, ...reading(clock + 8000) })
  }
  for (let day = 0; day < 12; day++) {
    clock = start + day * 24 * HOUR + (18 + random() * 2) * HOUR
    const games = 2 + Math.floor(random() * 4)
    for (let index = 0; index < games; index++) {
      // 连着打到后面胜率走低，让「状态分析」有内容可看。
      play(random() < (index < 2 ? 0.62 : 0.4))
    }
    if (day === 3) {
      clock += 6 * 60_000
      add({ kind: 'game', ...facts(clock, false), remake: true, gameDuration: 210 })
    }
    if (day === 5) {
      clock += 10 * 60_000
      absoluteLp -= 5
      add({ kind: 'adjustment', occurredAt: clock, lpDelta: -5, ...reading(clock) })
    }
    if (day === 7) {
      clock += (30 * HOUR) / 10
      for (let index = 0; index < 2; index++)
        add({ kind: 'game', ...facts(clock - index * 45 * 60_000, index === 0) })
      absoluteLp += 3
      wins++
      losses++
      add({ kind: 'gap', occurredAt: clock + HOUR, games: 2, lpDelta: 3, ...reading(clock + HOUR) })
    }
    if (day === 9) {
      clock += 50 * 60_000
      absoluteLp += 21
      wins++
      add({ kind: 'game', occurredAt: clock, win: true, lpDelta: 21, ...reading(clock) })
    }
  }
  if (lossStreak) {
    clock = Date.now() - 115 * 60_000
    play(true)
    play(false)
    play(false)
    play(false)
  }
  for (let index = 0; index < 3; index++)
    add({
      kind: 'game',
      queueType: 'RANKED_FLEX_SR',
      ...facts(start + (index * 3 + 1) * 24 * HOUR, index !== 1)
    })
  return entries.sort((a, b) => b.occurredAt - a.occurredAt || b.id - a.id)
}

// What the stand-in AI service "writes". Invented text: it only has to look like an answer,
// with headings, lists and game times.
const COACH_ANSWER = `**一句话总结**：这一局输在 10 到 15 分钟之间连续两次阵亡，对线期攒下的补刀优势没能留住。

## 最关键的三个时刻

1. **3:25 单杀之后**：拿到一血以后兵线停在河道，回城再回来时少了一波兵的经验。更好的选择是先把这波兵推进塔下再回。
2. **10:20 河道阵亡**：这是程序标出的片段。阵亡前 30 秒敌方打野没有出现在地图上，资料里看不出当时有没有视野，这一点需要你自己回看确认。
3. **12:30 峡谷先锋**：你比队友早到了大约 20 秒，在人数不齐的时候被先手。等到 12:50 队友到位再靠近，这个先锋有机会拿。

## 做得好的地方

- 前 10 分钟补刀比你平时多 9 个，对位补刀差 +12，属于明显好于平时。
- 第一件成装的时间比平时早了约 40 秒。

## 下一局只改一件事

**去河道和野区之前，先看一眼小地图上敌方打野最后出现的位置和时间。** 打完之后检查：每一次阵亡前，你能不能说出敌方打野当时大概在哪。

## 符文、召唤师技能和出装

**符文**：这一套在这个对位下说得通，问题出在基石没打出来。

- 基石 电刑：整局的记录远低于你的总伤害，说明三连命中的机会很少。对面中期就做了保命装，换成先攻更稳。
- 猛然冲击、恐怖纪念品、终极猎人：都正常发挥，不用动。
- 副系 神奇之鞋、饼干配送：没问题。
- 属性碎片：没问题。

**召唤师技能**：闪现用了 4 次、引燃 3 次，两次单杀里都有引燃的伤害，这一局带引燃是对的。

**出装**：出门装和鞋都和同段位的主流一致。第一件成装 10:20 才做出来，比你平时晚，是那两次阵亡拖的。

**下次遇到这个对位**：先攻，其余不变；闪现加引燃。`
const COACH_FOLLOW_UP = `对线期整体是合格的，主要有两点可以更好：

- **2:40 到 4:30** 你一直在推线，资料里这段时间没有插眼的记录。推线时在河道草丛留一个眼，被抓的风险会小很多。
- **5:10 回城的时机**上面说过了：先推线再回。

其余时间的换血细节资料里看不出来。`

const meta = {
  title: 'Renderer Shared/Review Studio',
  component: ReviewStudioModal,
  parameters: { akariStoryPanelMaxWidth: 1180 },
  args: { show: true, puuid: 'player-8', sgpServerId: 'REVIEW_STORY', initialGameId: 90_000 },
  render: (args, context) => ({
    components: { ReviewStudioModal, NButton, NTag },
    setup() {
      const isCoachStory = context.name.startsWith('Coach')
      const games =
        context.name === 'Empty History'
          ? []
          : context.name === 'Death Map' || context.name === 'Outcome Gap'
            ? patternFixtures()
            : context.name === 'Full Report' || context.name === 'Baseline' || isCoachStory
              ? patternFixtures().map((fixture, index) =>
                  index === 0 ? withReportData(fixture) : fixture
                )
              : context.name === 'Broaden Offer' || context.name === 'Broaden Stored'
                ? patternFixtures(true)
                : fixtures(context.name === 'Missing Data')
      const appContext = getCurrentInstance()!.appContext
      const previousManager = appContext.config.globalProperties.$akariManager
      const storage = new Map<string, unknown>()
      const storedSettings = {
        get: async (namespace: string, key: string) => storage.get(`${namespace}:${key}`) ?? null,
        set: async (namespace: string, key: string, value: unknown) => {
          storage.set(`${namespace}:${key}`, structuredClone(value))
        }
      }
      const wait = async () => new Promise((resolve) => setTimeout(resolve, 180))
      const query = {
        getMatchHistorySummaryByPlayerPuuid: async () => {
          await wait()
          return { data: { games: games.map((game) => game.summary) } }
        },
        getGameSummaryByGameId: async (id: number) => {
          await wait()
          return { data: games.find((game) => game.summary.json.gameId === id)!.summary }
        },
        getGameDetailsByGameId: async (id: number) => {
          await wait()
          return { data: games.find((game) => game.summary.json.gameId === id)!.details }
        }
      }
      // The rank log stories look at the logged-in player's own log, served from memory.
      const isRankStory = context.name.startsWith('Rank Log')
      const rankStore = useRankLogStore()
      const rankEntries =
        context.name === 'Rank Log Empty' ? [] : rankLogEntries(context.name.includes('Streak'))
      const rankLog = {
        queryEntries: async () => {
          await wait()
          return rankEntries
        },
        syncNow: async () => {
          await wait()
          return { result: 'ok', historyLoaded: true }
        },
        setEnabled: async (enabled: boolean) => {
          rankStore.settings.enabled = enabled
        }
      }
      // The coach stories talk to a stand-in AI service that writes a fixed answer piece by piece.
      const coachStore = useAiCoachStore()
      const previousCoach = { settings: { ...coachStore.settings }, state: { ...coachStore.state } }
      Object.assign(coachStore.settings, {
        provider: 'anthropic',
        anthropicModel: 'claude-opus-5-5',
        anthropicBaseUrl: '',
        openaiBaseUrl: '',
        openaiModel: ''
      })
      Object.assign(coachStore.state, {
        hasAnthropicKey: isCoachStory && context.name !== 'Coach Setup',
        hasOpenaiKey: false,
        canPersistKeys: true
      })
      const stoppedRequests = new Set<string>()
      const aiCoach = {
        chat: async (
          request: AiCoachChatRequest,
          onDelta: (text: string) => void
        ): Promise<AiCoachChatResult> => {
          await new Promise((resolve) => setTimeout(resolve, 900))
          if (context.name === 'Coach Error')
            return { result: 'failed', code: 'auth', message: 'invalid x-api-key', text: '' }
          const answer = request.messages.length === 1 ? COACH_ANSWER : COACH_FOLLOW_UP
          let text = ''
          for (let offset = 0; offset < answer.length; offset += 6) {
            if (stoppedRequests.has(request.requestId))
              return { result: 'failed', code: 'cancelled', message: '', text }
            const piece = answer.slice(offset, offset + 6)
            text += piece
            onDelta(piece)
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          return {
            result: 'ok',
            text,
            truncated: false,
            usage: {
              inputTokens: 9_800,
              outputTokens: 640,
              cachedInputTokens: request.messages.length === 1 ? 0 : 9_100
            },
            model: 'claude-opus-5-5'
          }
        },
        cancel: async (requestId: string) => stoppedRequests.add(requestId),
        setApiKey: async (provider: AiCoachProvider, key: string) => {
          if (key.trim().length < 8) return { result: 'failed', reason: 'invalid-key' }
          coachStore.state[provider === 'anthropic' ? 'hasAnthropicKey' : 'hasOpenaiKey'] = true
          return { result: 'ok', persisted: true }
        },
        clearApiKey: async (provider: AiCoachProvider) => {
          coachStore.state[provider === 'anthropic' ? 'hasAnthropicKey' : 'hasOpenaiKey'] = false
          return true
        },
        setSetting: async (key: keyof typeof coachStore.settings, value: string) => {
          Object.assign(coachStore.settings, { [key]: value })
        }
      }
      // The coach also reads same-rank statistics; a stand-in source answers after a moment.
      const answer = <T>(data: T) => ({
        status: 'success' as const,
        data,
        preferredSource: 'opgg' as const,
        effectiveSource: 'opgg' as const,
        fallbackReason: null,
        attempts: []
      })
      const championData = {
        loadPatches: async () => {
          await wait()
          return answer(['16.22', '16.21'])
        },
        loadDetails: async (statisticsQuery: ChampionDataQuery, championId: number) => {
          await new Promise((resolve) => setTimeout(resolve, 600))
          return answer(storyStatistics(championId, statisticsQuery.patch ?? '16.22'))
        }
      }
      // The only direct call is the matchup-only statistics, which this source does not have.
      const ipc = { call: async () => ({ targetVerified: false, overlay: null }) }
      // The champion kits are read from the client one champion at a time.
      const leagueClient = {
        api: {
          gameData: {
            getChampDetails: async (championId: number) => {
              await wait()
              return { data: storyChampionDetails(championId) }
            }
          }
        }
      }
      appContext.config.globalProperties.$akariManager = {
        getInstance: (constructor: unknown) => {
          if (constructor === SettingUtilsRenderer) return storedSettings
          if (constructor === SgpRenderer) return { api: { matchHistoryQuery: query } }
          if (constructor === RankLogRenderer) return rankLog
          if (constructor === AiCoachRenderer) return aiCoach
          if (constructor === ChampionDataRenderer) return championData
          if (constructor === AkariIpcRenderer) return ipc
          if (constructor === LeagueClientRenderer) return leagueClient
          throw new Error('Unexpected shard requested by review preview')
        }
      } as AkariManager
      const sgpStore = useSgpStore()
      const lcs = useLeagueClientStore()
      const previousState = {
        sgpServerId: sgpStore.availability.sgpServerId,
        tokenReady: sgpStore.isTokenReady,
        leagueServers: sgpStore.leagueServers,
        summoner: lcs.summoner.me,
        items: lcs.gameData.items,
        perks: lcs.gameData.perks,
        perkstyles: lcs.gameData.perkstyles,
        summonerSpells: lcs.gameData.summonerSpells,
        champions: lcs.gameData.champions,
        connectionState: lcs.connectionState,
        rankAvailable: rankStore.state.available,
        rankEnabled: rankStore.settings.enabled
      }
      rankStore.state.available = true
      rankStore.settings.enabled = true
      lcs.gameData.items = STORY_ITEMS
      if (isCoachStory) {
        lcs.gameData.perks = STORY_PERKS
        lcs.gameData.perkstyles = { schemaVersion: 2, styles: STORY_STYLES }
        lcs.gameData.summonerSpells = STORY_SPELLS
        lcs.gameData.champions = STORY_CHAMPIONS
        // The kits are only asked for while the client is connected.
        lcs.connectionState = 'connected'
      }
      sgpStore.availability.sgpServerId = 'REVIEW_STORY'
      sgpStore.isTokenReady = context.name !== 'Disconnected'
      sgpStore.leagueServers = {
        updatedAt: '',
        serverNames: {},
        servers: {
          REVIEW_STORY: { matchHistory: 'https://example.test', common: '', isTencent: true }
        }
      }
      // The rank log and the coach's "recent form" exist only for the logged-in player's own games.
      const ownerPuuid = isRankStory || isCoachStory ? 'player-8' : 'preview-owner'
      lcs.summoner.me = { puuid: ownerPuuid } as SummonerInfo
      // "Broaden Stored", "Baseline" and the coach stories open with every game already kept on
      // this device and no history read yet.
      const ready = ref(
        context.name !== 'Broaden Stored' && context.name !== 'Baseline' && !isCoachStory
      )
      if (!ready.value)
        void writeReviewArchive(
          storedSettings,
          {
            ownerPuuid,
            ownerServerId: 'REVIEW_STORY',
            targetPuuid: 'player-8',
            targetServerId: 'REVIEW_STORY'
          },
          games.flatMap((game) => {
            const parsed = parseReviewMatch(
              game.summary,
              game.details,
              'player-8',
              'REVIEW_STORY',
              {
                coreItem: (itemId) => isReviewCoreItem(STORY_ITEMS[itemId]),
                itemKind: (itemId) => classifyReviewItem(STORY_ITEMS[itemId])
              }
            )
            return parsed.ok ? [parsed.match] : []
          })
        ).then(() => (ready.value = true))
      onBeforeUnmount(() => {
        appContext.config.globalProperties.$akariManager = previousManager
        sgpStore.availability.sgpServerId = previousState.sgpServerId
        sgpStore.isTokenReady = previousState.tokenReady
        sgpStore.leagueServers = previousState.leagueServers
        lcs.summoner.me = previousState.summoner
        lcs.gameData.items = previousState.items
        lcs.gameData.perks = previousState.perks
        lcs.gameData.perkstyles = previousState.perkstyles
        lcs.gameData.summonerSpells = previousState.summonerSpells
        lcs.gameData.champions = previousState.champions
        lcs.connectionState = previousState.connectionState
        rankStore.state.available = previousState.rankAvailable
        rankStore.settings.enabled = previousState.rankEnabled
        Object.assign(coachStore.settings, previousCoach.settings)
        Object.assign(coachStore.state, previousCoach.state)
      })
      const show = ref(true)
      return { args, show, ready }
    },
    template: `<div class="flex items-center gap-3 p-4"><NTag type="warning">演示数据 · 仅验证界面交互</NTag><NButton @click="show = true">打开复盘台</NButton><ReviewStudioModal v-if="ready" v-bind="args" v-model:show="show" /></div>`
  })
} satisfies Meta<typeof ReviewStudioModal>

export default meta
type Story = StoryObj<typeof meta>
export const MatchOverview: Story = {}
export const History: Story = { args: { initialGameId: undefined } }
export const MissingData: Story = {}
export const EmptyHistory: Story = { args: { initialGameId: undefined } }
export const Disconnected: Story = { args: { initialGameId: undefined } }
export const DeathMap: Story = { args: { initialGameId: undefined, initialTab: 'deaths' } }
export const OutcomeGap: Story = { args: { initialGameId: undefined, initialTab: 'gap' } }
/** Opens one game; the "完整数据" sub-view of that game shows every section of the full report. */
export const FullReport: Story = { args: { initialGameId: 70_000 } }
/** Thirty games are already kept on this device, so the full report can compare one with the rest. */
export const Baseline: Story = { args: { initialGameId: 70_000 } }
export const BroadenOffer: Story = { args: { initialGameId: undefined, initialTab: 'gap' } }
export const BroadenStored: Story = { args: { initialGameId: undefined, initialTab: 'deaths' } }
export const RankLog: Story = { args: { initialGameId: undefined, initialTab: 'rank' } }
/** The last three games of the running session were lost: the break reminder is showing. */
export const RankLogLossStreak: Story = { args: { initialGameId: undefined, initialTab: 'rank' } }
export const RankLogEmpty: Story = { args: { initialGameId: undefined, initialTab: 'rank' } }
/**
 * The "AI 教练" sub-view of one game, talking to a stand-in service that writes a fixed answer.
 * A key counts as entered, so the review can be started straight away.
 */
export const Coach: Story = { args: { initialGameId: 70_000 } }
/** No key has been entered yet: the coach view opens on the connection form. */
export const CoachSetup: Story = { args: { initialGameId: 70_000 } }
/** The stand-in service rejects the key, to show how a failure is reported. */
export const CoachError: Story = { args: { initialGameId: 70_000 } }
