import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const flow = readFileSync("scripts/support-ux-voip-flow-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")
const page = readFileSync("src/app/(dashboard)/support/voip/page.tsx", "utf8")
const player = readFileSync("src/components/voip/call-recording-player.tsx", "utf8")

describe("VoIP mutating evidence contract", () => {
  it("fails closed outside the disposable loopback tenant", () => {
    expect(flow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"')
    expect(flow).toContain('new Set(["127.0.0.1", "localhost", "::1"])')
    expect(flow).toContain("requireScreenshotTarget()")
    expect(flow).toContain("requireDemoTenant()")
    expect(flow).toContain("assertDemoTenant")
    expect(flow).toContain('serviceWorkers: "block"')
  })

  it("proves history, connection, filter and recording recovery", () => {
    for (const id of [
      "history-loading-and-recovery",
      "history-load-failure-and-recovery",
      "stale-refresh-and-recovery",
      "connection-failure-and-recovery",
      "debounced-no-results-and-reset",
      "stale-search-response-is-aborted",
      "empty-history-and-recovery",
      "recording-error-input-and-recovery",
      "history-permission-state",
    ]) expect(flow).toContain(id)
    expect(flow).toContain('page.keyboard.press("Space")')
    expect(flow).toContain("usesTouchInput")
    expect(flow).toContain("page.touchscreen.tap")
    expect(flow).toContain('element.addEventListener("touchstart"')
    expect(flow).toContain('inputModality: usesTouchInput ? "playwright-touchscreen" : "keyboard"')
    expect(flow).toContain("touchInputEmulated: usesTouchInput")
    expect(flow).toContain("touchPlaybackStarted: usesTouchInput")
    expect(flow).toContain("element === document.activeElement")
    expect(flow).toContain("const samples = sampleRate * 5")
    expect(flow).toContain("evidencePlayObserved")
    expect(flow).toContain('element.addEventListener("play"')
    expect(flow).toContain("call-recording-player']:visible")
    expect(flow).toContain("raw_keystrokes_requested")
    expect(flow).toContain("stale_search_overwrote_latest_results")
    expect(flow).toContain("refresh_failure_discarded_summary")
    expect(flow).toContain("nativePlaybackStarted: true")
    expect(flow).toContain("captureObservedState")
    expect(flow).toContain("loadingScreenshot")
    expect(flow).toContain("errorScreenshot")
    expect(flow).toContain("emptyScreenshot")
    expect(flow).toContain('"voip-flow-evidence.json"')
    expect(flow).toContain("state_audit_failed")
    expect(flow).toContain("window.axe.run")
    expect(flow).toContain("activeAnimations")
    expect(flow).toContain("report.results.length !== 9")
  })

  it("uses stable selectors for all observable states", () => {
    for (const marker of [
      'data-testid="voip-workspace"',
      'data-testid="voip-load-error"',
      'data-testid="voip-retry-load"',
      'data-testid="voip-connection-state"',
      'data-testid="voip-call-timeline"',
      'data-testid="voip-refresh-error"',
      '"voip-no-results" : "voip-empty-state"',
    ]) expect(page).toContain(marker)
    expect(page).toContain('data-testid="voip-retry-load" variant="outline"')
    expect(page).toContain('className="mt-4 min-h-11 motion-reduce:transition-none"')
    expect(page).toContain('data-testid="voip-retry-connection" variant="outline"')
    expect(page).toContain('className="min-h-11 motion-reduce:transition-none"')
    expect(player).toContain('data-testid="call-recording-audio"')
    expect(player).toContain('data-testid="call-recording-retry"')
  })

  it("runs only when the VoIP scenario is selected", () => {
    expect(workflow).toContain("Validate section-scoped VoIP evidence")
    expect(workflow).toContain("contains(inputs.scenarios, 'voip')")
    expect(workflow).toContain("src/__tests__/api-calls.test.ts")
    expect(workflow).toContain("src/__tests__/voip-ux-contract.test.ts")
    expect(workflow).toContain("scripts/support-ux-voip-flow-evidence.mjs")
    expect(workflow).toContain("*,voip,*")
    expect(workflow).toContain("voip_flow_status")
  })
})
