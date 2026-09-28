import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-macros-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/macros/page.tsx", "utf8")

describe("Macros flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves recovery, permissions, density, editor safety and shared categories", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "read-only-library-suppresses-mutations",
      "empty-filter-and-forty-macro-density",
      "editor-timeline-assignee-preview-and-draft-recovery",
      "toggle-rollback-delete-undo-and-delete-recovery",
      "shared-category-failure-retains-input-and-retries",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("macros_permission_offered_misleading_retry")
    expect(flow).toContain("macro_failed_save_lost_draft")
    expect(flow).toContain("macro_toggle_failure_did_not_roll_back")
    expect(flow).toContain("macro_delete_undo_removed_row")
    expect(flow).toContain("macro_category_failure_lost_input")
    expect(flow).toContain("categoryDeleteUndo: true")
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("element === document.activeElement")
    expect(flow).not.toContain(".isFocused()")
    expect(flow).toContain("dismissTour(page, true)")
    expect(flow).toContain('"macros-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    expect(page).toContain('className="support-page-shell space-y-4 pb-8"')
    expect(page).toContain('data-testid="macro-toggle-target"')
    expect(page).toContain('<div className="space-y-4" data-testid="macro-editor"')
    expect(page).toContain('<div className="space-y-3" data-testid="macro-category-manager"')
    for (const marker of [
      'data-testid="macros-workspace"',
      'data-testid="macros-error"',
      'data-testid="macros-empty"',
      'data-testid="macros-filter-empty"',
      'data-testid="macro-row"',
      'data-testid="macro-editor"',
      'data-testid="macro-action-row"',
      'data-testid="macro-preview"',
      'data-testid="macro-category-manager"',
      'data-testid="macros-read-only"',
    ]) expect(page).toContain(marker)
  })

  it("runs only when the Macros scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-macros-flow-evidence.mjs")
    expect(workflow).toContain("*,macros,*")
    expect(workflow).toContain("macros_flow_status")
  })
})
