import { describe, expect, it } from 'vitest'

import { isCounterPageScope, parseLaneKillPair } from './counter-intel-web'
import { parseOpggMayhemAugments, parseOpggMayhemItems } from './opgg-web-data'

const node = (type: string, props: unknown) => ['$', type, null, props]
function page(section: string, content: unknown, mode = 'aram_mayhem', slug = 'ekko') {
  const flight = `0:${JSON.stringify(node('$L1', { sub: mode, detail: section, params: { game_patch_version: '16.18' } }))}\n1:${JSON.stringify(content)}\n`
  return `<link rel="canonical" href="https://op.gg/lol/modes/aram-mayhem/${slug}/${section}"/><script>self.__next_f.push(${JSON.stringify([1, flight])})</script>`
}
describe('OP.GG Mayhem public page contract', () => {
  it('restores only mode-bound recommendations, without presenting hidden rates as Mayhem statistics', () => {
    const rows = [{ ids: [3152, 2510, 4645], play: '65', win_rate: 56.9, pick_rate: 13.66 }]
    const content = node('section', {
      children: [
        node('div', { children: 'Core builds' }),
        node('$L2', { data: rows, mode: 'aram_mayhem' })
      ]
    })
    const parsed = parseOpggMayhemItems(page('items', content), 'ekko')
    expect(parsed).toMatchObject({
      patch: '16.18',
      itemBuilds: [
        {
          slot: 'core',
          options: [{ itemIds: [3152, 2510, 4645], performance: { games: null, winRate: null } }]
        }
      ]
    })
    expect(() => parseOpggMayhemItems(page('items', content, 'aram'), 'ekko')).toThrow()
    expect(() => parseOpggMayhemItems(page('items', content), 'zed')).toThrow()
    expect(() =>
      parseOpggMayhemItems(page('items', node('$L2', { data: rows, mode: 'aram' })), 'ekko')
    ).toThrow()
  })
  it('keeps Mayhem resources with the augment and rejects unsafe icons and broken rows', () => {
    const content = node('$L1', {
      data: [
        {
          id: 1029,
          tier: 0,
          performance: 99.96,
          popular: 5.52,
          name: '虚幻武器',
          rarity: 4,
          smallIcon: 'https://opgg-static.akamaized.net/test.png',
          desc: '技能<OnHit>攻击特效</OnHit>。'
        },
        {
          id: 1129,
          tier: 1,
          performance: 82,
          popular: 2,
          name: '另一强化',
          smallIcon: 'javascript:bad()'
        },
        { id: 22, tier: 0, performance: 20, popular: 150 }
      ]
    })
    const parsed = parseOpggMayhemAugments(page('augments', content), 'ekko')
    expect(parsed.augments).toHaveLength(2)
    expect(parsed.augments[0]).toMatchObject({
      augmentId: 1029,
      tier: 0,
      performanceScore: 99.96,
      performance: { winRate: null },
      display: { name: '虚幻武器', rarity: 'kPrismatic', description: '技能攻击特效。' }
    })
    expect(parsed.augments[1].display?.iconPath).toBeUndefined()
  })
})

it('rejects lane-kill values when the rendered scope or matchup differs, even for a successful response', () => {
  const args = {
    baseSlug: 'ahri',
    position: 'middle' as const,
    region: 'kr',
    tier: 'emerald_plus',
    patch: '16.18',
    targets: []
  }
  const target = { championId: 238, slug: 'zed' }
  const raw = `0:${JSON.stringify(node('$L1', { sub: 'ranked', detail: 'counters', params: { game_region: 'kr', game_tier: 'emerald_plus', game_patch_version: '16.18', game_position: 'mid' } }))}\n1:${JSON.stringify(node('$L2', { href: { pathname: '/lol/champions/zed/counters/mid', query: { region: 'kr', tier: 'emerald_plus', patch: '16.18', target_champion: 'ahri' } } }))}\n2:${JSON.stringify([node('span', { children: '48.94%' }), node('span', { children: 'Lane kill rate' }), node('span', { children: '51.06%' })])}`
  expect(isCounterPageScope(raw, args, target)).toBe(true)
  expect(parseLaneKillPair(raw)).toEqual({ leftPercent: 48.94, rightPercent: 51.06 })
  expect(isCounterPageScope(raw, { ...args, patch: '16.17' }, target)).toBe(false)
  expect(isCounterPageScope(raw, args, { championId: 7, slug: 'leblanc' })).toBe(false)
})
