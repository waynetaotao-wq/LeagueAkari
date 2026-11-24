import { describe, expect, it } from 'vitest'

import {
  formatRuneStatAmount,
  formatRuneStats,
  plainGameText,
  readItemText,
  readRuneStats
} from './game-text'

// The markup below is copied from the client's own game data (16.23, zh_MY), shortened where
// it does not matter.

describe('plainGameText', () => {
  it('strips the client’s tags and keeps the words', () => {
    expect(
      plainGameText(
        "3秒内，使用3次<b>不同</b>的普攻或技能命中同一位英雄，即可对目标造成额外<lol-uikit-tooltipped-keyword key='LinkTooltip_Description_AdaptiveDmg'><font color='#48C4B7'>适性伤害</font></lol-uikit-tooltipped-keyword>。"
      )
    ).toBe('3秒内，使用3次不同的普攻或技能命中同一位英雄，即可对目标造成额外适性伤害。')
  })

  it('turns line breaks into spaces and list items into bullets', () => {
    expect(plainGameText('伤害：70-240<br>冷却时间：20秒<br><br>余震上限：80-150')).toBe(
      '伤害：70-240 冷却时间：20秒 余震上限：80-150'
    )
    expect(
      plainGameText('下一次普攻将附带以下效果：<li>造成额外魔法伤害<li>获得治疗<li>永久提升5生命值')
    ).toBe('下一次普攻将附带以下效果： • 造成额外魔法伤害 • 获得治疗 • 永久提升5生命值')
  })

  it('drops the lore quote that closes a rune text, however it is quoted', () => {
    expect(
      plainGameText(
        "冷却时间：20秒<br><br><i>'我们称呼他们为雷神，意味着他们的雷电将引发灾厄。'</i>"
      )
    ).toBe('冷却时间：20秒')
    expect(
      plainGameText(
        '额外获得20金钱。<br><br><hr><br><i>“最危险的狩猎赋予最崇高的荣耀。”<br>——诺克萨斯清算人</i>'
      )
    ).toBe('额外获得20金钱。')
    expect(plainGameText('（随等级提升）。<br><br><i>愿你与奔腾不息的河流一样迅捷。</i>')).toBe(
      '（随等级提升）。'
    )
  })

  it('drops icon markers and writes a melee-or-ranged pair without the template brackets', () => {
    expect(plainGameText('提摩每次普攻会使目标中毒%i:OnHit%命中效果。')).toBe(
      '提摩每次普攻会使目标中毒命中效果。'
    )
    expect(
      plainGameText(
        '攻击敌方英雄可获得[6%近战 || 4%远程]攻击速度。最大叠层时，普攻造成[9 - 30近战 || 6 - 24远程] 额外适性伤害。'
      )
    ).toBe(
      '攻击敌方英雄可获得6%近战／4%远程攻击速度。最大叠层时，普攻造成9 - 30近战／6 - 24远程 额外适性伤害。'
    )
    expect(
      plainGameText('会造成[85（+28%最大生命值）近战 || 50 （+20%最大生命值）远程]额外物理伤害。')
    ).toBe('会造成85（+28%最大生命值）近战／50 （+20%最大生命值）远程额外物理伤害。')
    // Brackets that are a plain range stay as they are.
    expect(plainGameText('延长+[30 - 45]秒持续时间')).toBe('延长+[30 - 45]秒持续时间')
  })

  it('keeps italics that are part of the rule', () => {
    // An emphasised term in the middle of a sentence.
    expect(
      plainGameText('每叠加一层<i>赏金猎人</i>，便可在脱战时获得<speed>8移动速度</speed>。')
    ).toBe('每叠加一层赏金猎人，便可在脱战时获得8移动速度。')
    // A sentence that ends in italics but is not on a line of its own.
    expect(plainGameText('首次击杀可获得<i>赏金猎人</i>')).toBe('首次击杀可获得赏金猎人')
    // Italic labels at the start of several lines.
    expect(
      plainGameText('<i>10分钟</i>：+8魔法攻击<br><i>20分钟</i>：+24魔法攻击<br>以此类推……')
    ).toBe('10分钟：+8魔法攻击 20分钟：+24魔法攻击 以此类推……')
  })

  it('marks a value the client left as a placeholder instead of printing the placeholder', () => {
    expect(plainGameText('冷却时间永久缩短25秒（初始替换冷却时间为@f3@秒）。')).toBe(
      '冷却时间永久缩短25秒（初始替换冷却时间为若干秒）。'
    )
    expect(plainGameText('获得{{ Item_Melee_Ranged_Split }}%攻击速度')).toBe('获得若干%攻击速度')
  })

  it('decodes entities and tidies the spacing around Chinese punctuation', () => {
    expect(
      plainGameText(
        '+<attention>18</attention> 召唤师技能疾速 <br>+<attention>10</attention> 道具疾速'
      )
    ).toBe('+18 召唤师技能疾速 +10 道具疾速')
    expect(plainGameText('伤害 &amp; 治疗&nbsp;提升 ，持续 2 秒 。')).toBe(
      '伤害 & 治疗 提升，持续 2 秒。'
    )
  })

  it('has nothing for a value that is not text', () => {
    expect(plainGameText(undefined)).toBe('')
    expect(plainGameText(42)).toBe('')
  })
})

