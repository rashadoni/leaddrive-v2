import { prisma } from "@/lib/prisma"
import {
  runMonitoringSourceNow,
  type CollectorRunSummary,
} from "@/lib/social/monitoring-collector"
import { getMonitoringScenariosUncached } from "@/lib/social/monitoring-scenarios"
import {
  monitoringProfileSharedSourceCanTargetScenario,
  monitoringProfileSourceBelongsToScenario,
  monitoringProfileSourceRunPolicy,
} from "@/lib/social/monitoring-profile-run-plan"
import { isMonitoringIdentityRelation } from "@/lib/social/monitoring-source-identity"
import {
  compileSourceRoutePlans,
  ROUTE_ADAPTERS,
  SOURCE_ROUTE_POLICY_VERSION,
} from "@/lib/social/source-route-plan"
import { isBrightDataLiveRoutingAllowed } from "@/lib/social/bright-data-live-routing"
import { isApifySocialReadRouteAllowed } from "@/lib/social/bright-data-policy"

const inactiveSourceStatuses = new Set(["paused", "disabled", "blocked"])

type RunRoutePlan = {
  routeKey: string
  scenarioId: string | null
  policyVersion: string
  capability: string
  status: string
  primaryAdapter: string
  fallbackAdapters: string[]
  capabilityProofId: string | null
  dependsOnCapability: string | null
  budget: unknown
}

export type MonitoringProfileSourceRunInput = {
  scenarioId: string
  sourceId: string
  paidConfirmed?: boolean
  includeComments?: boolean
  commentsOnly?: boolean
  fullSearchConfirmed?: boolean
  maxTotalChargeUsd?: number
}

export type MonitoringProfileSourceRunFailure = {
  ok: false
  status: number
  error: string
  reason?: string
  retryAfterSeconds?: number
  providerAccountFundedOnly?: boolean
  maxTotalChargeUsd?: number | null
}

export type MonitoringProfileSourceRunSuccess = {
  ok: true
  status: 200
  data: CollectorRunSummary & { sharedAcrossMonitorings: boolean }
}

export type MonitoringProfileSourceRunOutcome =
  | MonitoringProfileSourceRunSuccess
  | MonitoringProfileSourceRunFailure

