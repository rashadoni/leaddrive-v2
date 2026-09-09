import { describe, expect, it } from "vitest"
import {
  appendMtmRouteChangeEvidenceOutcome,
  attachMtmRouteChangeEvidence,
  createMtmRouteChangeEvidence,
  readMtmRouteChangeEvidence,
} from "@/lib/mtm/route-change-evidence"

const route = {
  id: "route-1",
  version: 4,
  publishedVersion: 4,
  status: "PLANNED",
  date: new Date("2026-08-28T00:00:00.000Z"),
  totalPoints: 2,
  agentId: "agent-1",
}

const point = {
  id: "point-1",
  customerId: "customer-1",
  contactId: null,
  orderIndex: 0,
  status: "PENDING",
  plannedTime: new Date("2026-08-28T09:00:00.000Z"),
  deletedAt: null,
}

describe("MTM route change evidence", () => {
  it("captures a version-bound before snapshot while preserving caller payload", () => {
    const evidence = createMtmRouteChangeEvidence({
      capturedAt: new Date("2026-08-27T12:00:00.000Z"),
      changeType: "REMOVE_STOP",
      route,
      routePoint: point,
    })
    const payload = attachMtmRouteChangeEvidence({ reasonCode: "CUSTOMER_REQUEST", dedupeKey: "dedupe-1" }, evidence)

    expect(payload).toMatchObject({
      reasonCode: "CUSTOMER_REQUEST",
      dedupeKey: "dedupe-1",
      evidence: {
        schemaVersion: 1,
        before: {
          route: { id: "route-1", version: 4, totalPoints: 2 },
          routePoint: { id: "point-1", orderIndex: 0, status: "PENDING" },
        },
        proposed: { changeType: "REMOVE_STOP", routePointId: "point-1", target: null },
      },
    })
    expect(readMtmRouteChangeEvidence(payload)).toMatchObject({ legacySnapshot: false })
  })

  it("records an after snapshot without inventing evidence for legacy rows", () => {
    const evidence = createMtmRouteChangeEvidence({ changeType: "REMOVE_STOP", route, routePoint: point })
    const payload = attachMtmRouteChangeEvidence({}, evidence)
    const next = appendMtmRouteChangeEvidenceOutcome({
      payload,
      decision: "APPROVED",
      status: "APPROVED",
      recordedAt: new Date("2026-08-28T10:00:00.000Z"),
      route: { ...route, version: 5, publishedVersion: 5, totalPoints: 1 },
      routePoint: { ...point, deletedAt: new Date("2026-08-28T10:00:00.000Z") },
    })

    expect(next).toMatchObject({
      evidence: {
        outcomes: [{
          decision: "APPROVED",
          after: {
            route: { version: 5, totalPoints: 1 },
            routePoint: { deletedAt: "2026-08-28T10:00:00.000Z" },
          },
        }],
      },
    })
    expect(readMtmRouteChangeEvidence({ customerId: "legacy" })).toEqual({ legacySnapshot: true, evidence: null })
    expect(appendMtmRouteChangeEvidenceOutcome({
      payload: { customerId: "legacy" },
      decision: "REJECTED",
      status: "REJECTED",
      recordedAt: new Date(),
      route,
      routePoint: point,
    })).toBeNull()
  })
})
