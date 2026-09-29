import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-agent-calendar-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/support/calendar/page.tsx", "utf8")

describe("Agent Calendar flow evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
  })

  it("proves source recovery, density, outside hours, detail focus and navigation", () => {
    for (const id of [
      "load-failure-permission-and-keyboard-recovery",
      "partial-source-failure-and-recovery",
      "empty-selected-day-and-recovery",
      "high-volume-outside-hours-next-and-show-more",
      "keyboard-touch-detail-and-focus-return",
      "week-navigation-and-today-recovery",
    ]) expect(flow).toContain(id)
    expect(flow).toContain("calendar_permission_offered_misleading_retry")
    expect(flow).toContain("calendar_show_more_did_not_reveal_items")
    expect(flow).toContain("calendar_detail_focus_not_restored")
    expect(flow).toContain('"agent-calendar-flow-evidence.json"')
    expect(flow).toContain("report.results.length !== 6")
  })

  it("proves physical touch without weakening desktop keyboard evidence", () => {
    expect(flow).toContain('inputModality: "keyboard"')
    expect(flow).toContain('inputModality: "playwright-touchscreen"')
    expect(flow).toContain("await dismissTour(page)")
    expect(flow).toContain('overlay.waitFor({ state: "hidden", timeout: 5_000 })')
    expect(flow).toContain("scrollIntoViewIfNeeded()")
    expect(flow).toContain('scrollIntoView({ block: "center", inline: "center" })')
    expect(flow).toContain("document.elementFromPoint")
    expect(flow).toContain("box.width < 44 || box.height < 44")
    expect(flow).toContain("page.touchscreen.tap(point.x, point.y)")
    expect(flow).toContain("physicalTouchOpen")
    expect(flow).toContain("physicalTouchWeekNavigation")
    expect(flow).toContain("element === document.activeElement")
  })

  it("uses stable selectors for normal and exceptional states", () => {
    for (const marker of [
      'data-testid="support-calendar-workspace"',
      'data-testid="support-calendar-error"',
      'data-testid="support-calendar-partial"',
      'data-testid="support-calendar-empty-day"',
      'data-testid="support-calendar-item"',
      'data-testid="support-calendar-detail"',
      'data-testid="support-calendar-agenda"',
      'data-testid="support-calendar-week-board"',
    ]) expect(page).toContain(marker)
  })

  it("runs only when the Agent Calendar scenario is selected", () => {
    expect(workflow).toContain("scripts/support-ux-agent-calendar-flow-evidence.mjs")
    expect(workflow).toContain("Validate section-scoped Agent Calendar evidence")
    expect(workflow).toContain("contains(inputs.scenarios, 'agent-calendar')")
    expect(workflow).toContain("*,agent-calendar,*")
    expect(workflow).toContain("agent_calendar_flow_status")
  })
})
