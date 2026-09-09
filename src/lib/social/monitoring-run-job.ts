import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { hasModule, moduleRecordFromOrgFields } from "@/lib/modules"
import { checkPermission, type Role } from "@/lib/permissions"
import { logAudit, prisma } from "@/lib/prisma"
import { isSocialBrandProtectionOnly } from "@/lib/social/brand-protection"
import {
  mergeMonitoringCollectorAndProviderResult,
  monitoringCollectorPendingProviderRunIds,
  monitoringCollectorResultHasPendingProvider,
  summarizeMonitoringProviderRuns,
  type MonitoringProfileProviderRun,
  type MonitoringProfileSourceRunResult,
} from "@/lib/social/monitoring-profile-runner"
import { runMonitoringProfileSourceForSubject } from "@/lib/social/monitoring-profile-source-run"
import { listMonitoringProfiles } from "@/lib/social/monitoring-profiles"
import { monitoringSourceIdentityRole } from "@/lib/social/monitoring-source-identity"
import { monitoringSourcePresentationKind } from "@/lib/social/monitoring-source-presentation"
import { runMonitoringSourceForActor } from "@/lib/social/monitoring-source-run"
import { importApifyProviderRun } from "@/lib/social/apify-async-adapter"
import { reconcileBrightDataProviderRuns } from "@/lib/social/bright-data-reconcile"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export const SOCIAL_MONITORING_RUN_JOB_KINDS = [
  "PROFILE_FULL",
  "SOURCE_FULL",
  "WEB_NEWS",
] as const
export type SocialMonitoringRunJobKind = typeof SOCIAL_MONITORING_RUN_JOB_KINDS[number]
export const SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES = ["OWNED", "EXTERNAL"] as const
export type SocialMonitoringRunJobSourceScope = typeof SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES[number]

export const SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_PROVIDER",
  "CANCEL_REQUESTED",
] as const

const TERMINAL_ITEM_STATUSES = new Set([
  "SUCCEEDED",
  "PARTIAL",
  "SKIPPED",
  "FAILED",
  "TIMED_OUT",
])
const ISSUE_ITEM_STATUSES = new Set(["PARTIAL", "SKIPPED", "FAILED", "TIMED_OUT"])
const ACTIVE_PROVIDER_STATUSES = ["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"]
const MONETARY_ROUTE_ADAPTERS = new Set([
  "APIFY_ASYNC",
  "BRIGHT_DATA_SNAPSHOT",
  "TIKTOK_BUSINESS_API",
  "X_API",
])
const DEFAULT_BULK_RUN_CAP_USD = 5
const JOB_LEASE_MS = 15 * 60_000
const ITEM_LEASE_MS = 15 * 60_000
const PROVIDER_WAIT_MAX_MS = 20 * 60_000
const PROVIDER_TERMINAL_CONFIRMATION_MS = 5_000
const MAX_ITEMS_PER_TICK = 25
const MAX_JOB_FAILURES = 3

type JobPlanItem = {
  position: number
  subjectId?: string
  scenarioId?: string
  profileName?: string
  sourceId: string
  sourceLabel: string
  sourcePlatform: string
  paid: boolean
  providerAccountFundedOnly: boolean
  sharedAcrossMonitorings: boolean
  maxTotalChargeUsd?: number
  onlyCapability?: string
  includeComments: boolean
  fullArchiveRun: boolean
}

export type CreateSocialMonitoringRunJobInput = {
  organizationId: string
  requestedBy: string
  requestedByRole: string
  kind: SocialMonitoringRunJobKind
  sourceScope?: SocialMonitoringRunJobSourceScope
  idempotencyKey: string
  fullArchiveConfirmed?: boolean
  paidConfirmed?: boolean
  sharedConfirmed?: boolean
}

export class SocialMonitoringRunJobError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code)
    this.name = "SocialMonitoringRunJobError"
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function sourceLabel(source: {
  platform: string
  url: string | null
  handle: string | null
  query: string | null
  sourceType: string
}): string {
  const target = source.url
    ?? (source.handle ? `@${source.handle.replace(/^@+/, "")}` : null)
    ?? (source.query
      ? source.sourceType === "hashtag" ? `#${source.query}` : source.query
      : null)
    ?? source.sourceType
  return `${source.platform} · ${target}`.slice(0, 160)
}

function routeHasPaidAdapter(route: { primaryAdapter: string; fallbackAdapters: string[] }): boolean {
  return [route.primaryAdapter, ...(route.fallbackAdapters ?? [])]
    .some(adapter => MONETARY_ROUTE_ADAPTERS.has(adapter))
}

function manualCapForRoutes(routes: Array<{
  primaryAdapter: string
  fallbackAdapters: string[]
  budget: unknown
}>): number | undefined {
  const paidRoutes = routes.filter(routeHasPaidAdapter)
  if (paidRoutes.length === 0) return undefined
  const configured = paidRoutes.flatMap(route => {
    const budget = recordFromUnknown(route.budget)
    if (budget.usdLimitsConfigured !== true) return []
    const cap = positiveNumber(budget.maxTotalChargeUsd)
    return cap ? [cap] : []
  })
  return configured.length > 0 ? Math.min(...configured) : DEFAULT_BULK_RUN_CAP_USD
}

async function buildProfileJobPlan(organizationId: string): Promise<JobPlanItem[]> {
  const profiles = await listMonitoringProfiles(organizationId)
  const items: JobPlanItem[] = []
  for (const profile of profiles) {
    if (
      profile.status !== "active"
      || !profile.subjectId
      || !profile.scenarioId
    ) continue
    const sources = Array.from(new Map(
      profile.sources.filter(source => source.isActive).map(source => [source.id, source]),
    ).values())
    for (const source of sources) {
      items.push({
        position: items.length + 1,
        subjectId: profile.subjectId,
        scenarioId: profile.scenarioId,
        profileName: profile.name,
        sourceId: source.id,
        sourceLabel: source.label || `${source.platform} · ${source.sourceType}`,
        sourcePlatform: source.platform,
        paid: source.paid,
        providerAccountFundedOnly: source.providerAccountFundedOnly,
        sharedAcrossMonitorings: source.sharedAcrossMonitorings,
        includeComments: Boolean(
          profile.commentsEnabled
          && source.paid
          && !source.providerAccountFundedOnly,
        ),
        fullArchiveRun: true,
      })
    }
  }
  return items
}

