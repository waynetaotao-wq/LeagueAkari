import { describe, expect, it } from 'vitest'

import { type ReviewCoachGameData, buildReviewCoachCatalogue } from './coach-catalogue'

const slot = (type: string, perks: number[]) => ({ type, slotLabel: '', perks })

function gameData(): ReviewCoachGameData {
  return {
    perks: {
      8112: {
        id: 8112,
        name: '死亡电刑',
        shortDesc: '三次命中造成额外<b>伤害</b>。',
        longDesc: '3秒内命中三次造成额外伤害。<br>冷却时间：20秒',
        endOfGameStatDescs: ['已造成伤害合计：@eogvar1@']
      },
      // Stat shards have one text for both and no recorded numbers.
      5008: {
        id: 5008,
        name: '适性之力',
        shortDesc: '+9 适性之力',
        longDesc: '',
        endOfGameStatDescs: []
      },
      9999: { id: 9999, name: '', shortDesc: '没有名字', longDesc: '', endOfGameStatDescs: [] }
    },
    styles: {
      8300: {
        id: 8300,
        name: '启示',
        tooltip: '创新玩法，<b>改变游戏规则</b>',
        slots: [
          slot('kKeyStone', [8351, 8360, 8369]),
          slot('kMixedRegularSplashable', [8306, 8304, 8321]),
          slot('kMixedRegularSplashable', [8313, 8352, 8345]),
          slot('kMixedRegularSplashable', [8347, 8410, 8316]),
          slot('kStatMod', [5008, 5005, 5007]),
          slot('kStatMod', [5008, 5010, 5001]),
          slot('kStatMod', [5011, 5013, 5001])
        ]
      },
      8100: {
        id: 8100,
        name: '征服',
        tooltip: '锁定目标，造成爆发伤害',
        slots: [
          slot('kKeyStone', [8112, 8128, 9923]),
          slot('kMixedRegularSplashable', [8126, 8139, 8143]),
          slot('kMixedRegularSplashable', [8137, 8140, 8141]),
          slot('kMixedRegularSplashable', [8135, 8105, 8106])
        ]
      },
      // A tree without rows is not a tree anyone can pick from.
      1: { id: 1, name: '空', tooltip: '', slots: [] }
    },
    items: {
      3142: {
        id: 3142,
        name: '妖梦鬼刀',
        priceTotal: 2800,
        description:
          '<mainText><stats><attention> 55</attention> 物理攻击<br><attention>18</attention>物理致命</stats><br><br><passive>缠绕</passive><br>脱战时，获得<speed>0移动速度</speed>。</mainText>'
      },
      1206: {
        id: 1206,
        name: '中路任务奖励',
        priceTotal: 0,
        description: '<mainText><stats></stats><br><br>• 鞋子升级至3阶</mainText>'
      }
    },
    spells: {
      14: {
        id: 14,
        name: '点燃',
        cooldown: 180,
        description: '对目标持续造成<b>真实伤害</b>。',
        gameModes: ['ARAM', 'CLASSIC']
      },
      4: {
        id: 4,
        name: '闪现',
        cooldown: 300,
        description: '瞬间传送一小段距离。',
        gameModes: ['CLASSIC']
      },
      32: { id: 32, name: '标记', cooldown: 80, description: '投掷雪球。', gameModes: ['ARAM'] },
      5: { id: 5, name: '', cooldown: 180, description: '', gameModes: ['CLASSIC'] }
    },
    champions: {
      54: { id: 54, name: '墨菲特', roles: ['tank', 'mage'] },
      238: { id: 238, name: '劫', roles: ['assassin', 'something-new'] }
    }
  } as unknown as ReviewCoachGameData
}

