<template>
  <NConfigProvider
    :theme-overrides="themeOverrides"
    :theme="naiveUiTheme"
    :locale="naiveUiLocale.locale"
    :date-locale="naiveUiLocale.dateLocale"
    abstract
    inline-theme-disabled
  >
    <NMessageProvider placement="bottom">
      <NNotificationProvider>
        <NDialogProvider>
          <AkariResourceProvider :value="akariResourceProvider">
            <App />
          </AkariResourceProvider>
        </NDialogProvider>
      </NNotificationProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<script setup lang="ts">
import { useColorThemeAttr } from '@renderer-shared/composables/useColorThemeAttr'
import {
  AkariResourceProvider,
  createAkariResourceProvider
} from '@renderer-shared/providers/akari-resource'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import {
  getNaiveUiLocale,
  getNaiveUiTheme,
  getNaiveUiThemeOverrides
} from '@renderer-shared/theme/naive-ui'
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from 'naive-ui'
import { computed } from 'vue'

import App from './App.vue'

const as = useAppCommonStore()
const akariResourceProvider = createAkariResourceProvider()

// [lolps] Mini 待机窗固定暗色主题（原版未选主题时默认亮色调色板，整窗发白）
const themeOverrides = computed(() => {
  return getNaiveUiThemeOverrides('dark', true)
})

const naiveUiLocale = computed(() => {
  return getNaiveUiLocale(as.settings.locale)
})

const naiveUiTheme = computed(() => {
  return getNaiveUiTheme('dark')
})

useColorThemeAttr(
  () => 'dark',
  () => 'dark'
)
</script>

<style></style>
