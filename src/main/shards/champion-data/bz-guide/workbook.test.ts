import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { defaultPictures, workbookFixture } from './fixtures/workbook'
import { parseBzWorkbook } from './workbook'

describe('Bz workbook images', () => {
  it('locates heroes after row insertion, reordering and media renaming; reads text and images from one snapshot', () => {
    const data = workbookFixture({
      headerRow: 3,
      rows: [
        { row: 11, champion: '  Akali  ', summary: 'New advice' },
        { row: 12, champion: 'Ahri' }
      ],
      pictures: [...defaultPictures(11, 'DoransShield'), ...defaultPictures(12)],
      mediaPrefix: 'changed-export-number-'
    })
    expect(parseBzWorkbook(data)).toMatchObject([
      {
        champion: 'Akali',
        sourceRow: 11,
        summary: 'New advice',
        sourceSheet: 'Renamed Guide',
        imageLoadout: { status: 'ready', spellIds: [4, 14], starterItemId: 1054 }
      },
      {
        champion: 'Ahri',
        sourceRow: 12,
        imageLoadout: { status: 'ready', spellIds: [4, 14], starterItemId: 1055 }
      }
    ])
  })

  it('assigns an image anchored above its displayed row to the correct hero', () => {
    const rows = parseBzWorkbook(
      workbookFixture({
        rows: [
          { row: 8, champion: 'Syndra' },
          { row: 9, champion: 'Taliyah' }
        ],
        pictures: [
          ...defaultPictures(8, 'DoransShield'),
          ...defaultPictures(9).slice(0, 2),
          { row: 8, file: 'DoransBlade', x: 30, y: 99 }
        ]
      })
    )
    expect(rows.map((row) => row.imageLoadout)).toMatchObject([
      { status: 'ready', starterItemId: 1054 },
      { status: 'ready', starterItemId: 1055 }
    ])
  })

  it('withholds only ambiguous spells when an extra spell overlaps another one', () => {
    const [row] = parseBzWorkbook(
      workbookFixture({
        pictures: [...defaultPictures(8), { row: 8, file: 'Cleanse', x: 50, y: 49 }]
      })
    )
    expect(row.imageLoadout).toMatchObject({
      status: 'partial',
      starterItemId: 1055,
      issues: expect.arrayContaining([{ code: 'overlapping-images', field: 'spells' }]),
      previews: expect.any(Array)
    })
    expect(row.imageLoadout?.spellIds).toBeUndefined()
  })

  it('tolerates slightly touching spell edges and supports both two-cell and absolute anchors', () => {
    const pictures = defaultPictures(8)
    pictures[0].anchor = 'twoCellAnchor'
    pictures[1] = { ...pictures[1], x: 39, anchor: 'absoluteAnchor' }
    expect(parseBzWorkbook(workbookFixture({ pictures }))[0].imageLoadout).toMatchObject({
      status: 'ready',
      spellIds: [4, 14]
    })
  })

  it('rejects unknown images and external image links without filling from a historical default', () => {
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(255)
    const unknown = PNG.sync.write(png)
    for (const external of [false, true]) {
      const [row] = parseBzWorkbook(
        workbookFixture({
          pictures: [
            ...defaultPictures(8).slice(0, 2),
            { row: 8, file: 'unknown', x: 30, y: 5, external }
          ],
          media: { unknown }
        })
      )
      expect(row.imageLoadout?.status).toBe('partial')
      expect(row.imageLoadout?.issues).toContainEqual({ code: 'unknown-image', field: 'both' })
      expect(row.imageLoadout?.spellIds).toBeUndefined()
      expect(row.imageLoadout?.starterItemId).toBeUndefined()
    }
  })

  it('does not assign an image split evenly across two hero rows', () => {
    const rows = parseBzWorkbook(
      workbookFixture({
        rows: [
          { row: 8, champion: 'Ahri' },
          { row: 9, champion: 'Akali' }
        ],
        pictures: [{ row: 8, file: 'DoransBlade', x: 30, y: 84 }]
      })
    )
    for (const row of rows) {
      expect(row.imageLoadout?.issues).toContainEqual({ code: 'ambiguous-position', field: 'both' })
      expect(row.imageLoadout?.starterItemId).toBeUndefined()
    }
  })

  it('refuses ambiguous hero identities and XML entities instead of replacing cached valid data', () => {
    expect(() =>
      parseBzWorkbook(
        workbookFixture({
          rows: [
            { row: 8, champion: 'Monkey King' },
            { row: 9, champion: 'Wukong' }
          ]
        })
      )
    ).toThrow(/ambiguous champion row/)
    expect(() =>
      parseBzWorkbook(
        workbookFixture({
          parts: {
            'xl/workbook.xml':
              '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///private">]><workbook>&x;</workbook>'
          }
        })
      )
    ).toThrow(/invalid XML/)
    expect(() =>
      parseBzWorkbook(
        workbookFixture({
          parts: {
            'xl/_rels/workbook.xml.rels':
              '<Relationships><Relationship Id="sheet" Target="../../outside.xml"/></Relationships>'
          }
        })
      )
    ).toThrow(/outside workbook/)
  })
})
