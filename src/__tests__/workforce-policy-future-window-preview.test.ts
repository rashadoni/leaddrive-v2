import { describe, expect, it } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { previewWorkforcePolicyFutureWindow as preview, WorkforcePolicyWindowPreviewError } from "@/lib/workforce/policy-future-window-preview"
import type { WorkforcePolicyComparisonRecord as Record } from "@/lib/workforce/policy-version-comparison"

const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 300,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: { interpretation: "PRIVATE_OPAQUE" } }
function record(id: string, version: number, from = "2026-01-01", to: string | null = null): Record {
  return { id, version, organizationId: "org", teamId: null, name: `Policy ${version}`, status: "ACTIVE",
    effectiveFrom: new Date(from), effectiveTo: to === null ? null : new Date(to), definition, definitionHash: workforcePolicyDefinitionHash(definition) }
}
const draft = (): Record => ({ ...record("draft", 101, "2026-11-01"), status: "DRAFT" })
const run = (published: Record[] = [], selected = draft(), currentDate = "2026-10-04") => preview({ organizationId: "org", currentDate, draft: selected, published })
function rejects(action: () => unknown, code: WorkforcePolicyWindowPreviewError["code"]) {
  expect(action).toThrowError(expect.objectContaining({ code }))
}

describe("recorded future policy-window projection, with no activation promise", () => {
  it("projects an initial open future window without exposing definitions or employee impact", () => {
    const value = run()
    expect(value.projectedWindow).toEqual({ effectiveFrom: "2026-11-01", effectiveTo: null })
    expect(value.predecessor).toBeNull()
    expect(value.recordedWindows).toEqual([])
    expect(value.basis).toBe("RECORDED_SCOPE_WINDOWS_ONLY_NO_EMPLOYEE_IMPACT_OR_APPROVAL")
    expect(value.canonicalActivationRequired).toBe(true); expect(value.guaranteedAtActivation).toBe(false)
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE_OPAQUE|organizationId|definitionHash|expectedWorkSeconds|employee/)
  })
  it("projects closing only the spanning predecessor and preserves both input records", () => {
    const published = [record("current", 2, "2026-06-01"), record("older", 1, "2026-01-01", "2026-05-31")]
    const before = JSON.stringify(published), selected = draft(), draftBefore = JSON.stringify(selected)
    const value = run(published, selected)
    expect(value.recordedWindows.map(row => row.id)).toEqual(["older", "current"])
    expect(value.predecessor).toMatchObject({ id: "current", effectiveTo: null, projectedEffectiveTo: "2026-10-31" })
    expect(JSON.stringify(published)).toBe(before); expect(JSON.stringify(selected)).toBe(draftBefore)
  })
  it.each([["2028-03-01", "2028-02-29"], ["2027-03-01", "2027-02-28"], ["2027-01-01", "2026-12-31"]])("uses date-only calendar arithmetic for %s", (from, close) => {
    const selected = { ...draft(), effectiveFrom: new Date(from) }
    expect(run([record("current", 1)], selected).predecessor?.projectedEffectiveTo).toBe(close)
  })
  it("keeps adjacent published ACTIVE windows valid and projects only the latest spanning row", () => {
    const windows = [record("first", 1, "2026-01-01", "2026-10-31"), record("scheduled", 2, "2026-11-01")]
    const selected = { ...draft(), effectiveFrom: new Date("2026-12-01") }
    expect(run(windows, selected).predecessor?.id).toBe("scheduled")
  })
  it("preserves exact TEAM scope without looking up mutable membership", () => {
    const value = run([{ ...record("team-old", 1), teamId: "team" }], { ...draft(), teamId: "team" })
    expect(value.scope).toEqual({ kind: "TEAM", teamId: "team" })
  })
  it.each(["DRAFT", "RETIRED"] as const)("refuses a %s row masquerading as published", status => {
    rejects(() => run([{ ...record("old", 1), status }]), "WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  })
  it.each(["ACTIVE", "RETIRED"] as const)("never projects activating an already %s version", status => {
    rejects(() => run([], { ...draft(), status }), "WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  })
  it.each(["2026-10-04", "2026-10-03"])("rejects nonfuture date %s using the server date", from => {
    rejects(() => run([], { ...draft(), effectiveFrom: new Date(from) }), "WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  })
  it("rejects a bounded draft rather than promising an open-ended publication", () => {
    rejects(() => run([], { ...draft(), effectiveTo: new Date("2026-11-30") }), "WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  })
  it.each([
    [record("current", 1), record("later", 2, "2026-12-01")],
    [record("expired", 1, "2026-01-01", "2026-10-31")],
    [record("same-day", 1, "2026-11-01")],
    [record("left", 1, "2026-01-01", "2026-06-01"), record("right", 2, "2026-06-01")],
  ].map(windows => [windows]))("refuses conflicting future/gap/empty/inclusively overlapping recorded windows", windows => {
    rejects(() => run(windows), "WORKFORCE_POLICY_WINDOW_CONFLICT")
  })
  it.each([{ organizationId: "foreign" }, { teamId: "foreign-team" }])("rejects foreign or cross-scope rows before returning names", different => {
    rejects(() => run([{ ...record("PRIVATE_FOREIGN", 1), ...different }]), "WORKFORCE_POLICY_WINDOW_SCOPE_INVALID")
  })
  it("rejects a foreign draft", () => {
    rejects(() => run([], { ...draft(), organizationId: "foreign" }), "WORKFORCE_POLICY_WINDOW_SCOPE_INVALID")
  })
  it.each([
    { definitionHash: "0".repeat(64) },
    { definition: { ...definition, expectedWorkSeconds: -1 } },
    { definition: { ...definition, opaque: "changed" } },
  ])("fails closed on full-definition hash or numeric integrity drift", change => {
    rejects(() => run([{ ...record("old", 1), ...change }]), "WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID")
  })
  it.each([{ version: 0 }, { id: "" }, { effectiveFrom: new Date(NaN) }, { effectiveFrom: new Date("2026-01-01T00:00:01Z") },
    { effectiveTo: new Date("2025-12-31") }])("rejects malformed persisted metadata", change => {
    rejects(() => run([{ ...record("old", 1), ...change }]), "WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  })
  it.each(["2026-02-30", "bad", "2026-1-01"])("rejects invalid authoritative date %s", date => {
    rejects(() => run([], draft(), date), "WORKFORCE_POLICY_WINDOW_INPUT_INVALID")
  })
  it("rejects duplicated persisted version identity", () => {
    rejects(() => run([record("different-id", 101)]), "WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  })
  it("accepts exactly100 complete rows but refuses101 instead of projecting a partial scope", () => {
    const rows = Array.from({ length: 100 }, (_, i) => {
      const day = new Date("2026-01-01"); day.setUTCDate(day.getUTCDate() + i)
      const key = day.toISOString().slice(0, 10)
      return record(`row-${i}`, i + 1, key, i === 99 ? null : key)
    })
    expect(run(rows).recordedWindows).toHaveLength(100)
    rejects(() => run([...rows, record("sentinel", 102, "2026-12-01")]), "WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED")
  })
})
