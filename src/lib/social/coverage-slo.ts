import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { isInfraConfigError } from "@/lib/social/collector-error-classifier"
import {
  allowsAutomaticSourceCollection,
  automaticSourceCollectionDecision,
  type AutomaticRoutePlan,
} from "@/lib/social/automatic-collection-policy"
import { SOURCE_ROUTE_POLICY_VERSION } from "@/lib/social/source-route-plan"
import {
  writeSocialCoverageAlerts,
  type SocialCoverageAlertCandidate,
} from "@/lib/social/coverage-alerts"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export interface SocialCoverageSloRunInput {
  status: string
  startedAt?: Date | null
  finishedAt?: Date | null
  error?: string | null
  foundCount?: number | null
  rawStats?: unknown
}

export interface SocialCoverageSloSourceInput {
  id: string
  organizationId: string
  platform: string
  sourceType: string
  url?: string | null
  handle?: string | null
  status: string
  lastSuccessfulAt?: Date | null
  lastCheckedAt?: Date | null
  lastError?: string | null
  settings?: unknown
  automaticCollectionEligible?: boolean
  recentRuns: SocialCoverageSloRunInput[]
}

type SocialCoverageSloSourceRow = Omit<SocialCoverageSloSourceInput, "recentRuns" | "automaticCollectionEligible"> & {
  ownership: string
  settings: unknown
  organization: { settings: unknown }
  routePlans: AutomaticRoutePlan[]
  subjectSources: Array<{ relationType: string; scenarioId: string | null; subject: { status: string } }>
}

const ACTIVE_STATUSES = new Set(["active", "limited"])
const FAILURE_STATUSES = new Set(["failed", "partial"])
const PROVIDER_ERROR_PATTERN = /(401|403|429|5\d{2}|auth|forbidden|rate.?limit|quota|budget)/i

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function histogramTotal(run: SocialCoverageSloRunInput): number {
  const histogram = asRecord(asRecord(run.rawStats).rejectionReasonHistogram)
  const total = histogram.total
  return typeof total === "number" && Number.isFinite(total) ? Math.max(0, total) : 0
}

function candidate(
  source: SocialCoverageSloSourceInput,
  rule: SocialCoverageAlertCandidate["rule"],
  severity: SocialCoverageAlertCandidate["severity"],
  message: string,
  suffix: string,
  metadata: Record<string, unknown> = {},
): SocialCoverageAlertCandidate {
  return {
    rule,
    severity,
    message,
    dedupeKey: `${rule}:${source.id}:${suffix}`,
    metadata: {
      sourceId: source.id,
      platform: source.platform,
      sourceType: source.sourceType,
      ...metadata,
    },
  }
}

export function evaluateSocialCoverageSloRules(
  sources: SocialCoverageSloSourceInput[],
  now = new Date(),
): SocialCoverageAlertCandidate[] {
  const staleCutoff = now.getTime() - 24 * 60 * 60 * 1000
  const candidates: SocialCoverageAlertCandidate[] = []

  for (const source of sources) {
    if (!ACTIVE_STATUSES.has(source.status)) continue
    if (!allowsAutomaticSourceCollection(source.settings)) continue
    if (source.automaticCollectionEligible === false) continue
    const lastSuccess = source.lastSuccessfulAt?.getTime() ?? 0
    if (lastSuccess === 0 || lastSuccess < staleCutoff) {
      candidates.push(candidate(
        source,
        "stale_source",
        source.lastSuccessfulAt ? "warning" : "critical",
        `${source.platform} source has no successful collector run in the last 24 hours`,
        "24h",
        {
          lastSuccessfulAt: source.lastSuccessfulAt?.toISOString() ?? null,
          lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
        },
      ))
    }

    const recent = source.recentRuns.slice(0, 5)
    const failurePrefix = recent.length >= 3 && recent.slice(0, 3).every(run => FAILURE_STATUSES.has(run.status))
    if (failurePrefix) {
      candidates.push(candidate(
        source,
        "consecutive_failures",
        "critical",
        `${source.platform} source has three consecutive failed or partial runs`,
        "3",
        {
          consecutiveRuns: recent.slice(0, 3).map(run => ({ status: run.status, error: run.error ?? null })),
        },
      ))
    }

    const zeroPrefix = recent.length >= 3 && recent.slice(0, 3).every(run =>
      run.status === "success" && (run.foundCount ?? 0) === 0,
    )
    if (zeroPrefix) {
      candidates.push(candidate(
        source,
        "unexpected_zero_results",
        "warning",
        `${source.platform} source returned zero observations in three consecutive successful runs`,
        "3",
        { consecutiveRuns: 3 },
      ))
    }

    // A successful collector pass proves the provider recovered. Only inspect
    // the unresolved prefix before the newest success; older incidents remain
    // in run history for audit, but must not keep a healthy source critical.
    const newestSuccessIndex = recent.findIndex(run => run.status === "success")
    const unresolvedRecent = newestSuccessIndex === -1 ? recent : recent.slice(0, newestSuccessIndex)
    const providerErrors = unresolvedRecent
      .filter(run => FAILURE_STATUSES.has(run.status) && PROVIDER_ERROR_PATTERN.test(run.error ?? ""))
      .slice(0, 3)
    if (providerErrors.length >= 2) {
      const errorClass = (providerErrors[0].error ?? "provider_error").toLowerCase().match(/(401|403|429|5\d{2}|auth|forbidden|rate.?limit|quota|budget)/i)?.[1] ?? "provider_error"
      const rule: SocialCoverageAlertCandidate["rule"] = /(budget|quota)/i.test(errorClass)
        ? "budget_exhaustion"
        : "provider_status_failure"
      candidates.push(candidate(
        source,
        rule,
        "critical",
        `${source.platform} source has repeated provider ${errorClass} failures`,
        errorClass,
        {
          errorClass,
          recentErrors: providerErrors.map(run => run.error ?? "unknown"),
        },
      ))
    }

    const rejectionRuns = recent.filter(run => {
      const total = histogramTotal(run)
      const found = Math.max(0, run.foundCount ?? 0)
      return total >= 10 && total / Math.max(total + found, 1) >= 0.8
    })
    if (rejectionRuns.length >= 2) {
      candidates.push(candidate(
        source,
        "rejection_spike",
        "warning",
        `${source.platform} source rejection rate is above 80% in recent runs`,
        "80pct",
        {
          affectedRuns: rejectionRuns.length,
          rejectionTotals: rejectionRuns.slice(0, 3).map(histogramTotal),
        },
      ))
    }
  }

  return candidates
}

