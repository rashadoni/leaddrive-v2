import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")

describe("SWM-15B operational-week cancellation rail UI contract", () => {
  it("keeps every bounded cancellation reachable after the five-row summary", () => {
    expect(ui).toContain("const [cancellationsExpanded, setCancellationsExpanded] = useState(false)")
    expect(ui).toContain("cancellationsExpanded ? pendingCancellations.length : 5")
    expect(ui).toContain('t("pendingCancellationsShown"')
    expect(ui).toContain('cancellationsExpanded ? "showFewerCancellations" : "showAllCancellations"')
    expect(ui).toContain("setCancellationsExpanded(false)")
  })

  it("gives compact and desktop rail controls unique label targets", () => {
    expect(ui).toContain('function renderPlanChange(change: PlanChange, railId: "compact" | "desktop")')
    expect(ui).toContain("const decisionFieldId = `decision-${railId}-${change.id}`")
    expect(ui).toContain("const rescheduleFieldId = `reschedule-${railId}-${change.id}`")
    expect(ui).toContain("const coverageRowsId = `base-coverage-rows-${railId}-${group.key}`")
    expect(ui).toContain('renderAttentionRailContent("compact")')
    expect(ui).toContain('renderAttentionRailContent("desktop")')
    expect(ui).not.toContain('id={`decision-${change.id}`}')
    expect(ui).not.toContain('id={`reschedule-${change.id}`}')
    expect(ui).not.toContain('id={`base-coverage-rows-${group.key}`}')
  })
})
