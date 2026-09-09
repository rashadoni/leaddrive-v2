export type MonitoringProfileRunSource = {
  id: string
  platform: string
  label: string
  status: string
  isActive: boolean
  paid?: boolean
  providerAccountFundedOnly?: boolean
  maxTotalChargeUsd?: number | null
  sharedAcrossMonitorings?: boolean
}

export const MONITORING_PROFILE_RUN_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "web",
] as const

export type MonitoringProfileRunPlatform =
  | "all"
  | typeof MONITORING_PROFILE_RUN_PLATFORMS[number]

export function monitoringProfileSourcesForPlatform(
  sources: MonitoringProfileRunSource[],
  platform: MonitoringProfileRunPlatform,
): MonitoringProfileRunSource[] {
  return Array.from(new Map(
    sources
      .filter(source => source.isActive)
      .filter(source => platform === "all" || source.platform.toLowerCase() === platform)
      .map(source => [source.id, source]),
  ).values())
}

export type MonitoringProfileSourceRunResult = {
  status: string
  foundCount: number
  newCount: number
  duplicateCount: number
  acceptedCount?: number
  reviewCount?: number
  rejectedCount?: number
  ignoredCount?: number
  error?: string | null
  limitations?: string[]
  runId?: string
  rawStats?: Record<string, unknown>
}

export type MonitoringProfileRunPhase =
  | "running"
  | "stopping"
  | "completed"
  | "completed_with_issues"
  | "completed_with_pending"
  | "stopped"

export type MonitoringProfileRunStage = "starting" | "provider_wait"

export type MonitoringProfileProviderRun = {
  id?: string
  phase?: string
  status: string
  receivedCount: number
  acceptedCount: number
  reviewCount: number
  rejectedCount: number
  duplicateCount: number
  lastError?: string | null
}

export type MonitoringProfileRunCounts = {
  found: number
  accepted: number
  review: number
  rejected: number
  duplicates: number
}

export type MonitoringProfileRunSourceSummary = MonitoringProfileRunCounts & {
  sourceId: string
  platform: string
  label: string
  status: string
  limitations: string[]
}

export type MonitoringProfileRunPlatformSummary = MonitoringProfileRunCounts & {
  platform: string
  sources: MonitoringProfileRunSourceSummary[]
  issueCount: number
}

export type MonitoringProfileRunProgress = {
  phase: MonitoringProfileRunPhase
  total: number
  attempted: number
  succeeded: number
  partial: number
  failed: number
  skipped: number
  pending: number
  found: number
  accepted: number
  review: number
  rejected: number
  duplicates: number
  sourceResults: MonitoringProfileRunSourceSummary[]
  current: {
    id: string
    platform: string
    label: string
    index: number
    stage: MonitoringProfileRunStage
    preview: MonitoringProfileRunCounts
    providerWait?: {
      providerRunIds: string[]
      collectorResult: MonitoringProfileSourceRunResult
    }
  } | null
  lastIssue: {
    sourceId: string
    sourceLabel: string
    error: string
  } | null
  resumeContext?: MonitoringProfileRunResumeContext
}

export const MONITORING_PROFILE_RUN_RESUME_VERSION = 2
export const MONITORING_PROFILE_RUN_RESUME_MAX_AGE_MS = 24 * 60 * 60_000

export type MonitoringProfileRunResumeContext = {
  version: typeof MONITORING_PROFILE_RUN_RESUME_VERSION
  scenarioId: string
  profileRevision: string
  sourceIds: string[]
  startedAt: string
  updatedAt: string
}

function normalizedSourceIds(sourceIds: string[]): string[] {
  return Array.from(new Set(sourceIds.map(value => value.trim()).filter(Boolean))).sort()
}

