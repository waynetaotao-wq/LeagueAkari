import { describe, expect, it } from 'vitest'

import {
  BZ_SUMMARY_FINGERPRINTS,
  BZ_SUMMARY_ZH,
  bzSummaryFingerprint,
  getBzExtras,
  getBzSummaryZh
} from './bz-summary-zh'

const AHRI_SUMMARY = `Don't ult unless Ahri has no charm

If you do ult and she has charm, buffer your Q

Try to time your WQ combo after her ult dash`

describe('Bz summary translations', () => {
  it('keeps one verified fingerprint for each of the 61 translations', () => {
    const translationKeys = Object.keys(BZ_SUMMARY_ZH).sort()
    const fingerprintKeys = Object.keys(BZ_SUMMARY_FINGERPRINTS).sort()

    expect(translationKeys).toHaveLength(61)
    expect(fingerprintKeys).toEqual(translationKeys)
    expect(new Set(Object.values(BZ_SUMMARY_FINGERPRINTS))).toHaveLength(61)
    expect(
      Object.values(BZ_SUMMARY_FINGERPRINTS).every((value) => /^[0-9a-f]{16}$/.test(value))
    ).toBe(true)
  })

  it('uses Chinese only while the live English summary matches its verified content', () => {
    expect(bzSummaryFingerprint(AHRI_SUMMARY)).toBe(BZ_SUMMARY_FINGERPRINTS.ahri)
    expect(getBzSummaryZh('Ahri', AHRI_SUMMARY)).toBe(BZ_SUMMARY_ZH.ahri)
    expect(getBzSummaryZh('Ahri', `  ${AHRI_SUMMARY.replaceAll('\n', '   ')}  `)).toBe(
      BZ_SUMMARY_ZH.ahri
    )

    expect(getBzSummaryZh('Ahri', `${AHRI_SUMMARY}\nNew matchup advice.`)).toBeNull()
    expect(getBzSummaryZh('New Champion', AHRI_SUMMARY)).toBeNull()
  })
})

describe('getBzExtras', () => {
  it('keeps defaults independent from summary fingerprints', () => {
    expect(getBzExtras('Ahri')).toEqual({ starterItemId: 1055, spellIds: [4, 14] })
    expect(getBzSummaryZh('Ahri', `${AHRI_SUMMARY} changed`)).toBeNull()
    expect(getBzExtras('Ahri')).not.toBeNull()
  })

  it.each([
    ['Aurora', 1054, 14],
    ['Malphite', 1054, 12],
    ['Syndra', 1054, 14],
    ['Viktor', 1054, 14],
    ['Lux', 1055, 1],
    ['Zoe', 1055, 1],
    ['Qiyana', 1055, 3],
    ['Riven', 1055, 3],
    ['Trynd', 1055, 12]
  ])('returns the verified exception for %s', (champion, starterItemId, secondSpellId) => {
    expect(getBzExtras(champion)).toEqual({
      starterItemId,
      spellIds: [4, secondSpellId]
    })
  })

  it('covers all 61 known rows and hides unknown rows', () => {
    expect(Object.keys(BZ_SUMMARY_ZH).every((key) => getBzExtras(key) !== null)).toBe(true)
    expect(getBzExtras('New Champion')).toBeNull()
    expect(getBzExtras('constructor')).toBeNull()
  })
})
