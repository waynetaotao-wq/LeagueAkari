import { describe, expect, it } from 'vitest'

import {
  collectReviewCoachTimes,
  readReviewCoachTime,
  renderReviewCoachMarkdown
} from './coach-markdown'

const render = (text: string, durationMs?: number) =>
  renderReviewCoachMarkdown(text, { durationMs })
const times = (html: string) =>
  [...html.matchAll(/data-coach-time="(\d+)"[^>]*>([^<]*)</g)].map((match) => [
    Number(match[1]),
    match[2]
  ])

describe('renderReviewCoachMarkdown', () => {
  it('keeps the layout a coach uses', () => {
    const html = render('## 关键时刻\n\n1. **12:30** 河道阵亡\n2. 回城太晚\n\n- 做得好')

    expect(html).toContain('<h2>关键时刻</h2>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<strong>')
    expect(html).toContain('<ul>')
  })

  it('keeps single line breaks, as the answer is written line by line', () => {
    expect(render('第一行\n第二行')).toContain('第一行<br>')
  })

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an image tag with a handler', '<img src=x onerror="alert(1)">'],
    ['an inline frame', '前面 <iframe src="https://example.com"></iframe> 后面'],
    ['a styled block', '<div style="position:fixed">盖住界面</div>']
  ])('never turns %s written by the model into a tag', (_, text) => {
    const html = render(text)

    expect(html).not.toMatch(/<(script|img|iframe|div)\b/i)
    expect(html).toContain('&lt;')
  })

  it.each([
    ['a link', '[点这里](https://example.com/track)'],
    ['an image', '![图](https://example.com/pixel.png)'],
    ['a bare address', '看 <https://example.com> 和 https://example.com'],
    ['a script address', '[x](javascript:alert(1))']
  ])('leaves %s as plain text', (_, text) => {
    const html = render(text)

    expect(html).not.toMatch(/<a\b/i)
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/href=|src=/i)
  })

  it('turns game times into buttons that carry the moment', () => {
    const html = render('你在 3:05 第一次回城，12:30 在河道阵亡，到 31:47 结束。', 32 * 60_000)

    expect(times(html)).toEqual([
      [185_000, '3:05'],
      [750_000, '12:30'],
      [1_907_000, '31:47']
    ])
    expect(html).toContain('<button type="button" class="coach-time"')
  })

  it('accepts both ends of a range and the full-width colon', () => {
    expect(times(render('12:30–13:10 的团战，以及 18：05 的小龙', 30 * 60_000))).toEqual([
      [750_000, '12:30'],
      [790_000, '13:10'],
      [1_085_000, '18：05']
    ])
  })

  it.each([
    ['a time after the end of the game', '45:10'],
    ['a time with hours', '1:02:30'],
    ['seconds that do not exist', '12:75'],
    ['a ratio', '比分 3:2'],
    ['a decimal next to it', '1.12:30'],
    ['a longer number', '2026:11']
  ])('does not treat %s as a moment of the game', (_, text) => {
    expect(times(render(`这里写着 ${text} 。`, 30 * 60_000))).toEqual([])
  })

  it('marks every time when the length of the game is unknown', () => {
    expect(times(render('45:10 的团战'))).toEqual([[2_710_000, '45:10']])
  })

  it('leaves times inside code alone', () => {
    expect(times(render('`12:30` 和\n\n```\n12:30\n```', 30 * 60_000))).toEqual([])
  })

  it('finds times inside bold text and list items', () => {
    expect(times(render('- **12:30**：河道阵亡\n- 之后 14:02 丢塔', 30 * 60_000))).toEqual([
      [750_000, '12:30'],
      [842_000, '14:02']
    ])
  })

  it('renders an unfinished answer without failing', () => {
    expect(() => render('## 关键时刻\n\n1. **12:3')).not.toThrow()
    expect(render('')).toBe('')
  })

  it('marks a time the document does not mention, and still lets it be clicked', () => {
    const knownTimes = collectReviewCoachTimes('9:30 中路己方半场：阿狸击杀。\n10:00｜本人 4100金')
    const html = renderReviewCoachMarkdown('你在 9:30 阵亡，10:00 丢了小龙，大约 9:45 复活。', {
      durationMs: 30 * 60_000,
      knownTimes,
      unknownTimeTitle: '资料里没有 "这个" 时刻'
    })

    expect(times(html)).toEqual([
      [570_000, '9:30'],
      [600_000, '10:00'],
      [585_000, '9:45']
    ])
    expect(html).toContain(
      '<button type="button" class="coach-time" data-coach-time="570000">9:30<'
    )
    expect(html).toContain(
      '<button type="button" class="coach-time coach-time-unknown" data-coach-time="585000" title="资料里没有 &quot;这个&quot; 时刻">9:45<'
    )
    expect(html.match(/coach-time-unknown/g)).toHaveLength(1)
  })

  it('marks nothing when it is not told which times the document has', () => {
    expect(render('大约 9:45 复活。', 30 * 60_000)).not.toContain('coach-time-unknown')
  })
})

describe('collectReviewCoachTimes', () => {
  it('collects every game time of a text in seconds', () => {
    expect([
      ...collectReviewCoachTimes('4:06 中路：击杀。成装完成时间：电涌环剑 9:52；第 3 场 8:04–8:38')
    ]).toEqual([246, 592, 484, 518])
  })

  it('skips what only looks like a time', () => {
    expect(collectReviewCoachTimes('比分 3:2，版本 16.23，血744/744，1.12:30').size).toBe(0)
  })
})

describe('readReviewCoachTime', () => {
  const element = (value: string | null) => ({
    closest: (selector: string) =>
      selector === '[data-coach-time]' && value !== null ? { getAttribute: () => value } : null
  })

  it('reads the moment from a click on a time', () => {
    expect(readReviewCoachTime(element('750000') as never)).toBe(750_000)
    expect(readReviewCoachTime(element('0') as never)).toBe(0)
  })

  it('has nothing for a click anywhere else', () => {
    expect(readReviewCoachTime(element(null) as never)).toBeNull()
    expect(readReviewCoachTime(element('abc') as never)).toBeNull()
    expect(readReviewCoachTime(element('-5') as never)).toBeNull()
    expect(readReviewCoachTime(null)).toBeNull()
    expect(readReviewCoachTime({} as never)).toBeNull()
  })
})
