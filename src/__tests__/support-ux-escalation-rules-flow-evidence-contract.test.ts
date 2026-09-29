import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-escalation-rules-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/escalation/page.tsx", "utf8")

describe("Escalation Rules flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves recovery, permissions, density, safe editing, conflicts and rollback", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "read-only-permission-suppresses-mutations",
      "empty-filter-and-forty-rule-density",
      "edit-failure-retains-draft-and-focus",
      "duplicate-conflict-block-and-safe-create",
      "toggle-rollback-and-delete-recovery",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("escalation_permission_offered_misleading_retry")
    expect(flow).toContain("escalation_failed_edit_lost_draft")
    expect(flow).toContain("escalation_conflict_did_not_block_save")
    expect(flow).toContain("escalation_toggle_failure_did_not_roll_back")
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("element === document.activeElement")
    expect(flow).not.toContain(".isFocused()")
    expect(flow).toContain('"escalation-rules-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    expect(page).toContain("<SupportPageShell")
    for (const marker of [
      'data-testid="escalation-rules-workspace"',
      'data-testid="escalation-rules-error"',
      'data-testid="escalation-rules-empty"',
      'data-testid="escalation-rules-filter-empty"',
      'data-testid="escalation-rule-row"',
      'data-testid="escalation-rule-form"',
      'data-testid="escalation-rule-preview"',
      'data-testid="escalation-rule-conflict"',
      'data-testid="escalation-rules-read-only"',
    ]) expect(page).toContain(marker)
  })

  it("runs only when the Escalation Rules scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-escalation-rules-flow-evidence.mjs")
    expect(workflow).toContain("*,escalation-rules,*")
    expect(workflow).toContain("escalation_rules_flow_status")
  })
})