export function createMonitoringProfileRunResumeContext(input: {
  scenarioId: string
  profileRevision: string
  sourceIds: string[]
  now?: Date
}): MonitoringProfileRunResumeContext {
  const now = input.now ?? new Date()
  return {
    version: MONITORING_PROFILE_RUN_RESUME_VERSION,
    scenarioId: input.scenarioId,
    profileRevision: input.profileRevision,
    sourceIds: normalizedSourceIds(input.sourceIds),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export function canResumeMonitoringProfileRun(input: {
  progress: MonitoringProfileRunProgress | null | undefined
  scenarioId: string
  profileRevision: string
  sourceIds: string[]
  now?: Date
  maxAgeMs?: number
}): boolean {
  const progress = input.progress
  const context = progress?.resumeContext
  if (
    !progress
    || progress.phase !== "stopped"
    || progress.attempted >= progress.total
    || !context
    || context.version !== MONITORING_PROFILE_RUN_RESUME_VERSION
    || context.scenarioId !== input.scenarioId
    || context.profileRevision !== input.profileRevision
  ) return false

  const expectedSourceIds = normalizedSourceIds(input.sourceIds)
  if (
    expectedSourceIds.length !== context.sourceIds.length
    || expectedSourceIds.some((sourceId, index) => sourceId !== context.sourceIds[index])
  ) return false
  if (progress.sourceResults.some(result => !expectedSourceIds.includes(result.sourceId))) return false
  if (progress.current) {
    if (
      !expectedSourceIds.includes(progress.current.id)
      || progress.sourceResults.some(result => result.sourceId === progress.current?.id)
      || progress.current.stage !== "provider_wait"
      || !progress.current.providerWait?.providerRunIds.length
    ) return false
  }

  const updatedAt = new Date(context.updatedAt)
  const now = input.now ?? new Date()
  const maxAgeMs = Math.max(0, input.maxAgeMs ?? MONITORING_PROFILE_RUN_RESUME_MAX_AGE_MS)
  if (!Number.isFinite(updatedAt.getTime())) return false
  const ageMs = now.getTime() - updatedAt.getTime()
  return ageMs >= 0 && ageMs <= maxAgeMs
}

type RunMonitoringProfileSourcesOptions = {
  sources: MonitoringProfileRunSource[]
  initialProgress?: MonitoringProfileRunProgress | null
  runSource: (
    source: MonitoringProfileRunSource,
    setStage: (stage: MonitoringProfileRunStage) => void,
    setPreview: (result: MonitoringProfileSourceRunResult) => void,
    setProviderWait: (
      providerRunIds: string[],
      collectorResult: MonitoringProfileSourceRunResult,
    ) => void,
  ) => Promise<MonitoringProfileSourceRunResult>
  onProgress?: (progress: MonitoringProfileRunProgress) => void
  shouldStop?: () => boolean
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function unknownCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? safeCount(value)
    : null
}

function issueMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "source_run_failed"
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function distinctLimitations(...values: Array<string | null | undefined | string[]>): string[] {
  return Array.from(new Set(values.flatMap(value =>
    Array.isArray(value) ? value : typeof value === "string" ? [value] : [],
  ).map(value => value.trim()).filter(Boolean)))
}

export function monitoringProfileSourceRunCounts(
  result: MonitoringProfileSourceRunResult,
): MonitoringProfileRunCounts {
  const stats = recordFromUnknown(result.rawStats)
  const rejectionHistogram = recordFromUnknown(stats.rejectionReasonHistogram)
  const rejectionStatuses = recordFromUnknown(rejectionHistogram.byStatus)
  const histogramReview = unknownCount(rejectionStatuses.REVIEW) ?? 0
  const review = result.reviewCount === undefined
    ? histogramReview
    : safeCount(result.reviewCount)
  const ignored = result.ignoredCount === undefined ? 0 : safeCount(result.ignoredCount)
  const rejected = result.rejectedCount === undefined
    ? Math.max(0, ignored - review)
    : safeCount(result.rejectedCount)

  return {
    found: safeCount(result.foundCount),
    accepted: safeCount(result.acceptedCount ?? result.newCount),
    review,
    rejected,
    duplicates: safeCount(result.duplicateCount),
  }
}

export function summarizeMonitoringProfileRunPlatforms(
  sources: MonitoringProfileRunSourceSummary[],
): MonitoringProfileRunPlatformSummary[] {
  const platforms = new Map<string, MonitoringProfileRunPlatformSummary>()
  for (const source of sources) {
    const current = platforms.get(source.platform) ?? {
      platform: source.platform,
      found: 0,
      accepted: 0,
      review: 0,
      rejected: 0,
      duplicates: 0,
      sources: [],
      issueCount: 0,
    }
    current.found += source.found
    current.accepted += source.accepted
    current.review += source.review
    current.rejected += source.rejected
    current.duplicates += source.duplicates
    current.sources.push(source)
    if (
      source.limitations.length > 0
      || !["success", "completed", "imported"].includes(source.status.toLowerCase())
    ) {
      current.issueCount += 1
    }
    platforms.set(source.platform, current)
  }
  return Array.from(platforms.values())
}

export function monitoringCollectorResultHasPendingProvider(
  result: MonitoringProfileSourceRunResult,
): boolean {
  const pendingStatuses = new Set(["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"])
  const visit = (value: unknown, depth = 0): boolean => {
    if (depth > 5) return false
    if (Array.isArray(value)) return value.some(item => visit(item, depth + 1))
    const row = recordFromUnknown(value)
    if (row.queued === true || row.asyncPending === true) return true
    const providerStatus = typeof row.providerStatus === "string"
      ? row.providerStatus.toUpperCase()
      : ""
    if (pendingStatuses.has(providerStatus)) return true
    return Object.values(row).some(item => visit(item, depth + 1))
  }
  return visit(result.rawStats)
}

export function monitoringCollectorPendingProviderRunIds(
  result: MonitoringProfileSourceRunResult,
): string[] {
  const ids = new Set<string>()
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5) return
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }
    const row = recordFromUnknown(value)
    if (typeof row.providerRunId === "string" && row.providerRunId.trim()) {
      ids.add(row.providerRunId.trim())
    }
    Object.values(row).forEach(item => visit(item, depth + 1))
  }
  visit(result.rawStats)
  return Array.from(ids)
}

