import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import {
  buildMonitoringReadinessEnvironment,
  buildMonitoringDuplicateWhere,
  type MonitoringReadinessAccount,
  normalizeMonitoringSourceUpdate,
  redactMonitoringSettingsForResponse,
  summarizeMonitoringReadiness,
  summarizeMonitoringProviderSetup,
  summarizeSourceHealth,
  updateMonitoringSourceSchema,
} from "@/lib/social/monitoring-source"
import {
  getSocialMonitoringSettings,
  mergeMonitoringSettingsIntoSourceSettings,
  type SocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"
import { compileSourceRoutePlans } from "@/lib/social/source-route-plan"
import {
  findProtectedMonitoringIdentityCollision,
  OFFICIAL_IDENTITY_NOT_COLLECTABLE,
} from "@/lib/social/monitoring-source-protection"
import { isGoogleAlertsRssSource } from "@/lib/social/google-alerts-rss"
import { validateMonitoringSourceOutboundEndpoints } from "@/lib/social/social-outbound-http"
import {
  changesSensitiveSourceOutboundSettings,
  isBrowserSessionAdmin,
} from "@/lib/social/outbound-settings-access"

type RouteCtx = { params: Promise<{ id: string }> }

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid monitoring source"
}

type CollectorRunHealthRow = {
  id: string
  status: string
  startedAt: Date | string
  finishedAt: Date | string | null
  foundCount: number
  newCount: number
  duplicateCount: number
  ignoredCount: number
  error: string | null
  rawStats?: Prisma.JsonValue | null
}

type MonitoringReadinessContext = {
  accounts: MonitoringReadinessAccount[]
  liveRepliesEnabled: boolean
  monitoringSettings: SocialMonitoringSettings
}

type DecoratableMonitoringSource = {
  organizationId: string
  platform: string
  sourceType: string
  ownership: string
  collectionMode: string
  collectorRuns?: CollectorRunHealthRow[]
  settings: unknown
  lastCheckedAt: Date | string | null
  lastSuccessfulAt: Date | string | null
  lastError: string | null
  cadenceMinutes: number
  status: string
}

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

function decorateSource<T extends DecoratableMonitoringSource>(
  source: T,
  context: MonitoringReadinessContext,
) {
  const effectiveSettings = mergeMonitoringSettingsIntoSourceSettings(source.settings, context.monitoringSettings, source)
  return {
    ...source,
    settings: redactMonitoringSettingsForResponse(effectiveSettings),
    providerSetup: summarizeMonitoringProviderSetup(effectiveSettings),
    health: summarizeSourceHealth(source),
    readiness: summarizeMonitoringReadiness({ ...source, settings: effectiveSettings }, {
      accounts: context.accounts,
      env: buildMonitoringReadinessEnvironment({ liveRepliesEnabled: context.liveRepliesEnabled }),
    }),
  }
}

async function findSource(orgId: string, id: string) {
  return prisma.monitoringSource.findFirst({
    where: { id, organizationId: orgId },
    include: {
      routePlans: {
        where: { status: { not: "INVALIDATED" } },
        orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
      },
      collectorRuns: {
        orderBy: { startedAt: "desc" },
        take: 5,
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
      _count: {
        select: {
          collectorRuns: true,
          evidences: true,
          routePlans: true,
          providerRuns: { where: { purgedAt: null } },
        },
      },
    },
  })
}

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth, { params }: RouteCtx) => {
  const { id } = await params
  const [source, readinessContext] = await Promise.all([
    findSource(auth.orgId, id),
    resolveReadinessContext(auth.orgId),
  ])
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: decorateSource(source, readinessContext) })
})

export const PUT = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, ctx: RouteCtx) => {
  return updateSource(req, auth, ctx)
})

export const PATCH = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, ctx: RouteCtx) => {
  return updateSource(req, auth, ctx)
})

