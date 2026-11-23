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

  it('asks for the answer in the language of the interface', () => {
    expect(chinese).toContain('用简体中文回答')
    expect(chinese).toContain('600 到 900 个汉字')
    expect(chinese).not.toContain('Answer in English')
    expect(english).toContain('Answer in English')
    expect(english).toContain('350 到 500 个英文单词')
    expect(english).not.toContain('用简体中文回答')
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