export function summarizeMonitoringProviderRuns(
  runs: MonitoringProfileProviderRun[],
): MonitoringProfileSourceRunResult {
  // PAID_ROUTE_COLLECTION is a reservation/audit ledger row, not a second
  // provider snapshot. Once a concrete provider row exists, exclude the
  // wrapper so its lifecycle and mirrored counts cannot keep the source
  // pending or double-count the result.
  const providerRuns = runs.some(run => run.phase?.toUpperCase() !== "PAID_ROUTE_COLLECTION")
    ? runs.filter(run => run.phase?.toUpperCase() !== "PAID_ROUTE_COLLECTION")
    : runs
  const activeStatuses = new Set(["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"])
  const terminalSuccessStatuses = new Set(["IMPORTED", "PURGED"])
  const terminalIssueStatuses = new Set(["FAILED", "BLOCKED", "PARTIAL"])
  const statuses = providerRuns.map(run => run.status.toUpperCase())
  const active = providerRuns.length === 0 || providerRuns.some(run => {
    const status = run.status.toUpperCase()
    // A successful reservation wrapper has already finished its audit role
    // and has no dataset to import. A RUNNING wrapper remains pending:
    // without a concrete provider row, it is unsafe to infer whether dispatch
    // is still in flight or its acknowledgement was lost.
    if (run.phase?.toUpperCase() === "PAID_ROUTE_COLLECTION" && status === "SUCCEEDED") {
      return false
    }
    return activeStatuses.has(status)
      || (!terminalSuccessStatuses.has(status) && !terminalIssueStatuses.has(status))
  })
  const failedCount = statuses.filter(status => ["FAILED", "BLOCKED"].includes(status)).length
  const partialCount = statuses.filter(status => status === "PARTIAL").length
  const counts = providerRuns.reduce((summary, run) => ({
    foundCount: summary.foundCount + safeCount(run.receivedCount),
    acceptedCount: summary.acceptedCount + safeCount(run.acceptedCount),
    reviewCount: summary.reviewCount + safeCount(run.reviewCount),
    rejectedCount: summary.rejectedCount + safeCount(run.rejectedCount),
    duplicateCount: summary.duplicateCount + safeCount(run.duplicateCount),
  }), {
    foundCount: 0,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
  })
  const limitations = distinctLimitations(
    providerRuns.map(run => run.lastError ?? null).filter((value): value is string => Boolean(value)),
  )

  return {
    status: active
      ? "pending"
      : failedCount === providerRuns.length
        ? "failed"
        : failedCount > 0 || partialCount > 0
          ? "partial"
          : "success",
    ...counts,
    newCount: counts.acceptedCount,
    ignoredCount: counts.reviewCount + counts.rejectedCount,
    error: providerRuns.find(run => run.lastError)?.lastError ?? null,
    limitations,
  }
}

