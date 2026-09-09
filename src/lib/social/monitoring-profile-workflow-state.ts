import {
  MONITORING_PROFILE_RUN_RESUME_VERSION,
  type MonitoringProfileRunProgress,
} from "@/lib/social/monitoring-profile-runner"

export type MonitoringProfileWorkflowStage = "collection" | "review" | "results"

export const MONITORING_PROFILE_WORKFLOW_STORAGE_KEY =
  "leaddrive:social-monitoring-workflow:v1"
export const MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION = 3

export type MonitoringProfileWorkflowState = {
  selectedProfileId: string | null
  activeStage: MonitoringProfileWorkflowStage
  runProgress: Record<string, MonitoringProfileRunProgress>
}

const phases = new Set([
  "running",
  "stopping",
  "completed",
  "completed_with_issues",
  "completed_with_pending",
  "stopped",
])
const stages = new Set<MonitoringProfileWorkflowStage>([
  "collection",
  "review",
  "results",
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function validProgress(value: unknown): value is MonitoringProfileRunProgress {
  const candidate = record(value)
  const resumeContext = record(candidate.resumeContext)
  const current = candidate.current === null ? null : record(candidate.current)
  const providerWait = current ? record(current.providerWait) : null
  const hasValidProviderWait = !providerWait || Object.keys(providerWait).length === 0 || (
    Array.isArray(providerWait.providerRunIds)
    && providerWait.providerRunIds.length > 0
    && providerWait.providerRunIds.every(providerRunId => typeof providerRunId === "string")
    && Object.keys(record(providerWait.collectorResult)).length > 0
  )
  const hasResumeIdentity = resumeContext.version === MONITORING_PROFILE_RUN_RESUME_VERSION
    && typeof resumeContext.scenarioId === "string"
    && typeof resumeContext.profileRevision === "string"
    && Array.isArray(resumeContext.sourceIds)
    && resumeContext.sourceIds.every(sourceId => typeof sourceId === "string")
    && typeof resumeContext.startedAt === "string"
    && typeof resumeContext.updatedAt === "string"
  return phases.has(String(candidate.phase))
    && Number.isFinite(candidate.total)
    && Number.isFinite(candidate.attempted)
    && Array.isArray(candidate.sourceResults)
    && (candidate.current === null || typeof candidate.current === "object")
    && hasValidProviderWait
    && hasResumeIdentity
}

function resumableProgress(
  progress: MonitoringProfileRunProgress,
): MonitoringProfileRunProgress {
  // Clients before the provider-checkpoint fix recorded a timed-out or
  // ambiguous provider source as attempted/pending and then discarded its
  // provider IDs. Preserve that source result and reopen only the remaining
  // queue. This intentionally skips the already-dispatched source, so the
  // operator's "continue" action cannot create a duplicate paid request.
  if (
    progress.phase === "completed_with_pending"
    && progress.current === null
    && progress.pending > 0
    && progress.attempted < progress.total
  ) {
    return { ...progress, phase: "stopped" }
  }
  if (!["running", "stopping"].includes(progress.phase)) return progress
  if (
    progress.current
    && progress.current.stage === "provider_wait"
    && progress.current.providerWait?.providerRunIds.length
  ) {
    return { ...progress, phase: "stopped" }
  }
  // A page can disappear while dispatch is still ambiguous. Without a
  // provider-run identity it is unsafe to fire the paid source again.
  if (progress.current) {
    return { ...progress, phase: "completed_with_pending", current: null }
  }
  return { ...progress, phase: "stopped", current: null }
}

export function restoreMonitoringProfileWorkflowState(
  serialized: string | null,
): MonitoringProfileWorkflowState {
  const empty: MonitoringProfileWorkflowState = {
    selectedProfileId: null,
    activeStage: "collection",
    runProgress: {},
  }
  if (!serialized) return empty

  let stored: Record<string, unknown>
  try {
    stored = record(JSON.parse(serialized))
  } catch {
    return empty
  }

  const selectedProfileId = typeof stored.selectedProfileId === "string"
    ? stored.selectedProfileId
    : null
  const activeStage = stages.has(stored.activeStage as MonitoringProfileWorkflowStage)
    ? stored.activeStage as MonitoringProfileWorkflowStage
    : "collection"

  // Earlier versions can point at provider runs and source ids removed by a
  // monitoring reset. Preserve harmless navigation state, but never merge
  // their stale counters or provider checkpoints into a new global-search run.
  if (stored.version !== MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION) {
    return { selectedProfileId, activeStage, runProgress: {} }
  }

  const storedProgress = record(stored.runProgress)
  const runProgress = Object.fromEntries(
    Object.entries(storedProgress)
      .filter((entry): entry is [string, MonitoringProfileRunProgress] =>
        Boolean(entry[0]) && validProgress(entry[1]))
      .map(([profileId, progress]) => [profileId, resumableProgress(progress)]),
  )
  return { selectedProfileId, activeStage, runProgress }
}

export function serializeMonitoringProfileWorkflowState(
  state: MonitoringProfileWorkflowState,
): string {
  return JSON.stringify({
    version: MONITORING_PROFILE_WORKFLOW_STORAGE_VERSION,
    ...state,
  })
}
