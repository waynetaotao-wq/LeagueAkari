<template>
  <div class="coach-view">
    <NEmpty v-if="!context" :description="t('report.unavailable')" />
    <template v-else>
      <div class="coach-toolbar">
        <NText depth="3" class="text-xs">{{ t('coach.hint') }}</NText>
        <div class="coach-toolbar-actions">
          <NButton size="tiny" quaternary @click="showDocument = true">{{
            t('coach.viewDocument')
          }}</NButton>
          <NButton
            v-if="configured"
            size="tiny"
            quaternary
            :type="showSetup ? 'primary' : 'default'"
            @click="showSetup = !showSetup"
            >{{ t('coach.settings') }}</NButton
          >
        </div>
      </div>

      <ReviewCoachSetup v-if="showSetup || !configured" @done="showSetup = false" />

      <template v-if="configured && !showSetup">
        <div v-if="!conversation.loaded" class="coach-waiting"><NSpin size="small" /></div>

        <!-- 还没有对话：说明会发送什么，点一下开始 -->
        <div v-else-if="!conversation.messages.length" class="coach-start">
          <NText strong>{{ t('coach.start.title') }}</NText>
          <ul class="coach-facts">
            <li>{{ t('coach.start.size', { chars: context.text.length.toLocaleString() }) }}</li>
            <li>
              {{
                baseline
                  ? t('coach.start.baseline', { games: baseline.games })
                  : t('coach.start.noBaseline', { count: REVIEW_BASELINE_MIN_GAMES })
              }}
            </li>
            <li>
              {{
                t(
                  form
                    ? 'coach.start.form'
                    : self
                      ? 'coach.start.noForm'
                      : 'coach.start.noFormOther'
                )
              }}
            </li>
            <li v-if="tips.length">{{ t('coach.start.tips') }}</li>
            <li>
              {{
                t(
                  catalogue
                    ? kitsReady
                      ? 'coach.start.loadoutKits'
                      : 'coach.start.loadout'
                    : 'coach.start.noLoadout'
                )
              }}
            </li>
            <li>{{ statisticsText }}</li>
            <li>
              {{
                history
                  ? t('coach.start.history', { games: history.champion.games })
                  : t('coach.start.noHistory')
              }}
            </li>
          </ul>
          <NText depth="3" class="text-xs">{{ t('coach.start.privacy') }}</NText>
          <NInput
            v-model:value="focus"
            type="textarea"
            size="small"
            :autosize="{ minRows: 1, maxRows: 3 }"
            :maxlength="REVIEW_COACH_MAX_FOCUS_LENGTH"
            :placeholder="t('coach.start.focusPlaceholder')"
          />
          <div class="coach-start-actions">
            <NButton
              type="primary"
              :disabled="busyElsewhere || waitingForStatistics"
              @click="start"
              >{{ t('coach.start.action') }}</NButton
            >
            <NText depth="3" class="text-xs">{{
              t(
                busyElsewhere
                  ? 'coach.start.busy'
                  : waitingForStatistics
                    ? 'coach.start.waitStatistics'
                    : 'coach.start.model',
                { model: modelName }
              )
            }}</NText>
          </div>
        </div>

        <!-- 对话 -->
        <div v-else class="coach-thread" @click="onThreadClick">
          <div class="coach-sent">
            <NTag size="small" :bordered="false">{{ t('coach.sent') }}</NTag>
            <NText v-if="sentFocus" depth="3" class="text-xs">{{
              t('coach.focus', { text: sentFocus })
            }}</NText>
          </div>

          <template v-for="(turn, index) in turns" :key="index">
            <div v-if="turn.role === 'user'" class="coach-question">{{ turn.content }}</div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="coach-answer" v-html="turn.html" />
          </template>

          <div v-if="conversation.streaming || pendingHtml" ref="pendingRoot" class="coach-pending">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="pendingHtml" class="coach-answer" v-html="pendingHtml" />
            <div v-if="conversation.streaming" class="coach-status">
              <NSpin :size="14" />
              <NText depth="3" class="text-xs">{{
                t(
                  conversation.pendingText
                    ? 'coach.writing'
                    : answered
                      ? 'coach.thinkingFollowUp'
                      : 'coach.thinking'
                )
              }}</NText>
            </div>
          </div>

          <NAlert
            v-if="conversation.error"
            :type="conversation.error.code === 'cancelled' ? 'info' : 'warning'"
            :show-icon="false"
          >
            <div class="coach-alert">
              <div>
                <div>{{ t(`coach.errors.${conversation.error.code}`) }}</div>
                <div v-if="conversation.error.message" class="coach-alert-detail">
                  {{ t('coach.detail', { message: conversation.error.message }) }}
                </div>
              </div>
              <div class="coach-alert-actions">
                <NButton
                  size="tiny"
                  type="primary"
                  :disabled="busyElsewhere"
                  @click="coach.retry()"
                  >{{ t('coach.retry') }}</NButton
                >
                <NButton v-if="needsSetup" size="tiny" secondary @click="showSetup = true">{{
                  t('coach.openSettings')
                }}</NButton>
                <NButton v-if="!answered" size="tiny" quaternary @click="coach.restore()">{{
                  t('coach.back')
                }}</NButton>
              </div>
            </div>
          </NAlert>

          <NAlert
            v-else-if="conversation.incomplete && !conversation.streaming"
            type="info"
            :show-icon="false"
          >
            <div class="coach-alert">
              <div>{{ t(`coach.incomplete.${conversation.incomplete}`) }}</div>
              <NButton
                v-if="canAsk"
                size="tiny"
                type="primary"
                :disabled="busyElsewhere"
                @click="coach.continueAnswer()"
                >{{ t('coach.continue') }}</NButton
              >
            </div>
          </NAlert>

          <div v-if="answered" class="coach-composer">
            <div v-if="showQuickQuestions" class="coach-quick">
              <NButton
                v-for="key in QUICK_QUESTIONS"
                :key="key"
                size="tiny"
                secondary
                round
                :disabled="busyElsewhere"
                @click="ask(t(`coach.quick.${key}`))"
                >{{ t(`coach.quick.${key}`) }}</NButton
              >
            </div>
            <NText v-if="!canAsk" depth="3" class="text-xs">{{ t('coach.full') }}</NText>
            <div v-else class="coach-input">
              <NInput
                v-model:value="question"
                type="textarea"
                size="small"
                :autosize="{ minRows: 1, maxRows: 4 }"
                :maxlength="REVIEW_COACH_MAX_QUESTION_LENGTH"
                :placeholder="t('coach.placeholder')"
                :disabled="conversation.streaming"
                @keydown="onQuestionKey"
              />
              <NButton v-if="conversation.streaming" size="small" secondary @click="coach.stop()">{{
                t('coach.stop')
              }}</NButton>
              <NButton
                v-else
                size="small"
                type="primary"
                :disabled="!question.trim() || busyElsewhere"
                @click="ask(question)"
                >{{ t('coach.send') }}</NButton
              >
            </div>
          </div>
          <div v-else-if="conversation.streaming" class="coach-input coach-input-end">
            <NButton size="small" secondary @click="coach.stop()">{{ t('coach.stop') }}</NButton>
          </div>

          <div class="coach-footer">
            <div class="coach-footer-notes">
              <NText v-if="conversation.saveFailed" type="warning" class="text-xs">{{
                t('coach.saveFailed')
              }}</NText>
              <NText v-if="usageText" depth="3" class="text-xs">{{ usageText }}</NText>
              <NText depth="3" class="text-xs">{{ t('coach.disclaimer') }}</NText>
            </div>
            <NPopconfirm
              v-if="answered && !conversation.streaming"
              :positive-text="t('coach.restartYes')"
              :negative-text="t('coach.restartNo')"
              @positive-click="restart"
            >
              <template #trigger>
                <NButton size="tiny" quaternary>{{ t('coach.restart') }}</NButton>
              </template>
              {{ t('coach.restartConfirm') }}
            </NPopconfirm>
          </div>
        </div>
      </template>
    </template>

    <NModal
      v-model:show="showDocument"
      preset="card"
      :title="t('coach.documentTitle')"
      style="width: min(820px, calc(100vw - 48px))"
    >
      <div class="coach-document">
        <NText depth="3" class="text-xs"
          >{{ t('coach.documentHint') }}
          {{ t(sentDocument === null ? 'coach.documentLive' : 'coach.documentSent') }}</NText
        >
        <pre class="coach-document-text">{{ sentDocument ?? context?.text }}</pre>
      </div>
    </NModal>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NEmpty, NInput, NModal, NPopconfirm, NSpin, NTag, NText } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'

