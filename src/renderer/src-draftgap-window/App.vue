<template>
  <div class="flex h-full min-h-(--la-app-min-height) min-w-(--la-app-min-width) flex-col">
    <SetupInAppScope />
    <div class="dg-titlebar">
      <span class="dg-title">团队之选 · DraftGap</span>
      <span class="dg-sub">钻石+ · 近30天 · 全球</span>
      <div class="dg-actions">
        <button class="dg-btn" title="最小化" @click="winop('minimize')">─</button>
        <button class="dg-btn" title="隐藏（进入选人时自动出现）" @click="winop('hide')">✕</button>
      </div>
    </div>
    <DraftgapView class="h-0 flex-1" />
  </div>
</template>

<script setup lang="ts">
import { SetupInAppScope } from '@renderer-shared/shards/setup-in-app-scope/setup-in-app-scope-component'
import { useInstance } from '@renderer-shared/shards'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'

import DraftgapView from './DraftgapView.vue'

const NS = 'window-manager-main/draftgap-window'
const ipc = useInstance(AkariIpcRenderer)

function winop(action: 'minimize' | 'hide') {
  ipc.call(NS, 'winop', { action }).catch(() => {})
}
</script>

<style scoped>
.dg-titlebar {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  opacity: 0.95;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  flex-shrink: 0;
}
.dg-title {
  font-weight: 600;
}
.dg-sub {
  opacity: 0.6;
}
.dg-actions {
  margin-left: auto;
  -webkit-app-region: no-drag;
  display: flex;
  gap: 4px;
}
.dg-btn {
  width: 26px;
  height: 20px;
  line-height: 18px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.15);
  cursor: pointer;
}
.dg-btn:hover {
  background: rgba(128, 128, 128, 0.35);
}
</style>
