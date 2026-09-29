import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-ai-settings-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const client = readFileSync("src/app/(dashboard)/support/ai-settings/support-ai-settings-client.tsx", "utf8")

describe("Support AI Settings flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves recovery, consequences, rollback, server truth and audit outcomes", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "consequence-unaffected-and-audit-empty-density",
      "disable-confirm-failure-rollback-and-retry",
      "saved-state-survives-audit-refresh-failure",
      "direct-enable-and-recorded-audit",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("support_ai_permission_offered_misleading_retry")
    expect(flow).toContain("support_ai_duplicate_toggle_not_blocked")
    expect(flow).toContain("support_ai_disable_focus_not_restored")
    expect(flow).toContain("auditRefreshFailureDidNotRollback: true")
    expect(flow).toContain("waitForFocusRestoration")
    expect(flow).toContain('"support-ai-settings-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 5")
  })

  it("uses real keyboard or physical touch activation with measured hit targets", () => {
    expect(flow).toContain("activateEvidenceTarget")
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("page.touchscreen.tap")
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("target.width < 44 || target.height < 44")
    expect(flow).toContain("activations: activationEvidence")
    expect(flow).not.toContain(".click()")
    expect(flow).not.toContain(".check()")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="support-ai-settings-loading"',
      'data-testid="support-ai-settings-error"',
      'data-testid="support-ai-settings-workspace"',
      'data-testid="support-ai-settings-notice"',
      'data-testid="support-ai-consequence"',
      'data-testid="support-ai-unaffected"',
      'data-testid="support-ai-audit"',
      'data-testid="support-ai-disable-dialog"',
    ]) expect(client).toContain(marker)
    expect(client).toContain('className="min-h-11"')
    expect(client).toContain('className="relative h-11 w-11')
    expect(client).toContain("restoreSwitchFocusRef")
    expect(client).toContain("switchRef.current?.focus({ preventScroll: true })")
    expect(client).not.toMatch(/<DialogContent[^>]*data-testid=/)
  })

  it("runs only when the Support AI Settings scenario is selected", () => {
    expect(workflow).toContain("Validate section-scoped Support AI Settings evidence")
    expect(workflow).toContain("src/app/(dashboard)/support/ai-settings")
    expect(workflow).toContain("scripts/support-ux-ai-settings-flow-evidence.mjs")
    expect(workflow).toContain("*,support-ai-settings,*")
    expect(workflow).toContain("support_ai_settings_flow_status")
  })
})
