import { describe, expect, it } from "vitest"
import {
  targetScopedObservationIdempotencyKey,
} from "@/lib/social/collector-observation-context"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

function source(targetSubjectId?: string): MonitoringSourceForRun {
  return {
    id: "source-1",
    organizationId: "org-1",
    platform: "facebook",
    routeExecution: targetSubjectId
      ? {
          collectorRunId: "collector-1",
          routePlanId: "route-1",
          capability: "DISCOVER_URLS",
          adapterKey: "APIFY_ASYNC",
          acquisitionMode: "LICENSED_PROVIDER",
          providerKey: "APIFY",
          providerRunId: "provider-1",
          maxItems: 100,
          timeoutSeconds: 900,
          targetSubjectId,
        }
      : undefined,
  } as MonitoringSourceForRun
}

describe("target-scoped observation idempotency", () => {
  it("is stable for one target and distinct across monitorings", () => {
    const first = targetScopedObservationIdempotencyKey(source("subject-a"), "post-1")
    const repeated = targetScopedObservationIdempotencyKey(source("subject-a"), "post-1")
    const otherSubject = targetScopedObservationIdempotencyKey(source("subject-b"), "post-1")

    expect(first).toMatch(/^monitoring-target-v1:[a-f0-9]{64}$/)
    expect(repeated).toBe(first)
    expect(otherSubject).not.toBe(first)
  })

  it("keeps legacy global idempotency when no monitoring target is selected", () => {
    expect(targetScopedObservationIdempotencyKey(source(), "post-1")).toBeNull()
  })
})
