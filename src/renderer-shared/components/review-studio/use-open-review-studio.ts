import { useInstance } from '@renderer-shared/shards'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { ref } from 'vue'

import { type ReviewStudioTarget, buildReviewStudioLink } from './link'

export function useOpenReviewStudio() {
  const windowManager = useInstance(WindowManagerRenderer)
  const opening = ref(false)
  const error = ref('')

  async function open(target: ReviewStudioTarget) {
    if (opening.value) return
    opening.value = true
    error.value = ''
    try {
      const url = buildReviewStudioLink(target)
      await windowManager.mainWindow.show()
      const response = await fetch(url)
      if (!response.ok) throw new Error('复盘窗口暂时无法打开')
    } catch {
      error.value = '未能打开复盘台，请重试。'
    } finally {
      opening.value = false
    }
  }

  return { open, opening, error }
}
