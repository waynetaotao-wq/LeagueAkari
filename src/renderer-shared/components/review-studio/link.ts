// [lolps] A renderer link carries identifiers only; it never carries executable content.
export interface ReviewStudioTarget {
  puuid: string
  sgpServerId: string
  gameId?: number
  championId?: number
}

const REVIEW_PATH = '/overlays/review-studio'

function validIdentifier(value: string | null): value is string {
  return !!value && value.length <= 256 && !/[\s\u0000-\u001f]/u.test(value)
}

function optionalId(value: string | null): number | undefined | null {
  if (value === null) return undefined
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export function parseReviewStudioLink(value: string): ReviewStudioTarget | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'akari:' ||
      url.hostname !== 'renderer-link' ||
      url.pathname !== REVIEW_PATH ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    const puuid = url.searchParams.get('puuid')
    const sgpServerId = url.searchParams.get('sgpServerId')
    const gameId = optionalId(url.searchParams.get('gameId'))
    const championId = optionalId(url.searchParams.get('championId'))
    if (
      !validIdentifier(puuid) ||
      !validIdentifier(sgpServerId) ||
      gameId === null ||
      championId === null
    )
      return null
    return { puuid, sgpServerId, gameId, championId }
  } catch {
    return null
  }
}

export function buildReviewStudioLink(target: ReviewStudioTarget): string {
  const url = new URL(`akari://renderer-link${REVIEW_PATH}`)
  url.searchParams.set('puuid', target.puuid)
  url.searchParams.set('sgpServerId', target.sgpServerId)
  if (target.gameId !== undefined) url.searchParams.set('gameId', String(target.gameId))
  if (target.championId !== undefined) url.searchParams.set('championId', String(target.championId))
  if (!parseReviewStudioLink(url.href)) throw new Error('复盘目标信息不完整，请刷新战绩后重试')
  return url.href
}
