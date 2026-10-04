import { describe, expect, it } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { previewWorkforcePolicyEmployeeImpact as preview, type WorkforcePolicyImpactRecord,
  type WorkforcePolicyImpactEmployee } from "@/lib/workforce/policy-employee-impact-preview"

const definition = { expectedWorkSeconds: 28_800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: { retained: "not-displayed" } }
const policy = (patch: Partial<WorkforcePolicyImpactRecord> = {}): WorkforcePolicyImpactRecord => ({
  id: "published", organizationId: "org", teamId: null, version: 1, status: "ACTIVE", name: "Recorded policy",
  effectiveFrom: new Date("2010-01-01"), effectiveTo: null, activatedAt: new Date("2010-01-01"), retiredAt: null,
  definition, definitionHash: workforcePolicyDefinitionHash(definition), ...patch,
})
const draft = (patch: Partial<WorkforcePolicyImpactRecord> = {}) => policy({ id: "draft", version: 2,
  status: "DRAFT", activatedAt: null, name: "Future draft", effectiveFrom: new Date("2026-10-06"), ...patch })
const employee = (id: string, teamId: string | null = null): WorkforcePolicyImpactEmployee => ({ id,
  organizationId: "org", status: "ACTIVE", membership: { id: "membership-" + id, organizationId: "org",
    agentId: id, teamId, effectiveAt: new Date("2026-10-01T00:00:00Z") } })
const input = () => ({ organizationId: "org", observedAt: new Date("2026-10-04T12:00:00Z"), timezone: "UTC",
  draft: draft(), published: [policy()], employees: [employee("employee-private", "team")] })
const rehash = (row: WorkforcePolicyImpactRecord, next: typeof definition) => ({ ...row, definition: next,
  definitionHash: workforcePolicyDefinitionHash(next) })
function code(run: () => unknown, expected: string) { expect(run).toThrow(expect.objectContaining({ code: expected })) }