describe('readItemText', () => {
  it('separates the stats from the effects and names each effect', () => {
    expect(
      readItemText(
        '<mainText><stats><attention> 45</attention> 物理攻击<br><attention> 400</attention> 生命<br><attention> 20</attention> 技能疾速</stats><br><br><passive>雕刻</passive><br>造成<physicalDamage>物理伤害</physicalDamage>时，会使目标的<scaleArmor>物理防御降低6%</scaleArmor>，持续6秒。（可叠加5次）。<br><br><passive>狂热</passive><br>造成物理伤害时会提供<speed>0移动速度</speed>，持续2秒。</mainText>'
      )
    ).toEqual({
      stats: ['45 物理攻击', '400 生命', '20 技能疾速'],
      effects:
        '雕刻：造成物理伤害时，会使目标的物理防御降低6%，持续6秒。（可叠加5次）。 狂热：造成物理伤害时会提供若干移动速度，持续2秒。'
    })
  })

  it('has no effects for an item that only gives stats', () => {
    expect(
      readItemText(
        '<mainText><stats><attention> 10</attention> 物理攻击<br><attention> 80</attention> 生命<br><attention> 2.5%</attention> 全能吸血</stats><br><br></mainText>'
      )
    ).toEqual({ stats: ['10 物理攻击', '80 生命', '2.5% 全能吸血'], effects: '' })
  })

  it('has no stats for a consumable and keeps the numbers the client does give', () => {
    expect(
      readItemText(
        '<mainText><stats></stats><br><br><active>消耗</active><br>在15秒内回复<healing>120生命值</healing>。</mainText>'
      )
    ).toEqual({ stats: [], effects: '消耗：在15秒内回复120生命值。' })
  })

  it.each([
    // a lone zero stands for a number that depends on level or stats
    [
      '<passive>缠绕</passive><br>脱战时，获得<speed>0移动速度</speed>。',
      '缠绕：脱战时，获得若干移动速度。'
    ],
    [
      '<active>幽灵鬼步</active><br>进入鬼步状态，持续0秒。',
      '幽灵鬼步：进入鬼步状态，持续若干秒。'
    ],
    [
      '施放终极技能后，获得0%攻速和0%移动速度，持续8秒。',
      '施放终极技能后，获得一定比例攻速和一定比例移动速度，持续8秒。'
    ],
    ['在4秒内造成0至0当前生命值的物理伤害', '在4秒内造成若干至若干当前生命值的物理伤害'],
    // a cooldown the client does not give is dropped altogether
    [
      '<active>咒刃</active>（0秒）<br>下次普攻造成0额外魔法伤害。',
      '咒刃：下次普攻造成若干额外魔法伤害。'
    ],
    // sometimes not even the zero is there, only its percent sign
    [
      '你的充能攻击会造成<physicalDamage>%目标当前生命值的额外物理伤害</physicalDamage>。',
      '你的充能攻击会造成一定比例目标当前生命值的额外物理伤害。'
    ],
    // real zeros and numbers that merely contain a zero stay
    ['获得 0-30%暴击率，随额外生命值提升。', '获得 0-30%暴击率，随额外生命值提升。'],
    [
      '持续0.5秒，获得10%移动速度和100生命值，冷却时间90秒。',
      '持续0.5秒，获得10%移动速度和100生命值，冷却时间90秒。'
    ],
    ['使伤害降低1.0%，持续25000秒。', '使伤害降低1.0%，持续25000秒。']
  ])('hides the numbers the client leaves at zero: %s', (html, effects) => {
    expect(readItemText(`<mainText><stats></stats><br><br>${html}</mainText>`).effects).toBe(
      effects
    )
  })

  it('keeps a cooldown the client does give, next to the name of the effect', () => {
    expect(
      readItemText(
        '<mainText><stats></stats><br><br><active>主动</active>（<scaleLevel>210 - 90</scaleLevel>秒，最多2次充能）<br>放置一个<keyword>隐形</keyword>的潜行守卫提供视野，持续<scaleLevel>90-120</scaleLevel>秒。</mainText>'
      ).effects
    ).toBe('主动（210 - 90秒，最多2次充能）：放置一个隐形的潜行守卫提供视野，持续90-120秒。')
  })

  it('drops flavour text', () => {
    expect(
      readItemText(
        '<mainText><stats><attention> 20</attention> 物理攻击</stats><br><br>提升移动速度。<flavorText>传说它属于一位国王。</flavorText></mainText>'
      ).effects
    ).toBe('提升移动速度。')
  })

  it('has nothing for a value that is not text', () => {
    expect(readItemText(null)).toEqual({ stats: [], effects: '' })
  })
})

