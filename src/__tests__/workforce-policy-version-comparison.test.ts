import { describe, expect, it } from "vitest"
import { compareWorkforcePolicyVersions, type WorkforcePolicyComparisonRecord } from "@/lib/workforce/policy-version-comparison"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 300, undertimeToleranceSeconds: 600, overtimeThresholdSeconds: 1800, longPauseThresholdSeconds: null }
function record(overrides: Partial<WorkforcePolicyComparisonRecord> = {}): WorkforcePolicyComparisonRecord {
  const data = { id: "policy-before", organizationId: "org", teamId: null, version: 1, status: "ACTIVE" as const, name: "Recorded policy", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, definition, definitionHash: workforcePolicyDefinitionHash(definition), ...overrides }
  return data
}
const compare = (from: WorkforcePolicyComparisonRecord, to: WorkforcePolicyComparisonRecord) => compareWorkforcePolicyVersions({ organizationId: "org", from, to })
const after = (overrides: Partial<WorkforcePolicyComparisonRecord> = {}) => record({ id: "policy-after", version: 2, status: "DRAFT", ...overrides })

describe("recorded policy-version comparison", () => {
  it("reports signed duration changes, nullable threshold and zero without mutating either record", () => {
    const changed = { ...definition, expectedWorkSeconds: 0, lateGraceSeconds: 600, longPauseThresholdSeconds: 0 }
    const from = record(), to = after({ definition: changed, definitionHash: workforcePolicyDefinitionHash(changed) })
    const before = JSON.stringify([from, to]), result = compare(from, to)
    expect(result.changedCalculationFields).toBe(3)
    expect(result.fields).toContainEqual({ field: "expectedWorkSeconds", before: 28800, after: 0, changed: true, deltaSeconds: -28800 })
    expect(result.fields).toContainEqual({ field: "longPauseThresholdSeconds", before: null, after: 0, changed: true, deltaSeconds: null })
    expect(result.from.effectiveFrom).toBe("2026-01-01")
    expect(result.from.effectiveTo).toBeNull()
    expect(result.basis).toBe("RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL")
    expect(JSON.stringify([from, to])).toBe(before)
  })
  it("returns unchanged values for metadata-only revisions without inventing impact", () => {
    const result = compare(record(), after({ name: "Different label", effectiveFrom: new Date("2027-02-01") }))
    expect(result.changedCalculationFields).toBe(0)
    expect(result.fields.every(field => !field.changed && (field.deltaSeconds === 0 || field.deltaSeconds === null))).toBe(true)
    expect(result.opaqueDefinitionChanged).toBe(false)
  })
  it("compares both directions and allows historical retired versions in the same team", () => {
    const result = compare(after({ teamId: "team", status: "RETIRED" }), record({ teamId: "team" }))
    expect(result.scope).toEqual({ kind: "TEAM", teamId: "team" })
    expect(result.from.version).toBe(2)
    expect(result.to.version).toBe(1)
  })
  it("warns about opaque signed changes while excluding their raw keys and values", () => {
    const changed = { ...definition, privateFutureKey: { PRIVATE: "opaque-reason" } }
    const result = compare(record(), after({ definition: changed, definitionHash: workforcePolicyDefinitionHash(changed) }))
    expect(result.changedCalculationFields).toBe(0)
    expect(result.opaqueDefinitionChanged).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/privateFutureKey|PRIVATE|opaque-reason/)
  })
  it.each([
    { organizationId: "foreign" }, { teamId: "team" },
  ])("fails closed across tenant or scope %j", change => {
    expect(() => compare(record(), after(change))).toThrow("WORKFORCE_POLICY_COMPARISON_SCOPE_MISMATCH")
  })
  it.each([
    { id: "policy-before" }, { version: 1 }, { version: 0 }, { version: 1.5 },
    { effectiveFrom: new Date("invalid") }, { effectiveFrom: new Date("2026-01-01T01:00:00Z") },
    { effectiveTo: new Date("2025-12-31") }, { name: "" },
  ])("rejects inconsistent recorded metadata %j", change => {
    expect(() => compare(record(), after(change))).toThrow("WORKFORCE_POLICY_COMPARISON_RECORD_INVALID")
  })
  it.each([
    { definitionHash: "0".repeat(64) }, { definitionHash: "bad" },
    { definition: { ...definition, expectedWorkSeconds: -1 } },
    { definition: { ...definition, longPauseThresholdSeconds: 0.5 } },
    { definition: { ...definition, lateGraceSeconds: Number.MAX_SAFE_INTEGER + 1 } },
  ])("rejects invalid or hash-drift calculation input %j", change => {
    expect(() => compare(record(), after(change))).toThrow("WORKFORCE_POLICY_COMPARISON_INTEGRITY_INVALID")
  })
  it("accepts reordered opaque JSON only when its full hash verifies", () => {
    const first = { ...definition, future: { b: 2, a: 1 } }, second = { future: { a: 1, b: 2 }, ...definition }
    expect(compare(record({ definition: first, definitionHash: workforcePolicyDefinitionHash(first) }), after({ definition: second, definitionHash: workforcePolicyDefinitionHash(second) })).opaqueDefinitionChanged).toBe(false)
  })
})
