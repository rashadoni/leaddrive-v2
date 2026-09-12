import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runner = readFileSync("scripts/support-ux-browser-evidence.mjs", "utf8");
const serviceDeskFlow = readFileSync(
  "scripts/support-ux-service-desk-flow-evidence.mjs",
  "utf8",
);
const complaintFlow = readFileSync(
  "scripts/support-ux-complaint-flow-evidence.mjs",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/support-ux-evidence.yml",
  "utf8",
);
const sidebar = readFileSync("src/components/sidebar.tsx", "utf8");
const dashboardLayout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
const screenshotHelper = readFileSync("scripts/support-ux-screenshot.mjs", "utf8");
const header = readFileSync("src/components/header.tsx", "utf8");
const flowRunners = readdirSync("scripts")
  .filter((file) => file.startsWith("support-ux-") && file.endsWith("-flow-evidence.mjs"))
  .map((file) => readFileSync(`scripts/${file}`, "utf8"));

describe("Support UX browser evidence contract", () => {
  it("covers every Support destination and the nested customer/case flows", () => {
    for (const path of [
      "/tickets",
      "/complaints",
      "/complaints/new",
      "/complaints/import",
      "/support/agent-desktop",
      "/support/voip",
      "/knowledge-base",
      "/settings/ticket-categories",
      "/settings/sla-policies",
      "/support/entitlements",
      "/settings/entitlement-templates",
      "/support/skill-routing",
      "/support/calendar",
      "/settings/escalation",
      "/settings/macros",
      "/settings/portal-users",
      "/support/ai-settings",
      "/portal/tickets",
      "/portal/knowledge-base",
      "/portal/chat",
      "/ticket-closure/",
    ]) {
      expect(runner).toContain(path);
    }
    expect(runner).toContain("SUPPORT_EVIDENCE_TICKET_ID");
    expect(runner).toContain("SUPPORT_EVIDENCE_COMPLAINT_ID");
    expect(runner).toContain("SUPPORT_EVIDENCE_PORTAL_TICKET_ID");
    expect(runner).toContain("SUPPORT_EVIDENCE_KB_ARTICLE_ID");
    expect(runner).toContain("SUPPORT_EVIDENCE_CLOSURE_TOKEN");
    expect(runner).toContain('id: "service-desk-kanban"');
    expect(runner).toContain('id: "service-desk-reports"');
    expect(runner).toContain(
      "primary: \"[data-testid='tickets-kanban-viewport'] article, [data-testid='tickets-kanban-empty-state']\"",
    );
    expect(runner).toContain(
      "ready: \"[data-testid='ticketing-report-workspace']\"",
    );
    expect(runner).toContain('id: "complaint-import"');
    expect(runner).toContain("[data-testid='complaints-workspace']");
    expect(runner).toContain("[data-testid='complaint-new-workspace']");
    expect(runner).toContain("[data-testid='complaint-import-workspace']");
    expect(runner).toContain("[data-testid='complaint-detail-workspace']");
    expect(runner).toContain('id: "knowledge-article"');
    expect(runner).toContain("[data-testid='knowledge-base-workspace'][data-state='ready']");
    expect(runner).toContain("[data-testid='knowledge-article-workspace'][data-state='ready']");
    expect(runner).toContain("[data-testid='portal-knowledge-workspace'][data-state='ready']");
    expect(runner).toContain("[data-testid='ticket-categories-workspace'][data-state='ready']");
    expect(runner).toContain("[data-testid='sla-policies-workspace'][data-state='ready']");
  });

  it("crosses the required role, locale, theme and viewport matrices", () => {
    expect(runner).toContain('"agent", email:');
    expect(runner).toContain('"manager", email:');
    expect(runner).toContain('"admin", email:');
    expect(runner).toContain('"customer", email:');
    expect(runner).toContain('"az,ru,en"');
    expect(runner).toContain('"light,dark"');
    expect(runner).toContain("desktop: { width: 1440");
    expect(runner).toContain("tablet: { width: 1024");
    expect(runner).toContain('"narrow-tablet": { width: 768');
    expect(runner).toContain("mobile: { width: 375");
    expect(runner).toContain("SUPPORT_EVIDENCE_SCENARIOS");
    expect(runner).toContain("selectedScenarioIds.has(item.id)");
    expect(workflow).toContain("scenarios:");
    expect(workflow).toContain("default: all");
  });

  it("uses the narrow sidebar width before client viewport effects run", () => {
    expect(sidebar).toContain('effectiveCollapsed ? "w-16" : "w-16 lg:w-64"');
    expect(sidebar).toContain("overflow-hidden");
  });

  it("keeps the dashboard shell vertical while owned workspaces manage wide content", () => {
    expect(dashboardLayout).toContain("overflow-x-hidden overflow-y-auto");
    expect(runner).toContain("isInsideOwnedHorizontalContainment");
    expect(runner).toContain('style.textOverflow === "ellipsis"');
    expect(runner).toContain("mainScrollableHorizontalOverflow");
    expect(runner).toContain("overflowingElements.length > 0");
    expect(runner).toContain("mainOverflowX");
  });

  it("is read-only after authentication and fails closed on screenshot safety", () => {
    expect(runner).toContain("requireScreenshotTarget()");
    expect(runner).toContain("requireDemoTenant()");
    expect(runner).toContain("assertDemoTenant(bodyText");
    expect(runner).not.toContain("page.request.post(");
    expect(runner).not.toContain("page.request.put(");
    expect(runner).not.toContain("page.request.patch(");
    expect(runner).not.toContain("page.request.delete(");
    expect(runner).toContain('name: "portal-token"');
    expect(runner).toContain('secure: baseUrl.startsWith("https:")');
    expect(runner).toContain('primeEvidenceStorage(context, theme, portalUser)');
    expect(runner).toContain('page.goto("/api/v1/ping"');
    expect(runner).not.toContain("context.addInitScript");
  });

  it("records layout, task distance, action, a11y and p50/p75 evidence", () => {
    for (const marker of [
      "blockCount",
      "renderedRows",
      "borderedRoundedBlocks",
      "immediatelyVisibleActions",
      "primaryWorkTop",
      "primaryWorkVisible",
      "horizontalOverflow",
      "overflowSamples",
      "mainClientWidth",
      "mainScrollHeight",
      "mainScrollWidth",
      "mainVerticalScrollRange",
      "unlabeledInteractive",
      "smallTargets",
      "recommendedTouchTargets",
      "smallTargetSamples",
      "missingImageAlt",
      "duplicateIds",
      "loadP50",
      "loadP75",
      "filterP50",
      "filterP75",
      "interactionP75",
      "cumulativeLayoutShift",
      "primaryFlowClicks",
      "axeViolations",
    ]) {
      expect(runner).toContain(marker);
    }
    expect(runner).toContain('SUPPORT_EVIDENCE_SAMPLE_COUNT || "3"');
    expect(runner).toContain("[1, 3, 7].includes(sampleCount)");
    expect(runner).toContain("for (let sample = 0; sample < sampleCount");
    expect(runner).toContain("Visual/performance comparison requires seven samples");
    expect(runner).toContain("baselineEvidence?.sampleCount !== sampleCount");
    expect(runner).toContain("if (sampleCount > 1)");
    expect(runner).toContain("await openScenario()");
    expect(runner).toContain("measureFilterFeedback(page, scenario.ready)");
    expect(runner).toContain("const interactionMetrics = await inspectPage");
    expect(runner).toContain("interactionP75: interactionMetrics.interactionP75");
    expect(runner).not.toContain("cumulativeLayoutShift: interactionMetrics.cumulativeLayoutShift");
    expect(runner).toContain(
      'const scopeSelector = workspaceSelector || "main"',
    );
    expect(runner).toContain('Boolean(element.closest("form"))');
    expect(runner).toContain('type: "layout-shift"');
    expect(runner).toContain('type: "event"');
    expect(runner).toContain("startPerformanceObservation(page)");
    expect(runner).toContain("inspectKeyboard");
    expect(runner).toContain('page.keyboard.press("Tab")');
    expect(runner).toContain("documentLang");
    expect(runner).toContain("prefersDark");
    expect(runner).toContain("reducedMotion");
    expect(runner).toContain("maxTouchPoints");
    expect(runner).toContain("hasTouch: expectsTouch");
    expect(runner).toContain("rect.width < 24 || rect.height < 24");
    expect(runner).toContain("rect.width < 44 || rect.height < 44");
    expect(runner).toContain(
      "const touchTargetIssueCount = expectsTouch ? metrics.accessibility.smallTargets : 0",
    );
    expect(runner).toContain("primaryWorkMiss");
    expect(runner).toContain("tickets-empty-state");
    expect(runner).toContain("tickets-kanban-empty-state");
    expect(runner).toContain('require.resolve("axe-core/axe.min.js")');
    expect(runner).toContain("inspectAccessibility");
    expect(runner).toContain("window.axe.run(document");
    expect(runner).toContain('newCDPSession(page)');
    expect(runner).toContain('Page.setBypassCSP');
    expect(runner).toContain('await page.addScriptTag({ content: axeSource })');
    expect(runner.indexOf('Page.setBypassCSP", { enabled: true }')).toBeLessThan(
      runner.indexOf('await page.addScriptTag({ content: axeSource })'),
    );
    expect(runner.indexOf('await page.addScriptTag({ content: axeSource })')).toBeLessThan(
      runner.indexOf('Page.setBypassCSP", { enabled: false }'),
    );
    expect(runner).toContain("waitForStableDocumentTitle(page)");
    expect(runner).toContain('document.head.querySelector("title")?.textContent?.trim()');
    expect(runner).toContain("now - previous.since >= 500");
    expect(runner).toContain("{ timeout: 5_000 }");
    expect(header).toContain('data-session-ready={orgName && userName ? "true" : "false"}');
    expect(runner).toContain("[data-testid='global-header'][data-session-ready='true']");
    expect(runner).toContain("document.fonts.ready");
    expect(runner).toContain("hiddenByClosedDetails");
    expect(runner).toContain('ancestor.tagName === "DETAILS"');
    expect(runner).toContain(
      'values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]',
    );
  });

  it("captures deterministic screenshots and compares optional baselines", () => {
    expect(runner).toContain("page.screenshot");
    expect(runner).toContain('animations: "disabled"');
    expect(runner).toContain("prepareSupportEvidenceScreenshot(page)");
    expect(screenshotHelper).toContain(
      'page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })',
    );
    expect(runner).toContain("developmentChromeHosts,");
    expect(flowRunners.length).toBeGreaterThan(0);
    for (const flowRunner of flowRunners) {
      expect(flowRunner).toContain("captureSupportEvidenceScreenshot");
      expect(flowRunner).not.toContain("page.screenshot");
    }
    expect(workflow).toContain("node --check scripts/support-ux-screenshot.mjs");
    expect(workflow).toContain("scripts/support-ux-screenshot.mjs \\");
    expect(runner.indexOf("page.screenshot")).toBeLessThan(
      runner.indexOf("const keyboard = await inspectKeyboard(page)"),
    );
    expect(runner).toContain("baselineComparison");
    expect(runner).toContain(
      'import { compareScreenshotPixels } from "./support-ux-visual-compare.mjs"',
    );
    expect(runner).toContain("compareScreenshotPixels");
    expect(runner).toContain('reason: "identical_file"');
    expect(runner).toContain('requireBaseline ? visual.status !== "matched"');
    expect(runner).toContain('"evidence.json"');
    expect(runner).toContain('"index.md"');
  });

  it("enforces comparable relative performance gates in compare mode", () => {
    expect(runner).toContain('path.join(baselineDirectory, "evidence.json")')
    expect(runner).toContain("performanceComparison(common, performance, metrics, budgets)")
    expect(runner).toContain('import { compareSupportPerformance } from "./support-ux-performance-compare.mjs"')
    expect(runner).toContain("return compareSupportPerformance(performance, metrics, baseline, budgets)")
    expect(runner).toContain('comparedPerformance.status !== "matched"')
    expect(runner).toContain("performanceComparison: comparedPerformance")
  })

  it("keeps execution manual, non-production and SHA-bound in GitHub Actions", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\bpush:/);
    expect(workflow).toContain("SUPPORT_EVIDENCE_COMMIT: ${{ github.sha }}");
    expect(workflow).toContain("target_mode:");
    expect(workflow).toContain("default: ephemeral");
    expect(workflow).toContain("support_ux_evidence");
    expect(workflow).toContain("scripts/seed-support-ux-evidence.ts");
    expect(workflow).toContain("Production targets are forbidden");
    expect(workflow).toContain("13.140.132.245");
    expect(workflow).toContain("46.224.171.53");
    expect(workflow).toContain('echo "::add-mask::$value"');
    expect(workflow).toContain("secrets.SUPPORT_EVIDENCE_BASE_URL");
    expect(workflow).toContain("npm run support:ux:scan");
    expect(workflow).toContain("npm run i18n:check");
    expect(workflow).toContain("support-ux-performance-contract.test.ts");
    expect(workflow).toContain("support-ux-visual-compare.test.ts");
    expect(workflow).toContain("scripts/support-ux-visual-compare.mjs");
    expect(workflow).toContain("npx playwright install chromium");
    expect(workflow).not.toContain("playwright install --with-deps");
    expect(workflow).not.toMatch(/\bsudo\b/);
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("node .next/standalone/server.js");
    expect(workflow).toContain("cp -R .next/static .next/standalone/.next/static");
    expect(workflow).toContain("cp -R public .next/standalone/public");
    expect(workflow).toContain(
      "SUPPORT_EVIDENCE_APP_MODE: ${{ inputs.target_mode == 'ephemeral' && 'production' || 'remote' }}",
    );
    expect(workflow).toContain("Build isolated production-mode evidence application");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("visual_mode:");
    expect(workflow).toContain("baseline_run_id:");
    expect(workflow).toContain("baseline_artifact_name:");
    expect(workflow).toContain("scripts/support-ux-complaint-flow-evidence.mjs");
    expect(workflow).toContain("complaint_flow_status");
    expect(complaintFlow).toContain('SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"');
    expect(workflow).toContain("actions/download-artifact@v4");
    expect(workflow).toContain("SUPPORT_EVIDENCE_REQUIRE_BASELINE");
    expect(workflow).toContain("sample_count:");
    expect(workflow).toContain(
      "SUPPORT_EVIDENCE_SAMPLE_COUNT: ${{ inputs.sample_count }}",
    );
  });

  it("waits for data-ready Support workspaces rather than capturing loading shells", () => {
    expect(runner).toContain("[data-testid='tickets-workspace']");
    expect(runner).toContain("[data-testid='ticket-detail-workspace']");
    expect(runner).toContain("[data-testid='agent-desktop-workspace']");
    expect(runner).toContain("[data-testid='agent-desktop-next-case']");
    expect(runner).toContain("[data-testid='voip-workspace']");
    expect(runner).toContain("[data-testid='voip-call-timeline']");
    expect(runner).toContain("scenario.ready");
  });

  it("dismisses first-visit tours and accepts a queue that already fits without page scroll", () => {
    expect(runner).toContain('page.getByTestId("tour-overlay")');
    expect(runner).toContain("dismissFirstVisitTour(page)");
    expect(runner).toContain("resetWorkspaceScrollAfterTour(page)");
    expect(runner).toContain('document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "instant" })');
    expect(runner.lastIndexOf("resetWorkspaceScrollAfterTour(page)")).toBeLessThan(
      runner.lastIndexOf("startPerformanceObservation(page)"),
    );
    expect(serviceDeskFlow).toContain('page.getByTestId("tour-overlay")');
    expect(serviceDeskFlow).toContain('page.keyboard.press("Escape")');
    expect(serviceDeskFlow).toContain(
      "compactWithoutPageScroll: maxScroll < 120",
    );
    expect(serviceDeskFlow).not.toContain(
      "queue_not_scrollable_for_restore_evidence",
    );
    expect(serviceDeskFlow).toContain(
      "-failed-${locale}-${theme}-${viewportName}.png",
    );
  });

  it("labels development evidence and suppresses only duplicated development noise", () => {
    expect(runner).toContain('SUPPORT_EVIDENCE_APP_MODE || "unknown"');
    expect(runner).toContain("isIgnorableDevelopmentConsoleError");
    expect(runner).toContain('appMode !== "development"');
    expect(runner).toContain(
      'message.startsWith("eval() is not supported in this environment.")',
    );
    expect(runner).toContain(
      'message.startsWith("Failed to load resource: the server responded with a status of")',
    );
    expect(runner).toContain(
      'message.startsWith("TypeError: Failed to fetch")',
    );
    expect(runner).toContain("appMode,");
    expect(screenshotHelper).toContain('!== "development"');
  });

  it("rejects unsupported matrices and never reports blocked or empty evidence as green", () => {
    expect(runner).toContain("requireKnownSelection");
    expect(runner).toContain('result.status !== "passed"');
    expect(runner).toContain("report.results.length === 0");
  });
});
