import type { MonitoringProfileRunPhase } from "@/lib/social/monitoring-profile-runner"

export type MonitoringProfileBulkPlanSource = {
  id: string
  isActive: boolean
  paid?: boolean
  sharedAcrossMonitorings?: boolean
}

export type MonitoringProfileBulkPlanProfile = {
  id: string
  subjectId: string | null
  scenarioId: string | null
  status: string
  sources: MonitoringProfileBulkPlanSource[]
}

export type MonitoringProfileBulkPlanItem = {
  profileId: string
  sourceCount: number
  paidSourceCount: number
  sharedSourceCount: number
}

export type MonitoringProfileBulkPlan = {
  items: MonitoringProfileBulkPlanItem[]
  totalProfiles: number
  totalSources: number
  paidSources: number
  sharedSources: number
}

/**
 * Builds a profile/source plan without deduplicating a physical source across
 * profiles. The server evaluates each run for one target subject, so the same
 * shared source attached to two brands is intentionally two plan entries.
 */
export function createMonitoringProfileBulkPlan(
  profiles: MonitoringProfileBulkPlanProfile[],
): MonitoringProfileBulkPlan {
  const items = profiles.flatMap(profile => {
    if (
      profile.status !== "active"
      || !profile.subjectId
      || !profile.scenarioId
    ) return []

    const sources = Array.from(new Map(
      profile.sources
        .filter(source => source.isActive)
        .map(source => [source.id, source]),
    ).values())
    if (sources.length === 0) return []

    return [{
      profileId: profile.id,
      sourceCount: sources.length,
      paidSourceCount: sources.filter(source => source.paid).length,
      sharedSourceCount: sources.filter(source => source.sharedAcrossMonitorings).length,
    }]
  })

  return {
    items,
    totalProfiles: items.length,
    totalSources: items.reduce((total, item) => total + item.sourceCount, 0),
    paidSources: items.reduce((total, item) => total + item.paidSourceCount, 0),
    sharedSources: items.reduce((total, item) => total + item.sharedSourceCount, 0),
  }
}

export type MonitoringProfileBulkOutcome =
  | MonitoringProfileRunPhase
  | "failed_to_start"

export type MonitoringProfileBulkPhase =
  | "running"
  | "stopping"
  | "completed"
  | "completed_with_issues"
  | "stopped"

export type MonitoringProfileBulkProgress = {
  phase: MonitoringProfileBulkPhase
  totalProfiles: number
  processedProfiles: number
  currentProfileId: string | null
  outcomes: Record<string, MonitoringProfileBulkOutcome>
}

type RunMonitoringProfileBulkPlanOptions = {
  items: MonitoringProfileBulkPlanItem[]
  runProfile: (
    item: MonitoringProfileBulkPlanItem,
  ) => Promise<MonitoringProfileBulkOutcome | null>
  onProgress?: (progress: MonitoringProfileBulkProgress) => void
  shouldStop?: () => boolean
}

const ISSUE_OUTCOMES = new Set<MonitoringProfileBulkOutcome>([
  "completed_with_issues",
  "failed_to_start",
])

const HALT_OUTCOMES = new Set<MonitoringProfileBulkOutcome>([
  "completed_with_pending",
  "stopped",
])

/**
 * Runs profile queues strictly one at a time. An ambiguous provider result or
 * cooperative stop halts the outer queue so another paid profile cannot begin
 * while the previous dispatch is unresolved.
 */
export async function runMonitoringProfileBulkPlan({
  items,
  runProfile,
  onProgress,
  shouldStop = () => false,
}: RunMonitoringProfileBulkPlanOptions): Promise<MonitoringProfileBulkProgress> {
  let progress: MonitoringProfileBulkProgress = {
    phase: "running",
    totalProfiles: items.length,
    processedProfiles: 0,
    currentProfileId: null,
    outcomes: {},
  }
  const publish = (next: MonitoringProfileBulkProgress) => {
    progress = next
    onProgress?.(next)
  }

  publish(progress)

  for (const item of items) {
    if (shouldStop()) {
      publish({ ...progress, phase: "stopped", currentProfileId: null })
      return progress
    }

    publish({ ...progress, phase: "running", currentProfileId: item.profileId })

    let outcome: MonitoringProfileBulkOutcome
    try {
      outcome = await runProfile(item) ?? "failed_to_start"
    } catch {
      outcome = "failed_to_start"
    }

    const next: MonitoringProfileBulkProgress = {
      ...progress,
      processedProfiles: progress.processedProfiles + 1,
      currentProfileId: null,
      outcomes: {
        ...progress.outcomes,
        [item.profileId]: outcome,
      },
    }

    if (HALT_OUTCOMES.has(outcome) || shouldStop()) {
      publish({ ...next, phase: "stopped" })
      return progress
    }

    publish(next)
  }

  const hasIssues = Object.values(progress.outcomes).some(outcome => ISSUE_OUTCOMES.has(outcome))
  publish({
    ...progress,
    phase: hasIssues ? "completed_with_issues" : "completed",
    currentProfileId: null,
  })
  return progress
}
