import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-entitlement-templates-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/entitlement-templates/page.tsx", "utf8")

describe("Entitlement Templates mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves draft recovery, density, permissions, keyboard behavior and restoration", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "read-only-permission-state-and-recovery",
      "rule-density-0-1-30-and-preview",
      "draft-level-switch-and-route-recovery",
      "validation-keyboard-reorder-and-delete-discard",
      "save-failure-value-retention-retry-and-restore",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("template_level_switch_discarded_draft")
    expect(flow).toContain("template_route_reload_discarded_draft")
    expect(flow).toContain("template_keyboard_reorder_failed")
    expect(flow).toContain("template_save_failure_discarded_values")
    expect(flow).toContain("fixtureRestored: true")
    expect(flow).toContain('"entitlement-templates-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="entitlement-templates-workspace"',
      'data-testid="entitlement-templates-load-error"',
      'data-testid="entitlement-templates-save-error"',
      'data-testid="entitlement-template-rule"',
      'data-testid="entitlement-template-rule-editor"',
      'data-testid="entitlement-template-preview"',
      'data-testid="entitlement-template-save-bar"',
      'data-testid="entitlement-template-save"',
    ]) expect(page).toContain(marker)
  })

  it("proves physical touch targets without weakening desktop keyboard recovery", () => {
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("scrollIntoViewIfNeeded()")
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("page.touchscreen.tap(point.x, point.y)")
    expect(flow).toContain('serviceWorkers: "block"')
    expect(flow).toContain("physicalTouchRetry")
  })

  it("runs only when the Entitlement Templates scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-entitlement-templates-flow-evidence.mjs")
    expect(workflow).toContain("Validate section-scoped Entitlement Templates evidence")
    expect(workflow).toContain("contains(inputs.scenarios, 'entitlement-templates')")
    expect(workflow).toContain("*,entitlement-templates,*")
    expect(workflow).toContain("entitlement_templates_flow_status")
  })
})