describe('buildReviewCoachCatalogue', () => {
  const catalogue = buildReviewCoachCatalogue(gameData())

  it('gives a rune in plain words, with the labels of its recorded numbers', () => {
    expect(catalogue.rune(8112)).toEqual({
      name: '死亡电刑',
      short: '三次命中造成额外伤害。',
      long: '3秒内命中三次造成额外伤害。 冷却时间：20秒',
      statLabels: ['已造成伤害合计：@eogvar1@']
    })
    // One text stands in for the other when the client has only one.
    expect(catalogue.rune(5008)).toMatchObject({ short: '+9 适性之力', long: '+9 适性之力' })
  })

  it('does not know a rune the client does not name', () => {
    expect(catalogue.rune(9999)).toBeNull()
    expect(catalogue.rune(1)).toBeNull()
  })

  it('lists the trees in id order with keystones, rows and shard rows apart', () => {
    expect(catalogue.runeTrees).toEqual([
      {
        id: 8100,
        name: '征服',
        theme: '锁定目标，造成爆发伤害',
        keystones: [8112, 8128, 9923],
        rows: [
          [8126, 8139, 8143],
          [8137, 8140, 8141],
          [8135, 8105, 8106]
        ],
        shardRows: []
      },
      {
        id: 8300,
        name: '启示',
        theme: '创新玩法，改变游戏规则',
        keystones: [8351, 8360, 8369],
        rows: [
          [8306, 8304, 8321],
          [8313, 8352, 8345],
          [8347, 8410, 8316]
        ],
        shardRows: [
          [5008, 5005, 5007],
          [5008, 5010, 5001],
          [5011, 5013, 5001]
        ]
      }
    ])
  })

  it('gives an item with its price, stats and effects, and no price for one that is not sold', () => {
    expect(catalogue.item(3142)).toEqual({
      name: '妖梦鬼刀',
      price: 2800,
      stats: ['55 物理攻击', '18物理致命'],
      effects: '缠绕：脱战时，获得若干移动速度。',
      from: []
    })
    expect(catalogue.item(1206)).toEqual({
      name: '中路任务奖励',
      price: null,
      stats: [],
      effects: '• 鞋子升级至3阶',
      from: []
    })
    expect(catalogue.item(1)).toBeNull()

    // What an item is made from is passed on as the client lists it.
    const data = gameData()
    ;(data.items as Record<number, unknown>)[3172] = {
      id: 3172,
      name: '灰蓝护胫',
      priceTotal: 1100,
      description: '',
      from: [3006, 'x', -1]
    }
    expect(buildReviewCoachCatalogue(data).item(3172)).toMatchObject({ from: [3006] })
  })

  it('gives a summoner spell and knows which ones can be taken on the rift', () => {
    expect(catalogue.spell(14)).toEqual({
      name: '点燃',
      cooldown: 180,
      description: '对目标持续造成真实伤害。'
    })
    // In id order; the ARAM-only spell and the nameless placeholder are left out.
    expect(catalogue.riftSpells).toEqual([4, 14])
    expect(catalogue.spell(5)).toBeNull()
  })

  it('translates the class tags it knows and skips the ones it does not', () => {
    expect(catalogue.championRoles(54)).toEqual(['坦克', '法师'])
    expect(catalogue.championRoles(238)).toEqual(['刺客'])
    expect(catalogue.championRoles(999)).toEqual([])
  })

  it('reads a champion’s kit from the client’s own entry for it', () => {
    const withKits = buildReviewCoachCatalogue({
      ...gameData(),
      championDetails: {
        238: {
          id: 238,
          tacticalInfo: { style: 1, difficulty: 3, damageType: 'kPhysical', attackType: 'melee' },
          playstyleInfo: { damage: 3, durability: 1, crowdControl: 1, mobility: 3, utility: 1 },
          passive: {
            name: '影忍法！灭魂劫',
            description: '劫的普攻对<b>低生命值</b>的敌人造成额外魔法伤害。'
          },
          spells: [
            {
              spellKey: 'q',
              name: '影奥义！诸刃',
              description: '劫和他的影子投出手里剑。',
              // One value more than the ability has ranks; the same at every rank.
              cooldownCoefficients: [6, 6, 6, 6, 6, 6],
              maxLevel: 5
            },
            {
              spellKey: 'r',
              name: '禁奥义！瞬狱影杀阵',
              description: '劫标记目标并冲向它。',
              cooldownCoefficients: [120, 100, 80, 80, 80, 80],
              maxLevel: 3
            },
            // An entry without a name is not an ability.
            { spellKey: 'w', name: '', description: '', cooldownCoefficients: [], maxLevel: 5 }
          ]
        },
        // An entry the client answered with something else.
        54: { id: 54 }
      } as never
    })

    expect(withKits.champion(238)).toEqual({
      attack: '近战',
      damage: '物理',
      ratings: [
        { label: '伤害', value: 3 },
        { label: '坦度', value: 1 },
        { label: '控制', value: 1 },
        { label: '机动', value: 3 },
        { label: '功能', value: 1 }
      ],
      abilities: [
        {
          key: '被动',
          name: '影忍法！灭魂劫',
          description: '劫的普攻对低生命值的敌人造成额外魔法伤害。',
          cooldowns: []
        },
        { key: 'Q', name: '影奥义！诸刃', description: '劫和他的影子投出手里剑。', cooldowns: [6] },
        {
          key: 'R',
          name: '禁奥义！瞬狱影杀阵',
          description: '劫标记目标并冲向它。',
          cooldowns: [120, 100, 80]
        }
      ]
    })
    expect(withKits.champion(54)).toBeNull()
    expect(withKits.champion(999)).toBeNull()
    // Without the entries nothing is known about anyone's kit.
    expect(catalogue.champion(238)).toBeNull()
  })

  it('follows the game data as it loads', () => {
    const data = gameData()
    const live = buildReviewCoachCatalogue(data)
    expect(live.item(6692)).toBeNull()

    ;(data.items as Record<number, unknown>)[6692] = {
      id: 6692,
      name: '星蚀',
      priceTotal: 2900,
      description: ''
    }
    expect(live.item(6692)).toMatchObject({ name: '星蚀', price: 2900 })
  })
})