export function mergeMonitoringCollectorAndProviderResult(
  collector: MonitoringProfileSourceRunResult,
  provider: MonitoringProfileSourceRunResult,
): MonitoringProfileSourceRunResult {
  const collectorStatus = collector.status.toLowerCase()
  const providerStatus = provider.status.toLowerCase()
  const providerPending = ["pending", "queued", "running", "importing", "submitted"].includes(providerStatus)
  const hasFailure = collectorStatus === "failed" || providerStatus === "failed"
  const hasLimitation = ["failed", "partial", "skipped"].includes(collectorStatus)
    || ["failed", "partial", "skipped"].includes(providerStatus)
  const collectorCounts = monitoringProfileSourceRunCounts(collector)
  const providerCounts = monitoringProfileSourceRunCounts(provider)
  const acceptedCount = collectorCounts.accepted + providerCounts.accepted
  const reviewCount = collectorCounts.review + providerCounts.review
  const rejectedCount = collectorCounts.rejected + providerCounts.rejected
  const limitations = distinctLimitations(
    collector.limitations ?? [],
    collector.error,
    provider.limitations ?? [],
    provider.error,
  )

  return {
    ...collector,
    status: providerPending
      ? "pending"
      : hasFailure
        ? "failed"
        : hasLimitation
          ? "partial"
          : "success",
    foundCount: collectorCounts.found + providerCounts.found,
    newCount: acceptedCount,
    acceptedCount,
    reviewCount,
    rejectedCount,
    ignoredCount: reviewCount + rejectedCount,
    duplicateCount: collectorCounts.duplicates + providerCounts.duplicates,
    error: provider.error?.trim() || collector.error?.trim() || null,
    limitations,
  }
}

function finalPhase(
  progress: MonitoringProfileRunProgress,
  stopped: boolean,
): MonitoringProfileRunPhase {
  if (stopped && progress.attempted < progress.total) return "stopped"
  if (progress.pending > 0) return "completed_with_pending"
  if (progress.failed > 0 || progress.partial > 0 || progress.skipped > 0) {
    return "completed_with_issues"
  }
  return "completed"
}

function sourceRunSummary(
  source: MonitoringProfileRunSource,
  result: MonitoringProfileSourceRunResult,
): MonitoringProfileRunSourceSummary {
  return {
    sourceId: source.id,
    platform: source.platform,
    label: source.label || source.platform,
    status: result.status,
    ...monitoringProfileSourceRunCounts(result),
    limitations: distinctLimitations(result.limitations ?? [], result.error),
  }
}

/**
 * Runs only the active sources already attached to one monitoring profile.
 *
 * The queue is deliberately sequential: a single operator click must not
 * dogpile paid providers, and cooperative stop should leave at most the current
 * request in flight. A dispatched source run cannot be recalled server-side,
 * so shouldStop() prevents only the next source from starting.
 */