import ReviewCoachSetup from './ReviewCoachSetup.vue'
import { REVIEW_BASELINE_MIN_GAMES } from './baseline'
import { describeReviewStatisticsScope } from './coach-loadout'
import {
  collectReviewCoachTimes,
  readReviewCoachTime,
  renderReviewCoachMarkdown
} from './coach-markdown'
import {
  REVIEW_COACH_MAX_FOCUS_LENGTH,
  REVIEW_COACH_MAX_QUESTION_LENGTH,
  parseReviewCoachFirstMessage
} from './coach-prompt'
import { canAskReviewCoach } from './coach-session'
import type { ReviewMatch } from './types'
import { useReviewCoach } from './use-review-coach'

// [lolps] AI 教练：把这一局的资料交给用户自己选的 AI 服务，流式显示回答，可以接着追问。
// 回答里的游戏时间可以点，跳到时间线上的那一刻。

const QUICK_QUESTIONS = ['laning', 'deaths', 'items', 'midgame', 'loadout'] as const
/** 这几类错误多半要回到接口设置里改。 */
const SETUP_ERRORS = new Set([
  'not-configured',
  'no-key',
  'auth',
  'permission',
  'billing',
  'not-found',
  'bad-request'
])

const props = defineProps<{
  model: ReviewMatch
  /** The same player's other games kept on this device. */
  archive: readonly ReviewMatch[]
  /** The coach view is on screen. */
  active: boolean
}>()
const emit = defineEmits<{ timeline: [timestamp: number] }>()
const { t, i18next } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })

const coach = useReviewCoach({
  model: () => props.model,
  archive: () => props.archive,
  active: () => props.active
})
const {
  self,
  conversation,
  busyElsewhere,
  context,
  baseline,
  form,
  tips,
  catalogue,
  kitsReady,
  kitsLoading,
  history,
  statistics,
  statisticsStatus,
  configured,
  modelName
} = coach

/**
 * The statistics and the champion ability texts arrive a moment after the view opens;
 * starting before would leave them out.
 */
const statisticsLoading = computed(() => statisticsStatus.value === 'loading')
const waitingForStatistics = computed(() => statisticsLoading.value || kitsLoading.value)
const statisticsText = computed(() => {
  const loaded = statistics.value
  if (!loaded)
    return t(statisticsLoading.value ? 'coach.start.statisticsLoading' : 'coach.start.noStatistics')
  // 地区和段位的中文叫法只在中文界面用；其它语言照原样显示来源的写法。
  return t(
    'coach.start.statistics',
    i18next.language?.toLowerCase().startsWith('zh')
      ? describeReviewStatisticsScope(loaded)
      : { region: loaded.region, tier: loaded.tier, patch: loaded.patch ?? '?' }
  )
})

const showSetup = ref(false)
const showDocument = ref(false)
const focus = ref('')
const question = ref('')
const pendingRoot = ref<HTMLElement | null>(null)

const durationMs = computed(() => props.model.meta.gameDuration * 1000)

/** The first message is the whole document; it is shown as a tag, not as a bubble. */
const firstMessage = computed(() => {
  const first = conversation.value.messages[0]
  return first ? parseReviewCoachFirstMessage(first.content) : null
})
const sentFocus = computed(() => firstMessage.value?.focus ?? '')
const sentDocument = computed(() => firstMessage.value?.document ?? null)
// 回答里出现、资料里却没有的时刻，多半是估的或者记错的：照样能点，但标出来。
// 逐分钟表里的「人头 12:12」是比分不是时间，先去掉。
const knownTimes = computed(() =>
  sentDocument.value === null
    ? undefined
    : collectReviewCoachTimes(sentDocument.value.replace(/人头 \d+:\d+/g, ''))
)
const render = (text: string) =>
  renderReviewCoachMarkdown(text, {
    durationMs: durationMs.value,
    knownTimes: knownTimes.value,
    unknownTimeTitle: t('coach.unknownTime')
  })
const turns = computed(() =>
  conversation.value.messages
    .slice(1)
    .map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content, html: '' }
        : { role: 'assistant' as const, content: message.content, html: render(message.content) }
    )
)
const pendingHtml = computed(() =>
  conversation.value.pendingText ? render(conversation.value.pendingText) : ''
)
/** At least one answer exists, so questions can follow. */
const answered = computed(() => conversation.value.messages.length >= 2)
const canAsk = computed(() => canAskReviewCoach(conversation.value))
const showQuickQuestions = computed(
  () =>
    canAsk.value &&
    !conversation.value.streaming &&
    !conversation.value.error &&
    conversation.value.messages.length === 2
)
const needsSetup = computed(
  () => !!conversation.value.error && SETUP_ERRORS.has(conversation.value.error.code)
)
const usageText = computed(() => {
  const { usage, model } = conversation.value
  if (!usage || !model || usage.inputTokens === null || usage.outputTokens === null) return ''
  const values = {
    model,
    input: usage.inputTokens.toLocaleString(),
    output: usage.outputTokens.toLocaleString(),
    cached: (usage.cachedInputTokens ?? 0).toLocaleString()
  }
  return t(usage.cachedInputTokens ? 'coach.usageCached' : 'coach.usage', values)
})