async function buildWatchlistJobPlan(
  organizationId: string,
  kind: "SOURCE_FULL" | "WEB_NEWS",
  sourceScope: SocialMonitoringRunJobSourceScope,
): Promise<JobPlanItem[]> {
  const [sources, brandProtectionOnly] = await Promise.all([
    prisma.monitoringSource.findMany({
      where: {
        organizationId,
        status: { notIn: ["paused", "draft", "disabled"] },
      },
      orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        platform: true,
        sourceType: true,
        url: true,
        handle: true,
        query: true,
        ownership: true,
        settings: true,
        routePlans: {
          where: { status: { not: "INVALIDATED" } },
          select: {
            primaryAdapter: true,
            fallbackAdapters: true,
            budget: true,
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
    }),
    isSocialBrandProtectionOnly(organizationId),
  ])

  const eligible = sources.filter(source => {
    if (sourceScope === "OWNED") {
      if (source.ownership !== "owned") return false
    } else {
      if (source.ownership === "owned") return false
      if (monitoringSourceIdentityRole(source.subjectSources) !== "external") return false
      if (
        brandProtectionOnly
        && source.platform !== "web"
        && monitoringSourcePresentationKind(source) === "direct"
      ) return false
    }
    return kind !== "WEB_NEWS" || source.platform === "web"
  })

  const selected = kind === "WEB_NEWS"
    ? Array.from(eligible.reduce((byScenario, source) => {
        const scenarioId = source.subjectSources.find(link => link.scenarioId)?.scenarioId
        const key = scenarioId || source.id
        if (!byScenario.has(key)) byScenario.set(key, source)
        return byScenario
      }, new Map<string, (typeof eligible)[number]>()).values())
    : eligible

  return selected.map((source, index) => {
    const cap = kind === "SOURCE_FULL" ? manualCapForRoutes(source.routePlans) : undefined
    return {
      position: index + 1,
      sourceId: source.id,
      sourceLabel: sourceLabel(source),
      sourcePlatform: source.platform,
      paid: cap !== undefined,
      providerAccountFundedOnly: false,
      sharedAcrossMonitorings: source.subjectSources.length > 1,
      maxTotalChargeUsd: cap,
      onlyCapability: kind === "WEB_NEWS" ? "DISCOVER_POSTS" : undefined,
      includeComments: false,
      fullArchiveRun: kind === "WEB_NEWS",
    }
  })
}

async function buildJobPlan(input: CreateSocialMonitoringRunJobInput): Promise<JobPlanItem[]> {
  if (input.kind === "PROFILE_FULL") return buildProfileJobPlan(input.organizationId)
  return buildWatchlistJobPlan(
    input.organizationId,
    input.kind,
    input.sourceScope ?? "EXTERNAL",
  )
}

export async function createSocialMonitoringRunJob(input: CreateSocialMonitoringRunJobInput) {
  if (input.kind === "PROFILE_FULL" && !["admin", "superadmin"].includes(input.requestedByRole)) {
    throw new SocialMonitoringRunJobError("admin_required", 403)
  }
  const existingIdempotent = await prisma.socialMonitoringRunJob.findFirst({
    where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
    select: { id: true, kind: true, sourceScope: true },
  })
  const expectedScope = input.kind === "PROFILE_FULL"
    ? null
    : input.sourceScope ?? "EXTERNAL"
  if (existingIdempotent) {
    if (
      existingIdempotent.kind !== input.kind
      || existingIdempotent.sourceScope !== expectedScope
    ) {
      throw new SocialMonitoringRunJobError("idempotency_key_conflict", 409)
    }
    return getSocialMonitoringRunJob(input.organizationId, existingIdempotent.id)
  }

  const active = await prisma.socialMonitoringRunJob.findFirst({
    where: {
      organizationId: input.organizationId,
      status: { in: [...SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES] },
    },
    select: { id: true },
  })
  if (active) {
    throw new SocialMonitoringRunJobError("social_monitoring_run_job_already_active", 409, {
      activeJobId: active.id,
    })
  }

  const plan = await buildJobPlan(input)
  if (plan.length === 0) throw new SocialMonitoringRunJobError("social_monitoring_run_job_empty", 409)
  const paidItems = plan.filter(item => item.paid).length
  const sharedItems = plan.filter(item => item.sharedAcrossMonitorings).length
  const sourceScope = expectedScope
  if (input.kind === "PROFILE_FULL" && input.fullArchiveConfirmed !== true) {
    throw new SocialMonitoringRunJobError("full_archive_confirmation_required", 409)
  }
  if (paidItems > 0 && input.paidConfirmed !== true) {
    throw new SocialMonitoringRunJobError("paid_run_confirmation_required", 409, { paidItems })
  }
  if (input.kind === "PROFILE_FULL" && sharedItems > 0 && input.sharedConfirmed !== true) {
    throw new SocialMonitoringRunJobError("monitoring_shared_source_confirmation_required", 409, {
      sharedItems,
    })
  }

  let createdId: string
  try {
    const created = await prisma.socialMonitoringRunJob.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        sourceScope,
        status: "QUEUED",
        idempotencyKey: input.idempotencyKey,
        requestedBy: input.requestedBy,
        fullArchiveConfirmed: input.fullArchiveConfirmed === true,
        paidConfirmed: input.paidConfirmed === true,
        sharedConfirmed: input.sharedConfirmed === true,
        totalItems: plan.length,
        paidItems,
        sharedItems,
        items: {
          // The composite job relation propagates both jobId and
          // organizationId into nested items. Supplying organizationId here
          // is rejected by Prisma's checked nested-create input at runtime.
          create: plan,
        },
      },
      select: { id: true },
    })
    createdId = created.id
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.socialMonitoringRunJob.findFirst({
        where: {
          organizationId: input.organizationId,
          OR: [
            { idempotencyKey: input.idempotencyKey },
            { status: { in: [...SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES] } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, idempotencyKey: true, kind: true, sourceScope: true },
      })
      if (existing?.idempotencyKey === input.idempotencyKey) {
        if (existing.kind !== input.kind || existing.sourceScope !== expectedScope) {
          throw new SocialMonitoringRunJobError("idempotency_key_conflict", 409)
        }
        return getSocialMonitoringRunJob(input.organizationId, existing.id)
      }
      throw new SocialMonitoringRunJobError("social_monitoring_run_job_already_active", 409, {
        activeJobId: existing?.id,
      })
    }
    throw error
  }

  await logAudit(
    input.organizationId,
    "create",
    "social_monitoring_run_job",
    createdId,
    input.kind,
    { userId: input.requestedBy },
  )
  return getSocialMonitoringRunJob(input.organizationId, createdId)
}