describe('formatRuneStats', () => {
  it('fills each number into the label the client has for it', () => {
    expect(formatRuneStats(['已造成伤害合计：@eogvar1@'], [2782, 0, 0])).toEqual([
      '已造成伤害合计：2782'
    ])
    expect(
      formatRuneStats(['造成伤害： @eogvar1@', '获得金钱： @eogvar2@'], [1210, 703, 0])
    ).toEqual(['造成伤害： 1210', '获得金钱： 703'])
  })

  it('follows the labels, not the order of the numbers', () => {
    expect(formatRuneStats(['总计层数：@eogvar2@', '已搜集金钱：@eogvar1@'], [450, 5, 0])).toEqual([
      '总计层数：5',
      '已搜集金钱：450'
    ])
    expect(formatRuneStats(['已获得干粮：@eogvar1@', '总计治疗：@eogvar3@'], [3, 0, 183])).toEqual([
      '已获得干粮：3',
      '总计治疗：183'
    ])
  })

  it('writes a time whose seconds are one number with two digits', () => {
    expect(formatRuneStats(['完成时间：@eogvar1@:@eogvar2@'], [18, 0, 0])).toEqual([
      '完成时间：18:00'
    ])
    expect(formatRuneStats(['完成时间：@eogvar1@:@eogvar2@'], [13, 50, 0])).toEqual([
      '完成时间：13:50'
    ])
    // Never reached: the record holds zeros.
    expect(formatRuneStats(['完成时间：@eogvar1@:@eogvar2@'], [0, 0, 0])).toEqual([
      '完成时间：0:00'
    ])
  })

  it('joins the two digits of a time whose seconds are split in two numbers', () => {
    const template = ['鞋子送达时间：@eogvar1@:@eogvar2@@eogvar3@']
    expect(formatRuneStats(template, [10, 3, 0])).toEqual(['鞋子送达时间：10:30'])
    expect(formatRuneStats(template, [9, 4, 5])).toEqual(['鞋子送达时间：9:45'])
    expect(formatRuneStats(template, [12, 0, 0])).toEqual(['鞋子送达时间：12:00'])
  })

  it('drops a time line whose seconds are really the damage of another line', () => {
    // Lethal Tempo in 16.23: both numbers hold the damage; the "time" would be 1469:1469.
    const template = ['最大攻速持续时间：@eogvar1@:@eogvar2@<br>已造成伤害：@eogvar2@']
    expect(formatRuneStats(template, [1469, 1469, 0])).toEqual(['已造成伤害：1469'])
    // It would look like a valid time with small numbers, and is dropped all the same.
    expect(formatRuneStats(template, [37, 37, 0])).toEqual(['已造成伤害：37'])
  })

  it('drops a time that cannot be one', () => {
    expect(formatRuneStats(['发动时间合计：@eogvar1@:@eogvar2@'], [20, 75, 0])).toEqual([])
    expect(formatRuneStats(['送达时间：@eogvar1@:@eogvar2@@eogvar3@'], [9, 7, 5])).toEqual([])
  })

  it('keeps units and other text around the number, and strips tags', () => {
    expect(
      formatRuneStats(
        [
          '触发时间占游戏总长度百分比：@eogvar1@%',
          '总额外物理防御：@eogvar2@',
          '总额外魔法防御：@eogvar3@'
        ],
        [66, 11, 10]
      )
    ).toEqual(['触发时间占游戏总长度百分比：66%', '总额外物理防御：11', '总额外魔法防御：10'])
    expect(formatRuneStats(['提升移动速度：<speed>@eogvar1@</speed>'], [40, 5, 0])).toEqual([
      '提升移动速度：40'
    ])
    expect(formatRuneStats(['已获得额外属性：@eogvar1@ - @eogvar2@'], [10, 20, 0])).toEqual([
      '已获得额外属性：10 - 20'
    ])
  })

  it('has no lines for a rune without recorded numbers', () => {
    expect(formatRuneStats(['--'], [0, 0, 0])).toEqual([])
    expect(formatRuneStats([], [0, 0, 0])).toEqual([])
    expect(formatRuneStats(undefined, [1, 2, 3])).toEqual([])
  })

  it('reads a missing number as zero', () => {
    expect(formatRuneStats(['总伤害：@eogvar1@', '额外伤害：@eogvar2@'], [3635])).toEqual([
      '总伤害：3635',
      '额外伤害：0'
    ])
  })
})

