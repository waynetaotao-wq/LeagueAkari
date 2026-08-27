<template>
  <aside class="tc-col">
    <div class="tc-head">
      <div class="tc-title">{{ title }}</div>
      <div class="tc-wr" :class="wrClass">{{ wrText }}</div>
    </div>
    <div class="tc-cards">
      <div v-for="c in cards" :key="c.role" class="tc-card" :class="{ empty: !c.championId, me: c.me }">
        <template v-if="c.championId">
          <div class="tc-splash" :style="{ backgroundImage: c.splash ? `url(${c.splash})` : 'none' }" />
          <div class="tc-shade" />
          <div class="tc-name">{{ c.name }}</div>
          <div v-if="c.sub" class="tc-sub" :class="{ low: c.low }">{{ c.sub }}</div>
        </template>
        <template v-else>
          <div class="tc-empty">PICK · {{ ROLE_CN[c.role] }}</div>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface TeamCard {
  role: number
  championId: number
  name?: string
  splash?: string
  sub?: string
  low?: boolean
  me?: boolean
}

const props = defineProps<{
  title: string
  winrate: number | null
  cards: TeamCard[]
}>()

const ROLE_CN = ['上单', '打野', '中单', '下路', '辅助'] as const

const wrText = computed(() =>
  props.winrate === null ? '--.--' : (props.winrate * 100).toFixed(2)
)
const wrClass = computed(() => {
  if (props.winrate === null) return 'na'
  return props.winrate >= 0.5 ? 'good' : 'bad'
})
</script>

<style scoped>
.tc-col {
  display: flex;
  flex-direction: column;
  background: #0d0d11;
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}
.tc-head {
  padding: 14px 12px 10px;
  text-align: center;
  flex-shrink: 0;
}
.tc-title {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #fff;
  text-transform: uppercase;
}
.tc-wr {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.tc-wr.good {
  color: #f5a623;
}
.tc-wr.bad {
  color: #ef4444;
}
.tc-wr.na {
  color: #4b5563;
}
.tc-cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 6px 6px;
  min-height: 0;
}
.tc-card {
  position: relative;
  flex: 1;
  min-height: 84px;
  border-radius: 6px;
  overflow: hidden;
  background: #141419;
}
.tc-card.me {
  outline: 2px solid #f5a623;
  outline-offset: -2px;
}
.tc-splash {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center 20%;
  filter: saturate(1.05);
}
.tc-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.05) 45%, rgba(0, 0, 0, 0.6) 100%);
}
.tc-name {
  position: absolute;
  top: 6px;
  left: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
  text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
.tc-sub {
  position: absolute;
  right: 6px;
  bottom: 5px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #d1d5db;
}
.tc-sub.low {
  color: #f5a623;
  background: rgba(120, 80, 0, 0.5);
}
.tc-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4b5563;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
  border: 1px dashed #26262e;
  border-radius: 6px;
}
</style>
