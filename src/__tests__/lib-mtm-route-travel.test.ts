import { describe, expect, it } from "vitest"
import {
  MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED,
  createMtmRouteTravelCalculationRequest,
  createMtmRouteTravelNotConfiguredPlan,
  resolveMtmRouteTravelPolicy,
} from "@/lib/mtm/route-travel"

describe("MTM route travel provider boundary", () => {
  const points = [
    { id: "stop-b", orderIndex: 2, latitude: 40.4093, longitude: 49.8671 },
    { id: "stop-a", orderIndex: 1, latitude: 0, longitude: 0 },
    { id: "stop-c", orderIndex: 3, latitude: 91, longitude: 49.9 },
  ]

  it("keeps an unconfigured tenant in manual-only mode without enabling navigation", () => {
    expect(resolveMtmRouteTravelPolicy()).toEqual({
      schemaVersion: 1,
      policyVersion: 1,
      state: "NOT_CONFIGURED",
      providerKey: null,
      calculationEnabled: false,
      navigationEnabled: false,
    })
  })

  it("requires both a tenant opt-in and an operator-ready provider before calculation is available", () => {
    expect(resolveMtmRouteTravelPolicy({
      tenantCalculationEnabled: true,
      tenantNavigationEnabled: true,
      providerKey: "google-routes",
    })).toEqual({
      schemaVersion: 1,
      policyVersion: 1,
      state: "READY",
      providerKey: "google-routes",
      calculationEnabled: true,
      navigationEnabled: true,
    })
  })

  it("creates a deterministic request from the exact manual order and valid coordinates", () => {
    const first = createMtmRouteTravelCalculationRequest({ routeId: "route-1", routeVersion: 4, points })
    const same = createMtmRouteTravelCalculationRequest({ routeId: "route-1", routeVersion: 4, points: [...points].reverse() })
    const changedVersion = createMtmRouteTravelCalculationRequest({ routeId: "route-1", routeVersion: 5, points })

    expect(first.source.orderedPointIds).toEqual(["stop-a", "stop-b", "stop-c"])
    expect(first.points).toEqual([
      { id: "stop-a", orderIndex: 1, latitude: 0, longitude: 0 },
      { id: "stop-b", orderIndex: 2, latitude: 40.4093, longitude: 49.8671 },
    ])
    expect(first.source.fingerprint).toBe(same.source.fingerprint)
    expect(changedVersion.source.fingerprint).not.toBe(first.source.fingerprint)
  })

  it("returns a version-bound no-provider result without inventing distance, ETA, geometry, or a reordered route", () => {
    const plan = createMtmRouteTravelNotConfiguredPlan({ routeId: "route-1", routeVersion: 4, points })

    expect(plan).toMatchObject({
      schemaVersion: 1,
      state: "NOT_CONFIGURED",
      reasonCode: MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED,
      provider: null,
      source: {
        routeId: "route-1",
        routeVersion: 4,
        orderedPointIds: ["stop-a", "stop-b", "stop-c"],
      },
      coordinateCoverage: { totalPoints: 3, locatedPoints: 2, missingPoints: 1 },
      manualOrder: { preserved: true, orderedPointIds: ["stop-a", "stop-b", "stop-c"] },
      calculation: {
        distanceMeters: null,
        durationSeconds: null,
        geometry: null,
        calculatedAt: null,
      },
    })
  })
})
