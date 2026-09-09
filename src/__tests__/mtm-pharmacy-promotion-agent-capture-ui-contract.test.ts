import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const capture = readFileSync(
  resolve("src/components/mtm/pharmacy-promotion-agent-capture.tsx"),
  "utf8",
)

describe("SWM-09 explicit field-agent fact capture UI contract", () => {
  it("never silently chooses the first assignment or completed visit", () => {
    expect(capture).not.toContain('setTargetId(availableTargets[0]?.id ?? "")')
    expect(capture).not.toContain('setVisitId(visitRequired ? completedVisits[0]?.id ?? "" : "")')
    expect(capture).toContain('data-testid="mtm-pharmacy-agent-target-select"')
    expect(capture).toContain('data-testid="mtm-pharmacy-agent-visit-select"')
    expect(capture).toContain('<option value="" disabled={availableTargets.length > 0}>')
  })

  it("clears dependent fact state when a selected assignment or visit becomes invalid", () => {
    expect(capture).toContain('if (!targetId || availableTargets.some((target) => target.id === targetId)) return')
    expect(capture).toContain('if (!visitId || completedVisits.some((visit) => visit.id === visitId)) return')
    expect(capture).toContain('setConfirmationOpen(false)')
    expect(capture.match(/setFactQuantity\(""\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })

  it("disambiguates and recaps the selected pharmacy before an explicit confirmation", () => {
    expect(capture).toContain("target.customer.code")
    expect(capture).toContain("target.customer.locality")
    expect(capture).toContain("target.promotionVersion.promotion.code")
    expect(capture).toContain('data-testid="mtm-pharmacy-agent-selected-target"')
    expect(capture).toContain('data-testid="mtm-pharmacy-agent-confirmation"')
    expect(capture).toContain('open={confirmationOpen}')
    expect(capture).toContain('onClick={requestConfirmation}')
    expect(capture).toContain('onClick={() => void queueFact()}')
    expect(capture).toContain('className="min-h-11 w-full sm:w-auto"')
  })

  it("keeps the existing immutable offline operation path behind confirmation", () => {
    expect(capture).toContain("createPharmacyPromotionDraftOperation")
    expect(capture).toContain("persistPharmacyPromotionOperation(entry)")
    expect(capture).toContain("scopeKey")
    expect(capture).toContain("flushPharmacyPromotionOutbox")
    expect(capture).toContain("saving || syncingRef.current")
    expect(capture).toContain("disabled={!selectedTarget || saving || syncing}")
  })
})
