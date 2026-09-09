import { prisma } from "@/lib/prisma"
import { isSocialBrandProtectionOnly } from "@/lib/social/brand-protection"
import {
  runMonitoringSourceNow,
  type CollectorRunSummary,
} from "@/lib/social/monitoring-collector"
import { monitoringSourceIdentityRole } from "@/lib/social/monitoring-source-identity"
import { monitoringSourcePresentationKind } from "@/lib/social/monitoring-source-presentation"
import type { SourceCapability } from "@/lib/social/source-route-plan"

export type MonitoringSourceRunScope = "OWNED" | "EXTERNAL"

export type MonitoringSourceRunOutcome =
  | { ok: true; status: 200; data: CollectorRunSummary }
  | {
      ok: false
      status: 400 | 404 | 409
      error: string
      retryAfterSeconds?: number
    }

const INACTIVE_SOURCE_STATUSES = new Set(["paused", "draft", "disabled", "blocked"])

/**
 * Authoritative direct-source execution boundary shared by the single-source
 * HTTP route and durable watchlist jobs. The job plan is only a snapshot; this
 * function re-checks the live source, ownership scope, identity relation and
 * active client immediately before a collector can dispatch external work.
 */
export async function runMonitoringSourceForActor(input: {
  organizationId: string
  requestedByUserId: string
  sourceId: string
  expectedScope?: MonitoringSourceRunScope
  maxTotalChargeUsd?: number
  paidRunConfirmed?: boolean
  onlyCapability?: SourceCapability
  fullArchiveRun?: boolean
}): Promise<MonitoringSourceRunOutcome> {
  const source = await prisma.monitoringSource.findFirst({
    where: {
      organizationId: input.organizationId,
      id: input.sourceId,
    },
    select: {
      id: true,
      ownership: true,
      status: true,
      platform: true,
      sourceType: true,
      url: true,
      handle: true,
      query: true,
      settings: true,
      subjectSources: {
        select: {
          relationType: true,
          subject: { select: { status: true } },
        },
      },
    },
  })
  if (!source) return { ok: false, status: 404, error: "monitoring_source_not_found" }
  if (INACTIVE_SOURCE_STATUSES.has(source.status)) {
    return { ok: false, status: 409, error: "monitoring_source_not_active" }
  }

  const expectedScope = input.expectedScope ?? "EXTERNAL"
  const scopeMatches = expectedScope === "OWNED"
    ? source.ownership === "owned"
    : source.ownership !== "owned"
  if (!scopeMatches) {
    return { ok: false, status: 409, error: "monitoring_source_scope_changed" }
  }

  // The existing direct-run endpoint deliberately collects external targets;
  // owned identities are polled through their official-account integrations.
  // Keeping this guard for OWNED bulk jobs preserves the old button's behavior
  // without letting the server queue newly bypass that boundary.
  if (monitoringSourceIdentityRole(source.subjectSources) !== "external") {
    return { ok: false, status: 409, error: "official_identity_not_collectable" }
  }
  if (!source.subjectSources.some(link => link.subject?.status === "active")) {
    return { ok: false, status: 409, error: "no_active_linked_subject" }
  }

  if (
    expectedScope === "EXTERNAL"
    && await isSocialBrandProtectionOnly(input.organizationId)
    && source.platform !== "web"
    && monitoringSourcePresentationKind(source) === "direct"
  ) {
    return {
      ok: false,
      status: 409,
      error: "brand_protection_direct_source_not_collectable",
    }
  }

  const result = await runMonitoringSourceNow(input.organizationId, source.id, {
    maxTotalChargeUsd: input.maxTotalChargeUsd,
    // Callers must make the paid/free decision explicit. In particular, a
    // queued free plan must not silently become billable if routes are
    // recompiled between enqueue and dispatch.
    paidRunConfirmed: input.paidRunConfirmed ?? false,
    requestedByUserId: input.requestedByUserId,
    onlyCapability: input.onlyCapability,
    fullArchiveRun: input.fullArchiveRun,
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
    return { ok: false, status: 400, error: result.error }
  }
  return { ok: true, status: 200, data: result }
}
