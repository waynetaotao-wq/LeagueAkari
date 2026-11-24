import { describe, expect, it } from 'vitest'

import {
  REVIEW_COACH_MAX_FOCUS_LENGTH,
  buildReviewCoachFirstMessage,
  buildReviewCoachSystemPrompt,
  normalizeReviewCoachText,
  parseReviewCoachFirstMessage,
  resolveReviewCoachLanguage
} from './coach-prompt'

describe('resolveReviewCoachLanguage', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['ZH', 'zh-CN'],
    ['en', 'en'],
    ['ko-KR', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en']
  ] as const)('answers %s in %s', (locale, language) => {
    expect(resolveReviewCoachLanguage(locale)).toBe(language)
  })
})

describe('buildReviewCoachSystemPrompt', () => {
  const chinese = buildReviewCoachSystemPrompt({ language: 'zh-CN', self: true })
  const english = buildReviewCoachSystemPrompt({ language: 'en', self: true })

  it('tells the coach what the document cannot show', () => {
    for (const prompt of [chinese, english]) {
      expect(prompt).toContain('它不是录像')
      expect(prompt).toContain('资料里看不出来的事，就直接说看不出来')
      expect(prompt).toContain('不评价，不指责')
      expect(prompt).toContain('12:30')
    }
  })

  it('says how to read the parts of the document a first try stumbled over', () => {
    for (const prompt of [chinese, english]) {
      // sections count differently: timed events win, and the difference is not a finding
      expect(prompt).toContain('以带时间的事件记录为准')
      // the official counters are only a second opinion
      expect(prompt).toContain('「官方挑战统计」只当旁证')
      // only moments of this game are written as clickable times
      expect(prompt).toContain('平时水平里的时间，资料已经写成「12 分 12 秒」，照着写')
      // no padding to three moments
      expect(prompt).toContain('资料撑不起三个就写两个，不要凑数')
      // recent form is background, not a verdict on this game, and never made up
      expect(prompt).toContain('「近期排位状态」只是背景')
      expect(prompt).toContain('资料写明没有这方面的记录时，什么都不要说')
      // a fight is a grouping rule: its head count is not who was there
      expect(prompt).toContain('不要因为「卷入 我方 1 名」就说他是一个人')
      // the label the baseline section really uses
      expect(prompt).toContain('「最突出的项目」那几条更值得看')
      expect(prompt).not.toContain('明显偏离')
      // a better choice is not invented when the document cannot show one
      expect(prompt).toContain('资料不足以判断更好的选择时照实说，并说清还缺什么')
    }
  })

  it('says how to read the per-minute tables', () => {
    for (const prompt of [chinese, english]) {
      // cumulative numbers, health and position are one instant, and no unfair hindsight
      expect(prompt).toContain(
        '经济、补刀、伤害、承伤和人头是累计值，相邻两行相减才是这一分钟里的变化'
      )
      expect(prompt).toContain('血量和位置只是快照那一刻的')
      expect(prompt).toContain('队友的位置他当时在小地图上看得到')
      expect(prompt).toContain('对手的位置是赛后才看得到的，他当时未必知道')
      // a snapshot is a moment of this game, so its time can be quoted like an event's
      expect(prompt).toContain('事件的时间，以及逐分钟快照和检查点每行开头的时间')
      expect(prompt).not.toContain('分钟检查点写成「10 分钟」')
      // dead is said in words, since a body can report health
      expect(prompt).toContain('写「阵亡」的那一格表示那一刻是死的')
    }
  })

  it('asks for the answer in the language of the interface', () => {
    expect(chinese).toContain('用简体中文回答')
    expect(chinese).toContain(
      '前四部分合起来大约 600 到 900 个汉字，第五部分大约 700 到 1100 个汉字（都只数汉字，数字、标点和小标题不算）'
    )
    expect(chinese).not.toContain('Answer in English')
    expect(english).toContain('Answer in English')
    expect(english).toContain(
      '前四部分合起来大约 350 到 500 个英文单词，第五部分大约 400 到 650 个英文单词'
    )
    expect(english).not.toContain('用简体中文回答')
  })

  it('gives a method for judging runes, summoner spells and items', () => {
    for (const prompt of [chinese, english]) {
      // what it did this game comes first, win rates come late and are only correlation
      expect(prompt).toContain('逐项判断时依次看四件事，越靠前分量越重')
      expect(prompt).toContain('这一局里它实际做了什么')
      expect(prompt).toContain('它起作用的条件这一局存不存在')
      expect(prompt).toContain('「同段位统计」只说明相关，不说明因果')
      // the same choice is right in one game and wrong in another: it turns on whether the
      // lane can be killed, and an in-between matchup is a bet that has to be named
      expect(prompt).toContain('先回答一个问题：这个对位在对线期杀不杀得掉')
      expect(prompt).toContain('为击杀服务的选择（点燃、爆发型的基石）要靠杀掉人来兑现')
      expect(prompt).toContain('要讲清楚每种带法赌的是什么')
      // the enemy kits are read from the document, not remembered
      expect(prompt).toContain('这些从「英雄技能」和对面的装备看，不要凭记忆')
      // a rune's number is read against the player's own earlier games when there are any
      expect(prompt).toContain('本人以往带这颗符文的 N 局的中位数')
      expect(prompt).toContain('就照实说这一局的记录看不出它的作用')
      // an item is not judged by what happened in the minutes after it was finished
      expect(prompt).toContain('不要因为做出某件装备之后的几分钟赢了或输了几次交战')
      // no judging by the result, no made-up numbers, only runes that exist
      expect(prompt).toContain('不要用胜负倒推')
      expect(prompt).toContain('符文只从「符文一览」里选')
      expect(prompt).toContain('说明里的「若干」「一定比例」是客户端没有给出数字的地方')
      expect(prompt).toContain('资料写明没有统计时，不要谈使用率和胜率')
      expect(prompt).toContain('「前三件成装」「单件装备」的胜率天然偏高')
      // an item outside the document may be named, but as a memory
      expect(prompt).toContain('要说明它的效果是凭你的记忆、可能和现在的版本不一样')
      // a trade-off is stated as one
      expect(prompt).toContain('两个选择各有道理时照实说')
    }
  })

  it('asks the first answer to go through every rune, both spells and the build', () => {
    for (const prompt of [chinese, english]) {
      expect(prompt).toContain('5. 符文、召唤师技能和出装，按上一节的方法写')
      // every rune gets a verdict; the ones that are fine may share a line
      expect(prompt).toContain('基石、主系的三颗、副系的两颗，每一颗都要有结论')
      expect(prompt).toContain('没问题的几颗可以并在一行里一起说')
      expect(prompt).toContain('召唤师技能：两个各一两句')
      // the full setup is written out only when something changes
      expect(prompt).toContain('下次遇到这个对位和类似阵容时的完整带法')
      expect(prompt).toContain('没有要改的，说一句照现在这样带就行')
    }
  })

  it('keeps a verdict from claiming more than the document can carry', () => {
    // From the second try-out: asked for a swap per rune and a comparison per spell, the model
    // offered an estimate as if it were measured and took "used four times" for "right to take".
    for (const prompt of [chinese, english]) {
      expect(prompt).toContain('估计就写成估计')
      expect(prompt).toContain('使用次数只说明用了没有，说明不了带得对不对')
      expect(prompt).toContain(
        '替代选择在这个对位确实有道理时，讲清两者各自赌的是什么；没有就一句话说没问题'
      )
      expect(prompt).toContain('属性碎片资料里只有名字和效果，没有结算数字')
      expect(prompt).toContain('只把有把握的改动写进去')
    }
  })

  it('says who is asking when the game belongs to someone else', () => {
    const other = buildReviewCoachSystemPrompt({ language: 'zh-CN', self: false })

    expect(other).toContain('提问的人不一定是这位玩家本人')
    expect(chinese).not.toContain('提问的人不一定是这位玩家本人')
  })

  it('is the same text every time, so follow-ups reuse the cached prefix', () => {
    expect(buildReviewCoachSystemPrompt({ language: 'zh-CN', self: true })).toBe(chinese)
  })
})

