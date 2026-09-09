import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"

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
if (requireBaseline && !baselineDirectory) throw new Error("SUPPORT_EVIDENCE_BASELINE_DIR is required in compare mode")
const dataProfile = (process.env.SUPPORT_EVIDENCE_DATA_PROFILE || "typical").trim()
if (!new Set(["empty", "typical", "high", "0", "5", "50", "500"]).has(dataProfile)) {
  throw new Error("SUPPORT_EVIDENCE_DATA_PROFILE must identify empty/typical/high or 0/5/50/500")
}

const selectedRoles = new Set((process.env.SUPPORT_EVIDENCE_ROLES || "agent,manager,admin,customer").split(",").map((value) => value.trim()).filter(Boolean))
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
  { id: "service-desk", path: "/tickets", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true },
  { id: "ticket-detail", path: () => envPath("SUPPORT_EVIDENCE_TICKET_ID", "/tickets/"), roles: ["agent", "manager", "admin"], primaryClicks: 2 },
  { id: "complaints", path: "/complaints", roles: ["manager", "admin"], primaryClicks: 1, filter: true },
  { id: "complaint-new", path: "/complaints/new", roles: ["manager", "admin"], primaryClicks: 1 },
  { id: "complaint-detail", path: () => envPath("SUPPORT_EVIDENCE_COMPLAINT_ID", "/complaints/"), roles: ["manager", "admin"], primaryClicks: 2 },
  { id: "agent-desktop", path: "/support/agent-desktop", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true },
  { id: "voip", path: "/support/voip", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true },
  { id: "knowledge-base", path: "/knowledge-base", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true },
  { id: "ticket-categories", path: "/settings/ticket-categories", roles: ["admin"], primaryClicks: 2, filter: true },
  { id: "sla-policies", path: "/settings/sla-policies", roles: ["admin"], primaryClicks: 2, filter: true },
  { id: "support-entitlements", path: "/support/entitlements", roles: ["manager", "admin"], primaryClicks: 2, filter: true },
  { id: "entitlement-templates", path: "/settings/entitlement-templates", roles: ["admin"], primaryClicks: 2 },
  { id: "skill-routing", path: "/support/skill-routing", roles: ["manager", "admin"], primaryClicks: 2, filter: true },
  { id: "agent-calendar", path: "/support/calendar", roles: ["agent", "manager", "admin"], primaryClicks: 1, filter: true },
  { id: "escalation-rules", path: "/settings/escalation", roles: ["admin"], primaryClicks: 2, filter: true },
  { id: "macros", path: "/settings/macros", roles: ["admin"], primaryClicks: 2, filter: true },
  { id: "portal-users", path: "/settings/portal-users", roles: ["admin"], primaryClicks: 2, filter: true },
  { id: "support-ai-settings", path: "/support/ai-settings", roles: ["admin"], primaryClicks: 2 },
  { id: "portal-tickets", path: "/portal/tickets", roles: ["customer"], primaryClicks: 1, filter: true },
  { id: "portal-ticket-detail", path: () => envPath("SUPPORT_EVIDENCE_PORTAL_TICKET_ID", "/portal/tickets/"), roles: ["customer"], primaryClicks: 2 },
  { id: "portal-knowledge", path: "/portal/knowledge-base", roles: ["customer"], primaryClicks: 1, filter: true },
  { id: "portal-chat", path: "/portal/chat", roles: ["customer"], primaryClicks: 1 },
  { id: "ticket-closure", path: () => envPath("SUPPORT_EVIDENCE_CLOSURE_TOKEN", "/ticket-closure/"), roles: ["customer"], primaryClicks: 1 },
]

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
    await context.addInitScript((user) => localStorage.setItem("portal-user", JSON.stringify(user)), body.data)
    return
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
  return {
    status: actualSha256 === baselineSha256 ? "matched" : "changed",
    actualSha256,
    baselineSha256,
  }
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
    }
    const main = document.querySelector("main") || document.body
    const interactive = [...document.querySelectorAll("button,a[href],input,select,textarea,[role=button]")].filter(visible)
    const unlabeled = interactive.filter((element) => {
      if (element.textContent?.trim() || element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || element.getAttribute("title")) return false
      if (element instanceof HTMLInputElement && element.labels?.length) return false
      if (element instanceof HTMLSelectElement && element.labels?.length) return false
      if (element instanceof HTMLTextAreaElement && element.labels?.length) return false
      return true
    }).length
    const smallTargets = interactive.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44
    }).length
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
    const firstWork = main.querySelector("table,[role=table],form,section,article,[data-testid]")
    const navigation = performance.getEntriesByType("navigation")[0]
    const cards = main.querySelectorAll("[class*='rounded'][class*='border']").length
    const rows = main.querySelectorAll("tbody tr,[role=row],[data-row-key]").length
    const performanceState = window.__supportUxEvidencePerformance || { cumulativeLayoutShift: 0, eventDurations: [] }
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      blockCount: main.children.length,
      renderedRows: rows,
      borderedRoundedBlocks: cards,
      immediatelyVisibleActions: interactive.filter((element) => element.getBoundingClientRect().top < window.innerHeight).length,
      primaryWorkTop: firstWork ? Math.round(firstWork.getBoundingClientRect().top + window.scrollY) : null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      accessibility: {
        unlabeledInteractive: unlabeled,
        smallTargets,
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
  })
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