async function refreshStaleRoutePlans(
  organizationId: string,
  source: {
    id: string
    organizationId: string
    platform: string
    sourceType: string
    url: string | null
    handle: string | null
    query: string | null
    ownership: string
    collectionMode: string
    cadenceMinutes: number
    settings: unknown
    routePlans: RunRoutePlan[]
  },
  scenarioId: string,
): Promise<RunRoutePlan[]> {
  const currentPlans = source.routePlans
  const brightDataAdapter = ROUTE_ADAPTERS.BRIGHT_DATA_SNAPSHOT
  const planHasBrightData = currentPlans.some(plan =>
    plan.primaryAdapter === brightDataAdapter
    || plan.fallbackAdapters.includes(brightDataAdapter))
  const currentApifySocialReadPlan = ["facebook", "instagram", "tiktok"].includes(source.platform)
    && currentPlans.some(plan =>
      plan.policyVersion === SOURCE_ROUTE_POLICY_VERSION
      && isApifySocialReadRouteAllowed(source.platform, plan.capability)
      && (
        plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
        || plan.fallbackAdapters.includes(ROUTE_ADAPTERS.APIFY_ASYNC)
      ))
  let brightDataStale = false
  if (
    currentPlans.length > 0
    && !planHasBrightData
    && !currentApifySocialReadPlan
    && isBrightDataLiveRoutingAllowed(organizationId)
  ) {
    brightDataStale = await prisma.socialProviderCapabilityProof.count({
      where: {
        organizationId,
        platform: source.platform,
        adapterKey: brightDataAdapter,
        status: "VERIFIED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }) > 0
  }
  const prooflessInstagramBusinessDiscovery = source.platform === "instagram"
    && source.ownership === "external"
    && currentPlans.some(plan =>
      plan.capability === "DISCOVER_POSTS"
      && plan.primaryAdapter === ROUTE_ADAPTERS.META_GRAPH
      && !plan.capabilityProofId)
  const targetScenarioPlanStale = !currentPlans.some(plan => plan.scenarioId === scenarioId)
  const policyStale = currentPlans.some(plan =>
    plan.routeKey.endsWith(":entry")
    || plan.policyVersion !== SOURCE_ROUTE_POLICY_VERSION)

  if (
    currentPlans.length === 0
    || brightDataStale
    || prooflessInstagramBusinessDiscovery
    || targetScenarioPlanStale
    || policyStale
  ) {
    return compileSourceRoutePlans(source) as Promise<RunRoutePlan[]>
  }
  return currentPlans
}

/**
 * Authoritative server-side execution boundary shared by the one-source HTTP
 * route and durable bulk jobs. Keeping the profile/scenario/paid-route checks
 * here prevents a background worker from bypassing the guards applied to a
 * direct operator click.
 */
export async function runMonitoringProfileSourceForSubject(input: {
  organizationId: string
  requestedByUserId: string
  subjectId: string
  run: MonitoringProfileSourceRunInput
}): Promise<MonitoringProfileSourceRunOutcome> {
  const {
    organizationId,
    requestedByUserId,
    subjectId,
    run,
  } = input
  const {
    scenarioId,
    sourceId,
    paidConfirmed,
    includeComments,
    commentsOnly,
    fullSearchConfirmed,
    maxTotalChargeUsd,
  } = run

  const [link, scenarios] = await Promise.all([
    prisma.monitoringSubjectSource.findFirst({
      where: { organizationId, subjectId, sourceId },
      select: {
        scenarioId: true,
        relationType: true,
        subject: { select: { status: true } },
        source: {
          select: {
            id: true,
            organizationId: true,
            platform: true,
            sourceType: true,
            url: true,
            handle: true,
            query: true,
            ownership: true,
            collectionMode: true,
            cadenceMinutes: true,
            status: true,
            settings: true,
            routePlans: {
              where: { status: { not: "INVALIDATED" } },
              select: {
                routeKey: true,
                scenarioId: true,
                policyVersion: true,
                capability: true,
                status: true,
                primaryAdapter: true,
                fallbackAdapters: true,
                capabilityProofId: true,
                dependsOnCapability: true,
                budget: true,
              },
            },
            _count: { select: { subjectSources: true } },
          },
        },
      },
    }),
    getMonitoringScenariosUncached(organizationId),
  ])

  if (!link) return { ok: false, status: 404, error: "monitoring_source_not_linked" }
  if (link.subject.status !== "active") {
    return { ok: false, status: 409, error: "monitoring_profile_not_active" }
  }

  const scenario = scenarios.find(item => item.id === scenarioId && item.subjectId === subjectId)
  if (!scenario) return { ok: false, status: 404, error: "monitoring_scenario_not_found" }
  if (scenario.status !== "active") {
    return { ok: false, status: 409, error: "monitoring_scenario_not_active" }
  }
  if (inactiveSourceStatuses.has(link.source.status)) {
    return { ok: false, status: 409, error: "monitoring_source_not_active" }
  }
  if (isMonitoringIdentityRelation(link.relationType)) {
    return { ok: false, status: 409, error: "official_identity_not_collectable" }
  }
  const belongsToScenario = monitoringProfileSourceBelongsToScenario(link, scenario)
  const sharedSourceCanTargetScenario = monitoringProfileSharedSourceCanTargetScenario(link, scenario)
  if (!belongsToScenario && !sharedSourceCanTargetScenario) {
    return { ok: false, status: 409, error: "monitoring_source_not_in_scenario" }
  }

  const freshRoutePlans = await refreshStaleRoutePlans(organizationId, link.source, scenario.id)
  const runPolicy = monitoringProfileSourceRunPolicy({
    ...link,
    source: { ...link.source, routePlans: freshRoutePlans },
  }, scenario.id)
  const externalCommentsRequested = includeComments === true || commentsOnly === true
  if (externalCommentsRequested) {
    const paidClientFundedRun = runPolicy.paid
      && !runPolicy.providerAccountFundedOnly
      && paidConfirmed === true
    const scenarioAllowsExternalComments = scenario.search.includeExternalComments === true
    const hasScenarioApifyCommentRoute = freshRoutePlans.some(plan =>
      plan.scenarioId === scenario.id
      && ["ACTIVE", "DEGRADED"].includes(plan.status)
      && plan.capability === "READ_EXTERNAL_COMMENTS"
      && plan.primaryAdapter === ROUTE_ADAPTERS.APIFY_ASYNC
      && (
        plan.dependsOnCapability === "DISCOVER_POSTS"
        || (commentsOnly === true && plan.dependsOnCapability === "ENRICH_CONTENT")
      ))

    if (!paidClientFundedRun || !scenarioAllowsExternalComments || !hasScenarioApifyCommentRoute) {
      const reason = !paidClientFundedRun
        ? "paid_client_funded_route_required"
        : !scenarioAllowsExternalComments
          ? "scenario_external_comments_disabled"
          : "scenario_apify_comment_route_required"
      return {
        ok: false,
        status: 409,
        error: "external_comments_run_not_authorized",
        reason,
      }
    }
  }
  if (runPolicy.sharedAcrossMonitorings && fullSearchConfirmed !== true) {
    return { ok: false, status: 409, error: "monitoring_shared_source_confirmation_required" }
  }
  if (runPolicy.paid && paidConfirmed !== true) {
    return {
      ok: false,
      status: 409,
      error: "paid_run_confirmation_required",
      providerAccountFundedOnly: runPolicy.providerAccountFundedOnly,
      maxTotalChargeUsd: runPolicy.maxTotalChargeUsd,
    }
  }
  if (!runPolicy.paid && maxTotalChargeUsd !== undefined) {
    return { ok: false, status: 400, error: "paid_run_cap_not_applicable" }
  }

  const result = await runMonitoringSourceNow(organizationId, sourceId, {
    fullArchiveRun: commentsOnly !== true,
    maxTotalChargeUsd: runPolicy.paid ? maxTotalChargeUsd : undefined,
    requestedByUserId,
    targetScenarioId: scenario.id,
    targetSubjectId: subjectId,
    archiveStartAt: scenario.archive.startAt,
    paidRunConfirmed: runPolicy.paid,
    clientFundedManual: runPolicy.paid,
    providerAccountFunded: runPolicy.providerAccountFundedOnly,
    ...(externalCommentsRequested ? { includeComments: true } : {}),
    ...(commentsOnly === true ? { onlyCapability: "READ_EXTERNAL_COMMENTS" as const } : {}),
  })

  if (!("runId" in result)) {
    if (result.error === "not_found") {
      return { ok: false, status: 404, error: "monitoring_source_not_found" }
    }
    if (result.error === "already_running") {
      return {
        ok: false,
        status: 409,
        error: "collector_already_running",
        retryAfterSeconds: result.retryAfterSeconds ?? 60,
      }
    }
    return { ok: false, status: 409, error: result.error }
  }

  return {
    ok: true,
    status: 200,
    data: { ...result, sharedAcrossMonitorings: runPolicy.sharedAcrossMonitorings },
  }
}
