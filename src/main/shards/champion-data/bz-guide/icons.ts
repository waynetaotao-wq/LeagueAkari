import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

import references from './icon-references.json'

export interface BzIconIdentity {
  kind: 'spell' | 'item'
  id: number
}

export interface BzIconInspection {
  identity: BzIconIdentity | null
  digest: string
  preview?: string
}

const SIDE = 16
const samples = references.map((reference) => ({
  ...reference,
  colors: Buffer.from(reference.rgb16Base64, 'base64')
}))

/** Small normalized colour samples tolerate PNG re-encoding without reading any executable data. */
export function describeBzIcon(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  if (
    buffer.length < 33 ||
    buffer.length > 2 * 1024 * 1024 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Unsupported Bz image')
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (
    width < 16 ||
    height < 16 ||
    width > 512 ||
    height > 512 ||
    width / height < 0.8 ||
    width / height > 1.25
  ) {
    throw new Error('Unsupported Bz icon dimensions')
  }
  const png = PNG.sync.read(buffer, { checkCRC: true })
  const colors: number[] = []
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const sum = [0, 0, 0]
      let count = 0
      for (
        let sy = Math.floor((y * height) / SIDE);
        sy < Math.floor(((y + 1) * height) / SIDE);
        sy++
      ) {
        for (
          let sx = Math.floor((x * width) / SIDE);
          sx < Math.floor(((x + 1) * width) / SIDE);
          sx++
        ) {
          const offset = (sy * width + sx) * 4
          const alpha = png.data[offset + 3] / 255
          for (let channel = 0; channel < 3; channel++)
            sum[channel] += png.data[offset + channel] * alpha
          count++
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.round(sum[channel] / count)
        colors.push(value)
      }
    }
  }
  // Re-encode a bounded thumbnail: the renderer never receives the original attachment.
  const preview = new PNG({ width: 64, height: 64 })
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const source = (Math.floor((y * height) / 64) * width + Math.floor((x * width) / 64)) * 4
      png.data.copy(preview.data, (y * 64 + x) * 4, source, source + 4)
    }
  }
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    colors,
    preview: `data:image/png;base64,${PNG.sync.write(preview).toString('base64')}`
  }
}

/** Verified source icons first; only a close and unambiguous colour match may survive resizing. */
export function inspectBzIcon(bytes: Uint8Array): BzIconInspection {
  const digest = createHash('sha256').update(bytes).digest('hex')
  try {
    const descriptor = describeBzIcon(bytes)
    const exact = references.find((reference) => reference.sha256 === descriptor.sha256)
    if (exact)
      return {
        identity: { kind: exact.kind as BzIconIdentity['kind'], id: exact.id },
        digest,
        preview: descriptor.preview
      }
    const ranked = samples
      .map((reference) => ({
        reference,
        error:
          descriptor.colors.reduce(
            (sum, value, i) => sum + Math.abs(value - reference.colors[i]),
            0
          ) /
          (SIDE * SIDE * 3 * 255)
      }))
      .sort((a, b) => a.error - b.error)
    const best = ranked[0]
    const matched = best && best.error <= 0.035 && ranked[1].error - best.error >= 0.08
    return {
      identity: matched
        ? { kind: best.reference.kind as BzIconIdentity['kind'], id: best.reference.id }
        : null,
      digest,
      preview: descriptor.preview
    }
  } catch {
    return { identity: null, digest }
  }
}
