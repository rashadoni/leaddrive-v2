import { describe, expect, it } from "vitest"
import {
  canonicalWorkforcePolicyJson,
  workforcePolicyDefinitionHash,
  workforcePolicySnapshotValues,
  WorkforcePolicyDefinitionError,
} from "@/lib/workforce/policy-definition"

const definition = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 5 * 60,
  undertimeToleranceSeconds: 5 * 60,
  overtimeThresholdSeconds: 15 * 60,
  longPauseThresholdSeconds: null,
  futureApprovedField: { enabled: true },
}

describe("Workforce policy calculation definition", () => {
  it("extracts exactly the immutable calculation values while preserving unknown JSON in the hash", () => {
    const values = workforcePolicySnapshotValues({
      definition,
      definitionHash: workforcePolicyDefinitionHash(definition).toUpperCase(),
    })

    expect(values).toEqual({
      expectedWorkSeconds: 8 * 60 * 60,
      lateGraceSeconds: 5 * 60,
      undertimeToleranceSeconds: 5 * 60,
      overtimeThresholdSeconds: 15 * 60,
      longPauseThresholdSeconds: null,
    })
  })

  it("uses a stable hash for reordered JSON keys", () => {
    const reordered = {
      futureApprovedField: { enabled: true },
      longPauseThresholdSeconds: null,
      overtimeThresholdSeconds: 15 * 60,
      undertimeToleranceSeconds: 5 * 60,
      lateGraceSeconds: 5 * 60,
      expectedWorkSeconds: 8 * 60 * 60,
    }

    expect(canonicalWorkforcePolicyJson(reordered)).toBe(canonicalWorkforcePolicyJson(definition))
    expect(workforcePolicyDefinitionHash(reordered)).toBe(workforcePolicyDefinitionHash(definition))
  })

  it("fails closed for incomplete, unsafe or hash-mismatched definitions", () => {
    expect(() => workforcePolicySnapshotValues({
      definition: { ...definition, lateGraceSeconds: undefined },
      definitionHash: workforcePolicyDefinitionHash(definition),
    })).toThrow(WorkforcePolicyDefinitionError)

    expect(() => workforcePolicySnapshotValues({
      definition: { ...definition, expectedWorkSeconds: -1 },
      definitionHash: workforcePolicyDefinitionHash({ ...definition, expectedWorkSeconds: -1 }),
    })).toThrow(WorkforcePolicyDefinitionError)

    let error: unknown
    try {
      workforcePolicySnapshotValues({ definition, definitionHash: "0".repeat(64) })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: "WORKFORCE_POLICY_DEFINITION_HASH_MISMATCH" })
  })
})
