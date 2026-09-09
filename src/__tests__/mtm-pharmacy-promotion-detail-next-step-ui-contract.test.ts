import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const detailPath = "src/components/mtm/pharmacy-promotion-detail.tsx"

function source() {
  return readFileSync(detailPath, "utf8")
}

describe("SWM-09 pharmacy promotion detail next-step contract", () => {
  it("derives guidance only from server lifecycle, policy and submit capability facts", () => {
    const detail = source()

    expect(detail).toContain("export function pharmacyPromotionDetailGuidance")
    expect(detail).toContain('detail.l1State === "READY"')
    expect(detail).toContain('detail.l2State === "READY"')
    expect(detail).toContain('detail.permissions?.canSubmit && detail.status === "DRAFT"')
    expect(detail).toContain('detail.permissions?.canReview && nextResponsible !== "NONE"')
    expect(detail).toContain("detail.policy?.ready === true")
    expect(detail).toContain("detail.policy?.ready === false ? detail.policy.blockers : []")
  })

  it("keeps one responsive primary submit action inside a visible guidance region", () => {
    const detail = source()

    expect(detail).toContain('data-testid="mtm-pharmacy-promotion-next-step"')
    expect(detail).toContain('aria-labelledby="mtm-pharmacy-promotion-next-step-title"')
    expect(detail).toContain('className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"')
    expect(detail).toContain('className="min-h-11 w-full md:w-auto"')
    expect(detail).toContain('href="/mtm/promotions?view=review"')
    expect(detail.match(/\{t\("submitForReview"\)\}/g)).toHaveLength(1)
  })

  it("shows exact policy blockers and factual L1/L2 states without hiding existing sections", () => {
    const detail = source()

    expect(detail).toContain("guidance.blockers.map((blocker)")
    expect(detail).toContain("blockerLabel(blocker)")
    expect(detail).toContain("L1 {stateLabel(detail.l1State)} · L2 {stateLabel(detail.l2State)}")
    for (const section of [
      't("pharmacyAndExecution")',
      't("evidence")',
      't("auditTimeline")',
      't("governance")',
      't("reviews")',
      't("ledger")',
    ]) expect(detail).toContain(section)
  })
})
