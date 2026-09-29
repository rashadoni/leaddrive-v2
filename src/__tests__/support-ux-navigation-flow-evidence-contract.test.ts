import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-navigation-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")

describe("Support navigation flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
    expect(flow).toContain("SUPPORT_EVIDENCE_COMMIT must be an exact Git commit")
  })

  it("proves task grouping, persistence, search, mobile and gating outcomes", () => {
    for (const id of [
      "three-task-groups-and-active-destination",
      "persistent-section-state-and-active-route-recovery",
      "collapsed-section-search-and-keyboard",
      "labeled-mobile-navigation",
      "role-feature-and-addon-visibility",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("support_navigation_active_section_was_hidden")
    expect(flow).toContain("support_navigation_collapsed_rules_not_searchable")
    expect(flow).toContain("support_mobile_navigation_horizontal_overflow")
    expect(flow).toContain("support_navigation_admin_ai_gate_missing")
    expect(flow).toContain('"support-navigation-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 5")
  })

  it("uses keyboard and physical touch input with measured hit targets", () => {
    expect(flow).toContain("activateWithKeyboard")
    expect(flow).toContain("activateWithTouch")
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("page.touchscreen.tap")
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("target.width < 44 || target.height < 44")
    expect(flow).toContain("activationEvidence.length !== 5")
    expect(flow).toContain("activations: activationEvidence")
    expect(flow).not.toContain(".click()")
    expect(flow).not.toContain(".focus()")
  })

  it("is an explicit matrix scenario with a dedicated source gate", () => {
    expect(workflow).toContain("Validate section-scoped Support navigation evidence")
    expect(workflow).toContain("tsconfig.support-navigation-ui.json")
    expect(workflow).toContain("scripts/support-ux-navigation-flow-evidence.mjs")
    expect(workflow).toContain("*,support-navigation,*")
    expect(workflow).toContain("support_navigation_flow_status")
  })
})