const jobInclude = {
  items: { orderBy: { position: "asc" as const } },
} as const

function serializeJob(job: Awaited<ReturnType<typeof loadJob>>) {
  if (!job) return null
  const processedItems = job.items.filter(item => TERMINAL_ITEM_STATUSES.has(item.status)).length
  const currentItem = job.items.find(item =>
    item.status === "RUNNING" || item.status === "WAITING_PROVIDER") ?? null
  return {
    id: job.id,
    kind: job.kind,
    sourceScope: job.sourceScope,
    status: job.status,
    totalItems: job.totalItems,
    paidItems: job.paidItems,
    sharedItems: job.sharedItems,
    processedItems,
    foundCount: job.items.reduce((sum, item) => sum + item.foundCount, 0),
    newCount: job.items.reduce((sum, item) => sum + item.newCount, 0),
    currentItem: currentItem ? {
      id: currentItem.id,
      position: currentItem.position,
      profileName: currentItem.profileName,
      sourceLabel: currentItem.sourceLabel,
      sourcePlatform: currentItem.sourcePlatform,
      status: currentItem.status,
    } : null,
    items: job.items.map(item => ({
      id: item.id,
      position: item.position,
      subjectId: item.subjectId,
      profileName: item.profileName,
      sourceId: item.sourceId,
      sourceLabel: item.sourceLabel,
      sourcePlatform: item.sourcePlatform,
      status: item.status,
      foundCount: item.foundCount,
      newCount: item.newCount,
      error: item.error,
    })),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
  }
}

async function loadJob(organizationId: string, id: string) {
  return prisma.socialMonitoringRunJob.findFirst({
    where: { organizationId, id },
    include: jobInclude,
  })
}

export async function getSocialMonitoringRunJob(organizationId: string, id: string) {
  return serializeJob(await loadJob(organizationId, id))
}

export async function getLatestSocialMonitoringRunJob(
  organizationId: string,
  kind?: SocialMonitoringRunJobKind,
  sourceScope?: SocialMonitoringRunJobSourceScope,
) {
  const job = await prisma.socialMonitoringRunJob.findFirst({
    where: {
      organizationId,
      ...(kind ? { kind } : {}),
      ...(sourceScope ? { sourceScope } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: jobInclude,
  })
  return serializeJob(job)
}

export async function cancelSocialMonitoringRunJob(
  organizationId: string,
  id: string,
  actorId: string,
  actorRole: string,
) {
  const existingJob = await loadJob(organizationId, id)
  if (!existingJob) throw new SocialMonitoringRunJobError("social_monitoring_run_job_not_found", 404)
  if (existingJob.kind === "PROFILE_FULL" && !["admin", "superadmin"].includes(actorRole)) {
    throw new SocialMonitoringRunJobError("admin_required", 403)
  }
  const canceledAt = new Date()
  const canceled = await prisma.socialMonitoringRunJob.updateMany({
    where: {
      organizationId,
      id,
      status: { in: [...SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES] },
    },
    data: {
      status: "CANCELED",
      cancelRequestedAt: canceledAt,
      nextAttemptAt: null,
      finishedAt: canceledAt,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  if (canceled.count !== 1) {
    if (existingJob.status !== "CANCELED") {
      throw new SocialMonitoringRunJobError("social_monitoring_run_job_not_cancelable", 409)
    }
  } else {
    await logAudit(
      organizationId,
      "update",
      "social_monitoring_run_job",
      id,
      "canceled",
      { userId: actorId },
    )
  }
  return getSocialMonitoringRunJob(organizationId, id)
}

export async function resumeSocialMonitoringRunJob(
  organizationId: string,
  id: string,
  actorId: string,
  actorRole: string,
) {
  const existing = await loadJob(organizationId, id)
  if (!existing) throw new SocialMonitoringRunJobError("social_monitoring_run_job_not_found", 404)
  if (existing.kind === "PROFILE_FULL" && !["admin", "superadmin"].includes(actorRole)) {
    throw new SocialMonitoringRunJobError("admin_required", 403)
  }
  const resumed = await prisma.socialMonitoringRunJob.updateMany({
    where: { organizationId, id, status: { in: ["CANCELED", "FAILED"] } },
    data: {
      status: "QUEUED",
      cancelRequestedAt: null,
      requestedBy: actorId,
      error: null,
      failureCount: 0,
      nextAttemptAt: null,
      finishedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SocialMonitoringRunJobError("social_monitoring_run_job_already_active", 409)
    }
    throw error
  })
  if (resumed.count !== 1) {
    throw new SocialMonitoringRunJobError("social_monitoring_run_job_not_resumable", 409)
  }
  await logAudit(
    organizationId,
    "update",
    "social_monitoring_run_job",
    id,
    "resumed",
    { userId: actorId },
  )
  return getSocialMonitoringRunJob(organizationId, id)
}

type ClaimedJob = {
  id: string
  organizationId: string
  kind: string
  sourceScope: string | null
  requestedBy: string
  failureCount: number
}

async function currentJobActorAllowed(job: ClaimedJob) {
  const [actor, organization] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: job.requestedBy,
        organizationId: job.organizationId,
        isActive: true,
      },
      select: { role: true },
    }),
    prisma.organization.findUnique({
      where: { id: job.organizationId },
      select: {
        isActive: true,
        plan: true,
        addons: true,
        features: true,
        modules: true,
      },
    }),
  ])
  if (!actor || !organization?.isActive) return false
  const socialEnabled = hasModule({
    plan: organization.plan,
    addons: organization.addons,
    modules: moduleRecordFromOrgFields(organization),
  }, "social")
  if (!socialEnabled) return false
  if (job.kind === "PROFILE_FULL") {
    return ["admin", "superadmin"].includes(actor.role)
  }
  return checkPermission(actor.role as Role, "social", "write")
}

async function failJobForInvalidActor(job: ClaimedJob, token: string, now: Date) {
  await prisma.socialMonitoringRunJob.updateMany({
    where: {
      id: job.id,
      organizationId: job.organizationId,
      status: "RUNNING",
      nextAttemptAt: null,
      leaseToken: token,
    },
    data: {
      status: "FAILED",
      error: "social_monitoring_run_job_actor_not_authorized",
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: now,
    },
  })
}

