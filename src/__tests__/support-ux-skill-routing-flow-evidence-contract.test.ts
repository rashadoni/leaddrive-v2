import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-skill-routing-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/support/skill-routing/page.tsx", "utf8")
const queues = readFileSync("src/components/support/queue-manager.tsx", "utf8")
const agents = readFileSync("src/components/support/agent-skills-manager.tsx", "utf8")

describe("Skill Routing mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves partial recovery, scale, rollback, bulk safety and cleanup", () => {
    for (const id of [
      "dual-load-failure-permission-and-keyboard-recovery",
      "partial-source-failure-and-recovery",
      "empty-filtered-and-operational-density",
      "queue-master-detail-toggle-rollback-and-create-delete",
      "bulk-skill-rollback-retry-and-fixture-restore",
      "read-only-permission-suppresses-mutations",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("routing_queue_toggle_failed_to_rollback")
    expect(flow).toContain("routing_queue_save_failure_discarded_values")
    expect(flow).toContain("routing_bulk_failure_did_not_rollback")
    expect(flow).toContain("fixtureRestored: true")
    expect(flow).toContain('"skill-routing-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("proves physical touch targets without weakening desktop keyboard recovery", () => {
    expect(flow).toMatch(/async function activateEvidenceTarget[\s\S]*?await dismissTour\(page\)/)
    expect(flow).toContain('overlay.waitFor({ state: "hidden", timeout: 5_000 })')
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("scrollIntoViewIfNeeded()")
    expect(flow).toContain('scrollIntoView({ block: "center", inline: "center" })')
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("page.touchscreen.tap(point.x, point.y)")
    expect(flow).toContain('serviceWorkers: "block"')
    expect(flow).toContain("physicalTouchRetry")
  })

  it("uses stable selectors for source, coverage, row and recovery states", () => {
    for (const marker of [
      'data-testid="skill-routing-workspace"',
      'data-testid="skill-routing-coverage"',
      'data-testid="skill-routing-partial"',
      'data-testid="skill-routing-read-only"',
    ]) expect(page).toContain(marker)
    for (const marker of [
      'data-testid="routing-queues-manager"',
      'data-testid="routing-queues-error"',
      'data-testid="routing-queue-row"',
      'data-testid="routing-queue-status"',
    ]) expect(queues).toContain(marker)
    for (const marker of [
      'data-testid="routing-agents-manager"',
      'data-testid="routing-agents-error"',
      'data-testid="routing-agent-row"',
      'data-testid="routing-agent-status"',
      'data-testid="routing-agent-bulk-editor"',
    ]) expect(agents).toContain(marker)
  })

  it("runs only when the Skill Routing scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-skill-routing-flow-evidence.mjs")
    expect(workflow).toContain("Validate section-scoped Skill Routing evidence")
    expect(workflow).toContain("contains(inputs.scenarios, 'skill-routing')")
    expect(workflow).toContain("*,skill-routing,*")
    expect(workflow).toContain("skill_routing_flow_status")
  })
})
