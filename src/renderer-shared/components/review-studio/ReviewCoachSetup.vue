<template>
  <div class="coach-setup">
    <div class="setup-heading">
      <NText strong>{{ t('coach.setup.title') }}</NText>
      <NText depth="3" class="text-xs">{{ t('coach.setup.intro') }}</NText>
    </div>

    <div class="setup-field">
      <span class="setup-label">{{ t('coach.setup.provider') }}</span>
      <div class="setup-control">
        <NRadioGroup
          :value="settings.provider"
          size="small"
          :aria-label="t('coach.setup.provider')"
          @update:value="setProvider"
        >
          <NRadioButton v-for="provider in AI_COACH_PROVIDERS" :key="provider" :value="provider">{{
            t(`coach.setup.providers.${provider}`)
          }}</NRadioButton>
        </NRadioGroup>
        <NText depth="3" class="text-xs">{{
          t(`coach.setup.providerHint.${settings.provider}`)
        }}</NText>
      </div>
    </div>

    <template v-if="settings.provider === 'anthropic'">
      <div class="setup-field">
        <span class="setup-label">{{ t('coach.setup.model') }}</span>
        <div class="setup-control">
          <NSelect
            :value="settings.anthropicModel || null"
            :options="anthropicModelOptions"
            size="small"
            filterable
            tag
            :aria-label="t('coach.setup.model')"
            @update:value="(value: string) => coach.setSetting('anthropicModel', value ?? '')"
          />
          <NText depth="3" class="text-xs">{{ t('coach.setup.customModel') }}</NText>
        </div>
      </div>
      <div class="setup-field">
        <span class="setup-label">{{ t('coach.setup.relay') }}</span>
        <div class="setup-control">
          <NInput
            v-model:value="anthropicBaseUrl"
            size="small"
            :placeholder="t('coach.setup.relayPlaceholder')"
            :status="anthropicUrlInvalid ? 'error' : undefined"
            :input-props="plainInput"
            @change="saveAnthropicBaseUrl"
          />
          <NText v-if="anthropicUrlInvalid" type="error" class="text-xs">{{
            t('coach.setup.badUrl')
          }}</NText>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="setup-field">
        <span class="setup-label">{{ t('coach.setup.preset') }}</span>
        <div class="setup-control">
          <NSelect
            :value="activePreset"
            :options="presetOptions"
            size="small"
            :placeholder="t('coach.setup.presetPlaceholder')"
            :aria-label="t('coach.setup.preset')"
            @update:value="applyPreset"
          />
        </div>
      </div>
      <div class="setup-field">
        <span class="setup-label">{{ t('coach.setup.baseUrl') }}</span>
        <div class="setup-control">
          <NInput
            v-model:value="openaiBaseUrl"
            size="small"
            :placeholder="t('coach.setup.baseUrlPlaceholder')"
            :status="openaiUrlInvalid ? 'error' : undefined"
            :input-props="plainInput"
            @change="saveOpenaiBaseUrl"
          />
          <NText v-if="openaiUrlInvalid" type="error" class="text-xs">{{
            t('coach.setup.badUrl')
          }}</NText>
        </div>
      </div>
      <div class="setup-field">
        <span class="setup-label">{{ t('coach.setup.model') }}</span>
        <div class="setup-control">
          <NInput
            v-model:value="openaiModel"
            size="small"
            :placeholder="t('coach.setup.modelPlaceholder')"
            :input-props="plainInput"
            @change="(value: string) => coach.setSetting('openaiModel', value)"
          />
        </div>
      </div>
    </template>

    <div class="setup-field">
      <span class="setup-label">{{ t('coach.setup.key') }}</span>
      <div class="setup-control">
        <div v-if="hasKey && !replacingKey" class="setup-key-saved">
          <NTag
            size="small"
            :bordered="false"
            :type="state.canPersistKeys ? 'success' : 'warning'"
            >{{ t(state.canPersistKeys ? 'coach.setup.keySaved' : 'coach.setup.keyMemory') }}</NTag
          >
          <NButton size="tiny" secondary @click="replacingKey = true">{{
            t('coach.setup.keyReplace')
          }}</NButton>
          <NPopconfirm
            :positive-text="t('coach.setup.keyRemove')"
            :negative-text="t('coach.restartNo')"
            @positive-click="removeKey"
          >
            <template #trigger>
              <NButton size="tiny" quaternary type="error">{{
                t('coach.setup.keyRemove')
              }}</NButton>
            </template>
            {{ t('coach.setup.keyRemoveConfirm') }}
          </NPopconfirm>
        </div>
        <div v-else class="setup-key-input">
          <NInput
            v-model:value="keyInput"
            type="password"
            show-password-on="click"
            size="small"
            :placeholder="t('coach.setup.keyPlaceholder')"
            :status="keyProblem ? 'error' : undefined"
            :input-props="plainInput"
            @keydown.enter.prevent="saveKey"
          />
          <NButton
            size="small"
            type="primary"
            :disabled="!keyInput.trim()"
            :loading="savingKey"
            @click="saveKey"
            >{{ t('coach.setup.keySave') }}</NButton
          >
          <NButton v-if="hasKey" size="small" quaternary @click="cancelReplace">{{
            t('coach.restartNo')
          }}</NButton>
        </div>
        <NText v-if="keyProblem" type="error" class="text-xs">{{
          t(`coach.setup.${keyProblem}`)
        }}</NText>
        <NText v-if="activePreset === 'ollama'" depth="3" class="text-xs">{{
          t('coach.setup.ollamaKey')
        }}</NText>
        <NText depth="3" class="text-xs">{{ t('coach.setup.keyNote') }}</NText>
      </div>
    </div>

    <div class="setup-footer">
      <NText v-if="missing.length" depth="3" class="text-xs">{{
        t('coach.setup.incomplete', { items: missing.join(t('coach.setup.separator')) })
      }}</NText>
      <NButton v-else size="small" type="primary" @click="emit('done')">{{
        t('coach.setup.done')
      }}</NButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { AiCoachRenderer } from '@renderer-shared/shards/ai-coach'
