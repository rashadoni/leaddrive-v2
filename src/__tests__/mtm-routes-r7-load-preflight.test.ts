import { describe, expect, it } from "vitest"
import {
  MTM_ROUTES_R7_WORKLOAD_MANIFEST,
  hotPathsForMtmRoutesR7Stage,
  validateMtmRoutesR7Environment,
  validateMtmRoutesR7ExecutionInputs,
  validateMtmRoutesR7WorkloadManifest,
} from "../../scripts/mtm-routes-r7-load-preflight.mjs"

function profileFor(stage: "base" | "v2") {
  const operations = Object.fromEntries(
    hotPathsForMtmRoutesR7Stage(stage).map(({ id }) => [id, { requestsPerMinute: 1 }]),
  )
  const sloOperations = Object.fromEntries(
    hotPathsForMtmRoutesR7Stage(stage).map(({ id }) => [id, {
      p95Ms: 250,
      p99Ms: 500,
      maxErrorRate: 0.009,
    }]),
  )
  return {
    requestMix: {
      approvalStatus: "OWNER_APPROVED",
      workload: {
        normalPeakLogicalDataOperationsPerMinute: MTM_ROUTES_R7_WORKLOAD_MANIFEST.largestTenantNormalPeakDataOperationsPerMinute,
        burstLogicalDataOperationsPerMinute: MTM_ROUTES_R7_WORKLOAD_MANIFEST.largestTenantBurstDataOperationsPerMinute,
        burstMaxDurationMinutes: MTM_ROUTES_R7_WORKLOAD_MANIFEST.largestTenantBurstMaxDurationMinutes,
      },
      operations,
    },
    slo: {
      approvalStatus: "OWNER_APPROVED",
      errorRatePolicy: MTM_ROUTES_R7_WORKLOAD_MANIFEST.errorRatePolicy,
      operations: sloOperations,
    },
  }
}

