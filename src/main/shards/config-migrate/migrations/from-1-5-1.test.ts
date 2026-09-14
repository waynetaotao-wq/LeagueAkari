import 'reflect-metadata'

import type { FindOperator } from 'typeorm'
import { describe, expect, it } from 'vitest'

import { Setting } from '../../storage/entities/Settings'
import type { MigrationContext } from './context'
import {
  BACKGROUND_MATERIAL_SETTING_KEY,
  CHAMPION_DATA_PREFERENCES_KEY,
  LEGACY_AUX_SHOW_SKIN_SELECTOR_KEY,
  LEGACY_OPGG_PREFERENCES_KEY,
  MIGRATION_FROM_151,
  OPGG_SHOW_SKIN_SELECTOR_KEY,
  migrateFrom151
} from './from-1-5-1'

const LEGACY_KEY = 'app-common-main/httpProxy'
const NETWORK_KEY = 'network-main/httpProxy'

function setup(initial: Setting[] = []) {
  const settings = new Map(initial.map((setting) => [setting.key, setting]))
  const context = {
    manager: {
      findOneBy: async (_: unknown, { key }: { key: string | FindOperator<string> }) =>
        settings.get(typeof key === 'string' ? key : key.value),
      save: async (setting: Setting) => settings.set(setting.key, setting),
      remove: async (setting: Setting) => settings.delete(setting.key)
    },
    logger: { info: () => {} }
  }
  return { settings, context: context as unknown as MigrationContext }
}

describe('from 1.5.1 migration', () => {
  it('moves the skin selector preference without removing its compatibility value', async () => {
    const { settings, context } = setup([Setting.create(LEGACY_AUX_SHOW_SKIN_SELECTOR_KEY, true)])

    await migrateFrom151(context)

    expect(settings.get(OPGG_SHOW_SKIN_SELECTOR_KEY)?.value).toBe(true)
    expect(settings.get(LEGACY_AUX_SHOW_SKIN_SELECTOR_KEY)?.value).toBe(true)
    expect(settings.has(MIGRATION_FROM_151)).toBe(true)
  })

  it('upgrades fork beta proxy and Mica settings while preserving custom preferences', async () => {
    const marker = 'akari-migration-from-1.5.1_champion-data-window'
    const preferences = { mode: 'ranked', position: 'middle', region: 'kr', tier: 'emerald_plus' }
    const { settings, context } = setup([
      Setting.create(marker, marker),
      Setting.create(CHAMPION_DATA_PREFERENCES_KEY, preferences),
      Setting.create(BACKGROUND_MATERIAL_SETTING_KEY, 'mica'),
      Setting.create(LEGACY_KEY, { strategy: 'force', host: '127.0.0.1', port: 7890 }),
      Setting.create('champion-data-main/preferredSource', 'lolps'),
      Setting.create('champion-data-main/regionTierDefaultsMigrated', true),
      Setting.create('window-manager-main/post-game-window/enabled', false)
    ])

    await migrateFrom151(context)

    expect(settings.get(BACKGROUND_MATERIAL_SETTING_KEY)?.value).toBe('system')
    expect(settings.get(NETWORK_KEY)?.value).toEqual({
      strategy: 'fixed-servers',
      host: '127.0.0.1',
      port: 7890
    })
    expect(settings.has(LEGACY_KEY)).toBe(false)
    expect(settings.get(CHAMPION_DATA_PREFERENCES_KEY)?.value).toEqual(preferences)
    expect(settings.get('champion-data-main/preferredSource')?.value).toBe('lolps')
    expect(settings.get('champion-data-main/regionTierDefaultsMigrated')?.value).toBe(true)
    expect(settings.get('window-manager-main/post-game-window/enabled')?.value).toBe(false)
    expect(settings.has(MIGRATION_FROM_151)).toBe(true)
  })

  it('preserves the shipped fork upgrade from legacy OP.GG preferences', async () => {
    const legacy = { mode: 'ranked', position: 'adc', region: 'kr', tier: 'diamond_plus' }
    const { settings, context } = setup([Setting.create(LEGACY_OPGG_PREFERENCES_KEY, legacy)])

    await migrateFrom151(context)

    expect(settings.get(CHAMPION_DATA_PREFERENCES_KEY)?.value).toEqual({
      ...legacy,
      position: 'bottom'
    })
    expect(settings.get(LEGACY_OPGG_PREFERENCES_KEY)?.value).toEqual(legacy)
  })

  it('keeps current preferences instead of replacing them with older OP.GG settings', async () => {
    const current = { mode: 'aram_mayhem', position: 'none', region: 'kr', tier: 'all' }
    const { settings, context } = setup([
      Setting.create(CHAMPION_DATA_PREFERENCES_KEY, current),
      Setting.create(LEGACY_OPGG_PREFERENCES_KEY, { mode: 'ranked', position: 'adc' })
    ])

    await migrateFrom151(context)

    expect(settings.get(CHAMPION_DATA_PREFERENCES_KEY)?.value).toEqual(current)
  })

  it('does not change user choices when launched again after the upgrade', async () => {
    const { settings, context } = setup([
      Setting.create(LEGACY_KEY, { strategy: 'force', host: 'localhost', port: 1080 })
    ])
    await migrateFrom151(context)
    const chosen = { strategy: 'direct', host: 'localhost', port: 7890 }
    settings.set(NETWORK_KEY, Setting.create(NETWORK_KEY, chosen))
    settings.set(
      BACKGROUND_MATERIAL_SETTING_KEY,
      Setting.create(BACKGROUND_MATERIAL_SETTING_KEY, 'none')
    )

    await migrateFrom151(context)

    expect(settings.get(NETWORK_KEY)?.value).toEqual(chosen)
    expect(settings.get(BACKGROUND_MATERIAL_SETTING_KEY)?.value).toBe('none')
  })
})

describe('network proxy settings migration', () => {
  it.each([
    ['auto', 'system'],
    ['force', 'fixed-servers'],
    ['disable', 'direct']
  ])('migrates %s to %s and preserves host and port', async (strategy, migratedStrategy) => {
    const proxy = { strategy, host: 'localhost', port: 1080 }
    const { settings, context } = setup([Setting.create(LEGACY_KEY, proxy)])

    await migrateFrom151(context)

    expect(settings.get(NETWORK_KEY)?.value).toEqual({ ...proxy, strategy: migratedStrategy })
    expect(settings.has(LEGACY_KEY)).toBe(false)
    expect(settings.has(MIGRATION_FROM_151)).toBe(true)
  })

  it('keeps an existing network setting and removes the obsolete key', async () => {
    const current = { strategy: 'system', host: 'localhost', port: 7897 }
    const { settings, context } = setup([
      Setting.create(LEGACY_KEY, { strategy: 'force', host: 'localhost', port: 1080 }),
      Setting.create(NETWORK_KEY, current)
    ])

    await migrateFrom151(context)

    expect(settings.get(NETWORK_KEY)?.value).toEqual(current)
    expect(settings.has(LEGACY_KEY)).toBe(false)
  })
})
