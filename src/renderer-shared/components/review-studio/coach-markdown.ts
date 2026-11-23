import MarkdownIt from 'markdown-it'

// [lolps] AI 教练回答的渲染。
// 回答是模型写的文字，不能当成可信的 HTML：这里用一份单独的解析器，不解析 HTML、不生成链接
// 和图片，只保留标题、加粗、列表这些排版。回答里的游戏时间（如 12:30）变成可以点的按钮。

/** 12:30 这样的游戏时间；前后紧挨着数字、冒号或小数点的不算（比分、带小时的时间等）。 */
const GAME_TIME_PATTERN = /(?<![\d:.：])(\d{1,3})[:：]([0-5]\d)(?![\d:：])/g

interface CoachMarkdownEnvironment {
  /** Times after the end of the game are left as plain text. */
  durationMs?: number
}

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })
markdown.disable(['link', 'image', 'autolink', 'html_inline', 'html_block'])

markdown.core.ruler.push('coach_game_time', (state) => {
  const durationMs = (state.env as CoachMarkdownEnvironment).durationMs
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue

    const children: typeof block.children = []
    for (const token of block.children) {
      if (token.type !== 'text') {
        children.push(token)
        continue
      }

      let last = 0
      for (const match of token.content.matchAll(GAME_TIME_PATTERN)) {
        const milliseconds = (Number(match[1]) * 60 + Number(match[2])) * 1000
        if (durationMs !== undefined && milliseconds > durationMs) continue

        if (match.index > last) {
          const before = new state.Token('text', '', 0)
          before.content = token.content.slice(last, match.index)
          children.push(before)
        }
        const time = new state.Token('coach_game_time', '', 0)
        time.content = match[0]
        time.meta = { milliseconds }
        children.push(time)
        last = match.index + match[0].length
      }

      if (last === 0) {
        children.push(token)
      } else if (last < token.content.length) {
        const after = new state.Token('text', '', 0)
        after.content = token.content.slice(last)
        children.push(after)
      }
    }
    block.children = children
  }
})

markdown.renderer.rules.coach_game_time = (tokens, index) => {
  const token = tokens[index]
  const milliseconds = Number(token.meta?.milliseconds)
  return `<button type="button" class="coach-time" data-coach-time="${milliseconds}">${markdown.utils.escapeHtml(token.content)}</button>`
}

/**
 * Turns an answer into HTML that is safe to insert: nothing the model writes can become a tag,
 * a link or an image.
 */
export function renderReviewCoachMarkdown(text: string, options: { durationMs?: number } = {}) {
  return markdown.render(text, {
    durationMs: options.durationMs
  } satisfies CoachMarkdownEnvironment)
}

/** The game time behind a click inside a rendered answer; null when it was not on a time. */
export function readReviewCoachTime(target: EventTarget | null): number | null {
  const element =
    target && typeof (target as Element).closest === 'function'
      ? (target as Element).closest('[data-coach-time]')
      : null
  const value = Number(element?.getAttribute('data-coach-time'))
  return element && Number.isFinite(value) && value >= 0 ? value : null
}