async function revealPending() {
  await nextTick()
  pendingRoot.value?.scrollIntoView({ block: 'nearest' })
}
function start() {
  void coach.start(focus.value)
  focus.value = ''
  void revealPending()
}
function ask(text: string) {
  if (!text.trim() || conversation.value.streaming) return
  void coach.ask(text)
  question.value = ''
  void revealPending()
}
async function restart() {
  await coach.reset()
}
function onQuestionKey(event: KeyboardEvent) {
  // 输入法选字时的回车不算发送。
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  ask(question.value)
}
function onThreadClick(event: MouseEvent) {
  const timestamp = readReviewCoachTime(event.target)
  if (timestamp !== null) emit('timeline', timestamp)
}

// 换了一局：输入框里没发出去的字不带过去。
watch(
  () => props.model.meta.gameId,
  () => {
    focus.value = ''
    question.value = ''
    showSetup.value = false
    showDocument.value = false
  }
)
</script>

<style scoped>
.coach-view,
.coach-start,
.coach-thread,
.coach-pending,
.coach-composer,
.coach-document {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.coach-view {
  gap: 16px;
}
.coach-toolbar,
.coach-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.coach-toolbar-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}
.coach-waiting {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}
.coach-start {
  gap: 12px;
  padding: 16px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 8px;
}
.coach-facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  list-style: disc;
}
.coach-start-actions,
.coach-sent,
.coach-status,
.coach-quick {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coach-thread {
  gap: 16px;
}
.coach-question {
  align-self: flex-end;
  max-width: min(560px, 85%);
  padding: 8px 12px;
  border-radius: 10px 10px 2px 10px;
  background: rgb(var(--la-card-tint-rgb) / 0.08);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.coach-pending,
.coach-composer {
  gap: 10px;
}
.coach-answer {
  max-width: 760px;
  font-size: 14px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.coach-answer :deep(h1),
.coach-answer :deep(h2),
.coach-answer :deep(h3),
.coach-answer :deep(h4) {
  margin: 18px 0 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}
.coach-answer :deep(h1:first-child),
.coach-answer :deep(h2:first-child),
.coach-answer :deep(h3:first-child),
.coach-answer :deep(p:first-child) {
  margin-top: 0;
}
.coach-answer :deep(p) {
  margin: 10px 0;
}
.coach-answer :deep(p:last-child),
.coach-answer :deep(ul:last-child),
.coach-answer :deep(ol:last-child) {
  margin-bottom: 0;
}
.coach-answer :deep(ul),
.coach-answer :deep(ol) {
  margin: 10px 0;
  padding-left: 22px;
}
.coach-answer :deep(ul) {
  list-style: disc;
}
.coach-answer :deep(ol) {
  list-style: decimal;
}
.coach-answer :deep(li) {
  margin: 6px 0;
}
.coach-answer :deep(li > p) {
  margin: 4px 0;
}
.coach-answer :deep(strong) {
  font-weight: 600;
}
.coach-answer :deep(blockquote) {
  margin: 10px 0;
  padding-left: 12px;
  border-left: 3px solid rgb(var(--la-card-border-rgb) / 0.2);
  opacity: 0.85;
}
.coach-answer :deep(hr) {
  margin: 16px 0;
  border: 0;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
}
.coach-answer :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgb(var(--la-card-tint-rgb) / 0.08);
  font-size: 13px;
}
.coach-answer :deep(pre) {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgb(var(--la-card-tint-rgb) / 0.06);
}
.coach-answer :deep(pre code) {
  padding: 0;
  background: none;
}
.coach-answer :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 13px;
}
.coach-answer :deep(th),
.coach-answer :deep(td) {
  padding: 6px 10px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
  text-align: left;
}
/* 回答里的游戏时间：点了跳到时间线 */
.coach-answer :deep(.coach-time) {
  padding: 0 5px;
  border: 0;
  border-radius: 4px;
  background: rgb(var(--la-card-tint-rgb) / 0.1);
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: pointer;
}
.coach-answer :deep(.coach-time:hover),
.coach-answer :deep(.coach-time:focus-visible) {
  background: rgb(var(--la-card-tint-rgb) / 0.2);
}
/* 资料里没有的时刻：换成波浪线，鼠标停上去有说明 */
.coach-answer :deep(.coach-time-unknown) {
  text-decoration-style: wavy;
  opacity: 0.75;
}
.coach-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  line-height: 1.7;
}
.coach-alert-detail {
  font-size: 12px;
  opacity: 0.75;
  overflow-wrap: anywhere;
}
.coach-alert-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.coach-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.coach-input-end {
  justify-content: flex-end;
}
.coach-footer {
  padding-top: 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
}
.coach-footer-notes {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.coach-document {
  gap: 12px;
}
.coach-document-text {
  overflow: auto;
  max-height: min(60vh, 640px);
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
