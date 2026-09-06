import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-sla-policies-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/settings/sla-policies/page.tsx", "utf8")
const form = readFileSync("src/components/sla-policy-form.tsx", "utf8")

describe("SLA Policies mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves validation, recovery, dependency protection and cleanup", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "empty-state-and-recovery",
      "client-validation-preview-and-keyboard",
      "create-failure-stale-refresh-and-recovery",
      "dependency-delete-is-blocked",
      "delete-failure-retry-and-cleanup",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("invalid_sla_targets_remained_submittable")
    expect(flow).toContain("active_priority_conflict_remained_submittable")
    expect(flow).toContain("sla_refresh_failure_discarded_snapshot")
    expect(flow).toContain("linked_sla_policy_delete_not_blocked")
    expect(flow).toContain("disposableFixtureRemoved: true")
    expect(flow).toContain('"sla-policies-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="sla-policies-workspace"',
      'data-testid="sla-policies-load-error"',
      'data-testid="sla-policies-refresh-error"',
      'data-testid="sla-policies-empty-state"',
      'data-testid="sla-policy-row"',
      "data-testid={`sla-policy-actions-${policy.id}`}",
      "data-testid={`sla-policy-delete-${policy.id}`}",
    ]) expect(page).toContain(marker)
    for (const marker of [
      'data-testid="sla-policy-form"',
      'data-testid="sla-policy-save-error"',
      'data-testid="sla-policy-validation-error"',
      'data-testid="sla-policy-preview"',
      'data-testid="sla-policy-submit"',
    ]) expect(form).toContain(marker)
  })

  it("runs only when the SLA Policies scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-sla-policies-flow-evidence.mjs")
    expect(workflow).toContain("*,sla-policies,*")
    expect(workflow).toContain("sla_policies_flow_status")
  })
})
