import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { compareScreenshotPixels } from "./support-ux-visual-compare.mjs"
import { compareSupportPerformance } from "./support-ux-performance-compare.mjs"
import { prepareSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

const require = createRequire(import.meta.url)
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8")

const { baseUrl, hostname } = requireScreenshotTarget()
const demoOrganization = requireDemoTenant()
const commit = (process.env.SUPPORT_EVIDENCE_COMMIT || "").trim()
if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error("SUPPORT_EVIDENCE_COMMIT must be an exact Git commit")

const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const baselineDirectory = (process.env.SUPPORT_EVIDENCE_BASELINE_DIR || "").trim()
const requireBaseline = process.env.SUPPORT_EVIDENCE_REQUIRE_BASELINE === "true"
const appMode = (process.env.SUPPORT_EVIDENCE_APP_MODE || "unknown").trim()
if (requireBaseline && !baselineDirectory) throw new Error("SUPPORT_EVIDENCE_BASELINE_DIR is required in compare mode")
let baselineEvidence = null
if (baselineDirectory) {
  try {
    baselineEvidence = JSON.parse(await readFile(path.join(baselineDirectory, "evidence.json"), "utf8"))
  } catch (error) {
    if (requireBaseline) throw new Error(`Comparable baseline evidence.json is required: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const dataProfile = (process.env.SUPPORT_EVIDENCE_DATA_PROFILE || "typical").trim()
if (!new Set(["empty", "typical", "high", "0", "5", "50", "500"]).has(dataProfile)) {
  throw new Error("SUPPORT_EVIDENCE_DATA_PROFILE must identify empty/typical/high or 0/5/50/500")
}
const sampleCount = Number.parseInt(process.env.SUPPORT_EVIDENCE_SAMPLE_COUNT || "3", 10)
if (![1, 3, 7].includes(sampleCount)) {
  throw new Error("SUPPORT_EVIDENCE_SAMPLE_COUNT must be 1, 3 or 7")
}
if (requireBaseline && sampleCount !== 7) {
  throw new Error("Visual/performance comparison requires seven samples")
}
if (requireBaseline && baselineEvidence?.sampleCount !== sampleCount) {
  throw new Error("Comparable baseline evidence must use the same seven-sample contract")
}
if (requireBaseline && baselineEvidence?.dataProfile !== dataProfile) {
  throw new Error("Comparable baseline evidence must use the same data profile")
}
if (requireBaseline && baselineEvidence?.appMode !== appMode) {
  throw new Error("Comparable baseline evidence must use the same application mode")
}

const selectedRoles = new Set((process.env.SUPPORT_EVIDENCE_ROLES || "agent,manager,admin,customer").split(",").map((value) => value.trim()).filter(Boolean))
const selectedScenariosValue = (process.env.SUPPORT_EVIDENCE_SCENARIOS || "all").trim()
const selectedLocales = new Set((process.env.SUPPORT_EVIDENCE_LOCALES || "az,ru,en").split(",").map((value) => value.trim()).filter(Boolean))
const selectedThemes = new Set((process.env.SUPPORT_EVIDENCE_THEMES || "light,dark").split(",").map((value) => value.trim()).filter(Boolean))
const selectedViewports = new Set((process.env.SUPPORT_EVIDENCE_VIEWPORTS || "desktop,tablet,narrow-tablet,mobile").split(",").map((value) => value.trim()).filter(Boolean))

function requireKnownSelection(label, selected, allowed) {
  if (selected.size === 0) throw new Error(label + " must select at least one value")
  for (const value of selected) {
    if (!allowed.has(value)) throw new Error(label + " contains unsupported value: " + value)
  }
}

requireKnownSelection("SUPPORT_EVIDENCE_ROLES", selectedRoles, new Set(["agent", "manager", "admin", "customer"]))
requireKnownSelection("SUPPORT_EVIDENCE_LOCALES", selectedLocales, new Set(["az", "ru", "en"]))
requireKnownSelection("SUPPORT_EVIDENCE_THEMES", selectedThemes, new Set(["light", "dark"]))
requireKnownSelection("SUPPORT_EVIDENCE_VIEWPORTS", selectedViewports, new Set(["desktop", "tablet", "narrow-tablet", "mobile"]))

const roles = [
  { key: "agent", email: process.env.SUPPORT_EVIDENCE_AGENT_EMAIL, password: process.env.SUPPORT_EVIDENCE_AGENT_PASSWORD },
  { key: "manager", email: process.env.SUPPORT_EVIDENCE_MANAGER_EMAIL, password: process.env.SUPPORT_EVIDENCE_MANAGER_PASSWORD },
  { key: "admin", email: process.env.SUPPORT_EVIDENCE_ADMIN_EMAIL, password: process.env.SUPPORT_EVIDENCE_ADMIN_PASSWORD },
  { key: "customer", email: process.env.SUPPORT_EVIDENCE_PORTAL_EMAIL, password: process.env.SUPPORT_EVIDENCE_PORTAL_PASSWORD },
].filter((role) => selectedRoles.has(role.key))

for (const role of roles) {
  if (!role.email || !role.password) throw new Error("Missing credentials for selected role: " + role.key)
}

const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 900 },
  "narrow-tablet": { width: 768, height: 900 },
  mobile: { width: 375, height: 812 },
}

const scenarios = [
  { id: "support-navigation", path: "/tickets", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='sidebar']", primary: "[data-testid='support-navigation-sections'], [data-testid='support-mobile-navigation']" },
  { id: "service-desk", path: "/tickets", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='tickets-workspace']", primary: "tbody tr[tabindex='0'], article[role='link'], [data-testid='tickets-empty-state']", performanceBudget: { loadP75: 650, filterP50: 200, interactionP75: 250 } },
  { id: "service-desk-kanban", path: "/tickets?view=kanban", roles: ["agent", "manager", "admin"], primaryClicks: 2, ready: "[data-testid='tickets-workspace']", primary: "[data-testid='tickets-kanban-viewport'] article, [data-testid='tickets-kanban-empty-state']", performanceBudget: { loadP75: 600 } },
  { id: "service-desk-reports", path: "/tickets?view=reports", roles: ["agent", "manager", "admin"], primaryClicks: 2, filter: true, ready: "[data-testid='ticketing-report-workspace']", primary: "[data-testid='ticketing-report-workspace']", performanceBudget: { loadP75: 700, filterP50: 200, interactionP75: 150 } },
  { id: "ticket-detail", path: () => envPath("SUPPORT_EVIDENCE_TICKET_ID", "/tickets/"), roles: ["agent", "manager", "admin"], primaryClicks: 2, ready: "[data-testid='ticket-detail-workspace']", primary: "[data-tour-id='ticket-comments']", performanceBudget: { loadP75: 600 } },
  { id: "complaints", path: "/complaints", roles: ["manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='complaints-workspace']", primary: "tbody tr[tabindex='0'], article, [data-testid='complaints-empty-state']" },
  { id: "complaint-new", path: "/complaints/new", roles: ["manager", "admin"], primaryClicks: 1, ready: "[data-testid='complaint-new-workspace']", primary: "[data-testid='complaint-new-form']" },
  { id: "complaint-import", path: "/complaints/import", roles: ["manager", "admin"], primaryClicks: 2, ready: "[data-testid='complaint-import-workspace']", primary: "[data-testid='complaint-import-dropzone']" },
  { id: "complaint-detail", path: () => envPath("SUPPORT_EVIDENCE_COMPLAINT_ID", "/complaints/"), roles: ["manager", "admin"], primaryClicks: 2, ready: "[data-testid='complaint-detail-workspace']", primary: "[aria-labelledby='complaint-conversation-title']" },
  { id: "agent-desktop", path: "/support/agent-desktop", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='agent-desktop-workspace']", primary: "[data-testid='agent-desktop-next-case']" },
  { id: "voip", path: "/support/voip", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='voip-workspace']", primary: "[data-testid='voip-call-timeline']" },
  { id: "knowledge-base", path: "/knowledge-base", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='knowledge-base-workspace'][data-state='ready']", primary: "[data-testid='knowledge-base-article-row'], [data-testid='knowledge-base-empty-state']" },
  { id: "knowledge-article", path: () => envPath("SUPPORT_EVIDENCE_KB_ARTICLE_ID", "/knowledge-base/"), roles: ["agent", "manager", "admin"], primaryClicks: 2, ready: "[data-testid='knowledge-article-workspace'][data-state='ready']", primary: "[data-testid='knowledge-article-content']" },
  { id: "ticket-categories", path: "/settings/ticket-categories", roles: ["admin"], primaryClicks: 2, filter: true, ready: "[data-testid='ticket-categories-workspace'][data-state='ready']", primary: "[data-testid='ticket-categories-tree'], [data-testid='ticket-categories-empty-state']" },
  { id: "sla-policies", path: "/settings/sla-policies", roles: ["admin"], primaryClicks: 2, ready: "[data-testid='sla-policies-workspace'][data-state='ready']", primary: "[data-testid='sla-policies-matrix'], [data-testid='sla-policies-mobile-list'], [data-testid='sla-policies-empty-state']" },
  { id: "support-entitlements", path: "/support/entitlements", roles: ["manager", "admin"], primaryClicks: 2, filter: true, ready: "[data-testid='support-entitlements-workspace'][data-state='ready']", primary: "[data-testid='support-entitlement-row'], [data-testid='support-entitlements-empty-state']" },
  { id: "entitlement-templates", path: "/settings/entitlement-templates", roles: ["admin"], primaryClicks: 2, ready: "[data-testid='entitlement-templates-workspace'][data-state='ready']", primary: "[data-testid='entitlement-template-rule'], [data-testid='entitlement-template-empty-rules']" },
  { id: "skill-routing", path: "/support/skill-routing", roles: ["manager", "admin"], primaryClicks: 2, filter: true, ready: "[data-testid='skill-routing-workspace'][data-state='ready']", primary: "[data-testid='routing-queue-row'], [data-testid='routing-queues-empty']" },
  { id: "agent-calendar", path: "/support/calendar", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true, ready: "[data-testid='support-calendar-workspace'][data-state='ready']", primary: "[data-testid='support-calendar-item'], [data-testid='support-calendar-empty-day']" },
  { id: "escalation-rules", path: "/settings/escalation", roles: ["admin"], primaryClicks: 2, filter: true, ready: "[data-testid='escalation-rules-workspace'][data-state='ready']", primary: "[data-testid='escalation-rule-row'], [data-testid='escalation-rules-empty']" },
  { id: "macros", path: "/settings/macros", roles: ["admin"], primaryClicks: 2, filter: true, ready: "[data-testid='macros-workspace'][data-state='ready']", primary: "[data-testid='macro-row'], [data-testid='macros-empty']" },
  { id: "portal-users", path: "/settings/portal-users", roles: ["admin"], primaryClicks: 2, filter: true, ready: "[data-testid='portal-users-workspace'][data-state='ready']", primary: "[data-testid='portal-user-row'], [data-testid='portal-user-card'], [data-testid='portal-users-empty']" },
  { id: "support-ai-settings", path: "/support/ai-settings", roles: ["admin"], primaryClicks: 2, ready: "[data-testid='support-ai-settings-workspace'][data-state='ready']", primary: "[data-testid='support-ai-master-switch']" },
  { id: "portal-tickets", path: "/portal/tickets", roles: ["customer"], primaryClicks: 1, filter: true, ready: "[data-testid='portal-tickets-workspace'][data-state='ready']", primary: "[data-testid='portal-ticket-row'], [data-testid='portal-tickets-empty-state']" },
  { id: "portal-ticket-detail", path: () => envPath("SUPPORT_EVIDENCE_PORTAL_TICKET_ID", "/portal/tickets/"), roles: ["customer"], primaryClicks: 2, ready: "[data-testid='portal-ticket-workspace'][data-state='ready']", primary: "[data-testid='portal-ticket-conversation']" },
  { id: "portal-knowledge", path: "/portal/knowledge-base", roles: ["customer"], primaryClicks: 1, filter: true, ready: "[data-testid='portal-knowledge-workspace'][data-state='ready']", primary: "[data-testid='portal-knowledge-list'], [data-testid='portal-knowledge-empty-state']" },
  { id: "portal-chat", path: "/portal/chat", roles: ["customer"], primaryClicks: 1, ready: "[data-testid='portal-chat-workspace']:not([data-state='loading'])", primary: "[data-testid='portal-chat-log'], [data-testid='portal-chat-manual-ticket']" },
  { id: "ticket-closure", path: () => envPath("SUPPORT_EVIDENCE_CLOSURE_TOKEN", "/ticket-closure/"), roles: ["customer"], primaryClicks: 1, ready: "[data-testid='ticket-closure-workspace'][data-state='ready']", primary: "[data-testid='ticket-closure-confirm'], [data-testid='ticket-closure-outcome']" },
]
const knownScenarioIds = new Set(scenarios.map((scenario) => scenario.id))
const selectedScenarioIds = selectedScenariosValue === "all"
  ? knownScenarioIds
  : new Set(selectedScenariosValue.split(",").map((value) => value.trim()).filter(Boolean))
requireKnownSelection("SUPPORT_EVIDENCE_SCENARIOS", selectedScenarioIds, knownScenarioIds)

function envPath(name, prefix) {
  const value = (process.env[name] || "").trim()
  return value ? prefix + encodeURIComponent(value) : null
}

function slug(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
}

function percentile(values, ratio) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function isIgnorableDevelopmentConsoleError(message) {
  if (appMode !== "development") return false
  return message.startsWith("eval() is not supported in this environment.")
    || message.startsWith("Failed to load resource: the server responded with a status of")
    || message.startsWith("TypeError: Failed to fetch")
}

async function authenticate(context, role) {
  if (role.key === "customer") {
    const response = await context.request.post("/api/v1/public/portal-auth", {
      data: {
        email: role.email,
        password: role.password,
        slug: process.env.SUPPORT_EVIDENCE_PORTAL_SLUG || "leaddrive",
      },
    })
    const body = await response.json().catch(() => null)
    if (!response.ok() || !body?.success || !body?.data) throw new Error("portal_authentication_failed")
    if (!body.token) throw new Error("portal_authentication_token_missing")
    await context.addCookies([{
      name: "portal-token",
      value: body.token,
      url: baseUrl,
      httpOnly: true,
      secure: baseUrl.startsWith("https:"),
      sameSite: "Lax",
    }])
    return body.data
  }
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: role.email,
      password: role.password,
      callbackUrl: baseUrl + "/tickets",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("dashboard_authentication_failed")
  return null
}

async function primeEvidenceStorage(context, theme, portalUser) {
  const page = await context.newPage()
  try {
    const response = await page.goto("/api/v1/ping", { waitUntil: "domcontentloaded", timeout: 30_000 })
    if (!response?.ok()) throw new Error("evidence_storage_origin_unavailable")
    await page.evaluate(({ activeTheme, customer }) => {
      localStorage.setItem("theme", activeTheme)
      if (customer) localStorage.setItem("portal-user", JSON.stringify(customer))
    }, { activeTheme: theme, customer: portalUser })
  } finally {
    await page.close()
  }
}

async function startPerformanceObservation(page) {
  await page.evaluate(() => {
    window.__supportUxEvidencePerformance = { cumulativeLayoutShift: 0, eventDurations: [] }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__supportUxEvidencePerformance.cumulativeLayoutShift += entry.value
        }
      }).observe({ type: "layout-shift", buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__supportUxEvidencePerformance.eventDurations.push(entry.duration)
      }).observe({ type: "event", buffered: true, durationThreshold: 16 })
    } catch {
      // Older engines still return navigation and filter timings.
    }
  })
  await page.waitForTimeout(50)
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex")
}

async function baselineComparison(fileName, actualPath) {
  if (!baselineDirectory) return { status: "not_configured" }
  const baselinePath = path.join(baselineDirectory, fileName)
  try {
    await access(baselinePath)
  } catch {
    return { status: "baseline_missing" }
  }
  const [actualSha256, baselineSha256] = await Promise.all([sha256(actualPath), sha256(baselinePath)])
  if (actualSha256 === baselineSha256) {
    return {
      status: "matched",
      reason: "identical_file",
      actualSha256,
      baselineSha256,
      changedPixels: 0,
      changedPixelRatio: 0,
    }
  }
  const comparison = await compareScreenshotPixels(actualPath, baselinePath)
  return {
    ...comparison,
    actualSha256,
    baselineSha256,
  }
}

function performanceComparison(common, performance, metrics, budgets) {
  if (!baselineEvidence) return { status: "not_configured", regressions: [] }
  const baseline = baselineEvidence.results?.find((result) =>
    result.id === common.id
    && result.role === common.role
    && result.locale === common.locale
    && result.theme === common.theme
    && result.viewport === common.viewport
    && baselineEvidence.dataProfile === dataProfile
    && result.status === "passed"
  )
  return compareSupportPerformance(performance, metrics, baseline, budgets)
}

async function inspectPage(page, workspaceSelector, primarySelector) {
  return page.evaluate(({ workspaceSelector, primarySelector }) => {
    const hiddenByClosedDetails = (element) => {
      let ancestor = element.parentElement
      while (ancestor) {
        if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
          const summary = [...ancestor.children].find((child) => child.tagName === "SUMMARY")
          if (!summary?.contains(element)) return true
        }
        ancestor = ancestor.parentElement
      }
      return false
    }
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return !hiddenByClosedDetails(element) && style.display !== "none" && style.visibility !== "hidden" && !element.classList.contains("sr-only") && rect.width > 0 && rect.height > 0
    }
    const main = document.querySelector("main") || document.body
    const workspace = workspaceSelector ? document.querySelector(workspaceSelector) : main
    const interactive = [...document.querySelectorAll("button,a[href],input,select,textarea,[role=button]")].filter(visible)
    const unlabeled = interactive.filter((element) => {
      if (element.textContent?.trim() || element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || element.getAttribute("title")) return false
      if (element instanceof HTMLInputElement && element.labels?.length) return false
      if (element instanceof HTMLSelectElement && element.labels?.length) return false
      if (element instanceof HTMLTextAreaElement && element.labels?.length) return false
      return true
    }).length
    const recommendedTouchTargets = interactive.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44
    })
    const smallTargets = interactive.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width < 24 || rect.height < 24
    })
    const describeTargets = (elements) => elements.slice(0, 20).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        testId: element.dataset.testid || null,
        label: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim().slice(0, 80) || null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    })
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
    const firstWork = primarySelector
      ? [...document.querySelectorAll(primarySelector)].find(visible)
      : workspace?.querySelector("table,[role=table],form,section,article,[data-testid]")
    const firstWorkRect = firstWork?.getBoundingClientRect() || null
    const mainRect = main.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const isInsideOwnedHorizontalContainment = (element) => {
      let ancestor = element.parentElement
      while (ancestor && ancestor !== main && ancestor !== document.body) {
        const style = getComputedStyle(ancestor)
        if (["auto", "scroll"].includes(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 2) return true
        if (["hidden", "clip"].includes(style.overflowX) && style.textOverflow === "ellipsis") return true
        ancestor = ancestor.parentElement
      }
      return false
    }
    const overflowingElements = [...document.body.querySelectorAll("*")].filter((element) => {
      if (!visible(element)) return false
      const rect = element.getBoundingClientRect()
      return (rect.left < -2 || rect.right > viewportWidth + 2) && !isInsideOwnedHorizontalContainment(element)
    })
    const overflowSamples = overflowingElements.slice(0, 20).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        testId: element.dataset.testid || null,
        className: typeof element.className === "string" ? element.className.slice(0, 180) : null,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }
    })
    const navigation = performance.getEntriesByType("navigation")[0]
    const cards = main.querySelectorAll("[class*='rounded'][class*='border']").length
    const rows = main.querySelectorAll("tbody tr,[role=row],[data-row-key]").length
    const mainOverflowX = getComputedStyle(main).overflowX
    const mainScrollableHorizontalOverflow = !["hidden", "clip"].includes(mainOverflowX) && main.scrollWidth > main.clientWidth + 2
    const performanceState = window.__supportUxEvidencePerformance || { cumulativeLayoutShift: 0, eventDurations: [] }
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      mainClientHeight: main.clientHeight,
      mainClientWidth: main.clientWidth,
      mainScrollHeight: main.scrollHeight,
      mainScrollWidth: main.scrollWidth,
      mainOverflowX,
      mainVerticalScrollRange: Math.max(0, main.scrollHeight - main.clientHeight),
      workspaceTop: workspace ? Math.round(workspace.getBoundingClientRect().top) : null,
      blockCount: main.children.length,
      renderedRows: rows,
      borderedRoundedBlocks: cards,
      immediatelyVisibleActions: interactive.filter((element) => element.getBoundingClientRect().top < window.innerHeight).length,
      primaryWorkTop: firstWorkRect ? Math.round(firstWorkRect.top) : null,
      primaryWorkVisible: firstWorkRect ? firstWorkRect.top < Math.min(window.innerHeight, mainRect.bottom) && firstWorkRect.bottom > Math.max(0, mainRect.top) : false,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 || mainScrollableHorizontalOverflow || overflowingElements.length > 0,
      overflowSamples,
      accessibility: {
        unlabeledInteractive: unlabeled,
        smallTargets: smallTargets.length,
        smallTargetSamples: describeTargets(smallTargets),
        recommendedTouchTargets: recommendedTouchTargets.length,
        recommendedTouchTargetSamples: describeTargets(recommendedTouchTargets),
        missingImageAlt: [...document.querySelectorAll("img")].filter((image) => !image.hasAttribute("alt")).length,
        duplicateIds: [...new Set(duplicateIds)],
      },
      timing: navigation ? {
        responseMs: Math.round(navigation.responseEnd),
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadMs: Math.round(navigation.loadEventEnd),
      } : null,
      cumulativeLayoutShift: performanceState.cumulativeLayoutShift,
      interactionP75: performanceState.eventDurations.length
        ? performanceState.eventDurations.sort((left, right) => left - right)[Math.ceil(performanceState.eventDurations.length * 0.75) - 1]
        : null,
      environment: {
        documentLang: document.documentElement.lang,
        prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        maxTouchPoints: navigator.maxTouchPoints,
      },
    }
  }, { workspaceSelector, primarySelector })
}

async function inspectKeyboard(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const sampledStops = []
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab")
    sampledStops.push(await page.evaluate(() => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement)) return "none"
      const tag = active.tagName.toLowerCase()
      const stableId = active.id ? "#" + active.id : active.dataset.testid ? "[data-testid=" + active.dataset.testid + "]" : ""
      return tag + stableId + (active.getAttribute("role") ? "[role=" + active.getAttribute("role") + "]" : "")
    }))
  }
  return {
    sampledStops,
    uniqueStops: new Set(sampledStops.filter((stop) => stop !== "body" && stop !== "none")).size,
    bodyOrMissingStops: sampledStops.filter((stop) => stop === "body" || stop === "none").length,
  }
}

async function dismissFirstVisitTour(page) {
  const tourOverlay = page.getByTestId("tour-overlay")
  if (await tourOverlay.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape")
    await tourOverlay.waitFor({ state: "hidden", timeout: 5_000 })
  }
}

async function resetWorkspaceScrollAfterTour(page) {
  await page.evaluate(async () => {
    const reset = () => {
      document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "instant" })
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "instant" })
    }
    reset()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    reset()
  })
}

async function waitForStableApplicationShell(page, role) {
  if (role.key !== "customer") {
    // A valid application cookie can render the route before NextAuth finishes
    // hydrating the identity used by the header and permission-aware sidebar.
    // Never baseline that temporary watchdog/fallback shell.
    await page.locator("[data-testid='global-header'][data-session-ready='true']")
      .waitFor({ state: "visible", timeout: 30_000 })
    await page.locator("[data-nav-active='true']").first()
      .waitFor({ state: "visible", timeout: 10_000 })
  }
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await page.waitForTimeout(250)
}

async function waitForStableDocumentTitle(page) {
  await page.waitForFunction(() => {
    const value = document.head.querySelector("title")?.textContent?.trim() || ""
    const now = performance.now()
    const previous = window.__supportUxEvidenceTitle
    if (!value) {
      delete window.__supportUxEvidenceTitle
      return false
    }
    if (!previous || previous.value !== value) {
      window.__supportUxEvidenceTitle = { value, since: now }
      return false
    }
    return now - previous.since >= 500
  }, undefined, { timeout: 5_000 })
}

async function inspectAccessibility(page) {
  await waitForStableDocumentTitle(page)
  // Load and run axe under a temporary CDP exception. The product page has
  // already loaded with its real CSP enforced, and enforcement is restored as
  // soon as the scan completes. This prevents the audit tool's own dynamic
  // code from generating CSP violation reports and rate-limit 429s.
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("Page.setBypassCSP", { enabled: true })
    await page.addScriptTag({ content: axeSource })
    return await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      })
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })),
      }))
    })
  } finally {
    await cdp.send("Page.setBypassCSP", { enabled: false }).catch(() => undefined)
    await cdp.detach().catch(() => undefined)
  }
}

async function measureFilterFeedback(page, workspaceSelector) {
  const scopeSelector = workspaceSelector || "main"
  const scope = page.locator(scopeSelector).first()
  const candidate = scope.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):visible").first()
  if (await candidate.count() === 0) return null
  const original = await candidate.inputValue()
  const originalText = await scope.textContent()
  const submitsForm = await candidate.evaluate((element) => Boolean(element.closest("form")))
  const startedAt = await page.evaluate(() => performance.now())
  await candidate.fill("__support_evidence_no_match__")
  if (submitsForm) await candidate.press("Enter")
  await page.waitForFunction(
    ({ selector, before }) => document.querySelector(selector)?.textContent !== before,
    { selector: scopeSelector, before: originalText },
    { timeout: 10_000 },
  )
  const duration = await page.evaluate((start) => performance.now() - start, startedAt)
  const filteredText = await page.locator(scopeSelector).first().textContent()
  await candidate.fill(original)
  if (submitsForm) await candidate.press("Enter")
  await page.locator(scopeSelector).first().waitFor({ state: "visible", timeout: 10_000 })
  await page.waitForFunction(
    ({ selector, before }) => document.querySelector(selector)?.textContent !== before,
    { selector: scopeSelector, before: filteredText },
    { timeout: 10_000 },
  )
  return Math.round(duration)
}

function markdown(report) {
  const lines = [
    "# Support UX browser evidence",
    "",
    "- Generated: " + report.generatedAt,
    "- Commit: " + report.commit,
    "- Target host: " + report.targetHost,
    "- Demo organization: " + report.demoOrganization,
    "- Data profile: " + report.dataProfile,
    "- Loads per matrix cell: " + report.sampleCount,
    "",
    "| Scenario | Role | Locale | Theme | Viewport | Result | Overflow | A11y issues | p50/p75 load | Perf compare | Screenshot |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const result of report.results) {
    const timing = result.performance
      ? String(result.performance.loadP50) + "/" + String(result.performance.loadP75) + " ms"
      : "—"
    lines.push("| " + [result.id, result.role, result.locale, result.theme, result.viewport, result.status,
      String(result.metrics?.horizontalOverflow ?? "—"), String(result.a11yIssueCount ?? "—"), timing,
      result.performanceComparison?.status || "—",
      result.screenshot || result.reason || "—"].join(" | ") + " |")
  }
  lines.push("", "Primary-flow click counts are declared scenario targets; mutation flows require a separate disposable-fixture run.")
  return lines.join("\n")
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  appMode,
  demoOrganization,
  dataProfile,
  sampleCount,
  results: [],
}

const browser = await chromium.launch({ headless: true })
try {
  for (const role of roles) {
    for (const locale of selectedLocales) {
      for (const theme of selectedThemes) {
        for (const viewportName of selectedViewports) {
          const viewport = viewports[viewportName]
          const expectsTouch = viewportName !== "desktop"
          const context = await browser.newContext({ baseURL: baseUrl, viewport, locale, colorScheme: theme, reducedMotion: "reduce", hasTouch: expectsTouch })
          await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
          try {
            const portalUser = await authenticate(context, role)
            await primeEvidenceStorage(context, theme, portalUser)
            const roleScenarios = scenarios.filter((item) => item.roles.includes(role.key) && selectedScenarioIds.has(item.id))
            console.log(`[support-evidence] ${role.key}/${locale}/${theme}/${viewportName}: ${roleScenarios.length} scenario(s)`)
            for (const scenario of roleScenarios) {
              console.log(`[support-evidence] capturing ${scenario.id}`)
              const scenarioPath = typeof scenario.path === "function" ? scenario.path() : scenario.path
              const common = { id: scenario.id, role: role.key, locale, theme, viewport: viewportName, path: scenarioPath, primaryFlowClicks: scenario.primaryClicks }
              if (!scenarioPath) {
                report.results.push({ ...common, status: "blocked", reason: "required_fixture_identifier_missing" })
                continue
              }
              const page = await context.newPage()
              const errors = []
              page.on("pageerror", (error) => errors.push("page:" + error.message))
              page.on("console", (message) => {
                if (message.type() !== "error" || isIgnorableDevelopmentConsoleError(message.text())) return
                errors.push("console:" + message.text())
              })
              page.on("response", (response) => {
                const url = new URL(response.url())
                if (url.origin === baseUrl && response.status() >= 400 && url.pathname !== "/api/v1/public/csp-report") {
                  errors.push("http:" + response.status() + ":" + url.pathname)
                }
              })
              try {
                const loadSamples = []
                const filterSamples = []
                let metrics = null
                const openScenario = async () => {
                  const response = await page.goto(scenarioPath, { waitUntil: "domcontentloaded", timeout: 60_000 })
                  if (!response || response.status() >= 400) throw new Error("page_http_" + (response?.status() || 0))
                  await page.locator("body").waitFor({ state: "visible" })
                  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
                  if (scenario.ready) {
                    await page.locator(scenario.ready).waitFor({ state: "visible", timeout: 30_000 })
                  }
                  // Next.js can stream metadata after the route body is ready. Keep
                  // the audit fail-closed, but do not run axe in that brief gap.
                  await waitForStableDocumentTitle(page)
                  await dismissFirstVisitTour(page)
                  await waitForStableApplicationShell(page, role)
                  await resetWorkspaceScrollAfterTour(page)
                  await startPerformanceObservation(page)
                  const bodyText = await page.locator("body").innerText()
                  assertDemoTenant(bodyText, demoOrganization, scenario.id)
                }
                if (sampleCount > 1) {
                  // Warm application/session/data caches outside the measured
                  // samples so p75 compares steady product work.
                  await openScenario()
                }
                for (let sample = 0; sample < sampleCount; sample += 1) {
                  await openScenario()
                  metrics = await inspectPage(page, scenario.ready, scenario.primary)
                  if (metrics.timing?.loadMs) loadSamples.push(metrics.timing.loadMs)
                  if (scenario.filter) {
                    const filterFeedbackMs = await measureFilterFeedback(page, scenario.ready)
                    if (filterFeedbackMs !== null) filterSamples.push(filterFeedbackMs)
                    const interactionMetrics = await inspectPage(page, scenario.ready, scenario.primary)
                    // The synthetic no-match query intentionally visits an empty
                    // state. Keep structural evidence from the settled page and
                    // merge only interaction latency collected afterward;
                    // otherwise a transient restoration frame can falsely report
                    // that the page's primary work is missing. Keep load CLS from
                    // the pre-filter inspection: automation-driven no-results
                    // transitions are not trusted input and would pollute CLS.
                    metrics = {
                      ...metrics,
                      interactionP75: interactionMetrics.interactionP75,
                    }
                  }
                }
                const fileName = slug([scenario.id, role.key, locale, theme, viewportName, dataProfile].join("-")) + ".png"
                const screenshotPath = path.join(outputDirectory, fileName)
                const { developmentChromeHosts } = await prepareSupportEvidenceScreenshot(page)
                const axeViolations = await inspectAccessibility(page)
                await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" })
                const keyboard = await inspectKeyboard(page)
                const touchTargetIssueCount = expectsTouch ? metrics.accessibility.smallTargets : 0
                const a11yIssueCount = metrics.accessibility.unlabeledInteractive
                  + touchTargetIssueCount
                  + metrics.accessibility.missingImageAlt
                  + metrics.accessibility.duplicateIds.length
                const environmentMismatch = !metrics.environment.documentLang.toLowerCase().startsWith(locale)
                  || metrics.environment.prefersDark !== (theme === "dark")
                  || !metrics.environment.reducedMotion
                  || (expectsTouch && metrics.environment.maxTouchPoints < 1)
                const primaryWorkMiss = Boolean(scenario.primary) && (!metrics.primaryWorkVisible || metrics.primaryWorkTop === null || metrics.primaryWorkTop > Math.min(768, viewport.height))
                const performance = {
                  loadP50: percentile(loadSamples, 0.5),
                  loadP75: percentile(loadSamples, 0.75),
                  loadSamples,
                  filterP50: percentile(filterSamples, 0.5),
                  filterP75: percentile(filterSamples, 0.75),
                  filterSamples,
                  interactionP75: metrics.interactionP75,
                  cumulativeLayoutShift: metrics.cumulativeLayoutShift,
                }
                const visual = await baselineComparison(fileName, screenshotPath)
                const comparedPerformance = performanceComparison(common, performance, metrics, scenario.performanceBudget)
                const failed = errors.length || metrics.horizontalOverflow || a11yIssueCount || primaryWorkMiss
                  || axeViolations.length || keyboard.uniqueStops === 0 || environmentMismatch
                  || (requireBaseline ? visual.status !== "matched" || comparedPerformance.status !== "matched" : visual.status === "changed")
                report.results.push({
                  ...common,
                  status: failed ? "failed" : "passed",
                  screenshot: fileName,
                  developmentChromeHosts,
                  metrics,
                  a11yIssueCount,
                  touchTargetIssueCount,
                  axeViolations,
                  keyboard,
                  environmentMismatch,
                  primaryWorkMiss,
                  errors,
                  visual,
                  performance,
                  performanceComparison: comparedPerformance,
                })
              } catch (error) {
                report.results.push({ ...common, status: "failed", reason: error instanceof Error ? error.message : String(error), errors })
              } finally {
                await page.close()
              }
            }
          } catch (error) {
            report.results.push({ id: "authentication", role: role.key, locale, theme, viewport: viewportName, status: "blocked", reason: error instanceof Error ? error.message : String(error) })
          } finally {
            await context.close()
          }
        }
      }
    }
  }
} finally {
  await browser.close()
}

await writeFile(path.join(outputDirectory, "evidence.json"), JSON.stringify(report, null, 2) + "\n")
await writeFile(path.join(outputDirectory, "index.md"), markdown(report) + "\n")
if (report.results.length === 0 || report.results.some((result) => result.status !== "passed")) process.exitCode = 1
