<template>
  <span class="ach" :class="achievement.className" :title="achievement.label">
    <NIcon class="ach-icon" :component="icon" />
    <span v-if="achievement.count" class="ach-count">{{ achievement.count }}</span>
  </span>
</template>

<script setup lang="ts">
import {
  Bolt,
  ChessRook,
  Coins,
  Crown,
  Eye,
  Fire,
  Handshake,
  HandsHelping,
  Heart,
  Medkit,
  Seedling,
  ShieldAlt,
  Skull,
  Snowflake,
  Tint
} from '@vicons/fa'
import { NIcon } from 'naive-ui'
import { type Component, computed } from 'vue'

import type { AkariAchievement, AkariAchievementKey } from '../utils/akari-achievements'

const props = defineProps<{ achievement: AkariAchievement }>()

/** FontAwesome（@vicons/fa）图标映射，名称已核对存在 */
const ICONS: Record<AkariAchievementKey, Component> = {
  kills: Skull,
  damage: Fire,
  tank: ShieldAlt,
  assists: HandsHelping,
  cs: Seedling,
  gold: Coins,
  tower: ChessRook,
  vision: Eye,
  heal: Medkit,
  cc: Snowflake,
  kp: Handshake,
  firstBlood: Tint,
  legendary: Crown,
  penta: Bolt,
  quadra: Bolt,
  triple: Bolt,
  flawless: Heart
}

const icon = computed(() => ICONS[props.achievement.key])
</script>

<style scoped>
.ach {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: default;
}
.ach-icon {
  font-size: 10px;
}
.ach-count {
  position: absolute;
  right: -4px;
  bottom: -3px;
  min-width: 10px;
  height: 10px;
  padding: 0 2px;
  border-radius: 5px;
  background: #141416;
  color: #fde68a;
  font-size: 7px;
  line-height: 10px;
  font-weight: 800;
  text-align: center;
}
</style>