describe("MTM Routes R7 load preflight", () => {
  it("pins the approved population and largest-tenant concurrency without starting load", () => {
    expect(MTM_ROUTES_R7_WORKLOAD_MANIFEST).toMatchObject({
      version: 1,
      tenantCount: 100,
      provisionedUserCount: 5_000,
      largestTenantConcurrentActiveUsers: 1_000,
      largestTenantPeakConcurrentDataOperations: 200,
      largestTenantNormalPeakDataOperationsPerMinute: 200,
      largestTenantBurstDataOperationsPerMinute: 400,
      largestTenantBurstMaxDurationMinutes: 5,
      errorRatePolicy: "SYSTEM_ERRORS_EXCLUDE_EXPECTED_BUSINESS_CONFLICTS",
      maxP95Ms: 1_000,
      maxP99Ms: 2_000,
      maxSystemErrorRateExclusive: 0.01,
    })
    expect(validateMtmRoutesR7WorkloadManifest()).toEqual([])
    expect(hotPathsForMtmRoutesR7Stage("base").map(({ id }) => id)).not.toContain("mobile_v2_route_snapshot")
    expect(hotPathsForMtmRoutesR7Stage("base").map(({ id }) => id)).toContain("route_publish")
    expect(hotPathsForMtmRoutesR7Stage("base").map(({ id }) => id)).toContain("mobile_v1_sync_checkin")
    expect(hotPathsForMtmRoutesR7Stage("v2").map(({ id }) => id)).toContain("mobile_v2_route_snapshot")
  })

  it("fails closed when the approved peak data-operation envelope is changed", () => {
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      largestTenantPeakConcurrentDataOperations: 201,
    })).toEqual(expect.arrayContaining([
      "largestTenantPeakConcurrentDataOperations must remain 200",
    ]))
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      largestTenantNormalPeakDataOperationsPerMinute: 201,
    })).toEqual(expect.arrayContaining([
      "largestTenantNormalPeakDataOperationsPerMinute must remain 200",
    ]))
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      largestTenantBurstDataOperationsPerMinute: 401,
    })).toEqual(expect.arrayContaining([
      "largestTenantBurstDataOperationsPerMinute must remain 400",
    ]))
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      largestTenantBurstMaxDurationMinutes: 6,
    })).toEqual(expect.arrayContaining([
      "largestTenantBurstMaxDurationMinutes must remain 5",
    ]))
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      errorRatePolicy: "ALL_HTTP_4XX_ARE_SYSTEM_ERRORS",
    })).toEqual(expect.arrayContaining([
      "errorRatePolicy must exclude expected business conflicts from system errors",
    ]))
    expect(validateMtmRoutesR7WorkloadManifest({
      ...MTM_ROUTES_R7_WORKLOAD_MANIFEST,
      maxP95Ms: 1_001,
    })).toEqual(expect.arrayContaining([
      "maxP95Ms must remain 1000",
    ]))
  })

  it("fails closed until the owner-approved mix, SLO, stage, and isolated target are present", () => {
    expect(validateMtmRoutesR7ExecutionInputs({})).toEqual(expect.arrayContaining([
      "targetKind must be isolated-production-like",
      "isolated target confirmation is required",
      "owner-approved request mix is required",
      "owner-approved SLO profile is required",
    ]))
  })

  it("does not mistake a proposed profile for owner approval", () => {
    const base = profileFor("base")
    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "base",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      requestMix: { ...base.requestMix, approvalStatus: "PROPOSED_UNAPPROVED" },
      slo: { ...base.slo, approvalStatus: "PROPOSED_UNAPPROVED" },
    })).toEqual(expect.arrayContaining([
      "request mix must be explicitly marked OWNER_APPROVED",
      "SLO profile must be explicitly marked OWNER_APPROVED",
    ]))
  })

  it("requires an execution mix to repeat the approved logical data-operation envelope", () => {
    const base = profileFor("base")
    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "base",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      requestMix: {
        ...base.requestMix,
        workload: {
          ...base.requestMix.workload,
          burstLogicalDataOperationsPerMinute: 401,
        },
      },
      slo: base.slo,
    })).toEqual(expect.arrayContaining([
      "request mix burst must match the approved logical data-operation envelope",
    ]))
  })

  it("requires the SLO profile to report expected business conflicts separately", () => {
    const base = profileFor("base")
    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "base",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      requestMix: base.requestMix,
      slo: { ...base.slo, errorRatePolicy: "ALL_HTTP_4XX_ARE_SYSTEM_ERRORS" },
    })).toEqual(expect.arrayContaining([
      "SLO error rate policy must match the approved conflict classification",
    ]))
  })

  it("rejects SLO limits that are weaker than the approved latency and error ceilings", () => {
    const base = profileFor("base")
    const operation = "route_publish"
    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "base",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      requestMix: base.requestMix,
      slo: {
        ...base.slo,
        operations: {
          ...base.slo.operations,
          [operation]: { p95Ms: 1_001, p99Ms: 2_001, maxErrorRate: 0.01 },
        },
      },
    })).toEqual(expect.arrayContaining([
      `SLO p95Ms exceeds approved 1000ms for ${operation}`,
      `SLO p99Ms exceeds approved 2000ms for ${operation}`,
      `SLO maxErrorRate must remain below approved 0.01 for ${operation}`,
    ]))
  })

  it("accepts a complete base profile but requires v2 paths only for the v2 stage", () => {
    const base = profileFor("base")
    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "base",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      ...base,
    })).toEqual([])

    expect(validateMtmRoutesR7ExecutionInputs({
      stage: "v2",
      targetKind: "isolated-production-like",
      isolatedTargetConfirmed: true,
      ...base,
    })).toEqual(expect.arrayContaining([
      "request mix needs a positive requestsPerMinute for mobile_v2_route_snapshot",
      "SLO needs positive p95Ms and p99Ms for mobile_v2_route_delta",
    ]))
  })

  it("does not read a target or run a load test while validating local profile files", () => {
    const profile = profileFor("base")
    const files: Record<string, string> = {
      "/request-mix.json": JSON.stringify(profile.requestMix),
      "/slo.json": JSON.stringify(profile.slo),
    }
    const errors = validateMtmRoutesR7Environment({
      MTM_R7_REQUEST_MIX_FILE: "/request-mix.json",
      MTM_R7_SLO_FILE: "/slo.json",
      MTM_R7_TARGET_KIND: "isolated-production-like",
      MTM_R7_ISOLATED_TARGET_CONFIRMATION: "confirmed",
    }, (path) => files[path])
    expect(errors).toEqual([])
  })
})
