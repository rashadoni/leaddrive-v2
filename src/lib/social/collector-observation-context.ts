import crypto from "crypto"
import type { IngestObservationContext } from "@/lib/social/ingest-mention"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

export function observationContextForCollector(
  source: MonitoringSourceForRun,
  options: {
    providerItemId?: string | null
    idempotencyKey?: string | null
    rawPayload?: Record<string, unknown>
    requireMatchedTerm?: boolean
    relevanceStatus?: IngestObservationContext["relevanceStatus"]
    relevanceReason?: string
    relevanceConfidence?: number
    policySnapshot?: Record<string, unknown>
  } = {},
): IngestObservationContext {
  return {
    sourceId: source.id,
    collectorRunId: source.routeExecution?.collectorRunId ?? null,
    routePlanId: source.routeExecution?.routePlanId ?? null,
    providerRunId: source.routeExecution?.providerRunId ?? null,
    adapterKey: source.routeExecution?.adapterKey ?? source.collectionMode,
    providerKey: source.routeExecution?.providerKey ?? null,
    providerItemId: options.providerItemId ?? null,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    acquisitionMode: source.routeExecution?.acquisitionMode ?? source.collectionMode,
    rawPayload: options.rawPayload,
    policySnapshot: {
      version: "social-monitoring-v2-pr2",
      ...(options.policySnapshot ?? {}),
      routePlanId: source.routeExecution?.routePlanId ?? null,
      capability: source.routeExecution?.capability ?? null,
      adapterKey: source.routeExecution?.adapterKey ?? source.collectionMode,
      acquisitionMode: source.routeExecution?.acquisitionMode ?? source.collectionMode,
    },
    requireMatchedTerm: options.requireMatchedTerm,
    relevanceStatus: options.relevanceStatus,
    relevanceReason: options.relevanceReason,
    relevanceConfidence: options.relevanceConfidence,
  }
}

/**
 * Re-evaluate one canonical publication for each explicitly selected
 * monitoring. The envelope is subject-scoped, while SocialMention remains
 * deduplicated by its canonical platform/external identity.
 */
export function targetScopedObservationIdempotencyKey(
  source: MonitoringSourceForRun,
  providerItemIdentity: string | null | undefined,
): string | null {
  const targetSubjectId = source.routeExecution?.targetSubjectId?.trim()
  const identity = providerItemIdentity?.trim()
  if (!targetSubjectId || !identity) return null
  const digest = crypto.createHash("sha256").update([
    source.organizationId,
    targetSubjectId,
    source.platform,
    identity,
  ].join("\u0000")).digest("hex")
  return `monitoring-target-v1:${digest}`
}

export function routeExecutionMetadata(source: MonitoringSourceForRun): Record<string, unknown> {
  return {
    monitoringSourceId: source.id,
    collectorRunId: source.routeExecution?.collectorRunId ?? null,
    routePlanId: source.routeExecution?.routePlanId ?? null,
    routeCapability: source.routeExecution?.capability ?? null,
    routeAdapter: source.routeExecution?.adapterKey ?? null,
    acquisitionMode: source.routeExecution?.acquisitionMode ?? null,
    providerRunId: source.routeExecution?.providerRunId ?? null,
    targetScenarioId: source.routeExecution?.targetScenarioId ?? null,
    targetSubjectId: source.routeExecution?.targetSubjectId ?? null,
  }
}
