import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-ticket-categories-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/ticket-categories/page.tsx", "utf8")

describe("Ticket Categories mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves the full hierarchy and lifecycle recovery path", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "empty-state-and-recovery",
      "filters-no-results-and-reset",
      "hierarchy-keyboard-and-forced-context",
      "editor-advanced-and-discard-guard",
      "save-failure-value-retention-and-focus-return",
      "deactivate-rollback-restore-and-focus",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("category_permission_offered_misleading_retry")
    expect(flow).toContain("category_tree_forced_context_failed")
    expect(flow).toContain("category_save_focus_not_restored")
    expect(flow).toContain("deactivation_failure_changed_state")
    expect(flow).toContain("restore_failure_changed_state")
    expect(flow).toContain('"ticket-categories-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 7")
  })

  it("uses stable selectors for every rendered state", () => {
    for (const marker of [
      'data-testid="ticket-categories-workspace"',
      'data-testid="ticket-categories-load-error"',
      'data-testid="ticket-categories-empty-state"',
      'data-testid="ticket-categories-tree"',
      'data-testid="ticket-category-row"',
      'data-testid="ticket-category-editor"',
      'data-testid="ticket-category-save-error"',
      "data-testid={`ticket-category-toggle-${category.id}`}",
      "data-testid={`ticket-category-deactivate-${category.id}`}",
      "data-testid={`ticket-category-restore-${category.id}`}",
    ]) expect(page).toContain(marker)
  })

  it("runs only when the Ticket Categories scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-ticket-categories-flow-evidence.mjs")
    expect(workflow).toContain("*,ticket-categories,*")
    expect(workflow).toContain("ticket_categories_flow_status")
  })
})
