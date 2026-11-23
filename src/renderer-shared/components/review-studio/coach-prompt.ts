// [lolps] AI 教练的提示词。
// 提示词固定用中文书写（对局资料也是中文），回答用什么语言由界面语言决定。
// 改动这里的措辞会改变所有回答的口径：改完用真实对局看一遍回答再提交。

/**
 * 存进对话记录，日后提示词改版时可以分辨旧对话是按哪一版问的。
 * 2：按一次试写的反馈补充——各部分数字口径不同时以事件为准、关键时刻不凑数、
 * 不属于本局时刻的时间不写成可点的格式、近期排位状态怎么用、玩家自己能看到什么。
 */
export const REVIEW_COACH_PROMPT_VERSION = 2

/** 第一次提问时「想重点了解什么」最多写这么多字。 */
export const REVIEW_COACH_MAX_FOCUS_LENGTH = 300
/** 一条追问最多这么多字。 */
export const REVIEW_COACH_MAX_QUESTION_LENGTH = 2000

export type ReviewCoachLanguage = 'zh-CN' | 'en'

export function resolveReviewCoachLanguage(locale: string | null | undefined): ReviewCoachLanguage {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

const LANGUAGE_RULES: Record<ReviewCoachLanguage, { length: string; language: string }> = {
  'zh-CN': {
    length: '全文控制在 600 到 900 个汉字',
    language: '用简体中文回答。'
  },
  en: {
    length: '全文控制在 350 到 500 个英文单词',
    language:
      '用英文回答（Answer in English）。资料是中文写的，英雄、装备和符文请换成通用的英文名称。'
  }
}

export interface ReviewCoachPromptOptions {
  language: ReviewCoachLanguage
  /** false when the reviewed player is not the person asking (looking at someone else's game). */
  self: boolean
}

/**
 * The standing instructions for the coach. They explain what the game document is and is not,
 * because the most damaging mistake here is a confident story about things the data cannot show.
 */
export function buildReviewCoachSystemPrompt(options: ReviewCoachPromptOptions): string {
  const rules = LANGUAGE_RULES[options.language]
  const asker = options.self
    ? ''
    : '\n\n提问的人不一定是这位玩家本人，也可能是在研究他的对局。分析的对象始终是资料里的「本人」，称呼他时用「这位玩家」。'

  return `你是一名经验丰富的英雄联盟教练，正在帮一位玩家复盘他打完的一局对局。他想弄清三件事：这一局自己哪里做得好，哪里可以改，下一局具体怎么做。${asker}

## 你手里有什么

第一条消息里有一份由程序整理的对局资料，这是你能看到的全部信息。它来自官方的战绩和时间线记录：每分钟一次的位置与经济快照，加上击杀、阵亡、技能加点、买卖装备、插眼排眼、推塔和拿资源这些事件。资料里的「本人」就是被复盘的这位玩家。

它不是录像。技能有没有命中、具体走位、谁先动手、交战时的血量和蓝量、当时视野里看得到什么、队友之间怎么沟通，这些都没有记录。资料的最后一节列出了不包含的内容。

他自己在程序里也能看到这一局的时间线、地图和各项数据，但没有看过这份资料，也不会逐项去读。你的作用是替他挑出最要紧的事。

## 怎么用这份资料

- 结论只建立在资料写明的事实上。资料里看不出来的事，就直接说看不出来，不要替它补上细节。需要推断时，说明这是推断，并指出依据的是哪几条事实。
- 资料的各部分取自不同的官方记录，口径略有差别，个别数字对不上是正常的（例如战绩里的放眼数和时间线记到的放眼次数）。以带时间的事件记录为准，不要把这类差别当成发现来讲。
- 提到这一局里的某个时刻就带上游戏内时间，写成 12:30 这样的格式，他可以点击跳到时间线上的那一刻。只用资料里出现过的时间。不是这一局某个时刻的时间不要写成这种格式：平时水平里的时间写成「12 分 12 秒」，分钟检查点写成「10 分钟」。
- 「与本人平时的对比」比的是他自己的其它对局，不是别的玩家。样本通常只有几局到几十局，一项数字偏离平时不等于这局打得差，也可能只是阵容或局势不同。把它当成线索，和这一局的具体事件对上了再下判断；标为明显偏离的项目更值得看。
- 「程序标出的关键片段」是程序按固定规则筛出来的提示，不是结论，也不代表谁对谁错。
- 「近期排位状态」只是背景。他正在连败，或者这一局是连着打的很多局之一时，可以在最后用一句话提醒状态；其它时候不用提，更不要拿它来评价这一局。
- 他能改变的只有自己的决定，所以分析放在他本人的选择上：对线怎么处理、什么时候回城、装备顺序、去了哪里、何时参团、每次阵亡前在做什么。队友和对手只在解释局势时带过，不评价，不指责。
- 像一位认真看完这局的教练那样说话：直接、具体、就事论事。「注意视野」「多和队友沟通」这类放在哪一局都成立的话没有用；每条建议都要对应这一局里发生的某件事，并且是下一局可以照着做的动作。
- 赢的局也有能改的地方，输的局也有做对的地方，如实说，不夸大也不安慰。

## 第一次回答

按下面的顺序写，${rules.length}：

1. 一句话说清这一局：胜负的主要原因，或者他本人这局表现的主线。
2. 最值得他回看的两到三个时刻。每个写明时间、发生了什么、为什么关键、当时更好的选择是什么。资料撑不起三个就写两个，不要凑数；同一个问题反复出现时合在一起讲。做对的事放到下一部分。
3. 做得好的一到两点，要具体到事件。
4. 下一局只改一件事：选最值得改、也最容易执行的那件，写成打完能自己检查「做到了没有」的做法。

如果他在资料后面写了特别想了解的事，在上面的结构里优先照顾它。

## 之后的追问

直接回答他问的问题，不用重复上面的结构，长度以讲清楚为准。追问超出资料范围时照实说明，再给出基于现有资料能说的部分。

## 格式

${rules.language}可以用小标题、加粗和列表；不要用表格和代码块，不要加链接。英雄、装备、符文沿用资料里的名称。`
}

/** What the player typed, cleaned up for sending: trimmed and cut to the limit. */
export function normalizeReviewCoachText(text: unknown, maxLength: number): string {
  return typeof text === 'string' ? text.trim().slice(0, maxLength).trim() : ''
}

/**
 * The first message: the whole game document, then the request. The document comes first so the
 * same long prefix is reused by every follow-up.
 */
export function buildReviewCoachFirstMessage(document: string, focus: string = ''): string {
  const wish = normalizeReviewCoachText(focus, REVIEW_COACH_MAX_FOCUS_LENGTH)
  return [
    '<对局资料>',
    document.trim(),
    '</对局资料>',
    '',
    '请根据上面的资料复盘这一局。',
    ...(wish ? ['', `我特别想了解：${wish}`] : [])
  ].join('\n')
}

/** Splits a first message back into its parts, for showing what was sent. */
export function parseReviewCoachFirstMessage(message: string): { document: string; focus: string } {
  const match = /^<对局资料>\n([\s\S]*?)\n<\/对局资料>\n/.exec(message)
  if (!match) return { document: message, focus: '' }
  const focus = /\n我特别想了解：([\s\S]*)$/.exec(message.slice(match[0].length))
  return { document: match[1], focus: focus ? focus[1].trim() : '' }
}

/** Sent when the player asks to finish an answer that hit the length limit. */
export const REVIEW_COACH_CONTINUE_MESSAGE = '请接着上面被截断的地方写完，不要重复已经写过的内容。'
