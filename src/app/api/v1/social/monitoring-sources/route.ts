import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { isSocialBrandProtectionOnly } from "@/lib/social/brand-protection"
import {
  buildMonitoringReadinessEnvironment,
  buildMonitoringDuplicateWhere,
  type MonitoringReadinessAccount,
  createMonitoringSourceSchema,
  normalizeMonitoringSourceInput,
  redactMonitoringSettingsForResponse,
  summarizeMonitoringReadiness,
  summarizeSourceHealth,
  summarizeMonitoringProviderSetup,
} from "@/lib/social/monitoring-source"
import {
  getSocialMonitoringSettings,
  mergeMonitoringSettingsIntoSourceSettings,
  type SocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"
import { compileSourceRoutePlans } from "@/lib/social/source-route-plan"
import { monitoringSourceIdentityRole } from "@/lib/social/monitoring-source-identity"
import {
  findProtectedMonitoringIdentityCollision,
  OFFICIAL_IDENTITY_NOT_COLLECTABLE,
} from "@/lib/social/monitoring-source-protection"
import { validateMonitoringSourceOutboundEndpoints } from "@/lib/social/social-outbound-http"
import {
  changesSensitiveSourceOutboundSettings,
  isBrowserSessionAdmin,
} from "@/lib/social/outbound-settings-access"

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid monitoring source"
}

type CollectorRunHealthRow = {
  id: string
  sourceId?: string
  status: string
  startedAt: Date | string
  finishedAt: Date | string | null
  foundCount: number
  newCount: number
  duplicateCount: number
  ignoredCount: number
  error: string | null
  rawStats?: Prisma.JsonValue | null
  source?: { platform: string; sourceType: string; collectionMode: string } | null
}

type SourceHealthRow = {
  organizationId: string
  platform: string
  sourceType: string
  ownership: string
  collectorRuns?: CollectorRunHealthRow[]
  // Суммы типизированы как unknown: для тенантных ролей они зануляются перед ответом.
  providerRuns?: Array<{ reservedChargeUsd: unknown; actualChargeUsd: unknown }>
  settings: unknown
  lastCheckedAt: Date | string | null
  lastSuccessfulAt: Date | string | null
  lastError: string | null
  cadenceMinutes: number
  collectionMode: string
  status: string
  subjectSources?: Array<{
    subjectId: string
    scenarioId: string | null
    relationType: string
  }>
}

type MonitoringReadinessContext = {
  accounts: MonitoringReadinessAccount[]
  liveRepliesEnabled: boolean
  monitoringSettings: SocialMonitoringSettings
}

type CountRow<K extends string> = Record<K, string> & { _count: number }

const PARTIAL_COVERAGE_MODES = new Set(["provider_api", "search_index", "notification_inbox", "browser_capture"])
const SOCIAL_ALERT_TYPES = ["social_signal_risk", "social_manual_escalation", "social_coverage_rule", "social_source_failure"]

async function resolveReadinessContext(orgId: string): Promise<MonitoringReadinessContext> {
  const liveRepliesEnabled =
    process.env.SOCIAL_LIVE_REPLY_ENABLED === "1" &&
    await isAiFeatureEnabled(orgId, "social_live_reply")
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId: orgId },
    select: { id: true, platform: true, isActive: true, accessToken: true },
  })
  const monitoringSettings = await getSocialMonitoringSettings(orgId)
  return { accounts, liveRepliesEnabled, monitoringSettings }
}