async function claimJob(candidate: ClaimedJob, now: Date) {
  const token = crypto.randomUUID()
  const claimed = await prisma.socialMonitoringRunJob.updateMany({
    where: {
      id: candidate.id,
      organizationId: candidate.organizationId,
      status: { in: [...SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES] },
      AND: [
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    data: {
      status: "RUNNING",
      error: null,
      nextAttemptAt: null,
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
      updatedAt: now,
    },
  })
  if (claimed.count !== 1) return null
  await prisma.socialMonitoringRunJob.updateMany({
    where: {
      id: candidate.id,
      organizationId: candidate.organizationId,
      leaseToken: token,
      startedAt: null,
    },
    data: { startedAt: now },
  })
  return token
}

async function ownsJob(organizationId: string, jobId: string, token: string) {
  return Boolean(await prisma.socialMonitoringRunJob.findFirst({
    where: {
      organizationId,
      id: jobId,
      status: "RUNNING",
      leaseToken: token,
      leaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  }))
}

function collectorResultJson(result: MonitoringProfileSourceRunResult): Prisma.InputJsonValue {
  return result as unknown as Prisma.InputJsonValue
}

function resultCounts(result: MonitoringProfileSourceRunResult) {
  return {
    foundCount: Math.max(0, result.foundCount ?? 0),
    newCount: Math.max(0, result.newCount ?? 0),
    duplicateCount: Math.max(0, result.duplicateCount ?? 0),
    acceptedCount: Math.max(0, result.acceptedCount ?? result.newCount ?? 0),
    reviewCount: Math.max(0, result.reviewCount ?? 0),
    rejectedCount: Math.max(0, result.rejectedCount ?? 0),
    ignoredCount: Math.max(0, result.ignoredCount ?? 0),
  }
}

function terminalItemStatus(status: string) {
  const normalized = status.toLowerCase()
  if (["success", "completed", "imported"].includes(normalized)) return "SUCCEEDED"
  if (normalized === "partial") return "PARTIAL"
  if (normalized === "skipped" || normalized === "blocked") return "SKIPPED"
  return "FAILED"
}

async function completeItem(input: {
  organizationId: string
  itemId: string
  token: string
  result: MonitoringProfileSourceRunResult
  error?: string | null
  now: Date
}) {
  const status = terminalItemStatus(input.result.status)
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: input.organizationId,
      id: input.itemId,
      leaseToken: input.token,
      status: { in: ["RUNNING", "WAITING_PROVIDER"] },
    },
    data: {
      status,
      ...resultCounts(input.result),
      collectorRunId: input.result.runId,
      collectorResult: collectorResultJson(input.result),
      error: input.error ?? input.result.error ?? null,
      nextAttemptAt: null,
      terminalObservedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: input.now,
    },
  })
  return status
}

async function failItem(input: {
  organizationId: string
  itemId: string
  token: string
  error: string
  now: Date
  timedOut?: boolean
}) {
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: input.organizationId,
      id: input.itemId,
      leaseToken: input.token,
      status: { in: ["RUNNING", "WAITING_PROVIDER"] },
    },
    data: {
      status: input.timedOut ? "TIMED_OUT" : "FAILED",
      error: input.error.slice(0, 1_000),
      nextAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: input.now,
    },
  })
}

