import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-portal-users-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/portal-users/page.tsx", "utf8")

describe("Portal Users flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves recovery, state, stale-search, batch and destructive outcomes", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "empty-six-recovery-states-and-density",
      "debounce-abort-and-selection-scope-recovery",
      "bulk-disable-failure-preserves-scope-and-retries",
      "recovery-failure-expiry-and-audit-feedback",
      "edit-and-manual-password-recovery",
      "single-disable-clear-chat-and-removal-recovery",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("portal_users_permission_offered_misleading_retry")
    expect(flow).toContain("portal_users_stale_search_overwrote_results")
    expect(flow).toContain("portal_users_bulk_failure_lost_selection")
    expect(flow).toContain("portal_edit_failure_lost_draft")
    expect(flow).toContain("portal_password_failure_lost_input")
    expect(flow).toContain('"portal-users-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 7")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="portal-users-workspace"',
      'data-testid="portal-users-error"',
      'data-testid="portal-users-empty"',
      'data-testid="portal-user-row"',
      'data-testid="portal-user-card"',
      'data-testid="portal-users-bulk"',
      'data-testid="portal-user-edit-form"',
      'data-testid="portal-user-password-form"',
      'data-testid="portal-user-recovery"',
    ]) expect(page).toContain(marker)
  })

  it("uses real keyboard or touchscreen activation and proves dialog focus recovery", () => {
    expect(flow).toContain("page.touchscreen.tap")
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("portal_users_touch_target_too_small")
    expect(flow).toContain("waitForFocusRestoration")
    expect(flow).not.toMatch(/\.(click|check)\(/)
    expect(page).toContain("data-dialog-initial-focus")
    expect(page).not.toContain("autoFocus")
  })

  it("keeps compact surfaces through tablet widths and exposes 44px touch areas", () => {
    expect(page).toContain("xl:block")
    expect(page).toContain("xl:hidden")
    expect(page).toContain('className="flex h-11 w-11 shrink-0 cursor-pointer')
    expect(page).toContain('className="flex min-h-11 items-start')
  })

  it("runs only when the Portal Users scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-portal-users-flow-evidence.mjs")
    expect(workflow).toContain("*,portal-users,*")
    expect(workflow).toContain("portal_users_flow_status")
  })
})