import { useAiCoachStore } from '@renderer-shared/shards/ai-coach/store'
import {
  AI_COACH_ANTHROPIC_MODELS,
  AI_COACH_OPENAI_PRESETS,
  AI_COACH_PROVIDERS,
  type AiCoachProvider,
  normalizeAiCoachBaseUrl
} from '@shared/shards/ai-coach'
import { useTranslation } from 'i18next-vue'
import {
  NButton,
  NInput,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag,
  NText
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

// [lolps] AI 教练的接口设置：服务、模型、地址和密钥，全部由用户自己填写。
// 密钥只在点「保存」的那一下交给主进程，这里不保留，也读不回来。

const emit = defineEmits<{ done: [] }>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const coach = useInstance(AiCoachRenderer)
const store = useAiCoachStore()
const settings = store.settings
const state = store.state

/** 密钥、地址、模型名都不该被浏览器记住或纠错。 */
const plainInput = { autocomplete: 'off', spellcheck: false }

const anthropicModelOptions = computed(() => {
  const options = AI_COACH_ANTHROPIC_MODELS.map((model) => ({
    label: t(`coach.setup.models.${model}`),
    value: model as string
  }))
  const current = settings.anthropicModel
  return current && !options.some((option) => option.value === current)
    ? [...options, { label: current, value: current }]
    : options
})
const presetOptions = AI_COACH_OPENAI_PRESETS.map((preset) => ({
  label: t(`coach.setup.presets.${preset.id}`),
  value: preset.id as string
}))
const activePreset = computed(
  () =>
    AI_COACH_OPENAI_PRESETS.find((preset) => preset.baseUrl === settings.openaiBaseUrl)?.id ?? null
)

// 地址和模型名在输入框里先改，离开输入框或按回车时才保存。
const anthropicBaseUrl = ref(settings.anthropicBaseUrl)
const openaiBaseUrl = ref(settings.openaiBaseUrl)
const openaiModel = ref(settings.openaiModel)
const anthropicUrlInvalid = ref(false)
const openaiUrlInvalid = ref(false)
watch(
  () => settings.anthropicBaseUrl,
  (value) => {
    if (!anthropicUrlInvalid.value) anthropicBaseUrl.value = value
  }
)
watch(
  () => settings.openaiBaseUrl,
  (value) => {
    if (!openaiUrlInvalid.value) openaiBaseUrl.value = value
  }
)
watch(
  () => settings.openaiModel,
  (value) => (openaiModel.value = value)
)

function saveAnthropicBaseUrl(value: string) {
  // 留空 = 用官方地址。
  anthropicUrlInvalid.value = !!value.trim() && !normalizeAiCoachBaseUrl(value)
  if (!anthropicUrlInvalid.value) void coach.setSetting('anthropicBaseUrl', value)
}
function saveOpenaiBaseUrl(value: string) {
  openaiUrlInvalid.value = !!value.trim() && !normalizeAiCoachBaseUrl(value)
  if (!openaiUrlInvalid.value) void coach.setSetting('openaiBaseUrl', value)
}
function applyPreset(id: string) {
  const preset = AI_COACH_OPENAI_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) return
  openaiUrlInvalid.value = false
  openaiBaseUrl.value = preset.baseUrl
  void coach.setSetting('openaiBaseUrl', preset.baseUrl)
}