export async function runMonitoringProfileSources({
  sources,
  initialProgress = null,
  runSource,
  onProgress,
  shouldStop = () => false,
}: RunMonitoringProfileSourcesOptions): Promise<MonitoringProfileRunProgress> {
  const seen = new Set<string>()
  const filteredSources = sources.filter(source => {
    if (!source.isActive || seen.has(source.id)) return false
    seen.add(source.id)
    return true
  })
  const restoredProviderWait = initialProgress?.current?.stage === "provider_wait"
    && initialProgress.current.providerWait?.providerRunIds.length
    ? initialProgress.current
    : null
  const restoredSourceIndex = restoredProviderWait
    ? filteredSources.findIndex(source => source.id === restoredProviderWait.id)
    : -1
  const runnable = restoredSourceIndex > 0
    ? [
        filteredSources[restoredSourceIndex],
        ...filteredSources.slice(0, restoredSourceIndex),
        ...filteredSources.slice(restoredSourceIndex + 1),
      ]
    : filteredSources
  let progress: MonitoringProfileRunProgress = initialProgress ? {
    ...initialProgress,
    phase: "running",
    total: Math.max(initialProgress.total, initialProgress.attempted + runnable.length),
    partial: initialProgress.partial + initialProgress.pending,
    pending: 0,
    sourceResults: initialProgress.sourceResults.map(source =>
      ["pending", "queued", "running", "importing", "submitted"].includes(source.status.toLowerCase())
        ? { ...source, status: "partial" }
        : source),
    current: restoredProviderWait && restoredSourceIndex >= 0
      ? restoredProviderWait
      : null,
  } : {
    phase: "running",
    total: runnable.length,
    attempted: 0,
    succeeded: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    found: 0,
    accepted: 0,
    review: 0,
    rejected: 0,
    duplicates: 0,
    sourceResults: [],
    current: null,
    lastIssue: null,
  }

  const publish = (next: MonitoringProfileRunProgress) => {
    progress = next
    onProgress?.(next)
  }

  publish(progress)

  // A persisted provider wait is the only safe identity for an asynchronous
  // source after a reload. If the caller did not supply that exact source,
  // retain the resumable checkpoint instead of dispatching a different source.
  if (restoredProviderWait && restoredSourceIndex < 0) {
    publish({ ...progress, phase: "stopped", current: restoredProviderWait })
    return progress
  }

  for (let index = 0; index < runnable.length; index += 1) {
    if (shouldStop()) {
      publish({
        ...progress,
        phase: "stopped",
        current: progress.current?.stage === "provider_wait"
          ? progress.current
          : null,
      })
      return progress
    }

    const source = runnable[index]
    const currentProviderWait = index === 0
      && progress.current?.id === source.id
      && progress.current.stage === "provider_wait"
      && progress.current.providerWait?.providerRunIds.length
      ? progress.current
      : null
    publish({
      ...progress,
      phase: "running",
      current: currentProviderWait
        ? {
            ...currentProviderWait,
            index: progress.attempted + 1,
          }
        : {
            id: source.id,
            platform: source.platform,
            label: source.label || source.platform,
            index: progress.attempted + 1,
            stage: "starting",
            preview: {
              found: 0,
              accepted: 0,
              review: 0,
              rejected: 0,
              duplicates: 0,
            },
          },
    })

    try {
      const result = await runSource(source, stage => {
        if (progress.current?.id !== source.id) return
        publish({
          ...progress,
          phase: shouldStop() ? "stopping" : progress.phase,
          current: { ...progress.current, stage },
        })
      }, preview => {
        if (progress.current?.id !== source.id) return
        publish({
          ...progress,
          current: {
            ...progress.current,
            preview: monitoringProfileSourceRunCounts(preview),
          },
        })
      }, (providerRunIds, collectorResult) => {
        if (progress.current?.id !== source.id) return
        publish({
          ...progress,
          current: {
            ...progress.current,
            stage: "provider_wait",
            providerWait: {
              providerRunIds: Array.from(new Set(
                providerRunIds.map(value => value.trim()).filter(Boolean),
              )).slice(0, 50),
              collectorResult,
            },
          },
        })
      })
      const status = result.status.toLowerCase()
      const failed = status === "failed" ? 1 : 0
      const partial = status === "partial" ? 1 : 0
      const skipped = status === "skipped" ? 1 : 0
      const pending = ["pending", "queued", "running", "importing", "submitted"].includes(status) ? 1 : 0
      const succeeded = ["success", "completed", "imported"].includes(status) ? 1 : 0

      // The source is not complete while its identified provider job is still
      // active. Keep the exact provider IDs and collector result in `current`
      // so a later invocation polls this job instead of dispatching it again.
      if (
        pending > 0
        && progress.current?.id === source.id
        && progress.current.stage === "provider_wait"
        && progress.current.providerWait?.providerRunIds.length
      ) {
        publish({
          ...progress,
          phase: "stopped",
          current: {
            ...progress.current,
            preview: monitoringProfileSourceRunCounts(result),
          },
        })
        return progress
      }

      const unknown = failed || partial || skipped || pending || succeeded ? 0 : 1
      const reportedIssue = result.error?.trim()
      const statusIssue = unknown
        ? `unexpected_source_status:${status || "empty"}`
        : null
      const sourceResult = sourceRunSummary(source, statusIssue
        ? {
            ...result,
            limitations: distinctLimitations(result.limitations ?? [], statusIssue),
          }
        : result)

      publish({
        ...progress,
        phase: shouldStop() && index + 1 < runnable.length ? "stopping" : "running",
        attempted: progress.attempted + 1,
        succeeded: progress.succeeded + succeeded,
        partial: progress.partial + partial,
        failed: progress.failed + failed + unknown,
        skipped: progress.skipped + skipped,
        pending: progress.pending + pending,
        found: progress.found + sourceResult.found,
        accepted: progress.accepted + sourceResult.accepted,
        review: progress.review + sourceResult.review,
        rejected: progress.rejected + sourceResult.rejected,
        duplicates: progress.duplicates + sourceResult.duplicates,
        sourceResults: [...progress.sourceResults, sourceResult],
        current: null,
        lastIssue: reportedIssue || unknown
          ? {
              sourceId: source.id,
              sourceLabel: source.label || source.platform,
              error: reportedIssue || statusIssue || "source_run_failed",
            }
          : progress.lastIssue,
      })

      // A provider job can legitimately outlive the browser polling window.
      // Halt the queue instead of starting another (possibly paid) source while
      // the previous source is still running in the background.
      if (pending > 0 && index + 1 < runnable.length) {
        publish({
          ...progress,
          phase: shouldStop() ? "stopped" : "completed_with_pending",
          current: null,
        })
        return progress
      }
    } catch (error) {
      const errorText = issueMessage(error)
      if (
        progress.current?.id === source.id
        && progress.current.stage === "provider_wait"
        && progress.current.providerWait?.providerRunIds.length
      ) {
        publish({
          ...progress,
          phase: "stopped",
          lastIssue: {
            sourceId: source.id,
            sourceLabel: source.label || source.platform,
            error: errorText,
          },
        })
        return progress
      }

      const ambiguousPaidFailure = source.paid === true
      const sourceResult = sourceRunSummary(source, {
        status: ambiguousPaidFailure ? "pending" : "failed",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        error: errorText,
      })
      publish({
        ...progress,
        phase: shouldStop() && index + 1 < runnable.length ? "stopping" : "running",
        attempted: progress.attempted + 1,
        failed: progress.failed + (ambiguousPaidFailure ? 0 : 1),
        pending: progress.pending + (ambiguousPaidFailure ? 1 : 0),
        sourceResults: [...progress.sourceResults, sourceResult],
        current: null,
        lastIssue: {
          sourceId: source.id,
          sourceLabel: source.label || source.platform,
          error: errorText,
        },
      })
      if (ambiguousPaidFailure && index + 1 < runnable.length) {
        publish({
          ...progress,
          phase: "completed_with_pending",
          current: null,
        })
        return progress
      }
    }

    if (shouldStop() && index + 1 < runnable.length) {
      publish({ ...progress, phase: "stopped", current: null })
      return progress
    }
  }

  publish({
    ...progress,
    phase: finalPhase(progress, shouldStop()),
    current: null,
  })
  return progress
}
