/**
 * CLM Slice 4c — Unit tests for the pure deviation-detector.
 */
import { describe, it, expect } from "vitest"
import { detectDeviations, type LibraryClause, type TemplateClauseInput } from "@/lib/contract-lifecycle/deviation-detector"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClause(overrides: Partial<LibraryClause> = {}): LibraryClause {
  return {
    id:                 "lib-1",
    title:              "Standard Clause",
    riskLevel:          "standard",
    status:             "approved",
    fallbackOfClauseId: null,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("detectDeviations", () => {
  // ── No library ─────────────────────────────────────────────────────────────
  it("flags all template clauses as non_standard when library is empty", () => {
    const tc: TemplateClauseInput[] = [{ title: "Limitation of Liability" }, { title: "Force Majeure" }]
    const flags = detectDeviations(tc, [])
    expect(flags).toHaveLength(2)
    expect(flags[0]).toMatchObject({ deviationType: "non_standard", severity: "info", clauseId: null })
    expect(flags[1]).toMatchObject({ deviationType: "non_standard", severity: "info", clauseId: null })
  })

  // ── Standard approved clause → no flag ────────────────────────────────────
  it("does not flag a matched standard approved clause", () => {
    const tc: TemplateClauseInput[] = [{ title: "Standard Clause" }]
    const lib: LibraryClause[] = [makeClause({ riskLevel: "standard", status: "approved", fallbackOfClauseId: null })]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(0)
  })

  // ── high_risk → critical ───────────────────────────────────────────────────
  it("flags high_risk clause as critical", () => {
    const tc: TemplateClauseInput[] = [{ title: "Indemnity Clause" }]
    const lib: LibraryClause[] = [makeClause({ id: "lib-hr", title: "Indemnity Clause", riskLevel: "high_risk" })]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      clauseId:     "lib-hr",
      clauseTitle:  "Indemnity Clause",
      deviationType: "high_risk",
      severity:      "critical",
    })
  })

  // ── retired → critical ─────────────────────────────────────────────────────
  it("flags retired clause as critical", () => {
    const tc: TemplateClauseInput[] = [{ title: "Old Warranty" }]
    const lib: LibraryClause[] = [makeClause({ id: "lib-ret", title: "Old Warranty", status: "retired" })]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ deviationType: "retired", severity: "critical", clauseId: "lib-ret" })
  })

  // ── fallback variant → warning ─────────────────────────────────────────────
  it("flags fallback variant clause as warning", () => {
    const tc: TemplateClauseInput[] = [{ title: "Fallback Confidentiality" }]
    const lib: LibraryClause[] = [
      makeClause({ id: "lib-fb", title: "Fallback Confidentiality", fallbackOfClauseId: "lib-primary" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ deviationType: "fallback", severity: "warning", clauseId: "lib-fb" })
  })

  // ── non_standard (no library match) → info ─────────────────────────────────
  it("flags an unmatched clause as non_standard info", () => {
    const tc: TemplateClauseInput[] = [{ title: "Custom Internal Clause" }]
    const lib: LibraryClause[] = [makeClause({ title: "Something Else" })]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      deviationType: "non_standard",
      severity:      "info",
      clauseId:      null,
      clauseTitle:   "Custom Internal Clause",
    })
  })

  // ── Highest-severity wins (high_risk + retired on same clause → critical high_risk wins over critical retired;
  //    but since both are critical we just take the first-seen critical)
  it("picks highest-severity flag when multiple conditions apply", () => {
    const tc: TemplateClauseInput[] = [{ title: "Dual Problem" }]
    // high_risk + retired + fallback all at once
    const lib: LibraryClause[] = [
      makeClause({
        id:                 "lib-dual",
        title:              "Dual Problem",
        riskLevel:          "high_risk",
        status:             "retired",
        fallbackOfClauseId: "lib-primary",
      }),
    ]
    const flags = detectDeviations(tc, lib)
    // Must produce exactly one flag
    expect(flags).toHaveLength(1)
    // Severity must be critical (high_risk and retired are both critical)
    expect(flags[0].severity).toBe("critical")
    expect(flags[0].clauseId).toBe("lib-dual")
  })

  // ── Exact title match is case-sensitive ─────────────────────────────────────
  it("does not match on case-insensitive title", () => {
    const tc: TemplateClauseInput[] = [{ title: "limitation of liability" }]  // lowercase
    const lib: LibraryClause[] = [makeClause({ title: "Limitation of Liability" })]  // mixed case
    const flags = detectDeviations(tc, lib)
    // No match → non_standard
    expect(flags).toHaveLength(1)
    expect(flags[0].deviationType).toBe("non_standard")
  })

  // ── Mix: some match (std), some match (hr), some unmatched ─────────────────
  it("handles a mix of standard, high_risk, and non_standard clauses", () => {
    const tc: TemplateClauseInput[] = [
      { title: "Standard Clause" },       // standard → no flag
      { title: "Risky Clause" },          // high_risk → critical
      { title: "Unknown Clause" },        // not in lib → non_standard info
    ]
    const lib: LibraryClause[] = [
      makeClause({ title: "Standard Clause", riskLevel: "standard" }),
      makeClause({ id: "lib-r", title: "Risky Clause", riskLevel: "high_risk" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(2)
    const risky = flags.find((f) => f.deviationType === "high_risk")
    const ns    = flags.find((f) => f.deviationType === "non_standard")
    expect(risky).toBeDefined()
    expect(ns).toBeDefined()
    expect(risky!.severity).toBe("critical")
    expect(ns!.severity).toBe("info")
  })

  // ── Empty template → no flags ──────────────────────────────────────────────
  it("returns empty array when template has no clauses", () => {
    const lib: LibraryClause[] = [makeClause()]
    const flags = detectDeviations([], lib)
    expect(flags).toHaveLength(0)
  })

  // ── Duplicate title: standard dup must NOT mask a high_risk clause ──────────
  it("keeps the high_risk clause when a same-title standard duplicate exists (standard order)", () => {
    const tc: TemplateClauseInput[] = [{ title: "Liability Cap" }]
    // standard appears first, high_risk second — high_risk must win
    const lib: LibraryClause[] = [
      makeClause({ id: "lib-std", title: "Liability Cap", riskLevel: "standard" }),
      makeClause({ id: "lib-hr",  title: "Liability Cap", riskLevel: "high_risk" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0].deviationType).toBe("high_risk")
    expect(flags[0].severity).toBe("critical")
    expect(flags[0].clauseId).toBe("lib-hr")
  })

  it("keeps the high_risk clause when a same-title standard duplicate exists (reverse order)", () => {
    const tc: TemplateClauseInput[] = [{ title: "Liability Cap" }]
    // high_risk appears first, standard second — high_risk must still win
    const lib: LibraryClause[] = [
      makeClause({ id: "lib-hr",  title: "Liability Cap", riskLevel: "high_risk" }),
      makeClause({ id: "lib-std", title: "Liability Cap", riskLevel: "standard" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0].deviationType).toBe("high_risk")
    expect(flags[0].clauseId).toBe("lib-hr")
  })

  it("keeps the retired clause when a same-title standard duplicate exists", () => {
    const tc: TemplateClauseInput[] = [{ title: "Warranty" }]
    const lib: LibraryClause[] = [
      makeClause({ id: "lib-std", title: "Warranty", riskLevel: "standard", status: "approved" }),
      makeClause({ id: "lib-ret", title: "Warranty", riskLevel: "standard", status: "retired" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    expect(flags[0].deviationType).toBe("retired")
    expect(flags[0].clauseId).toBe("lib-ret")
  })

  it("retired beats high_risk when both share the same title (retired rank > high_risk rank)", () => {
    const tc: TemplateClauseInput[] = [{ title: "Data Processing" }]
    const lib: LibraryClause[] = [
      makeClause({ id: "lib-hr",  title: "Data Processing", riskLevel: "high_risk", status: "approved" }),
      makeClause({ id: "lib-ret", title: "Data Processing", riskLevel: "standard",  status: "retired" }),
    ]
    const flags = detectDeviations(tc, lib)
    expect(flags).toHaveLength(1)
    // retired rank (4) > high_risk rank (3) → retired clause is selected
    expect(flags[0].clauseId).toBe("lib-ret")
    expect(flags[0].deviationType).toBe("retired")
  })

  it("dedup is deterministic regardless of array order across many iterations", () => {
    // Shuffle: standard first vs high_risk first — outcome must always be high_risk
    for (let i = 0; i < 3; i++) {
      const tc: TemplateClauseInput[] = [{ title: "NDA" }]
      const lib: LibraryClause[] = i % 2 === 0
        ? [
            makeClause({ id: "lib-std", title: "NDA", riskLevel: "standard" }),
            makeClause({ id: "lib-hr",  title: "NDA", riskLevel: "high_risk" }),
          ]
        : [
            makeClause({ id: "lib-hr",  title: "NDA", riskLevel: "high_risk" }),
            makeClause({ id: "lib-std", title: "NDA", riskLevel: "standard" }),
          ]
      const flags = detectDeviations(tc, lib)
      expect(flags[0].clauseId).toBe("lib-hr")
    }
  })
})
