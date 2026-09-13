import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-agent-desktop-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/support/agent-desktop/page.tsx", "utf8")

describe("Agent Desktop mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
    expect(flow).toContain('serviceWorkers: "block"')
  })

  it("proves data and availability recovery without inventing truth", () => {
    for (const id of [
      "dashboard-loading-and-recovery",
      "dashboard-load-failure-and-recovery",
      "availability-load-failure-and-recovery",
      "availability-save-rollback-and-recovery",
      "stale-refresh-and-recovery",
      "empty-queue-and-recovery",
      "dashboard-permission-state",
    ]) expect(flow).toContain(id)
    expect(flow).toContain('page.keyboard.press("Space")')
    expect(flow).toContain("!control.hasAttribute(\"disabled\")")
    expect(flow).toContain("const permissionPage = await context.newPage()")
    expect(flow).toContain("permissionPage.route(pattern, deny)")
    expect(flow).toContain("permission_intercept_count_")
    expect(flow).toContain("captureObservedState")
    expect(flow).toContain('"dashboard-load-error"')
    expect(flow).toContain('"availability-load-error"')
    expect(flow).toContain('"availability-save-error"')
    expect(flow).toContain('"stale-refresh-error"')
    expect(flow).toContain('"empty-queue"')
    expect(flow).toContain("availability_failure_did_not_rollback")
    expect(flow).toContain("refresh_failure_discarded_snapshot")
    expect(flow).toContain("permission_state_offered_misleading_retry")
    expect(flow).toContain('"agent-desktop-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 7")
  })

  it("uses stable selectors for every observable state", () => {
    for (const marker of [
      'data-testid="agent-desktop-workspace"',
      'data-testid="agent-desktop-load-error"',
      'data-testid="agent-desktop-retry-load"',
      'data-testid="agent-desktop-availability"',
      'data-testid="agent-desktop-availability-saved"',
      'data-testid="agent-desktop-availability-error"',
      'data-testid="agent-desktop-refresh-error"',
      'data-testid="agent-desktop-empty-queue"',
    ]) expect(page).toContain(marker)
  })

  it("runs only when the Agent Desktop scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-agent-desktop-flow-evidence.mjs")
    expect(workflow).toContain("*,agent-desktop,*")
    expect(workflow).toContain("agent_desktop_flow_status")
  })
})