function decorateSource<T extends SourceHealthRow>(
  source: T,
  context?: MonitoringReadinessContext,
) {
  const effectiveSettings = context?.monitoringSettings
    ? mergeMonitoringSettingsIntoSourceSettings(source.settings, context.monitoringSettings, source)
    : source.settings
  return {
    ...source,
    identityRole: monitoringSourceIdentityRole(source.subjectSources),
    settings: redactMonitoringSettingsForResponse(effectiveSettings),
    providerSetup: summarizeMonitoringProviderSetup(effectiveSettings),
    health: summarizeSourceHealth(source),
    readiness: summarizeMonitoringReadiness({ ...source, settings: effectiveSettings }, {
      accounts: context?.accounts ?? [],
      env: buildMonitoringReadinessEnvironment({ liveRepliesEnabled: context?.liveRepliesEnabled ?? false }),
    }),
  }
}

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get("platform") || undefined
  const sourceType = searchParams.get("sourceType") || undefined
  const status = searchParams.get("status") || undefined
  const collectionMode = searchParams.get("collectionMode") || undefined
  const riskLevel = searchParams.get("riskLevel") || undefined
  const targetKind = searchParams.get("targetKind") || undefined
  const q = searchParams.get("q")?.trim()
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 200)

  const where: Prisma.MonitoringSourceWhereInput = {
    organizationId: orgId,
    ...(platform ? { platform } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(status ? { status } : {}),
    ...(collectionMode ? { collectionMode } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(targetKind === "direct"
      ? { AND: [{ OR: [{ url: { not: null } }, { handle: { not: null } }] }] }
      : targetKind === "query"
        ? { AND: [{ url: null }, { handle: null }] }
        : {}),
    ...(q
      ? {
          OR: [
            { url: { contains: q, mode: "insensitive" } },
            { handle: { contains: q, mode: "insensitive" } },
            { query: { contains: q, mode: "insensitive" } },
            { keywords: { has: q } },
          ],
        }
      : {}),
  }

  const recentSince = new Date(Date.now() - 24 * 3600000)
  const [sources, byStatus, byMode, byRisk, recentRuns, trustTiers, recentAlerts, readinessContext] = await Promise.all([
    prisma.monitoringSource.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: limit,
      include: {
        routePlans: {
          where: { status: { not: "INVALIDATED" } },
          orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
          include: {
            capabilityProof: {
              select: { status: true, verifiedAt: true, expiresAt: true },
            },
          },
        },
        providerRuns: {
          where: { purgedAt: null },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            providerKey: true,
            phase: true,
            status: true,
            receivedCount: true,
            acceptedCount: true,
            reviewCount: true,
            duplicateCount: true,
            reservedChargeUsd: true,
            actualChargeUsd: true,
            createdAt: true,
          },
        },
        collectorRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            foundCount: true,
            newCount: true,
            duplicateCount: true,
            ignoredCount: true,
            error: true,
            rawStats: true,
          },
        },
        subjectSources: {
          select: {
            subjectId: true,
            scenarioId: true,
            relationType: true,
          },
        },
        _count: {
          select: {
            collectorRuns: true,
            evidences: true,
            routePlans: true,
            providerRuns: { where: { purgedAt: null } },
          },
        },
      },
    }),
    prisma.monitoringSource.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: true,
    }),
    prisma.monitoringSource.groupBy({
      by: ["collectionMode"],
      where: { organizationId: orgId },
      _count: true,
    }),
    prisma.monitoringSource.groupBy({
      by: ["riskLevel"],
      where: { organizationId: orgId },
      _count: true,
    }),
    prisma.collectorRun.findMany({
      where: {
        organizationId: orgId,
        startedAt: { gte: recentSince },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: {
        id: true,
        sourceId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        foundCount: true,
        newCount: true,
        duplicateCount: true,
        ignoredCount: true,
        error: true,
        rawStats: true,
        source: { select: { platform: true, sourceType: true, collectionMode: true } },
      },
    }),
    prisma.mentionEvidence.groupBy({
      by: ["sourceTrustTier"],
      where: { organizationId: orgId },
      _count: true,
    }),
    prisma.aiAlert.findMany({
      where: {
        organizationId: orgId,
        type: { in: SOCIAL_ALERT_TYPES },
        createdAt: { gte: recentSince },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, severity: true, message: true, metadata: true, createdAt: true, isRead: true },
    }),
    resolveReadinessContext(orgId),
  ])

  const decorated = (sources as SourceHealthRow[]).map((source) => decorateSource(source, readinessContext))
  // Провайдерские затраты — внутренняя операционка платформы: в провайдер-ранах
  // источников тенантным ролям суммы не отдаём, superadmin видит как раньше.
  if (auth.role !== "superadmin") {
    for (const source of decorated) {
      for (const run of source.providerRuns ?? []) {
        run.reservedChargeUsd = null
        run.actualChargeUsd = null
      }
    }
  }
  const runRows = recentRuns as CollectorRunHealthRow[]
  const latestRun = runRows[0]
  const runTotals = runRows.reduce(
    (acc, run) => {
      acc.found += run.foundCount
      acc.new += run.newCount
      acc.duplicate += run.duplicateCount
      acc.ignored += run.ignoredCount
      if (run.status === "failed") acc.failed += 1
      if (run.status === "partial") acc.partial += 1
      return acc
    },
    { found: 0, new: 0, duplicate: 0, ignored: 0, failed: 0, partial: 0 },
  )
  const coverage = {
    activeSources: decorated.filter((source) => source.status === "active").length,
    health: {
      healthy: decorated.filter((source) => source.health.state === "healthy").length,
      due: decorated.filter((source) => source.health.due).length,
      degraded: decorated.filter((source) => source.health.state === "degraded").length,
      needsSetup: decorated.filter((source) => source.health.state === "needs_setup").length,
      blocked: decorated.filter((source) => source.status === "blocked").length,
    },
    last24h: runTotals,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          sourceId: latestRun.sourceId,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          foundCount: latestRun.foundCount,
          newCount: latestRun.newCount,
          error: latestRun.error,
          rawStats: latestRun.rawStats ?? null,
          source: latestRun.source ?? null,
        }
      : null,
    trustTiers: Object.fromEntries((trustTiers as Array<CountRow<"sourceTrustTier">>).map((group) => [group.sourceTrustTier, group._count])),
    partialCoverage: decorated.some((source) => PARTIAL_COVERAGE_MODES.has(source.collectionMode)),
    recentAlerts,
  }
  return NextResponse.json({
    success: true,
    data: {
      sources: decorated,
      coverage,
      stats: {
        total: decorated.length,
        due: decorated.filter((source) => source.health.due).length,
        degraded: decorated.filter((source) => source.health.state === "degraded").length,
        byStatus: Object.fromEntries((byStatus as Array<CountRow<"status">>).map((group) => [group.status, group._count])),
        byMode: Object.fromEntries((byMode as Array<CountRow<"collectionMode">>).map((group) => [group.collectionMode, group._count])),
        byRisk: Object.fromEntries((byRisk as Array<CountRow<"riskLevel">>).map((group) => [group.riskLevel, group._count])),
      },
    },
  })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const body = await req.json()
  const parsed = createMonitoringSourceSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  let input
  try {
    input = normalizeMonitoringSourceInput(parsed.data)
  } catch (error) {
    return NextResponse.json({ error: asErrorMessage(error) }, { status: 400 })
  }
  if (
    parsed.data.settings !== undefined
    && changesSensitiveSourceOutboundSettings(parsed.data.settings)
    && !isBrowserSessionAdmin(auth)
  ) {
    return NextResponse.json({ error: "browser_admin_required" }, { status: 403 })
  }
  if (parsed.data.settings !== undefined) {
    try {
      await validateMonitoringSourceOutboundEndpoints(input.settings)
    } catch (error) {
      return NextResponse.json({ error: asErrorMessage(error) }, { status: 400 })
    }
  }
  // Brand-protection-only tenants may add EXTERNAL watch targets but not OWNED
  // sources (those belong to the engagement mode they aren't entitled to).
  if (input.ownership === "owned" && await isSocialBrandProtectionOnly(orgId)) {
    return NextResponse.json({ error: "brand_protection_only" }, { status: 403 })
  }

  const protectedCollision = await findProtectedMonitoringIdentityCollision({
    organizationId: orgId,
    source: input,
    db: prisma,
  })
  if (protectedCollision) {
    return NextResponse.json({ error: OFFICIAL_IDENTITY_NOT_COLLECTABLE }, { status: 409 })
  }

  const duplicate = await prisma.monitoringSource.findFirst({
    where: {
      organizationId: orgId,
      ...buildMonitoringDuplicateWhere(input),
    },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json({ error: "Monitoring source already exists" }, { status: 409 })
  }

  const persisted = await prisma.monitoringSource.create({
    data: {
      organizationId: orgId,
      platform: input.platform,
      sourceType: input.sourceType,
      url: input.url,
      handle: input.handle,
      query: input.query,
      ownership: input.ownership,
      collectionMode: input.collectionMode,
      cadenceMinutes: input.cadenceMinutes,
      keywords: input.keywords,
      riskLevel: input.riskLevel,
      status: input.status,
      settings: input.settings as Prisma.InputJsonValue,
      createdBy: auth.userId,
    },
  })
  const routePlans = await compileSourceRoutePlans(persisted)
  await logAudit(
    orgId,
    "create",
    "monitoring_source",
    persisted.id,
    `${persisted.platform}:${persisted.sourceType}`,
  )
  return NextResponse.json({
    success: true,
    data: {
      ...decorateSource({ ...persisted, collectorRuns: [], subjectSources: [] }),
      routePlans,
      reused: false,
    },
  }, { status: 201 })
})
