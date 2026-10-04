import { describe, expect, it } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { previewWorkforcePolicyEmployeeImpact, type WorkforcePolicyImpactRecord } from "@/lib/workforce/policy-employee-impact-preview"
import { validWorkforcePolicyEmployeeImpactReceipt } from "@/lib/workforce/policy-employee-impact-receipt"

const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }
const record = (draft: boolean): WorkforcePolicyImpactRecord => ({ id: draft ? "draft" : "baseline", organizationId: "org", teamId: null,
  name: draft ? "Future draft" : "Recorded baseline", version: draft ? 2 : 1, status: draft ? "DRAFT" : "ACTIVE",
  effectiveFrom: new Date(draft ? "2026-10-06" : "2020-01-01"), effectiveTo: null, definition,
  definitionHash: workforcePolicyDefinitionHash(definition), activatedAt: draft ? null : new Date("2020-01-01"), retiredAt: null })
const preview = (covered = true, empty = false) => previewWorkforcePolicyEmployeeImpact({ organizationId: "org", observedAt: new Date("2026-10-04T12:00:00Z"),
  timezone: "Asia/Baku", draft: record(true), published: covered ? [record(false)] : [],
  employees: empty ? [] : [{ id: "PRIVATE_EMPLOYEE", organizationId: "org", status: "ACTIVE", membership: null }] })
const source = { id: "draft", name: "Future draft", version: 2, teamId: null, definitionHash: workforcePolicyDefinitionHash(definition), effectiveFrom: "2026-10-06" }
const obj = (value: unknown) => value as Record<string, unknown>
const count = (value: Record<string, unknown>) => obj(value.counts)
const first = (value: Record<string, unknown>) => obj((value.groups as unknown[])[0])

describe("aggregate employee impact receipt validation before display", () => {
  it.each([[true, false], [false, false], [true, true]])("accepts real projector covered=%s empty=%s including zero and null", (covered, empty) => {
    expect(validWorkforcePolicyEmployeeImpactReceipt(preview(covered, empty), source)).toBe(true)
  })
  it.each([
    ["live guarantee", (v: Record<string, unknown>) => { v.guaranteedAtActivation = true }],
    ["wrong cohort", (v: Record<string, unknown>) => { v.cohort = "FUTURE_EMPLOYMENT" }],
    ["employee payload", (v: Record<string, unknown>) => { v.employees = ["PRIVATE_EMPLOYEE"] }],
    ["selection drift", (v: Record<string, unknown>) => { obj(v.draft).definitionHash = "0".repeat(64) }],
    ["version drift", (v: Record<string, unknown>) => { obj(v.draft).version = 3 }],
    ["date drift", (v: Record<string, unknown>) => { obj(v.draft).effectiveFrom = "2026-10-07" }],
    ["scope drift", (v: Record<string, unknown>) => { obj(v.scope).teamId = "foreign" }],
    ["non-midnight cutoff", (v: Record<string, unknown>) => { v.scopeInstant = "2026-10-05T21:00:00.000Z" }],
    ["invalid timezone", (v: Record<string, unknown>) => { v.timezone = "Invalid/Timezone" }],
    ["normalized invalid timestamp", (v: Record<string, unknown>) => { v.observedAt = "2026-02-30T12:00:00.000Z" }],
    ["truncated cohort", (v: Record<string, unknown>) => { count(v).directoryEmployees = 101 }],
    ["missing counts", (v: Record<string, unknown>) => { delete count(v).missingMembership }],
    ["negative count", (v: Record<string, unknown>) => { count(v).missingMembership = -1 }],
    ["nonpartitioned selection", (v: Record<string, unknown>) => { count(v).unchangedSelection = 1 }],
    ["unsupported new coverage", (v: Record<string, unknown>) => { count(v).newlyCovered = 1 }],
    ["unsupported opaque change", (v: Record<string, unknown>) => { count(v).opaqueDefinitionChanged = 1 }],
    ["missing groups", (v: Record<string, unknown>) => { v.groups = [] }],
    ["duplicate groups", (v: Record<string, unknown>) => { v.groups = [first(v), first(v)] }],
    ["group payload", (v: Record<string, unknown>) => { first(v).employeeNames = ["PRIVATE_EMPLOYEE"] }],
    ["nonpartitioned group", (v: Record<string, unknown>) => { first(v).count = 2 }],
    ["invalid delta", (v: Record<string, unknown>) => { obj((first(v).fields as unknown[])[0]).deltaSeconds = 1 }],
    ["NULL collapsed to zero", (v: Record<string, unknown>) => { obj((first(v).fields as unknown[])[4]).after = 0 }],
  ] as const)("rejects %s without display", (_name, mutate) => {
    const receipt = JSON.parse(JSON.stringify(preview())) as Record<string, unknown>; mutate(receipt)
    expect(validWorkforcePolicyEmployeeImpactReceipt(receipt, source)).toBe(false)
  })
  it("rejects invented baseline values for previously uncovered employees", () => {
    const receipt = JSON.parse(JSON.stringify(preview(false))) as Record<string, unknown>
    obj((first(receipt).fields as unknown[])[0]).before = 0
    expect(validWorkforcePolicyEmployeeImpactReceipt(receipt, source)).toBe(false)
  })
})
