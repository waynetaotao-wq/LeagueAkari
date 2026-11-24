// [lolps] 客户端里符文、装备、召唤师技能的说明是带标签的富文本，这里把它整理成纯文字，
// 交给 AI 教练读。只做去标签和整理，不改写意思；客户端没给出的数值（随等级或属性变化的那些
// 在文本里是 0 或占位符）一律写成「若干」，不让它被当成真的 0。

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'"
}

/** 文末单独成行的斜体是背景故事里的引语，不是效果。 */
const TRAILING_QUOTE = /(?:\s*<(?:br|hr)\s*\/?>)+\s*<i>(?:(?!<\/i>)[\s\S])*<\/i>\s*$/i
const FLAVOR_BLOCK = /<flavorText>[\s\S]*?<\/flavorText>/gi
const STATS_BLOCK = /<stats>([\s\S]*?)<\/stats>/i
const LINE_BREAK = /<(?:br|hr)\s*\/?>/gi
const PLACEHOLDER = /@[^@\s<>]+@|\{\{[^{}]*\}\}/g
/** 图标的占位，例如「%i:OnHit%」：界面上是一个小图标，文字里什么都不代表。 */
const ICON_MARK = /%i:[A-Za-z0-9_]+%/g
/**
 * 近战和远程数值不同的地方，客户端写成「[6%近战 || 4%远程]」（实测 16.23：致命节奏、爆破）。
 * 去掉方括号，两个数之间换成斜线。
 */
const EITHER_OR = /\[([^[\]|]*?)\s*\|\|\s*([^[\]|]*?)\]/g
/** 这个数客户端没有给出。 */
export const REVIEW_UNKNOWN_AMOUNT = '若干'

function tidy(text: string) {
  return text
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。；：、）])/g, '$1')
    .replace(/([（])\s+/g, '$1')
    .trim()
}