describe('normalizeReviewCoachText', () => {
  it('trims and cuts what was typed', () => {
    expect(normalizeReviewCoachText('  为什么中期崩了？\n', 100)).toBe('为什么中期崩了？')
    expect(normalizeReviewCoachText('一二三四五六', 4)).toBe('一二三四')
    expect(normalizeReviewCoachText('ab   cd', 4)).toBe('ab')
  })

  it('has nothing for blanks and for values that are not text', () => {
    expect(normalizeReviewCoachText('   \n ', 100)).toBe('')
    expect(normalizeReviewCoachText(undefined, 100)).toBe('')
    expect(normalizeReviewCoachText(42, 100)).toBe('')
  })
})

describe('buildReviewCoachFirstMessage', () => {
  const document = '# 对局概况\n中单，胜利。\n\n# 阵亡\n12:30 在河道阵亡。'

  it('puts the document first and the request after it', () => {
    const message = buildReviewCoachFirstMessage(`\n${document}\n\n`)

    expect(message).toBe(`<对局资料>\n${document}\n</对局资料>\n\n请根据上面的资料复盘这一局。`)
  })

  it('adds what the player wants to know and keeps it short', () => {
    expect(buildReviewCoachFirstMessage(document, '  中期为什么崩了？ ')).toBe(
      `<对局资料>\n${document}\n</对局资料>\n\n请根据上面的资料复盘这一局。\n\n我特别想了解：中期为什么崩了？`
    )
    expect(buildReviewCoachFirstMessage(document, '   ')).toBe(
      buildReviewCoachFirstMessage(document)
    )

    const long = buildReviewCoachFirstMessage(document, '问'.repeat(1000))
    expect(parseReviewCoachFirstMessage(long).focus).toHaveLength(REVIEW_COACH_MAX_FOCUS_LENGTH)
  })

  it('can be taken apart again for showing what was sent', () => {
    expect(parseReviewCoachFirstMessage(buildReviewCoachFirstMessage(document))).toEqual({
      document,
      focus: ''
    })
    expect(
      parseReviewCoachFirstMessage(buildReviewCoachFirstMessage(document, '出装顺序\n对不对'))
    ).toEqual({ document, focus: '出装顺序\n对不对' })
  })

  it('shows a message of another shape as it is', () => {
    expect(parseReviewCoachFirstMessage('随便一段话')).toEqual({
      document: '随便一段话',
      focus: ''
    })
  })
})
