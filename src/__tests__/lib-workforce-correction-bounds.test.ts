import { describe, expect, it } from "vitest"
import {
  assessWorkforceCorrectionBounds,
  workforceCorrectionBoundsPolicyHash,
} from "@/lib/workforce/correction-bounds"

const policy = {
  version: "correction-policy-v1",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  directCorrectionWindowDays: 14,
  maximumWorkdayDurationSeconds: 16 * 60 * 60,
  maximumBoundaryChangeSeconds: 4 * 60 * 60,
}

const baseline = {
  policy,
  workDate: "2026-08-28",
  evaluationDate: "2026-08-30",
  periodState: "OPEN" as const,
  currentStartedAt: "2026-08-28T09:00:00.000+04:00",
  currentCompletedAt: "2026-08-28T18:00:00.000+04:00",
  desiredStartedAt: "2026-08-28T08:45:00.000+04:00",
  desiredCompletedAt: "2026-08-28T17:45:00.000+04:00",
}

describe("Workforce correction bounds", () => {
  it("permits a bounded correction only under an explicit effective open-period policy", () => {
    const result = assessWorkforceCorrectionBounds(baseline)

    expect(result).toEqual({
      disposition: "DIRECT_ALLOWED",
      code: "WORKFORCE_TIME_CORRECTION_WITHIN_POLICY",
      policy: { version: policy.version, hash: workforceCorrectionBoundsPolicyHash(policy) },
      ageDays: 2,
      desiredDurationSeconds: 9 * 60 * 60,
      maximumBoundaryDeltaSeconds: 15 * 60,
    })
  })

  it("fails closed to human review when no tenant correction policy is supplied", () => {
    const result = assessWorkforceCorrectionBounds({ ...baseline, policy: null })

    expect(result).toMatchObject({
      disposition: "REVIEW_REQUIRED",
      code: "WORKFORCE_TIME_CORRECTION_POLICY_UNCONFIGURED",
      policy: null,
    })
  })

  it.each([
    ["outside the configured correction window", { evaluationDate: "2026-09-13" }, "WORKFORCE_TIME_CORRECTION_OUTSIDE_WINDOW"],
    ["closed pay period", { periodState: "CLOSED" as const }, "WORKFORCE_TIME_CORRECTION_PERIOD_NOT_OPEN"],
    ["expired policy", { workDate: "2025-12-31" }, "WORKFORCE_TIME_CORRECTION_POLICY_NOT_EFFECTIVE"],
    ["extreme duration", { desiredCompletedAt: "2026-08-29T01:00:00.000+04:00" }, "WORKFORCE_TIME_CORRECTION_DURATION_REVIEW"],
    ["extreme boundary", { desiredStartedAt: "2026-08-28T04:00:00.000+04:00" }, "WORKFORCE_TIME_CORRECTION_BOUNDARY_REVIEW"],
  ])("routes %s to explicit escalation", (_label, changes, code) => {
    const result = assessWorkforceCorrectionBounds({ ...baseline, ...changes })

    expect(result).toMatchObject({ disposition: "REVIEW_REQUIRED", code })
  })

  it("uses a stable policy fingerprint and refuses malformed temporal facts", () => {
    expect(workforceCorrectionBoundsPolicyHash(policy)).toBe(workforceCorrectionBoundsPolicyHash({ ...policy }))
    expect(() => assessWorkforceCorrectionBounds({
      ...baseline,
      desiredStartedAt: baseline.desiredCompletedAt,
    })).toThrow("Corrected workday must have a positive duration")
  })
})
