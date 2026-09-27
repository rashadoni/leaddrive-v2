import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-entitlements-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/support/entitlements/page.tsx", "utf8")

describe("Support Entitlements mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves density, context preservation, rollback, retry and fixture restoration", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "density-0-1-20-100-and-rule-independence",
      "filters-no-results-and-reset",
      "detail-context-focus-and-lifecycle-rollback",
      "edit-failure-value-retention-and-recovery",
      "milestone-failure-retry-and-cleanup",
      "fixture-restore-and-resume-recovery",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("definitionsPerTerm: 100")
    expect(flow).toContain("entitlement_detail_focus_not_restored")
    expect(flow).toContain("lifecycle_failure_discarded_reason")
    expect(flow).toContain("milestone_delete_failure_removed_definition")
    expect(flow).toContain("entitlementRestoredActive: true")
    expect(flow).toContain('"support-entitlements-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 7")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="support-entitlements-workspace"',
      'data-testid="support-entitlements-load-error"',
      'data-testid="support-entitlements-refresh-error"',
      'data-testid="support-entitlements-empty-state"',
      'data-testid="support-entitlement-row"',
      'data-testid="support-entitlement-detail-sheet"',
      'data-testid="support-entitlement-form"',
      'data-testid="support-entitlement-lifecycle-dialog"',
      'data-testid="support-entitlement-milestone-editor"',
    ]) expect(page).toContain(marker)
  })

  it("proves physical touch targets without weakening desktop keyboard evidence", () => {
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("scrollIntoViewIfNeeded()")
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("page.touchscreen.tap(point.x, point.y)")
    expect(flow).toContain('serviceWorkers: "block"')
    expect(flow).toContain("physicalTouchRetry")
  })

  it("runs only when the Support Entitlements scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-entitlements-flow-evidence.mjs")
    expect(workflow).toContain("*,support-entitlements,*")
    expect(workflow).toContain("entitlements_flow_status")
  })
})