async function updateSource(
  req: NextRequest,
  auth: { orgId: string; userId: string; role: string; scopes?: unknown },
  { params }: RouteCtx,
) {
  const orgId = auth.orgId
  const { id } = await params
  const existing = await prisma.monitoringSource.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (isGoogleAlertsRssSource(existing)) {
    return NextResponse.json({ error: "google_alerts_rss_managed_in_scenario" }, { status: 409 })
  }

  const body = await req.json()
  const parsed = updateMonitoringSourceSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  let input
  try {
    input = normalizeMonitoringSourceUpdate(existing, parsed.data)
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

  const protectedCollision = await findProtectedMonitoringIdentityCollision({
    organizationId: orgId,
    source: input,
    excludeSourceId: id,
    db: prisma,
  })
  if (protectedCollision) {
    return NextResponse.json({ error: OFFICIAL_IDENTITY_NOT_COLLECTABLE }, { status: 409 })
  }

  const duplicate = await prisma.monitoringSource.findFirst({
    where: {
      organizationId: orgId,
      id: { not: id },
      ...buildMonitoringDuplicateWhere(input),
    },
    select: { id: true },
  })
  if (duplicate) return NextResponse.json({ error: "Monitoring source already exists" }, { status: 409 })

  const updated = await prisma.monitoringSource.update({
    where: { id },
    data: {
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
    },
    include: {
      routePlans: {
        where: { status: { not: "INVALIDATED" } },
        orderBy: [{ executionOrder: "asc" }, { compiledAt: "desc" }],
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
  })
  const routePlans = await compileSourceRoutePlans(updated)

  await logAudit(orgId, "update", "monitoring_source", updated.id, `${updated.platform}:${updated.sourceType}`, {
    oldValue: existing,
    newValue: updated,
  })
  const readinessContext = await resolveReadinessContext(orgId)
  return NextResponse.json({
    success: true,
    data: { ...decorateSource(updated, readinessContext), routePlans },
  })
}

export const DELETE = withRlsAuth("social", "delete", async (_req: NextRequest, auth, { params }: RouteCtx) => {
  const orgId = auth.orgId
  const { id } = await params
  const existing = await prisma.monitoringSource.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (isGoogleAlertsRssSource(existing)) {
    return NextResponse.json({ error: "google_alerts_rss_managed_in_scenario" }, { status: 409 })
  }

  // Collected artifacts (mention evidence, discovery leads, ingest envelopes,
  // dedup fingerprints, metric snapshots) reference the source and its
  // runs/plans with NoAction FKs (compound FK includes organizationId, so
  // SetNull is impossible at the schema level). Detach them first, otherwise
  // the delete cascade over collector_runs/route_plans/provider_runs hits an
  // FK violation as soon as the source has collected anything.
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.mentionEvidence.updateMany({
      where: { organizationId: orgId, sourceId: id },
      data: { sourceId: null },
    })
    await tx.discoveryLead.updateMany({
      where: { organizationId: orgId, sourceId: id },
      data: { sourceId: null },
    })
    await tx.rejectedObservationFingerprint.updateMany({
      where: { organizationId: orgId, sourceId: id },
      data: { sourceId: null },
    })
    await tx.ingestEnvelope.updateMany({
      where: { organizationId: orgId, sourceId: id },
      data: { sourceId: null },
    })
    await tx.ingestEnvelope.updateMany({
      where: { organizationId: orgId, collectorRun: { sourceId: id } },
      data: { collectorRunId: null },
    })
    await tx.ingestEnvelope.updateMany({
      where: { organizationId: orgId, routePlan: { sourceId: id } },
      data: { routePlanId: null },
    })
    await tx.ingestEnvelope.updateMany({
      where: { organizationId: orgId, providerRun: { sourceId: id } },
      data: { providerRunId: null },
    })
    await tx.socialMetricSnapshot.updateMany({
      where: { organizationId: orgId, providerRun: { sourceId: id } },
      data: { providerRunId: null },
    })
    await tx.monitoringSource.delete({ where: { id } })
  })
  logAudit(orgId, "delete", "monitoring_source", id, `${existing.platform}:${existing.sourceType}`, {
    newValue: { removedScenarioIds: [] },
  })
  return NextResponse.json({ success: true })
})