async function providerRunsForItem(item: {
  organizationId: string
  sourceId: string
  providerRunIds: string[]
  collectorRunId?: string | null
  startedAt: Date | null
  error?: string | null
}) {
  const explicitIds = item.providerRunIds
  if (explicitIds.length > 0) {
    return prisma.socialProviderRun.findMany({
      where: {
        organizationId: item.organizationId,
        purgedAt: null,
        OR: [{ id: { in: explicitIds } }, { parentRunId: { in: explicitIds } }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        parentRunId: true,
        providerKey: true,
        phase: true,
        status: true,
        receivedCount: true,
        acceptedCount: true,
        reviewCount: true,
        rejectedCount: true,
        duplicateCount: true,
        lastError: true,
        timeoutSeconds: true,
        startedAt: true,
        createdAt: true,
      },
    })
  }
  if (item.collectorRunId) {
    return prisma.socialProviderRun.findMany({
      where: {
        organizationId: item.organizationId,
        collectorRunId: item.collectorRunId,
        purgedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        parentRunId: true,
        providerKey: true,
        phase: true,
        status: true,
        receivedCount: true,
        acceptedCount: true,
        reviewCount: true,
        rejectedCount: true,
        duplicateCount: true,
        lastError: true,
        timeoutSeconds: true,
        startedAt: true,
        createdAt: true,
      },
    })
  }
  if (!item.error?.startsWith("source_busy:")) {
    // Only explicit IDs or an authoritative CollectorRun may attribute
    // provider results. Source/time lookup is reserved for source_busy, where
    // it merely checks whether any active lease-holder remains and never
    // assigns that run's counts to this item.
    return []
  }
  return prisma.socialProviderRun.findMany({
    where: {
      organizationId: item.organizationId,
      sourceId: item.sourceId,
      status: { in: ACTIVE_PROVIDER_STATUSES },
      ...(item.startedAt ? { createdAt: { gte: new Date(item.startedAt.getTime() - 1_000) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      parentRunId: true,
      providerKey: true,
      phase: true,
      status: true,
      receivedCount: true,
      acceptedCount: true,
      reviewCount: true,
      rejectedCount: true,
      duplicateCount: true,
      lastError: true,
      timeoutSeconds: true,
      startedAt: true,
      createdAt: true,
    },
  })
}

function providerRunStillBlocksSource(row: {
  phase: string
  status: string
  startedAt: Date | null
  createdAt: Date
  timeoutSeconds: number
}, now: Date) {
  if (row.phase.toUpperCase() === "PAID_ROUTE_COLLECTION" && row.status === "SUCCEEDED") {
    return false
  }
  if (!["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"].includes(row.status)) return false
  const startedAt = row.startedAt ?? row.createdAt
  const expiresAt = startedAt.getTime() + Math.max(30, row.timeoutSeconds) * 1_000 + 5 * 60_000
  return now.getTime() < expiresAt
}

function providerDeadline(
  now: Date,
  rows: Array<{ startedAt: Date | null; createdAt: Date; timeoutSeconds: number }>,
) {
  const hardLimit = now.getTime() + PROVIDER_WAIT_MAX_MS
  if (rows.length === 0) return new Date(hardLimit)
  const providerExpiry = Math.max(...rows.map(row =>
    (row.startedAt ?? row.createdAt).getTime()
    + Math.max(30, row.timeoutSeconds) * 1_000
    + 5 * 60_000))
  return new Date(Math.min(hardLimit, providerExpiry))
}

async function reconcileProviderRows(
  organizationId: string,
  rows: Array<{ id: string; providerKey: string; status: string }>,
) {
  const reconcilable = rows.filter(row => ["RUNNING", "SUCCEEDED", "IMPORTING"].includes(row.status))
  for (const row of reconcilable.filter(row => row.providerKey === "APIFY")) {
    await importApifyProviderRun(row.id).catch(error => {
      console.error("[social-monitoring-run-job] Apify reconciliation failed", {
        organizationId,
        providerRunId: row.id,
        error: error instanceof Error ? error.message : "unknown",
      })
    })
  }
  const brightDataIds = reconcilable
    .filter(row => row.providerKey === "bright-data")
    .map(row => row.id)
  if (brightDataIds.length > 0) {
    await reconcileBrightDataProviderRuns(
      brightDataIds.length,
      undefined,
      { organizationId, ids: brightDataIds },
    ).catch(error => {
      console.error("[social-monitoring-run-job] Bright Data reconciliation failed", {
        organizationId,
        providerRunIds: brightDataIds,
        error: error instanceof Error ? error.message : "unknown",
      })
    })
  }
}

function providerSummary(rows: Array<{
  id: string
  phase: string
  status: string
  receivedCount: number
  acceptedCount: number
  reviewCount: number
  rejectedCount: number
  duplicateCount: number
  lastError: string | null
}>): MonitoringProfileSourceRunResult {
  return summarizeMonitoringProviderRuns(rows satisfies MonitoringProfileProviderRun[])
}

function parseCollectorResult(value: unknown): MonitoringProfileSourceRunResult | null {
  const record = recordFromUnknown(value)
  if (
    typeof record.status !== "string"
    || typeof record.foundCount !== "number"
    || typeof record.newCount !== "number"
    || typeof record.duplicateCount !== "number"
  ) return null
  return record as unknown as MonitoringProfileSourceRunResult
}

type JobItemRow = Awaited<ReturnType<typeof loadJob>> extends infer T
  ? T extends { items: Array<infer Item> } ? Item : never
  : never

async function setItemWaiting(input: {
  item: JobItemRow
  token: string
  providerRunIds: string[]
  collectorResult?: MonitoringProfileSourceRunResult | null
  collectorRunId?: string | null
  error?: string | null
  now: Date
  rows?: Array<{ startedAt: Date | null; createdAt: Date; timeoutSeconds: number }>
  retryAfterSeconds?: number
}) {
  const existingDeadline = input.item.providerDeadlineAt
  const deadline = existingDeadline ?? providerDeadline(input.now, input.rows ?? [])
  const retryAt = new Date(input.now.getTime() + Math.max(5, input.retryAfterSeconds ?? 60) * 1_000)
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: input.item.organizationId,
      id: input.item.id,
      leaseToken: input.token,
      status: { in: ["RUNNING", "WAITING_PROVIDER"] },
    },
    data: {
      status: "WAITING_PROVIDER",
      providerRunIds: input.providerRunIds,
      providerDeadlineAt: deadline,
      nextAttemptAt: retryAt < deadline ? retryAt : deadline,
      ...(input.collectorResult
        ? {
            collectorRunId: input.collectorResult.runId,
            collectorResult: collectorResultJson(input.collectorResult),
            ...resultCounts(input.collectorResult),
          }
        : {}),
      ...(input.collectorRunId ? { collectorRunId: input.collectorRunId } : {}),
      error: input.error ?? input.collectorResult?.error ?? input.item.error,
      leaseExpiresAt: new Date(input.now.getTime() + ITEM_LEASE_MS),
    },
  })
}

async function processWaitingItem(item: JobItemRow, token: string, now: Date) {
  if (
    item.leaseToken !== token
    && item.leaseExpiresAt
    && item.leaseExpiresAt > now
  ) return { waiting: true as const }

  const tookOver = await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: item.organizationId,
      id: item.id,
      status: { in: ["RUNNING", "WAITING_PROVIDER"] },
      OR: [
        { leaseToken: token },
        { leaseToken: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + ITEM_LEASE_MS),
    },
  })
  if (tookOver.count !== 1) return { waiting: true as const }

  if (item.error?.startsWith("source_busy:")) {
    const deadline = item.providerDeadlineAt ?? new Date(now.getTime() + PROVIDER_WAIT_MAX_MS)
    const activeRows = (await providerRunsForItem({
      ...item,
      providerRunIds: [],
      startedAt: null,
    })).filter(row => providerRunStillBlocksSource(row, now))
    // The foreign run may have completed between ticks. Re-check liveness
    // before applying our deadline so a now-free source is retried once.
    if (activeRows.length === 0) {
      await prisma.socialMonitoringRunJobItem.updateMany({
        where: { organizationId: item.organizationId, id: item.id, leaseToken: token },
        data: {
          status: "QUEUED",
          nextAttemptAt: null,
          providerDeadlineAt: null,
          terminalObservedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      return { waiting: false as const, retry: true as const }
    }
    if (now >= deadline) {
      await failItem({
        organizationId: item.organizationId,
        itemId: item.id,
        token,
        error: "collector_busy_timeout",
        now,
        timedOut: true,
      })
      return { waiting: false as const, terminal: "TIMED_OUT" }
    }
    if (activeRows.length > 0) {
      await prisma.socialMonitoringRunJobItem.updateMany({
        where: { organizationId: item.organizationId, id: item.id, leaseToken: token },
        data: {
          status: "WAITING_PROVIDER",
          providerRunIds: [],
          providerDeadlineAt: deadline,
          nextAttemptAt: new Date(Math.min(deadline.getTime(), now.getTime() + 60_000)),
          terminalObservedAt: null,
          leaseExpiresAt: new Date(now.getTime() + ITEM_LEASE_MS),
        },
      })
      return { waiting: true as const }
    }
  }

  let rows = await providerRunsForItem({
    ...item,
    startedAt: item.error?.includes("already_running") ? null : item.startedAt,
  })
  const ids = Array.from(new Set([
    ...item.providerRunIds,
    ...rows.map(row => row.parentRunId ?? row.id),
  ]))
  if (rows.length > 0) {
    await reconcileProviderRows(item.organizationId, rows)
    rows = await providerRunsForItem({ ...item, providerRunIds: ids })
  }

  const deadline = item.providerDeadlineAt ?? providerDeadline(now, rows)
  if (rows.length === 0) {
    if (now >= deadline) {
      await failItem({
        organizationId: item.organizationId,
        itemId: item.id,
        token,
        error: item.error || "provider_wait_timeout",
        now,
        timedOut: true,
      })
      return { waiting: false as const, terminal: "TIMED_OUT" }
    }
    await setItemWaiting({ item, token, providerRunIds: ids, error: item.error, now })
    return { waiting: true as const }
  }

  const providerResult = providerSummary(rows)
  if (providerResult.status === "pending") {
    if (now >= deadline) {
      await failItem({
        organizationId: item.organizationId,
        itemId: item.id,
        token,
        error: providerResult.error || item.error || "provider_wait_timeout",
        now,
        timedOut: true,
      })
      return { waiting: false as const, terminal: "TIMED_OUT" }
    }
    await prisma.socialMonitoringRunJobItem.updateMany({
      where: { organizationId: item.organizationId, id: item.id, leaseToken: token },
      data: {
        status: "WAITING_PROVIDER",
        providerRunIds: ids,
        providerDeadlineAt: deadline,
        nextAttemptAt: new Date(Math.min(deadline.getTime(), now.getTime() + 60_000)),
        terminalObservedAt: null,
        error: providerResult.error ?? item.error,
      },
    })
    return { waiting: true as const }
  }

  if (
    !item.terminalObservedAt
    || now.getTime() - item.terminalObservedAt.getTime() < PROVIDER_TERMINAL_CONFIRMATION_MS
  ) {
    await prisma.socialMonitoringRunJobItem.updateMany({
      where: { organizationId: item.organizationId, id: item.id, leaseToken: token },
      data: {
        status: "WAITING_PROVIDER",
        providerRunIds: ids,
        providerDeadlineAt: deadline,
        nextAttemptAt: new Date(now.getTime() + PROVIDER_TERMINAL_CONFIRMATION_MS),
        terminalObservedAt: item.terminalObservedAt ?? now,
      },
    })
    return { waiting: true as const }
  }

  const collectorResult = parseCollectorResult(item.collectorResult)
  const merged = collectorResult
    ? mergeMonitoringCollectorAndProviderResult(collectorResult, providerResult)
    : providerResult
  const terminal = await completeItem({
    organizationId: item.organizationId,
    itemId: item.id,
    token,
    result: merged,
    now,
  })
  return { waiting: false as const, terminal }
}

async function claimQueuedItem(item: JobItemRow, token: string, now: Date) {
  const dispatchDeadlineAt = new Date(now.getTime() + PROVIDER_WAIT_MAX_MS)
  const claimed = await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: item.organizationId,
      id: item.id,
      status: "QUEUED",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      job: {
        is: {
          status: "RUNNING",
          leaseToken: token,
          leaseExpiresAt: { gt: now },
        },
      },
    },
    data: {
      status: "RUNNING",
      attemptCount: { increment: 1 },
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + ITEM_LEASE_MS),
      nextAttemptAt: null,
      error: null,
      startedAt: now,
      // A killed request cannot leave a RUNNING item immortal. A later worker
      // takes over after the lease and applies this durable deadline.
      providerDeadlineAt: dispatchDeadlineAt,
      terminalObservedAt: null,
      collectorRunId: null,
      providerRunIds: [],
      collectorResult: Prisma.DbNull,
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      ignoredCount: 0,
      finishedAt: null,
    },
  })
  return claimed.count === 1 ? dispatchDeadlineAt : null
}

