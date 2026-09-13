<template>
  <NPopover
    :show="show && enabled"
    trigger="hover"
    placement="bottom"
    :delay="80"
    :keep-alive-on-hover="true"
    :disabled="!enabled"
    @update:show="updateShow"
  >
    <template #trigger>
      <slot
        :open="open"
        :set-trigger="setTrigger"
        :close="close"
        :blur="blur"
        :focus-details="focusDetails"
        :expanded="show && enabled"
        :enabled="enabled"
      />
    </template>
    <div ref="contentElement" @focusout="blur" @keydown.esc.stop="close">
      <MidlaneResearchContent
        v-if="research && enabled && show"
        :key="research.identity.value"
        :state="research.state"
        :max-height="maxHeight"
        :champion-id="research.championId.value"
        :is-opponent="research.isOpponent.value"
        @retry="research.retry"
      />
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import { NPopover } from 'naive-ui'
import { type ComponentPublicInstance, computed, nextTick, ref, watch } from 'vue'

import { useMidlaneResearch } from './context'
import MidlaneResearchContent from './MidlaneResearchContent.vue'

const research = useMidlaneResearch()
const enabled = computed(() => research?.visible.value ?? false)
const show = ref(false)
const maxHeight = ref(500)
let triggerElement: HTMLElement | null = null
function setTrigger(value: Element | ComponentPublicInstance | null) {
  triggerElement = value instanceof HTMLElement ? value : value && '$el' in value ? value.$el : null
}
function fitViewport() {
  const rect = triggerElement?.getBoundingClientRect()
  if (!rect) return
  const above = Math.max(0, Math.min(window.innerHeight, rect.top))
  const below = Math.max(0, window.innerHeight - Math.max(0, rect.bottom))
  maxHeight.value = Math.max(40, Math.max(above, below) - 48)
}
function updateShow(value: boolean) {
  if (value) fitViewport()
  show.value = value && enabled.value
}
const contentElement = ref<HTMLElement | null>(null)
const open = () => {
  updateShow(true)
}
const close = () => {
  show.value = false
}
function blur(event: FocusEvent) {
  if (
    !(event.relatedTarget instanceof Node) ||
    !contentElement.value?.contains(event.relatedTarget)
  )
    close()
}
async function focusDetails() {
  open()
  await nextTick()
  contentElement.value?.querySelector('button')?.focus()
}
watch(() => [research?.identity.value, enabled.value], close, { flush: 'sync' })
watch(show, (value, _, onCleanup) => {
  if (!value) return
  window.addEventListener('resize', fitViewport)
  onCleanup(() => window.removeEventListener('resize', fitViewport))
})
</script>
