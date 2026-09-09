import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const runner = readFileSync("scripts/support-ux-browser-evidence.mjs", "utf8")
const workflow = readFileSync(".github/workflows/support-ux-evidence.yml", "utf8")

describe("Support UX browser evidence contract", () => {
  it("covers every Support destination and the nested customer/case flows", () => {
    for (const path of [
      "/tickets", "/complaints", "/complaints/new", "/support/agent-desktop",
      "/support/voip", "/knowledge-base", "/settings/ticket-categories",
      "/settings/sla-policies", "/support/entitlements",
      "/settings/entitlement-templates", "/support/skill-routing",
      "/support/calendar", "/settings/escalation", "/settings/macros",
      "/settings/portal-users", "/support/ai-settings", "/portal/tickets",
      "/portal/knowledge-base", "/portal/chat", "/ticket-closure/",
    ]) {
      expect(runner).toContain(path)
    }
    expect(runner).toContain("SUPPORT_EVIDENCE_TICKET_ID")
    expect(runner).toContain("SUPPORT_EVIDENCE_COMPLAINT_ID")
    expect(runner).toContain("SUPPORT_EVIDENCE_PORTAL_TICKET_ID")
    expect(runner).toContain("SUPPORT_EVIDENCE_CLOSURE_TOKEN")
  })

  it("crosses the required role, locale, theme and viewport matrices", () => {
    expect(runner).toContain('"agent", email:')
    expect(runner).toContain('"manager", email:')
    expect(runner).toContain('"admin", email:')
    expect(runner).toContain('"customer", email:')
    expect(runner).toContain('"az,ru,en"')
    expect(runner).toContain('"light,dark"')
    expect(runner).toContain("desktop: { width: 1440")
    expect(runner).toContain("tablet: { width: 1024")
    expect(runner).toContain('"narrow-tablet": { width: 768')
    expect(runner).toContain("mobile: { width: 375")
  })

  it("is read-only after authentication and fails closed on screenshot safety", () => {
    expect(runner).toContain("requireScreenshotTarget()")
    expect(runner).toContain("requireDemoTenant()")
    expect(runner).toContain("assertDemoTenant(bodyText")
    expect(runner).not.toContain("page.request.post(")
    expect(runner).not.toContain("page.request.put(")
    expect(runner).not.toContain("page.request.patch(")
    expect(runner).not.toContain("page.request.delete(")
    expect(runner).toContain('name: "portal-token"')
    expect(runner).toContain('secure: baseUrl.startsWith("https:")')
  })

  it("records layout, task distance, action, a11y and p50/p75 evidence", () => {
    for (const marker of [
      "blockCount", "renderedRows", "borderedRoundedBlocks",
      "immediatelyVisibleActions", "primaryWorkTop", "horizontalOverflow",
      "unlabeledInteractive", "smallTargets", "missingImageAlt",
      "duplicateIds", "loadP50", "loadP75", "filterP50", "filterP75",
      "interactionP75", "cumulativeLayoutShift", "primaryFlowClicks",
      "axeViolations",
    ]) {
      expect(runner).toContain(marker)
    }
    expect(runner).toContain("for (let sample = 0; sample < 3")
    expect(runner).toContain("measureFilterFeedback")
    expect(runner).toContain('type: "layout-shift"')
    expect(runner).toContain('type: "event"')
    expect(runner).toContain("inspectKeyboard")
    expect(runner).toContain('page.keyboard.press("Tab")')
    expect(runner).toContain("documentLang")
    expect(runner).toContain("prefersDark")
    expect(runner).toContain("reducedMotion")
    expect(runner).toContain("maxTouchPoints")
    expect(runner).toContain("hasTouch: expectsTouch")
    expect(runner).toContain('require.resolve("axe-core/axe.min.js")')
    expect(runner).toContain("inspectAccessibility")
    expect(runner).toContain("window.axe.run(document")
    expect(runner).toContain('values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]')
  })

  it("captures deterministic screenshots and compares optional baselines", () => {
    expect(runner).toContain("page.screenshot")
    expect(runner).toContain('animations: "disabled"')
    expect(runner).toContain("baselineComparison")
    expect(runner).toContain('status: actualSha256 === baselineSha256 ? "matched" : "changed"')
    expect(runner).toContain("requireBaseline ? visual.status !== \"matched\"")
    expect(runner).toContain('"evidence.json"')
    expect(runner).toContain('"index.md"')
  })

  it("keeps execution manual, non-production and SHA-bound in GitHub Actions", () => {
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).not.toMatch(/\bpush:/)
    expect(workflow).toContain("SUPPORT_EVIDENCE_COMMIT: ${{ github.sha }}")
    expect(workflow).toContain("target_mode:")
    expect(workflow).toContain("default: ephemeral")
    expect(workflow).toContain("support_ux_evidence")
    expect(workflow).toContain("scripts/seed-support-ux-evidence.ts")
    expect(workflow).toContain("Production targets are forbidden")
    expect(workflow).toContain("13.140.132.245")
    expect(workflow).toContain("46.224.171.53")
    expect(workflow).toContain('echo "::add-mask::$value"')
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_BASE_URL")
    expect(workflow).toContain("npm run i18n:check")
    expect(workflow).toContain("Validate evidence infrastructure")
    expect(workflow).toContain("npx playwright install --with-deps chromium")
    expect(workflow).toContain("actions/upload-artifact@v4")
    expect(workflow).toContain("visual_mode:")
    expect(workflow).toContain("baseline_run_id:")
    expect(workflow).toContain("baseline_artifact_name:")
    expect(workflow).toContain("actions/download-artifact@v4")
    expect(workflow).toContain("SUPPORT_EVIDENCE_REQUIRE_BASELINE")
  })

  it("rejects unsupported matrices and never reports blocked or empty evidence as green", () => {
    expect(runner).toContain("requireKnownSelection")
    expect(runner).toContain('result.status !== "passed"')
    expect(runner).toContain("report.results.length === 0")
  })

})