async function stillOwnsDispatch(job: ClaimedJob, item: JobItemRow, token: string) {
  const now = new Date()
  return Boolean(await prisma.socialMonitoringRunJobItem.findFirst({
    where: {
      organizationId: job.organizationId,
      id: item.id,
      jobId: job.id,
      status: "RUNNING",
      leaseToken: token,
      leaseExpiresAt: { gt: now },
      job: {
        is: {
          status: "RUNNING",
          leaseToken: token,
          leaseExpiresAt: { gt: now },
        },
      },
    },
    select: { id: true },
  }))
}

async function releaseUndispatchedItem(job: ClaimedJob, item: JobItemRow, token: string) {
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: job.organizationId,
      id: item.id,
      jobId: job.id,
      status: "RUNNING",
      leaseToken: token,
    },
    data: {
      status: "QUEUED",
      nextAttemptAt: null,
      providerDeadlineAt: null,
      terminalObservedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

async function deferItem(input: {
  item: JobItemRow
  token: string
  error: string
  now: Date
  retryAfterSeconds?: number
}) {
  const retryAfterSeconds = Math.max(5, input.retryAfterSeconds ?? 300)
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: input.item.organizationId,
      id: input.item.id,
      leaseToken: input.token,
      status: "RUNNING",
    },
    data: {
      status: "QUEUED",
      error: input.error,
      nextAttemptAt: new Date(input.now.getTime() + retryAfterSeconds * 1_000),
      providerDeadlineAt: null,
      terminalObservedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

async function executeItemWithinFence(job: ClaimedJob, item: JobItemRow) {
  let result: MonitoringProfileSourceRunResult | null = null
  let failure: { error: string; retryAfterSeconds?: number } | null = null
  if (job.kind === "PROFILE_FULL") {
    if (!item.subjectId || !item.scenarioId) {
      return { result, failure: { error: "profile_job_scope_missing" } }
    }
    const outcome = await runMonitoringProfileSourceForSubject({
      organizationId: job.organizationId,
      requestedByUserId: job.requestedBy,
      subjectId: item.subjectId,
      run: {
        scenarioId: item.scenarioId,
        sourceId: item.sourceId,
        paidConfirmed: item.paid,
        includeComments: item.includeComments,
        fullSearchConfirmed: item.sharedAcrossMonitorings,
        maxTotalChargeUsd: item.maxTotalChargeUsd
          ? Number(item.maxTotalChargeUsd)
          : undefined,
      },
    })
    if (outcome.ok) result = outcome.data
    else failure = {
      error: outcome.error,
      retryAfterSeconds: outcome.retryAfterSeconds,
    }
    return { result, failure }
  }

  if (job.sourceScope !== "OWNED" && job.sourceScope !== "EXTERNAL") {
    return { result, failure: { error: "monitoring_source_job_scope_missing" } }
  }
  const outcome = await runMonitoringSourceForActor({
    organizationId: job.organizationId,
    requestedByUserId: job.requestedBy,
    sourceId: item.sourceId,
    expectedScope: job.sourceScope,
    maxTotalChargeUsd: item.maxTotalChargeUsd ? Number(item.maxTotalChargeUsd) : undefined,
    paidRunConfirmed: item.paid,
    onlyCapability: item.onlyCapability as "DISCOVER_POSTS" | undefined,
    fullArchiveRun: item.fullArchiveRun,
  })
  if (outcome.ok) result = outcome.data
  else failure = {
    error: outcome.error,
    retryAfterSeconds: outcome.retryAfterSeconds,
  }
  return { result, failure }
}

async function dispatchItem(job: ClaimedJob, item: JobItemRow, token: string) {
  try {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      job.organizationId,
      async () => {
        // Cancellation clears both leases. Re-check after acquiring the
        // tenant collection fence, immediately before an external (possibly
        // paid) dispatch, so a stopped job cannot start the claimed item.
        if (!await stillOwnsDispatch(job, item, token)) {
          return { ownershipLost: true as const }
        }
        if (!await currentJobActorAllowed(job)) {
          return {
            ownershipLost: false as const,
            authorizationLost: true as const,
          }
        }
        return {
          ownershipLost: false as const,
          authorizationLost: false as const,
          ...await executeItemWithinFence(job, item),
        }
      },
    )
    const settledAt = new Date()
    if (!fenced.allowed) {
      await deferItem({
        item,
        token,
        error: fenced.reason,
        now: settledAt,
      })
      return { waiting: true as const, deferred: true as const }
    }
    if (fenced.value.ownershipLost) {
      await releaseUndispatchedItem(job, item, token)
      return { waiting: false as const, ownershipLost: true as const }
    }
    if (fenced.value.authorizationLost) {
      await releaseUndispatchedItem(job, item, token)
      await failJobForInvalidActor(job, token, settledAt)
      return { waiting: false as const, authorizationLost: true as const }
    }
    const { result, failure } = fenced.value

    if (failure) {
      if (failure.error === "collector_already_running") {
        await setItemWaiting({
          item,
          token,
          providerRunIds: [],
          error: `source_busy:${failure.error}`,
          now: settledAt,
          rows: [],
          retryAfterSeconds: failure.retryAfterSeconds,
        })
        return { waiting: true as const }
      }
      await failItem({
        organizationId: job.organizationId,
        itemId: item.id,
        token,
        error: failure.error,
        now: settledAt,
      })
      return { waiting: false as const }
    }

    if (!result) {
      await failItem({
        organizationId: job.organizationId,
        itemId: item.id,
        token,
        error: "collector_result_missing",
        now: settledAt,
      })
      return { waiting: false as const }
    }
    if (monitoringCollectorResultHasPendingProvider(result)) {
      const providerRunIds = monitoringCollectorPendingProviderRunIds(result)
      const rows = await providerRunsForItem({ ...item, providerRunIds })
      await setItemWaiting({
        item,
        token,
        providerRunIds,
        collectorResult: result,
        now: settledAt,
        rows,
      })
      return { waiting: true as const }
    }
    await completeItem({
      organizationId: job.organizationId,
      itemId: item.id,
      token,
      result,
      now: settledAt,
    })
    return { waiting: false as const }
  } catch (error) {
    const settledAt = new Date()
    const message = error instanceof Error ? error.message : "collector_run_failed"
    if (item.paid) {
      const unknownError = `dispatch_outcome_unknown:${message}`
      await setItemWaiting({
        item,
        token,
        providerRunIds: [],
        error: unknownError,
        now: settledAt,
        rows: [],
      })
      return { waiting: true as const }
    }
    await failItem({
      organizationId: job.organizationId,
      itemId: item.id,
      token,
      error: message,
      now: settledAt,
    })
    return { waiting: false as const }
  }
}

async function releaseJobForNextTick(job: ClaimedJob, token: string, status: "QUEUED" | "WAITING_PROVIDER") {
  const runnableItem = await prisma.socialMonitoringRunJobItem.findFirst({
    where: {
      organizationId: job.organizationId,
      jobId: job.id,
      status: "QUEUED",
      nextAttemptAt: null,
    },
    select: { id: true },
  })
  const nextItem = runnableItem ? null : await prisma.socialMonitoringRunJobItem.findFirst({
    where: {
      organizationId: job.organizationId,
      jobId: job.id,
      status: { in: ["QUEUED", "RUNNING", "WAITING_PROVIDER"] },
      nextAttemptAt: { not: null },
    },
    orderBy: { nextAttemptAt: "asc" },
    select: { nextAttemptAt: true },
  })
  await prisma.socialMonitoringRunJobItem.updateMany({
    where: {
      organizationId: job.organizationId,
      jobId: job.id,
      leaseToken: token,
      status: "WAITING_PROVIDER",
    },
    data: { leaseToken: null, leaseExpiresAt: null },
  })
  await prisma.socialMonitoringRunJob.updateMany({
    where: {
      organizationId: job.organizationId,
      id: job.id,
      status: "RUNNING",
      leaseToken: token,
    },
    data: {
      status,
      failureCount: 0,
      nextAttemptAt: nextItem?.nextAttemptAt ?? null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

async function finalizeJob(job: ClaimedJob, token: string, now: Date) {
  const items = await prisma.socialMonitoringRunJobItem.findMany({
    where: { organizationId: job.organizationId, jobId: job.id },
    select: { status: true },
  })
  const hasUnfinished = items.some(item => !TERMINAL_ITEM_STATUSES.has(item.status))
  if (hasUnfinished) {
    const waiting = items.some(item => ["RUNNING", "WAITING_PROVIDER"].includes(item.status))
    const hasQueued = items.some(item => item.status === "QUEUED")
    const nextStatus = hasQueued ? "QUEUED" : waiting ? "WAITING_PROVIDER" : "QUEUED"
    await releaseJobForNextTick(job, token, nextStatus)
    return nextStatus
  }
  const status = items.some(item => ISSUE_ITEM_STATUSES.has(item.status))
    ? "COMPLETED_WITH_ISSUES"
    : "COMPLETED"
  await prisma.socialMonitoringRunJob.updateMany({
    where: {
      organizationId: job.organizationId,
      id: job.id,
      status: "RUNNING",
      leaseToken: token,
    },
    data: {
      status,
      error: null,
      failureCount: 0,
      nextAttemptAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: now,
    },
  })
  return status
}

async function processClaimedJob(
  job: ClaimedJob,
  token: string,
  maxItems: number,
  deadlineAt?: Date,
) {
  let processed = 0
  const checkedWaitingIds = new Set<string>()
  if (!await currentJobActorAllowed(job)) {
    await failJobForInvalidActor(job, token, new Date())
    return { status: "FAILED", processed }
  }
  while (processed < maxItems) {
    if (deadlineAt && new Date() >= deadlineAt) {
      return { status: await finalizeJob(job, token, new Date()), processed }
    }
    if (!await ownsJob(job.organizationId, job.id, token)) return { status: "lost", processed }
    const blockingCurrent = job.kind === "SOURCE_FULL"
      ? null
      : await prisma.socialMonitoringRunJobItem.findFirst({
          where: {
            organizationId: job.organizationId,
            jobId: job.id,
            status: { in: ["RUNNING", "WAITING_PROVIDER"] },
          },
          orderBy: { position: "asc" },
        })
    if (blockingCurrent) {
      const outcome = await processWaitingItem(blockingCurrent as JobItemRow, token, new Date())
      processed += 1
      if (outcome.waiting) {
        await releaseJobForNextTick(job, token, "WAITING_PROVIDER")
        return { status: "waiting", processed }
      }
      continue
    }

    const next = await prisma.socialMonitoringRunJobItem.findFirst({
      where: {
        organizationId: job.organizationId,
        jobId: job.id,
        status: "QUEUED",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { position: "asc" },
    })
    // The profile queue preserves its conservative one-at-a-time paid boundary.
    // The watchlist queue used a bounded browser pool before this migration, so
    // it may keep dispatching independent queued sources while earlier provider
    // jobs reconcile in the background.
    if (next) {
      const now = new Date()
      const dispatchDeadlineAt = await claimQueuedItem(next as JobItemRow, token, now)
      if (!dispatchDeadlineAt) continue
      const claimed = {
        ...next,
        status: "RUNNING",
        leaseToken: token,
        startedAt: now,
        providerDeadlineAt: dispatchDeadlineAt,
        terminalObservedAt: null,
        collectorRunId: null,
        providerRunIds: [],
        collectorResult: null,
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 0,
        ignoredCount: 0,
        finishedAt: null,
      } as JobItemRow
      const outcome = await dispatchItem(job, claimed, token)
      processed += 1
      if ("authorizationLost" in outcome && outcome.authorizationLost) {
        return { status: "FAILED", processed }
      }
      if ("ownershipLost" in outcome && outcome.ownershipLost) {
        return { status: "lost", processed }
      }
      if (outcome.waiting && job.kind !== "SOURCE_FULL") {
        await releaseJobForNextTick(
          job,
          token,
          "deferred" in outcome && outcome.deferred ? "QUEUED" : "WAITING_PROVIDER",
        )
        return { status: "waiting", processed }
      }
      continue
    }

    const current = await prisma.socialMonitoringRunJobItem.findFirst({
      where: {
        organizationId: job.organizationId,
        jobId: job.id,
        status: { in: ["RUNNING", "WAITING_PROVIDER"] },
        ...(checkedWaitingIds.size > 0 ? { id: { notIn: Array.from(checkedWaitingIds) } } : {}),
      },
      orderBy: { position: "asc" },
    })
    if (current) {
      const outcome = await processWaitingItem(current as JobItemRow, token, new Date())
      if (outcome.waiting) {
        if (job.kind !== "SOURCE_FULL") {
          await releaseJobForNextTick(job, token, "WAITING_PROVIDER")
          return { status: "waiting", processed }
        }
        checkedWaitingIds.add(current.id)
        processed += 1
      } else {
        processed += 1
      }
      continue
    }

    return { status: await finalizeJob(job, token, new Date()), processed }
  }
  return { status: await finalizeJob(job, token, new Date()), processed }
}

export async function processSocialMonitoringRunJobs(options: {
  organizationId?: string
  limit?: number
  maxItemsPerJob?: number
  maxItemsTotal?: number
  deadlineAt?: Date
  now?: Date
} = {}) {
  const selectionNow = options.now ?? new Date()
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 3), 20))
  const maxItemsPerJob = Math.max(
    1,
    Math.min(Math.trunc(options.maxItemsPerJob ?? MAX_ITEMS_PER_TICK), MAX_ITEMS_PER_TICK),
  )
  const maxItemsTotal = Math.max(
    1,
    Math.min(
      Math.trunc(options.maxItemsTotal ?? limit * maxItemsPerJob),
      MAX_ITEMS_PER_TICK,
    ),
  )
  const candidates = await prisma.socialMonitoringRunJob.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      status: { in: [...SOCIAL_MONITORING_RUN_JOB_ACTIVE_STATUSES] },
      AND: [
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: selectionNow } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: selectionNow } }] },
      ],
    },
    orderBy: [
      { updatedAt: "asc" },
      { createdAt: "asc" },
    ],
    take: limit,
    select: {
      id: true,
      organizationId: true,
      kind: true,
      sourceScope: true,
      requestedBy: true,
      failureCount: true,
    },
  })
  const results: Array<{ id: string; status: string; processed: number }> = []
  let processedTotal = 0
  for (const candidate of candidates) {
    if (processedTotal >= maxItemsTotal) break
    if (options.deadlineAt && new Date() >= options.deadlineAt) break
    const token = await claimJob(candidate, options.now ?? new Date())
    if (!token) continue
    try {
      const outcome = await processClaimedJob(
        candidate,
        token,
        Math.min(maxItemsPerJob, maxItemsTotal - processedTotal),
        options.deadlineAt,
      )
      processedTotal += outcome.processed
      results.push({ id: candidate.id, status: outcome.status, processed: outcome.processed })
    } catch (error) {
      const failureNow = options.now ?? new Date()
      const message = error instanceof Error ? error.message : "social_monitoring_run_job_failed"
      const failureCount = candidate.failureCount + 1
      const failed = failureCount >= MAX_JOB_FAILURES
      console.error("[social-monitoring-run-job] worker failed", {
        jobId: candidate.id,
        organizationId: candidate.organizationId,
        error: message,
      })
      await prisma.socialMonitoringRunJob.updateMany({
        where: {
          id: candidate.id,
          organizationId: candidate.organizationId,
          status: "RUNNING",
          leaseToken: token,
        },
        data: {
          status: failed ? "FAILED" : "QUEUED",
          failureCount,
          error: message.slice(0, 1_000),
          nextAttemptAt: failed
            ? null
            : new Date(failureNow.getTime() + Math.min(300, 30 * 2 ** (failureCount - 1)) * 1_000),
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: failed ? failureNow : null,
        },
      })
      await prisma.socialMonitoringRunJobItem.updateMany({
        where: {
          organizationId: candidate.organizationId,
          jobId: candidate.id,
          leaseToken: token,
          status: { in: ["RUNNING", "WAITING_PROVIDER"] },
        },
        data: { leaseToken: null, leaseExpiresAt: null },
      })
      results.push({ id: candidate.id, status: failed ? "FAILED" : "retry", processed: 0 })
    }
  }
  return { selected: candidates.length, claimed: results.length, processed: processedTotal, results }
}