// Self-heal: a source that has not succeeded in 24h+ because of a CONFIG-class
// failure (budget gate, missing routes, provider flag) is put back at the front
// of the due queue — the retry itself recompiles plans and re-checks gates, so
// no human has to notice the watchdog alert and wake sources by hand. Bounded:
// at most one revive per source per 6h, config-class errors only (real
// provider failures keep their backoff).
const REVIVE_MIN_IDLE_MS = 6 * 60 * 60 * 1000
const REVIVE_STALE_SUCCESS_MS = 24 * 60 * 60 * 1000
const REVIVE_QUEUE_JUMP_MS = 30 * 24 * 60 * 60 * 1000

async function reviveStarvedSources(
  sources: Array<Pick<SocialCoverageSloSourceInput, "id" | "organizationId" | "status" | "lastSuccessfulAt" | "lastCheckedAt" | "lastError" | "automaticCollectionEligible">>,
  now: Date,
): Promise<number> {
  const byOrg = new Map<string, string[]>()
  for (const source of sources) {
    if (!ACTIVE_STATUSES.has(source.status)) continue
    if (source.automaticCollectionEligible === false) continue
    if (!isInfraConfigError(source.lastError)) continue
    const lastSuccess = source.lastSuccessfulAt?.getTime() ?? 0
    const lastChecked = source.lastCheckedAt?.getTime() ?? 0
    if (lastSuccess >= now.getTime() - REVIVE_STALE_SUCCESS_MS) continue
    // Never-checked sources are already due by definition; only revive ones
    // the backoff has parked, and no more than once per 6h.
    if (lastChecked === 0 || lastChecked >= now.getTime() - REVIVE_MIN_IDLE_MS) continue
    const list = byOrg.get(source.organizationId) ?? []
    list.push(source.id)
    byOrg.set(source.organizationId, list)
  }
  let revived = 0
  for (const [organizationId, ids] of byOrg) {
    const updated = await prisma.monitoringSource.updateMany({
      where: { id: { in: ids }, organizationId, status: { in: ["active", "limited"] } },
      data: { lastCheckedAt: new Date(now.getTime() - REVIVE_QUEUE_JUMP_MS) },
    }).catch(() => ({ count: 0 }))
    revived += updated.count
  }
  return revived
}

// The watchdog's findings must reach the owner, not just an alerts panel:
// when NEW coverage alerts were written this pass (24h-deduped upstream),
// ping the org's active admins/managers with an in-app + push notification.
async function notifyCoverageBreakage(organizationId: string, created: number, sample: string): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { organizationId, role: { in: ["admin", "manager"] }, isActive: true },
    select: { id: true },
  }).catch(() => [] as Array<{ id: string }>)
  for (const admin of admins) {
    await createNotification({
      organizationId,
      userId: admin.id,
      type: "warning",
      title: "Мониторинг: сбой сбора",
      message: `${created} источник(ов) с проблемами сбора (${sample}). Детали — в AI-алертах.`,
      entityType: "social_mention",
      entityId: "coverage",
      push: true,
      kind: "social.coverage",
      awaitPush: true,
    }).catch(() => {})
  }
  return admins.length
}

type SocialCoverageSloCheckResult = {
  evaluated: number
  created: number
  revived: number
  notifiedAdmins: number
  candidates: SocialCoverageAlertCandidate[]
}

function emptySocialCoverageSloResult(): SocialCoverageSloCheckResult {
  return {
    evaluated: 0,
    created: 0,
    revived: 0,
    notifiedAdmins: 0,
    candidates: [],
  }
}

