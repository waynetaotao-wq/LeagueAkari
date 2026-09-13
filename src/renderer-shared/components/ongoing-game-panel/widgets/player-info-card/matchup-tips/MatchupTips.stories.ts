import type { Meta, StoryObj } from '@storybook/vue3-vite'

import MatchupTipsDemo from './MatchupTipsDemo.vue'

const meta = {
  title: 'Renderer Shared/Ongoing Game/Matchup Tips',
  component: MatchupTipsDemo,
  parameters: { akariStoryPanelMaxWidth: 500 }
} satisfies Meta<typeof MatchupTipsDemo>

export default meta
type Story = StoryObj<typeof meta>
export const Confirmed: Story = {}
export const Reverse: Story = { args: { initialScenario: 'reverse' } }
export const Missing: Story = { args: { initialScenario: 'missing' } }
export const ChampionSelect: Story = { args: { initialScenario: 'champ-select' } }