describe('readRuneStats', () => {
  it('gives the one quantity of a line and the label around it', () => {
    expect(readRuneStats(['触发时间占游戏总长度百分比：@eogvar1@%'], [66, 0, 0])).toEqual([
      {
        text: '触发时间占游戏总长度百分比：66%',
        amount: { value: 66, unit: 'number' },
        around: ['触发时间占游戏总长度百分比：', '%']
      }
    ])
  })

  it('gives a time as seconds, whichever way the client writes it', () => {
    expect(readRuneStats(['完成时间：@eogvar1@:@eogvar2@'], [14, 50, 0])[0]).toMatchObject({
      text: '完成时间：14:50',
      amount: { value: 890, unit: 'seconds' },
      around: ['完成时间：', '']
    })
    expect(
      readRuneStats(['鞋子送达时间：@eogvar1@:@eogvar2@@eogvar3@'], [9, 4, 5])[0]
    ).toMatchObject({ text: '鞋子送达时间：9:45', amount: { value: 585, unit: 'seconds' } })
  })

  it('has no single quantity for a line that carries two', () => {
    expect(readRuneStats(['已获得额外属性：@eogvar1@ - @eogvar2@'], [10, 20, 0])[0]).toMatchObject({
      text: '已获得额外属性：10 - 20',
      amount: null
    })
  })

  it('fills a line in the order it is written, a time after a number included', () => {
    expect(readRuneStats(['层数 @eogvar3@，完成于 @eogvar1@:@eogvar2@'], [12, 30, 7])[0].text).toBe(
      '层数 7，完成于 12:30'
    )
  })
})

describe('formatRuneStatAmount', () => {
  const [damage] = readRuneStats(['造成伤害： @eogvar1@'], [1192, 0, 0])
  const [finished] = readRuneStats(['完成时间：@eogvar1@:@eogvar2@'], [14, 50, 0])
  const [both] = readRuneStats(['已获得额外属性：@eogvar1@ - @eogvar2@'], [10, 20, 0])

  it('writes another number into the same label', () => {
    expect(formatRuneStatAmount(damage, 1010.4)).toBe('造成伤害： 1010')
  })

  it('writes a time in words, not as a moment of the game', () => {
    expect(formatRuneStatAmount(finished, 860)).toBe('完成时间：14 分 20 秒')
    expect(formatRuneStatAmount(finished, 59.6)).toBe('完成时间：1 分 0 秒')
  })

  it('has nothing to write for a line without a single quantity', () => {
    expect(formatRuneStatAmount(both, 15)).toBeNull()
  })
})