async function runSocialCoverageSloChecksWithinFence(input: {
  organizationId: string
  sourceIds?: string[]
  now: Date
}): Promise<SocialCoverageSloCheckResult> {
  const sources: SocialCoverageSloSourceRow[] = await prisma.monitoringSource.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.sourceIds ? { id: { in: input.sourceIds } } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      platform: true,
      sourceType: true,
      url: true,
      handle: true,
      ownership: true,
      status: true,
      lastSuccessfulAt: true,
      lastCheckedAt: true,
      lastError: true,
      settings: true,
      organization: { select: { settings: true } },
      routePlans: {
        where: { status: { not: "INVALIDATED" } },
        select: {
          status: true,
          capability: true,
          primaryAdapter: true,
          fallbackAdapters: true,
          capabilityProofId: true,
          budget: true,
          policyVersion: true,
          dependsOnCapability: true,
          lastFailureClass: true,
        },
      },
      subjectSources: {
        select: {
          relationType: true,
          scenarioId: true,
          subject: { select: { status: true } },
        },
      },
    },
    take: 500,
  })
  if (sources.length === 0) return emptySocialCoverageSloResult()

  const runs = await prisma.collectorRun.findMany({
    where: {
      organizationId: input.organizationId,
      sourceId: { in: sources.map(source => source.id) },
    },
    orderBy: { startedAt: "desc" },
    select: {
      sourceId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      error: true,
      foundCount: true,
      rawStats: true,
    },
    // Global runs pass an already bounded sourceIds slice. Avoid applying the
    // old per-query minimum to every tenant, which could turn a 2,500-row
    // global watchdog pass into 25,000 rows across many one-source tenants.
    take: input.sourceIds
      ? Math.min(2500, Math.max(1, sources.length * 5))
      : Math.min(2500, Math.max(50, sources.length * 5)),
  })
  const runsBySource = new Map<string, SocialCoverageSloRunInput[]>()
  for (const run of runs) {
    const list = runsBySource.get(run.sourceId) ?? []
    if (list.length < 5) list.push(run)
    runsBySource.set(run.sourceId, list)
  }

  const sloSources: SocialCoverageSloSourceInput[] = sources.map(source => ({
    ...source,
    automaticCollectionEligible: automaticSourceCollectionDecision({
      settings: source.settings,
      platform: source.platform,
      sourceType: source.sourceType,
      url: source.url,
      handle: source.handle,
      ownership: source.ownership,
      linkedSubjectStatuses: source.subjectSources?.map(link => link.subject.status) ?? [],
      linkedSubjectRelations: source.subjectSources ?? [],
      routePlans: source.routePlans ?? [],
      organizationSettings: source.organization?.settings,
      currentRoutePolicyVersion: SOURCE_ROUTE_POLICY_VERSION,
    }).allowed,
    recentRuns: runsBySource.get(source.id) ?? [],
  }))
  const candidates = evaluateSocialCoverageSloRules(sloSources, input.now)
  const created = await writeSocialCoverageAlerts(
    input.organizationId,
    candidates,
    input.now,
  )
  let notifiedAdmins = 0
  if (created > 0) {
    const sample = candidates
      .slice(0, 3)
      .map((item) => `${item.metadata.platform}: ${item.rule}`)
      .join(", ")
    notifiedAdmins = await notifyCoverageBreakage(
      input.organizationId,
      created,
      sample,
    )
  }
  const revived = await reviveStarvedSources(sloSources, input.now)
  return { evaluated: candidates.length, created, revived, notifiedAdmins, candidates }
}

export async function runSocialCoverageSloChecks(options: {
  organizationId?: string
  now?: Date
} = {}): Promise<SocialCoverageSloCheckResult> {
  const now = options.now ?? new Date()

  const requestedOrganizationId = options.organizationId
  if (requestedOrganizationId) {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      requestedOrganizationId,
      () => runSocialCoverageSloChecksWithinFence({
        organizationId: requestedOrganizationId,
        now,
      }),
    )
    return fenced.allowed ? fenced.value : emptySocialCoverageSloResult()
  }

  // Preserve the former global 500-source bound while keeping every source
  // detail read, alert write, notification and revive inside its tenant lock.
  // This first pass discovers only the bounded tenant/source scope; every row
  // is re-read after that tenant's clean-slate fence has been acquired.
  const sourceScope = await prisma.monitoringSource.findMany({
    select: { id: true, organizationId: true },
    take: 500,
  })
  const sourceIdsByOrganization = new Map<string, string[]>()
  for (const source of sourceScope) {
    const ids = sourceIdsByOrganization.get(source.organizationId) ?? []
    ids.push(source.id)
    sourceIdsByOrganization.set(source.organizationId, ids)
  }

  const result = emptySocialCoverageSloResult()
  for (const [organizationId, sourceIds] of sourceIdsByOrganization) {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      organizationId,
      () => runSocialCoverageSloChecksWithinFence({
        organizationId,
        sourceIds,
        now,
      }),
    )
    if (!fenced.allowed) continue
    result.evaluated += fenced.value.evaluated
    result.created += fenced.value.created
    result.revived += fenced.value.revived
    result.notifiedAdmins += fenced.value.notifiedAdmins
    result.candidates.push(...fenced.value.candidates)
  }
  return result
}