async function inspectAccessibility(page) {
  await page.addScriptTag({ content: axeSource })
  return page.evaluate(async () => {
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
}

async function measureFilterFeedback(page) {
  const candidate = page.locator("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):visible").first()
  if (await candidate.count() === 0) return null
  const original = await candidate.inputValue()
  const startedAt = await page.evaluate(() => performance.now())
  await candidate.fill("__support_evidence_no_match__")
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const duration = await page.evaluate((start) => performance.now() - start, startedAt)
  await candidate.fill(original)
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
    "",
    "| Scenario | Role | Locale | Theme | Viewport | Result | Overflow | A11y issues | p50/p75 load | Screenshot |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const result of report.results) {
    const timing = result.performance
      ? String(result.performance.loadP50) + "/" + String(result.performance.loadP75) + " ms"
      : "—"
    lines.push("| " + [result.id, result.role, result.locale, result.theme, result.viewport, result.status,
      String(result.metrics?.horizontalOverflow ?? "—"), String(result.a11yIssueCount ?? "—"), timing,
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
  demoOrganization,
  dataProfile,
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
          await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)
          await context.addInitScript(() => {
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
          try {
            await authenticate(context, role)
            for (const scenario of scenarios.filter((item) => item.roles.includes(role.key))) {
              const scenarioPath = typeof scenario.path === "function" ? scenario.path() : scenario.path
              const common = { id: scenario.id, role: role.key, locale, theme, viewport: viewportName, path: scenarioPath, primaryFlowClicks: scenario.primaryClicks }
              if (!scenarioPath) {
                report.results.push({ ...common, status: "blocked", reason: "required_fixture_identifier_missing" })
                continue
              }
              const page = await context.newPage()
              const errors = []
              page.on("pageerror", (error) => errors.push("page:" + error.message))
              page.on("console", (message) => { if (message.type() === "error") errors.push("console:" + message.text()) })
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
                for (let sample = 0; sample < 3; sample += 1) {
                  const response = await page.goto(scenarioPath, { waitUntil: "domcontentloaded", timeout: 60_000 })
                  if (!response || response.status() >= 400) throw new Error("page_http_" + (response?.status() || 0))
                  await page.locator("body").waitFor({ state: "visible" })
                  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
                  const bodyText = await page.locator("body").innerText()
                  assertDemoTenant(bodyText, demoOrganization, scenario.id)
                  metrics = await inspectPage(page)
                  if (metrics.timing?.loadMs) loadSamples.push(metrics.timing.loadMs)
                  if (scenario.filter) {
                    const filterFeedbackMs = await measureFilterFeedback(page)
                    if (filterFeedbackMs !== null) filterSamples.push(filterFeedbackMs)
                  }
                }
                const fileName = slug([scenario.id, role.key, locale, theme, viewportName, dataProfile].join("-")) + ".png"
                const screenshotPath = path.join(outputDirectory, fileName)
                const keyboard = await inspectKeyboard(page)
                const axeViolations = await inspectAccessibility(page)
                await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" })
                const visual = await baselineComparison(fileName, screenshotPath)
                const a11yIssueCount = metrics.accessibility.unlabeledInteractive
                  + metrics.accessibility.smallTargets
                  + metrics.accessibility.missingImageAlt
                  + metrics.accessibility.duplicateIds.length
                const environmentMismatch = !metrics.environment.documentLang.toLowerCase().startsWith(locale)
                  || metrics.environment.prefersDark !== (theme === "dark")
                  || !metrics.environment.reducedMotion
                  || (expectsTouch && metrics.environment.maxTouchPoints < 1)
                const failed = errors.length || metrics.horizontalOverflow || a11yIssueCount
                  || axeViolations.length || keyboard.uniqueStops === 0 || environmentMismatch
                  || (requireBaseline ? visual.status !== "matched" : visual.status === "changed")
                report.results.push({
                  ...common,
                  status: failed ? "failed" : "passed",
                  screenshot: fileName,
                  metrics,
                  a11yIssueCount,
                  axeViolations,
                  keyboard,
                  environmentMismatch,
                  errors,
                  visual,
                  performance: {
                    loadP50: percentile(loadSamples, 0.5),
                    loadP75: percentile(loadSamples, 0.75),
                    loadSamples,
                    filterP50: percentile(filterSamples, 0.5),
                    filterP75: percentile(filterSamples, 0.75),
                    filterSamples,
                    interactionP75: metrics.interactionP75,
                    cumulativeLayoutShift: metrics.cumulativeLayoutShift,
                  },
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