const hasKey = computed(() =>
  settings.provider === 'anthropic' ? state.hasAnthropicKey : state.hasOpenaiKey
)
const keyInput = ref('')
const replacingKey = ref(false)
const savingKey = ref(false)
const keyProblem = ref<'keyInvalid' | 'keyWriteFailed' | null>(null)

function resetKeyForm() {
  keyInput.value = ''
  replacingKey.value = false
  keyProblem.value = null
}
function setProvider(provider: AiCoachProvider) {
  resetKeyForm()
  void coach.setSetting('provider', provider)
}
function cancelReplace() {
  resetKeyForm()
}
async function saveKey() {
  if (savingKey.value || !keyInput.value.trim()) return
  savingKey.value = true
  keyProblem.value = null
  try {
    const result = await coach.setApiKey(settings.provider, keyInput.value)
    if (result.result === 'ok') {
      resetKeyForm()
    } else if (result.reason === 'write-failed') {
      // 密钥本次仍可用，只是没能写进本机。
      resetKeyForm()
      keyProblem.value = 'keyWriteFailed'
    } else {
      keyProblem.value = 'keyInvalid'
    }
  } catch {
    keyProblem.value = 'keyWriteFailed'
  } finally {
    savingKey.value = false
  }
}
async function removeKey() {
  await coach.clearApiKey(settings.provider)
  resetKeyForm()
}

const missing = computed(() => {
  const items: string[] = []
  if (settings.provider === 'anthropic') {
    if (!settings.anthropicModel.trim()) items.push(t('coach.setup.missing.model'))
  } else {
    if (!settings.openaiBaseUrl.trim()) items.push(t('coach.setup.missing.baseUrl'))
    if (!settings.openaiModel.trim()) items.push(t('coach.setup.missing.model'))
  }
  if (!hasKey.value) items.push(t('coach.setup.missing.key'))
  return items
})
</script>

<style scoped>
.coach-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 8px;
  background: rgb(var(--la-card-tint-rgb) / 0.03);
}
.setup-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.setup-field {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
}
.setup-label {
  padding-top: 5px;
  font-size: 13px;
}
.setup-control {
  display: flex;
  min-width: 0;
  max-width: 520px;
  flex-direction: column;
  gap: 6px;
}
.setup-key-saved,
.setup-key-input {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.setup-key-input :deep(.n-input) {
  min-width: 200px;
  flex: 1;
}
.setup-footer {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 640px) {
  .setup-field {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .setup-label {
    padding-top: 0;
  }
}
</style>
