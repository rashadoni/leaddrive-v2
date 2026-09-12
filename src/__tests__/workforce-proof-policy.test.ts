import { describe, expect, it } from "vitest"
import {
  WORKFORCE_PROOF_POLICY_BASELINE_V1,
  WorkforceProofPolicyError,
  WorkforceProofPolicySchema,
  evaluateWorkforceProofMethods,
  resolveWorkforceProofRule,
} from "@/lib/workforce/proof-policy"

describe("Workforce proof-policy composition", () => {
  it("requires location and QR-or-kiosk for an office/site action", () => {
    const missing = evaluateWorkforceProofMethods({
      policy: WORKFORCE_PROOF_POLICY_BASELINE_V1,
      segmentMode: "SITE",
      action: "START",
      suppliedMethods: ["LOCATION"],
    })
    expect(missing).toMatchObject({
      status: "REVIEW_REQUIRED",
      missingAllOf: [],
      missingAnyOf: ["QR", "KIOSK"],
      matchedRule: { fallback: "REVIEW_REQUIRED" },
    })

    expect(evaluateWorkforceProofMethods({
      policy: WORKFORCE_PROOF_POLICY_BASELINE_V1,
      segmentMode: "SITE",
      action: "START",
      suppliedMethods: ["LOCATION", "QR", "DEVICE"],
    })).toMatchObject({ status: "SATISFIED", missingAllOf: [], missingAnyOf: [] })
  })

  it("does not require location for remote, field or travel mode", () => {
    for (const segmentMode of ["REMOTE", "FIELD", "TRAVEL"] as const) {
      expect(evaluateWorkforceProofMethods({
        policy: WORKFORCE_PROOF_POLICY_BASELINE_V1,
        segmentMode,
        action: "START",
        suppliedMethods: [],
      })).toMatchObject({
        status: "SATISFIED",
        missingAllOf: [],
        missingAnyOf: [],
      })
    }
  })

  it("selects the most specific action/mode rule and fails closed when none exists", () => {
    const policy = WorkforceProofPolicySchema.parse({
      policyVersion: "workforce-proof-policy-v1",
      rules: [
        {
          segmentMode: "SITE",
          action: "ANY",
          allOf: ["LOCATION"],
          anyOf: [],
          optional: [],
          fallback: "REVIEW_REQUIRED",
        },
        {
          segmentMode: "SITE",
          action: "FINISH",
          allOf: ["QR"],
          anyOf: [],
          optional: [],
          fallback: "REVIEW_REQUIRED",
        },
      ],
    })
    expect(resolveWorkforceProofRule({ policy, segmentMode: "SITE", action: "FINISH" }))
      .toMatchObject({ allOf: ["QR"] })
    expect(() => resolveWorkforceProofRule({ policy, segmentMode: "REMOTE", action: "START" }))
      .toThrow(expect.objectContaining({ code: "WORKFORCE_PROOF_RULE_MISSING" } satisfies Partial<WorkforceProofPolicyError>))
  })

  it("rejects ambiguous duplicate methods and automatic MANUAL proof", () => {
    expect(() => WorkforceProofPolicySchema.parse({
      policyVersion: "workforce-proof-policy-v1",
      rules: [{
        segmentMode: "SITE",
        action: "START",
        allOf: ["LOCATION"],
        anyOf: ["LOCATION"],
        optional: [],
        fallback: "REVIEW_REQUIRED",
      }],
    })).toThrow(/only one proof group/i)
    expect(() => WorkforceProofPolicySchema.parse({
      policyVersion: "workforce-proof-policy-v1",
      rules: [{
        segmentMode: "EXCEPTION",
        action: "START",
        allOf: ["MANUAL"],
        anyOf: [],
        optional: [],
        fallback: "MANUAL_REQUEST",
      }],
    })).toThrow(/reviewed fallback/i)
  })
})
