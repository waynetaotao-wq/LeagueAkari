import { strToU8, zipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FixturePicture {
  row: number
  file: string
  x: number
  y: number
  width?: number
  height?: number
  anchor?: 'oneCellAnchor' | 'twoCellAnchor' | 'absoluteAnchor'
  external?: boolean
}

export const defaultPictures = (row: number, starter = 'DoransBlade'): FixturePicture[] => [
  { row, file: 'Flash', x: 10, y: 50 },
  { row, file: 'Ignite', x: 50, y: 50 },
  { row, file: starter, x: 30, y: 5 }
]
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const PX = 9525

/** Minimal real OOXML, deliberately allowing anchor offsets into a neighbouring row. */
export function workbookFixture(
  options: {
    rows?: Array<{ row: number; champion: string; summary?: string }>
    headerRow?: number
    pictures?: FixturePicture[]
    mediaPrefix?: string
    media?: Record<string, Uint8Array>
    parts?: Record<string, string>
  } = {}
) {
  const rows = options.rows ?? [{ row: 8, champion: 'Ahri' }]
  const pictures = options.pictures ?? rows.flatMap((row) => defaultPictures(row.row))
  const header = [
    'Champion',
    'Rune',
    'Summoners & Start Item',
    'Difficulty',
    'Core Build',
    'Summary'
  ]
  const cells = (row: number, values: string[]) =>
    `<row r="${row}" ht="75">${values.map((text, index) => `<c r="${String.fromCharCode(65 + index)}${row}" t="inlineStr"><is><t>${escape(text)}</t></is></c>`).join('')}</row>`
  const media = Object.fromEntries(
    [...new Set(pictures.map((p) => p.file))].map((file) => [
      file,
      options.media?.[file] ?? readFileSync(join(__dirname, `${file}.png`))
    ])
  )
  const filenames = Object.keys(media).map((_, i) => `${options.mediaPrefix ?? 'image'}${i}.png`)
  const rels = (content: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`
  const parts: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Renamed Guide" sheetId="1" r:id="sheet"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      rels('<Relationship Id="sheet" Target="worksheets/sheet42.xml"/>')
    ),
    'xl/worksheets/sheet42.xml': strToU8(
      `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetFormatPr defaultColWidth="14" defaultRowHeight="75"/><sheetData>${cells(options.headerRow ?? 7, header)}${rows.map((row) => cells(row.row, [row.champion, 'Electrocute', '', 'Hard', 'Voltaic -> LDR', row.summary ?? 'Hold shadow'])).join('')}<row r="1007" ht="15.75"/></sheetData><drawing r:id="drawing"/></worksheet>`
    ),
    'xl/worksheets/_rels/sheet42.xml.rels': strToU8(
      rels('<Relationship Id="drawing" Target="../drawings/guide.xml"/>')
    ),
    'xl/drawings/_rels/guide.xml.rels': strToU8(
      rels(
        pictures
          .map(
            (p, i) =>
              `<Relationship Id="pic${i}" Target="${p.external ? 'https://example.invalid/private.png' : '../media/' + filenames[Object.keys(media).indexOf(p.file)]}"${p.external ? ' TargetMode="External"' : ''}/>`
          )
          .join('')
      )
    ),
    'xl/drawings/guide.xml': strToU8(
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pictures
        .map((p, i) => {
          const tag = p.anchor ?? 'oneCellAnchor'
          const marker = (tag: string, x: number, y: number) =>
            `<xdr:${tag}><xdr:col>2</xdr:col><xdr:colOff>${x * PX}</xdr:colOff><xdr:row>${p.row - 1}</xdr:row><xdr:rowOff>${y * PX}</xdr:rowOff></xdr:${tag}>`
          const start =
            tag === 'absoluteAnchor'
              ? `<xdr:pos x="${(196 + p.x) * PX}" y="${((p.row - 1) * 100 + p.y) * PX}"/>`
              : marker('from', p.x, p.y)
          const end =
            tag === 'twoCellAnchor'
              ? marker('to', p.x + (p.width ?? 32), p.y + (p.height ?? 32))
              : `<xdr:ext cx="${(p.width ?? 32) * PX}" cy="${(p.height ?? 32) * PX}"/>`
          return `<xdr:${tag}>${start}${end}<xdr:pic><xdr:blipFill><a:blip r:embed="pic${i}"/></xdr:blipFill></xdr:pic></xdr:${tag}>`
        })
        .join('')}</xdr:wsDr>`
    )
  }
  Object.values(media).forEach((bytes, i) => {
    parts[`xl/media/${filenames[i]}`] = bytes
  })
  for (const [name, value] of Object.entries(options.parts ?? {})) parts[name] = strToU8(value)
  return Buffer.from(zipSync(parts))
}
