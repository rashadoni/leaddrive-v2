import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-complaint-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const registry = readFileSync("src/app/(dashboard)/complaints/page.tsx", "utf8")
const create = readFileSync("src/app/(dashboard)/complaints/new/page.tsx", "utf8")
const detail = readFileSync("src/app/(dashboard)/complaints/[id]/page.tsx", "utf8")
const importPage = readFileSync("src/app/(dashboard)/complaints/import/page.tsx", "utf8")

describe("Complaint mutating flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
    expect(flow).toContain("SUPPORT_EVIDENCE_COMPLAINT_ID")
    expect(flow).toContain('serviceWorkers: "block"')
  })

  it("proves all critical registry, draft, recovery and import paths", () => {
    for (const id of [
      "registry-context-and-scroll-recovery",
      "registry-load-failure-and-recovery",
      "export-failure-and-recovery",
      "draft-navigation-create-failure-and-recovery",
      "response-failure-and-recovery",
      "status-permission-and-recovery",
      "assignment-failure-rollback-and-recovery",
      "stale-detail-and-recovery",
      "detail-permission-and-recovery",
      "import-validation-preview-partial-and-retry",
    ]) expect(flow).toContain(id)

    expect(flow).toContain('page.keyboard.press("Enter")')
    expect(flow).toContain('complaints-results").waitFor({ state: "visible" })')
    expect(flow).toContain('click({ trial: true })')
    expect(flow).toContain('url.pathname !== "/complaints/new"')
    expect(flow).toContain('url.pathname !== "/complaints/import"')
    expect(flow).toContain("value !== current")
    expect(flow).toContain("select.selectOption(original)")
    expect(flow).toContain("complaint-assignee-save'] svg.animate-spin")
    expect(flow).toContain("button instanceof HTMLButtonElement && !button.disabled")
    expect(flow).toContain('stale_refresh_intercept_missed_')
    expect(flow).toContain("registry_scroll_not_restored")
    expect(flow).toContain("create_failure_discarded_draft")
    expect(flow).toContain("response_failure_discarded_draft")
    expect(flow).toContain("assignment_failure_did_not_rollback")
    expect(flow).toContain("partialObserved: true")
    expect(flow).toContain('"complaint-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 10")
    expect(flow).toContain('page.unrouteAll({ behavior: "ignoreErrors" })')
  })

  it("uses stable application-owned selectors for outcomes", () => {
    for (const marker of [
      'data-testid="complaints-search"',
      'data-testid="complaints-load-error"',
      'data-testid="complaints-retry-load"',
      'data-testid="complaints-export-error"',
      'data-testid="complaints-retry-export"',
    ]) expect(registry).toContain(marker)
    expect(registry).toContain('aria-label={t("searchPlaceholder")}')
    for (const marker of [
      'data-testid="complaint-new-draft-recovered"',
      'data-testid="complaint-new-content"',
      'data-testid="complaint-new-submit"',
      'data-testid="complaint-new-error"',
    ]) expect(create).toContain(marker)
    for (const marker of [
      'data-testid="complaint-detail-stale"',
      'data-testid="complaint-detail-retry-stale"',
      'data-testid="complaint-status-resolved"',
      'data-testid="complaint-assignee-select"',
      'data-testid="complaint-response-composer"',
      'data-testid="complaint-response-retry"',
    ]) expect(detail).toContain(marker)
    expect(detail).toContain('aria-label={t("fieldAssignee")}')
    for (const marker of [
      'data-testid="complaint-import-file"',
      'data-testid="complaint-import-preview"',
      'data-testid="complaint-import-result"',
      'data-testid="complaint-import-retry-rows"',
    ]) expect(importPage).toContain(marker)
  })

  it("runs only the mutating workflow selected by scenario", () => {
    expect(workflow).toContain("scripts/support-ux-complaint-flow-evidence.mjs")
    expect(workflow).toContain("*,complaint-detail,*")
    expect(workflow).toContain("complaint_flow_status")
    expect(workflow).toContain('SUPPORT_EVIDENCE_TARGET_MODE" != "ephemeral')
  })
})
