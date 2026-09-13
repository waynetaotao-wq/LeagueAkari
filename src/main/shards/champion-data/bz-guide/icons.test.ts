import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { inspectBzIcon } from './icons'

describe('Bz icon recognition', () => {
  it.each([
    ['Flash', 'spell', 4],
    ['Ignite', 'spell', 14],
    ['Cleanse', 'spell', 1],
    ['Teleport', 'spell', 12],
    ['Exhaust', 'spell', 3],
    ['DoransBlade', 'item', 1055],
    ['DoransShield', 'item', 1054]
  ])('identifies the verified %s source icon and a resized/re-encoded copy', (file, kind, id) => {
    const original = readFileSync(join(__dirname, 'fixtures', `${file}.png`))
    expect(inspectBzIcon(original).identity).toEqual({ kind, id })
    const source = PNG.sync.read(original)
    const resized = new PNG({ width: 128, height: 128 })
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const offset =
          (Math.floor((y * source.height) / 128) * source.width +
            Math.floor((x * source.width) / 128)) *
          4
        source.data.copy(resized.data, (y * 128 + x) * 4, offset, offset + 4)
      }
    }
    expect(inspectBzIcon(PNG.sync.write(resized)).identity).toEqual({ kind, id })
  })

  it('returns unknown for malformed files and a materially changed known icon', () => {
    expect(inspectBzIcon(Buffer.from('<svg onload="alert(1)"/>')).identity).toBeNull()
    const source = PNG.sync.read(readFileSync(join(__dirname, 'fixtures/Flash.png')))
    for (let i = 0; i < source.data.length; i += 4) {
      source.data[i] = 255 - source.data[i]
      source.data[i + 1] = 255 - source.data[i + 1]
    }
    expect(inspectBzIcon(PNG.sync.write(source)).identity).toBeNull()
  })
})
