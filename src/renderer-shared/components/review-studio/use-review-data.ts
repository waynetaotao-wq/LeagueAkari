import { useSgpApiStatus } from '@renderer-shared/composables/useSgpApiStatus'
import { useInstance } from '@renderer-shared/shards'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { SgpGameSummaryLol } from '@shared/types/sgp/match-history'
import {
  type MaybeRefOrGetter,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch
} from 'vue'

import { type ReviewArchiveScope, readReviewArchive, writeReviewArchive } from './archive'
import {
  type ReviewCandidate,
  type ReviewIdentity,
  type ReviewLoadFailure,
  type ReviewLoadProgress,
  createReviewDataLoader,
  getReviewCandidate,
  isReviewAbort,
  matchesReviewCandidate
} from './data-loader'
import type { ReviewFilter, ReviewMatch } from './types'

function initialProgress(): ReviewLoadProgress {
  return {
    phase: 'idle',
    scanned: 0,
    target: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    truncated: false
  }
}

export function useReviewData(options: {
  puuid: MaybeRefOrGetter<string>
  sgpServerId: MaybeRefOrGetter<string>
  active: MaybeRefOrGetter<boolean>
  persistArchive?: boolean
}) {
  const sgp = useInstance(SgpRenderer)
  const sgps = useSgpStore()
  const lcs = useLeagueClientStore()
  const settings = useInstance(SettingUtilsRenderer)
  const targetServer = computed(() => toValue(options.sgpServerId) || sgps.availability.sgpServerId)
  const sgpStatus = useSgpApiStatus(targetServer)
  const identity = computed<ReviewIdentity>(() => ({
    puuid: toValue(options.puuid),
    sgpServerId: targetServer.value
  }))
  const archiveScope = computed<ReviewArchiveScope | null>(() => {
    if (options.persistArchive === false) return null
    const ownerPuuid = lcs.summoner.me?.puuid
    const ownerServerId = sgps.availability.sgpServerId
    if (!ownerPuuid || !ownerServerId || !identity.value.puuid || !identity.value.sgpServerId)
      return null
    return {
      ownerPuuid,
      ownerServerId,
      targetPuuid: identity.value.puuid,
      targetServerId: identity.value.sgpServerId
    }
  })
  const availability = computed(() => {
    if (!identity.value.puuid || !identity.value.sgpServerId)
      return { ready: false, kind: 'identity' as const, reason: '请先连接客户端并选择研究对象' }
    const targetConfig = sgps.leagueServers.servers[identity.value.sgpServerId]
    if (!sgpStatus.value.canUse || !targetConfig?.matchHistory)
      return { ready: false, kind: 'config' as const, reason: '该区尚未配置 SGP 战绩与时间线服务' }
    const currentServer = sgps.availability.sgpServerId
    const currentConfig = sgps.leagueServers.servers[currentServer]
    // Match-history endpoints already route explicitly through the configured Tencent servers.
    // Other regions validate regional tokens; host similarity never grants compatibility.
    if (
      currentServer !== identity.value.sgpServerId &&
      !(currentConfig?.isTencent && targetConfig.isTencent)
    ) {
      return {
        ready: false,
        kind: 'region' as const,
        reason: '当前登录区无法读取该目标区的战绩，请切换客户端区服'
      }
    }
    if (!sgpStatus.value.isReady)
      return {
        ready: false,
        kind: 'token' as const,
        reason: '正在等待客户端登录凭据，请登录后重试'
      }
    return { ready: true, kind: 'ready' as const, reason: '' }
  })
  const loader = createReviewDataLoader({
    history: async (target, startIndex, count, signal) =>
      (
        await sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(target.puuid, {
          startIndex,
          count,
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data.games,
    summary: async (target, gameId, signal) =>
      (
        await sgp.api.matchHistoryQuery.getGameSummaryByGameId(gameId, {
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data,
    details: async (target, gameId, signal) =>
      (
        await sgp.api.matchHistoryQuery.getGameDetailsByGameId(gameId, {
          signal,
          __sgpServerId: target.sgpServerId
        })
      ).data
  })

  const candidates = shallowRef<ReviewCandidate[]>([])
  const matches = shallowRef<ReviewMatch[]>([])
  const selectedMatch = shallowRef<ReviewMatch | null>(null)
  const archivedMatches = shallowRef<ReviewMatch[]>([])
  const archiveStatus = ref<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle')
  const archiveError = ref('')
  const progress = ref(initialProgress())
  const failures = shallowRef<ReviewLoadFailure[]>([])
  const error = ref('')
  const busy = computed(() => progress.value.phase !== 'idle')
  let summaries = new Map<number, SgpGameSummaryLol>()
  let historyReady = false
  let historyScanned = 0
  let historySkipped = 0
  let historyTruncated = false
  let sequence = 0
  let archiveSequence = 0
  let controller: AbortController | null = null
  let lastRequested: number[] = []

  function cancel() {
    sequence++
    controller?.abort()
    controller = null
    if (progress.value.phase === 'history') progress.value.truncated = true
    progress.value.phase = 'idle'
  }

  function begin(phase: ReviewLoadProgress['phase']) {
    cancel()
    if (!toValue(options.active)) return null
    if (!availability.value.ready) {
      error.value = availability.value.reason
      return null
    }
    const target = { ...identity.value }
    const activeSequence = sequence
    controller = new AbortController()
    error.value = ''
    progress.value = { ...initialProgress(), phase }
    return {
      target,
      archiveScope: archiveScope.value ? { ...archiveScope.value } : null,
      signal: controller.signal,
      current: () => sequence === activeSequence && !controller?.signal.aborted
    }
  }

  function updateSummaries(values: SgpGameSummaryLol[]) {
    summaries = new Map(values.map((summary) => [summary.json.gameId, summary]))
    candidates.value = values
      .map((summary) => getReviewCandidate(summary, identity.value.puuid))
      .filter((candidate): candidate is ReviewCandidate => candidate !== null)
      .sort((a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId)
  }

  async function persistMatches(values: ReviewMatch[], scope = archiveScope.value) {
    if (!scope || values.length === 0) return
    const isCurrentScope = () => JSON.stringify(scope) === JSON.stringify(archiveScope.value)
    const currentSequence = isCurrentScope() ? ++archiveSequence : -1
    if (isCurrentScope()) {
      archiveStatus.value = 'saving'
      archiveError.value = ''
    }
    try {
      const saved = await writeReviewArchive(settings, scope, values)
      if (!isCurrentScope() || currentSequence !== archiveSequence) return
      archivedMatches.value = saved.map((record) => record.match)
      archiveStatus.value = 'saved'
    } catch {
      if (!isCurrentScope() || currentSequence !== archiveSequence) return
      archiveStatus.value = 'error'
      archiveError.value = '长期档案保存失败，当前结果仍保留在页面，请重试保存'
    }
  }

  async function loadArchive() {
    const scope = archiveScope.value
    const currentSequence = ++archiveSequence
    archivedMatches.value = []
    if (!scope) {
      archiveStatus.value = 'idle'
      return
    }
    archiveStatus.value = 'loading'
    archiveError.value = ''
    try {
      const stored = await readReviewArchive(settings, scope)
      if (currentSequence !== archiveSequence) return
      archivedMatches.value = stored.map((record) => record.match)
      archiveStatus.value = 'saved'
    } catch {
      if (currentSequence !== archiveSequence) return
      archiveStatus.value = 'error'
      archiveError.value = '长期档案读取失败，请重试；当前仍可读取服务器战绩'
    }
  }

  async function scanInto(run: NonNullable<ReturnType<typeof begin>>) {
    progress.value.phase = 'history'
    progress.value.target = 500
    const result = await loader.scanHistory(run.target, run.signal, (scanned, skipped, partial) => {
      if (!run.current()) return
      historyReady = true
      historyScanned = scanned
      historySkipped = skipped
      historyTruncated = true
      progress.value.scanned = scanned
      progress.value.skipped = skipped
      updateSummaries(partial)
    })
    if (!run.current()) return false
    updateSummaries(result.summaries)
    historyReady = true
    progress.value.scanned = result.scanned
    progress.value.skipped = result.skipped
    progress.value.truncated = result.truncated
    historyTruncated = result.truncated
    historyScanned = result.scanned
    historySkipped = result.skipped
    if (result.failure)
      error.value = `历史读取未完成：${result.failure.reason}。已取得的部分仍可分析。`
    return true
  }

  async function scanHistory() {
    const run = begin('history')
    if (!run) return
    try {
      await scanInto(run)
    } catch (cause) {
      if (run.current() && !isReviewAbort(cause)) error.value = '战绩读取失败，请重试'
    } finally {
      if (run.current()) progress.value.phase = 'idle'
    }
  }

  async function runBatch(
    run: NonNullable<ReturnType<typeof begin>>,
    ids: number[],
    previous: ReviewMatch[] = []
  ) {
    progress.value = {
      ...progress.value,
      phase: 'timelines',
      target: ids.length,
      attempted: 0,
      succeeded: 0,
      failed: 0
    }
    failures.value = []
    matches.value = previous
    const succeeded = new Map(previous.map((match) => [match.meta.gameId, match]))
    try {
      await Promise.all(
        ids.map(async (gameId) => {
          const result = await loader.loadMatch(
            run.target,
            gameId,
            run.signal,
            summaries.get(gameId)
          )
          if (!run.current()) return
          progress.value.attempted++
          if (result.ok) {
            succeeded.set(gameId, result.match)
            progress.value.succeeded++
            matches.value = [...succeeded.values()].sort(
              (a, b) => b.meta.gameCreation - a.meta.gameCreation || b.meta.gameId - a.meta.gameId
            )
          } else {
            progress.value.failed++
            failures.value = [...failures.value, result.failure]
          }
        })
      )
    } finally {
      // Preserve completed games when the user changes accounts or starts another batch.
      await persistMatches([...succeeded.values()], run.archiveScope)
    }
  }

  async function analyze(filter: ReviewFilter, limit: 20 | 40 | 60 = 20) {
    const run = begin('timelines')
    if (!run) return
    try {
      if (!historyReady && !(await scanInto(run))) return
      if (!run.current()) return
      const eligible = candidates.value.filter((candidate) =>
        matchesReviewCandidate(candidate, filter)
      )
      const safeLimit = [20, 40, 60].includes(limit) ? limit : 20
      lastRequested = eligible.slice(0, safeLimit).map((candidate) => candidate.gameId)
      progress.value.scanned = historyScanned
      progress.value.skipped = historySkipped
      progress.value.truncated = historyTruncated || eligible.length > safeLimit
      await runBatch(run, lastRequested)
    } catch (cause) {
      if (run.current() && !isReviewAbort(cause))
        error.value = '分析未完成，请重试；已取得的对局仍可查看'
    } finally {
      if (run.current()) progress.value.phase = 'idle'
    }
  }

  async function loadMatch(gameId: number, refresh = false) {
    const run = begin('single')
    if (!run) return null
    selectedMatch.value = null
    progress.value.target = 1
    try {
      const result = await loader.loadMatch(
        run.target,
        gameId,
        run.signal,
        summaries.get(gameId),
        refresh
      )
      if (!run.current()) return null
      progress.value.attempted = 1
      if (result.ok) {
        selectedMatch.value = result.match
        matches.value = matches.value.map((match) =>
          match.meta.gameId === gameId ? result.match : match
        )
        progress.value.succeeded = 1
        await persistMatches([result.match], run.archiveScope)
        return run.current() ? result.match : null
      }
      error.value = result.failure.reason
      progress.value.failed = 1
      return null
    } catch (cause) {
      if (run.current() && !isReviewAbort(cause)) error.value = '对局读取失败，请重试'
      return null
    } finally {
      if (run.current()) progress.value.phase = 'idle'
    }
  }

  async function retryFailed() {
    const completed = new Set(matches.value.map((match) => match.meta.gameId))
    const ids = lastRequested.filter((id) => !completed.has(id))
    if (!ids.length) return
    const previous = [...matches.value]
    const run = begin('timelines')
    if (!run) return
    try {
      await runBatch(run, ids, previous)
    } catch (cause) {
      if (run.current() && !isReviewAbort(cause)) error.value = '重试未完成，请检查网络后重试'
    } finally {
      if (run.current()) progress.value.phase = 'idle'
    }
  }

  async function retryArchive() {
    const values = [...matches.value, ...(selectedMatch.value ? [selectedMatch.value] : [])]
    if (values.length) await persistMatches(values)
    else await loadArchive()
  }

  watch(
    () => JSON.stringify([identity.value, archiveScope.value]),
    () => {
      cancel()
      summaries = new Map()
      candidates.value = []
      matches.value = []
      selectedMatch.value = null
      failures.value = []
      error.value = ''
      historyReady = false
      historyScanned = 0
      historySkipped = 0
      historyTruncated = false
      lastRequested = []
      progress.value = initialProgress()
      void loadArchive()
    },
    { immediate: true }
  )
  watch(
    () => toValue(options.active),
    (active) => {
      if (!active) {
        cancel()
        void persistMatches(matches.value)
      }
    }
  )
  watch(
    () => availability.value.ready,
    (ready) => {
      if (!ready) cancel()
    }
  )
  onScopeDispose(() => {
    cancel()
    void persistMatches(matches.value)
  })

  return {
    availability,
    candidates,
    matches,
    selectedMatch,
    archivedMatches,
    archiveStatus,
    archiveError,
    progress,
    failures,
    error,
    busy,
    scanHistory,
    analyze,
    loadMatch,
    retryFailed,
    retryArchive,
    cancel
  }
}