/** Rich text of the client as one line of plain text. */
export function plainGameText(html: unknown): string {
  if (typeof html !== 'string') return ''
  return tidy(
    html
      .replace(FLAVOR_BLOCK, ' ')
      .replace(TRAILING_QUOTE, ' ')
      .replace(/<li\s*\/?>/gi, ' • ')
      .replace(LINE_BREAK, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(ICON_MARK, '')
      .replace(EITHER_OR, '$1／$2')
      .replace(PLACEHOLDER, REVIEW_UNKNOWN_AMOUNT)
  )
}

/**
 * 装备说明里随等级或属性变化的数，客户端给的是 0：「获得0移动速度」「（0秒）」。单独的 0
 * 不会是真的数值，换成「若干」；「0-30%」这种后面跟着非零数的范围是真的，保留。
 */
function hideUnknownAmounts(text: string) {
  return (
    text
      .replace(/（\s*0\s*秒\s*）/g, '')
      .replace(/(?<![\d.])0(?![\d.])(?!\s*[-–~至]\s*[1-9])\s*%/g, '一定比例')
      .replace(/(?<![\d.])0(?![\d.])(?!\s*[-–~至]\s*[1-9])/g, REVIEW_UNKNOWN_AMOUNT)
      // 有的地方客户端连 0 都没给，只剩一个百分号：「造成%目标当前生命值的伤害」。
      .replace(/(?<![\d%])%/g, '一定比例')
  )
}

export interface ReviewItemText {
  /** The item's plain stats, e.g. 「55 物理攻击」. */
  stats: string[]
  /** What its passives and actives do; empty for an item that only gives stats. */
  effects: string
}

/** An item description split into its stat lines and the text of its effects. */
export function readItemText(html: unknown): ReviewItemText {
  if (typeof html !== 'string') return { stats: [], effects: '' }
  const stats = (STATS_BLOCK.exec(html)?.[1] ?? '')
    .split(LINE_BREAK)
    .map((line) => plainGameText(line))
    .filter(Boolean)
  const effects = html
    .replace(STATS_BLOCK, ' ')
    .replace(FLAVOR_BLOCK, ' ')
    // 先去掉只管颜色的标签，剩下名字、换行这些结构，才认得出下面的写法。
    .replace(/<(?!\/?(?:passive|active|br|hr|li)\b)[^>]*>/gi, '')
    // 被动、主动的名字单独占一行（后面可能跟一个写冷却的括号），再往下才是说明：
    // 接成「名字（冷却）：说明」。
    .replace(/<\/(passive|active)>\s*((?:（[^（）]*）)?)\s*(?:<br\s*\/?>\s*)+/gi, '</$1>$2：')
  return { stats, effects: tidy(hideUnknownAmounts(plainGameText(effects))) }
}

/**
 * 结算说明里的一个量，三种写法，按这个顺序认：
 * 「分:十位个位」（秒拆成两个变量）、「分:秒」（秒是一个变量）、单独一个数。
 */
const STAT_PART =
  /@eogvar([123])@\s*[:：]\s*@eogvar([123])@@eogvar([123])@|@eogvar([123])@\s*[:：]\s*@eogvar([123])@|@eogvar([123])@/g

/**
 * 符文的结算数字：战绩给每颗符文记三个数，客户端的结算说明（如「已造成伤害合计：@eogvar1@」）
 * 说明每个数是什么。这里把数填进说明里。
 *
 * 实测 16.23（63 颗符文、280 个视角）有三种写法要单独处理：
 * - 「@eogvar1@:@eogvar2@」是时间，秒只记到十位（0、10…50），填进去要补成两位；
 * - 「@eogvar1@:@eogvar2@@eogvar3@」同样是时间，秒的十位和个位分开记；
 * - 致命节奏的说明把同一个数既当秒又当伤害用，那一行时间是错的：同一个变量在别处被当作
 *   普通数值时，含它的时间行不要。
 * 说明是「--」或者没有说明的符文，没有结算数字。
 */
export interface ReviewRuneStat {
  /** The label with the numbers filled in, e.g. 「已造成伤害合计：2782」. */
  text: string
  /**
   * The one quantity the line carries, so that games can be compared: a plain number, or a
   * time in seconds. null for a line that carries two quantities at once.
   */
  amount: { value: number; unit: 'number' | 'seconds' } | null
  /** The label around that quantity, to write another value of the same kind into it. */
  around: readonly [string, string]
}

export function readRuneStats(templates: unknown, values: readonly number[]): ReviewRuneStat[] {
  if (!Array.isArray(templates)) return []
  const value = (index: string) => {
    const number = values[Number(index) - 1]
    return typeof number === 'number' && Number.isFinite(number) ? number : 0
  }
  const lines = templates
    .flatMap((template) => (typeof template === 'string' ? template.split(LINE_BREAK) : []))
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter((line) => line.includes('@eogvar'))

  // 被当作普通数值用到的变量：在不属于任何时间写法的位置出现过。
  const plainlyUsed = new Set<string>()
  for (const line of lines)
    for (const part of line.matchAll(STAT_PART)) if (part[6]) plainlyUsed.add(part[6])

  return lines.flatMap((line) => {
    // 从左到右把每个量换成它的写法；记下这一行一共有几个量，以及第一个量前后的文字。
    const amounts: Array<{ value: number; unit: 'number' | 'seconds' }> = []
    const around: [string, string] = ['', '']
    let filled = ''
    let last = 0
    for (const part of line.matchAll(STAT_PART)) {
      const [whole, minutes, tens, ones, clockMinutes, clockSeconds, plain] = part
      let written: string
      if (plain) {
        amounts.push({ value: value(plain), unit: 'number' })
        written = String(value(plain))
      } else {
        const seconds = minutes ? value(tens) * 10 + value(ones) : value(clockSeconds)
        const wholeMinutes = value(minutes ?? clockMinutes)
        // 秒超过 59，或者同一个变量在别处被当作普通数值：这不是一个时间，整行不要。
        if (
          seconds > 59 ||
          (!minutes && (plainlyUsed.has(clockSeconds) || plainlyUsed.has(clockMinutes)))
        )
          return []
        amounts.push({ value: wholeMinutes * 60 + seconds, unit: 'seconds' })
        written = `${wholeMinutes}:${String(seconds).padStart(2, '0')}`
      }
      const before = line.slice(last, part.index)
      if (amounts.length === 1) around[0] = filled + before
      else around[1] += before + written
      filled += before + written
      last = part.index + whole.length
    }
    filled += line.slice(last)
    around[1] += line.slice(last)
    return [
      {
        text: tidy(filled),
        amount: amounts.length === 1 ? amounts[0] : null,
        around
      }
    ]
  })
}

/** The recorded numbers of a rune, one filled-in label per line. */
export function formatRuneStats(templates: unknown, values: readonly number[]): string[] {
  return readRuneStats(templates, values).map((stat) => stat.text)
}

/**
 * Writes another value into the label of a stat, for a typical value across games. A time is
 * written as 「14 分 20 秒」 on purpose: it is not a moment of the reviewed game.
 */
export function formatRuneStatAmount(stat: ReviewRuneStat, value: number): string | null {
  if (!stat.amount) return null
  const rounded = Math.round(value)
  const written =
    stat.amount.unit === 'seconds'
      ? `${Math.floor(rounded / 60)} 分 ${rounded % 60} 秒`
      : String(rounded)
  return tidy(`${stat.around[0]}${written}${stat.around[1]}`)
}