describe("bounded aggregate future-date employee policy what-if", () => {
  it("projects version-only selection without claiming changed calculations or exposing employees", () => {
    const value = preview(input())
    expect(value.counts).toMatchObject({ directoryEmployees: 1, selectedDraft: 1, calculationChanged: 0,
      newlyCovered: 0, unchangedSelection: 0, noPolicyAfter: 0 })
    expect(value.groups[0]).toMatchObject({ count: 1, before: { id: "published" }, opaqueDefinitionChanged: false })
    expect(value.groups[0].fields.every(field => !field.changed)).toBe(true)
    expect(value.basis).toBe("RECORDED_ACTIVE_DIRECTORY_WHAT_IF_NO_EMPLOYMENT_OR_ACTIVATION_GUARANTEE")
    expect(value.guaranteedAtActivation).toBe(false)
    expect(value.scopeInstant).toBe("2026-10-06T00:00:00.000Z")
    expect(JSON.stringify(value)).not.toMatch(/employee-private|membership-employee|organizationId|not-displayed/)
  })
  it("preserves an existing team override for an organization draft", () => {
    const data = input(); data.published.push(policy({ id: "team-published", teamId: "team" }))
    expect(preview(data).counts).toMatchObject({ selectedDraft: 0, teamOverride: 1, unchangedSelection: 1 })
    expect(preview(data).groups).toEqual([])
  })
  it("replaces organization fallback for a team draft and keeps other-team selections", () => {
    const data = input(); data.draft = draft({ teamId: "team", version: 1 }); data.employees.push(employee("other", "other-team"))
    const value = preview(data)
    expect(value.counts).toMatchObject({ selectedDraft: 1, outsideDraftTeam: 1, unchangedSelection: 1 })
    expect(value.groups[0].before?.id).toBe("published")
  })
  it("uses missing membership only as organization fallback, never a mutable team assumption", () => {
    const data = input(); data.employees[0].membership = null
    data.published.push(policy({ id: "team-published", teamId: "team" }))
    expect(preview(data).counts).toMatchObject({ selectedDraft: 1, missingMembership: 1, teamOverride: 0 })
    data.draft = draft({ teamId: "team", version: 2 })
    expect(preview(data).counts).toMatchObject({ selectedDraft: 0, missingMembership: 1, outsideDraftTeam: 1 })
  })
  it("counts first coverage separately from changes to existing calculation inputs", () => {
    const data = input(); data.published = []
    const value = preview(data)
    expect(value.counts).toMatchObject({ newlyCovered: 1, selectedDraft: 1, noPolicyBefore: 1, calculationChanged: 0 })
    expect(value.groups[0]).toMatchObject({ before: null, opaqueDefinitionChanged: null })
  })
  it("keeps explicit missing coverage outside a team draft", () => {
    const data = input(); data.draft = draft({ teamId: "different", version: 1 }); data.published = []
    expect(preview(data).counts).toMatchObject({ selectedDraft: 0, noPolicyBefore: 1, noPolicyAfter: 1, outsideDraftTeam: 1 })
  })
  it("reports NULL/0 exactly and does not interpret opaque definition keys", () => {
    const data = input(); data.published = [rehash(policy(), { ...definition, longPauseThresholdSeconds: 0 } as typeof definition)]
    data.draft = rehash(draft(), { ...definition, expectedWorkSeconds: 0, opaque: { retained: "different" } })
    const value = preview(data)
    expect(value.counts).toMatchObject({ calculationChanged: 1, opaqueDefinitionChanged: 1 })
    expect(value.groups[0].fields.find(field => field.field === "expectedWorkSeconds"))
      .toMatchObject({ before: 28_800, after: 0, changed: true, deltaSeconds: -28_800 })
    expect(value.groups[0].fields.find(field => field.field === "longPauseThresholdSeconds"))
      .toMatchObject({ before: 0, after: null, changed: true, deltaSeconds: null })
  })
  it("groups aggregate changes by recorded predecessor without employee identity", () => {
    const data = input(); data.employees.push(employee("second-private", "team"), employee("third-private", null))
    const value = preview(data)
    expect(value.groups).toHaveLength(1); expect(value.groups[0].count).toBe(3)
    expect(value.counts.selectedDraft).toBe(3); expect(JSON.stringify(value)).not.toContain("private")
  })
  it("does not mutate recorded draft, policy windows or membership facts", () => {
    const data = input(), copy = structuredClone(data); preview(data); expect(data).toEqual(copy)
    expect(data.published[0].effectiveTo).toBeNull(); expect(data.draft.status).toBe("DRAFT")
  })
  it("allows an empty complete employee cohort while still validating the draft", () => {
    const data = input(); data.employees = []; expect(preview(data).counts.directoryEmployees).toBe(0)
    data.draft.definitionHash = "0".repeat(64)
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID")
  })
  it("accepts 100 employees and rejects the 101st without partial counts", () => {
    const data = input(); data.employees = Array.from({ length: 100 }, (_, n) => employee("e" + n))
    expect(preview(data).counts.selectedDraft).toBe(100)
    data.employees.push(employee("sentinel")); code(() => preview(data), "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED")
  })
  it("accepts 100 complete historical policy windows and rejects global policy sentinel101", () => {
    const data = input(); data.draft.version = 101
    data.published = Array.from({ length: 100 }, (_, n) => {
      const from = new Date(Date.UTC(2020, 0, n + 1))
      return policy({ id: "p" + n, version: n + 1, effectiveFrom: from, effectiveTo: n === 99 ? null : from })
    })
    expect(preview(data).groups[0].before?.id).toBe("p99")
    data.published.push(policy({ id: "sentinel", teamId: "other" }))
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED")
  })
  it.each(["draft", "policy", "employee", "membership"])("rejects cross-tenant %s facts", kind => {
    const data = input()
    if (kind === "draft") data.draft.organizationId = "foreign"
    if (kind === "policy") data.published[0].organizationId = "foreign"
    if (kind === "employee") data.employees[0].organizationId = "foreign"
    if (kind === "membership") data.employees[0].membership!.organizationId = "foreign"
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_SCOPE_INVALID")
  })
  it("rejects membership for a different employee", () => {
    const data = input(); data.employees[0].membership!.agentId = "other"
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_SCOPE_INVALID")
  })
  it("refuses a future membership beyond the chosen instant", () => {
    const data = input(); data.employees[0].membership!.effectiveAt = new Date("2026-10-06T00:00:00.001Z")
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  })
  it("accepts the exact effective membership boundary", () => {
    const data = input(); data.employees[0].membership!.effectiveAt = new Date("2026-10-06T00:00:00Z")
    expect(preview(data).counts.selectedDraft).toBe(1)
  })
  it.each(["duplicate employee", "duplicate id", "duplicate scope version", "inactive employee", "future activation", "retired active"])("fails closed for %s", kind => {
    const data = input()
    if (kind === "duplicate employee") data.employees.push(data.employees[0])
    if (kind === "duplicate id") data.published.push(policy({ version: 3 }))
    if (kind === "duplicate scope version") data.published.push(policy({ id: "duplicate" }))
    if (kind === "inactive employee") data.employees[0].status = "INACTIVE" as "ACTIVE"
    if (kind === "future activation") data.published[0].activatedAt = new Date("2026-10-05")
    if (kind === "retired active") data.published[0].retiredAt = new Date("2026-10-03")
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  })
  it("refuses ambiguous team baseline even if the organization draft would not replace it", () => {
    const data = input(); data.published.push(policy({ id: "team-a", teamId: "team" }), policy({ id: "team-b", teamId: "team", version: 2 }))
    code(() => preview(data), "WORKFORCE_POLICY_IMPACT_POLICY_AMBIGUOUS")
  })
  it("retains canonical same-scope later-window conflict", () => {
    const data = input(); data.published[0].effectiveTo = new Date("2026-10-09")
    data.published.push(policy({ id: "later", version: 3, effectiveFrom: new Date("2026-10-10") }))
    code(() => preview(data), "WORKFORCE_POLICY_WINDOW_CONFLICT")
  })
  it("uses organization-local date and refuses a draft that is already today", () => {
    const data = input(); data.observedAt = new Date("2026-10-05T23:30:00Z"); data.timezone = "Asia/Baku"
    code(() => preview(data), "WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  })
  it("uses the actual UTC instant of Baku local midnight", () => {
    const data = input(); data.timezone = "Asia/Baku"
    expect(preview(data).scopeInstant).toBe("2026-10-05T20:00:00.000Z")
  })
  it.each([ ["America/Sao_Paulo", "2018-11-04", "2018-11-01"], ["America/Havana", "2026-11-01", "2026-10-01"] ])(
    "refuses a DST gap/fold at local midnight in %s", (timezone, date, observed) => {
      const data = input(); data.timezone = timezone; data.observedAt = new Date(observed); data.draft.effectiveFrom = new Date(date); data.employees = []
      code(() => preview(data), "WORKFORCE_POLICY_IMPACT_TIME_AMBIGUOUS")
    })
  it.each(["invalid timezone", "invalid observedAt", "non-midnight policy date", "hash drift"])("refuses %s", kind => {
    const data = input()
    if (kind === "invalid timezone") data.timezone = "Invalid/Timezone"
    if (kind === "invalid observedAt") data.observedAt = new Date("bad")
    if (kind === "non-midnight policy date") data.published[0].effectiveFrom = new Date("2010-01-01T00:00:01Z")
    if (kind === "hash drift") data.published[0].definitionHash = "0".repeat(64)
    code(() => preview(data), kind === "hash drift" ? "WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID"
      : kind === "non-midnight policy date" ? "WORKFORCE_POLICY_IMPACT_RECORD_INVALID" : "WORKFORCE_POLICY_IMPACT_INPUT_INVALID")
  })
})
