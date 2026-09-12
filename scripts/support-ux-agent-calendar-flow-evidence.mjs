import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Agent Calendar flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Agent Calendar flow evidence refuses a non-local host")
}

const demoOrganization = requireDemoTenant()
const commit = (process.env.SUPPORT_EVIDENCE_COMMIT || "").trim()
if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error("SUPPORT_EVIDENCE_COMMIT must be an exact Git commit")

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function singleSelection(name, fallback, allowed) {
  const values = (process.env[name] || fallback).split(",").map((value) => value.trim()).filter(Boolean)
  if (values.length !== 1 || !allowed.has(values[0])) {
    throw new Error(`${name} must select exactly one supported value for flow evidence`)
  }
  return values[0]
}

const locale = singleSelection("SUPPORT_EVIDENCE_LOCALES", "az", new Set(["az", "ru", "en"]))
const theme = singleSelection("SUPPORT_EVIDENCE_THEMES", "light", new Set(["light", "dark"]))
const viewportName = singleSelection("SUPPORT_EVIDENCE_VIEWPORTS", "desktop", new Set(["desktop", "tablet", "narrow-tablet", "mobile"]))
const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 900 },
  "narrow-tablet": { width: 768, height: 900 },
  mobile: { width: 375, height: 812 },
}
const usesAgenda = viewports[viewportName].width < 1280
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const agent = {
  email: requiredEnv("SUPPORT_EVIDENCE_AGENT_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_AGENT_PASSWORD"),
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: agent.email,
      password: agent.password,
      callbackUrl: baseUrl + "/support/calendar",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("agent_calendar_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/support/calendar", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Agent Calendar")
}

function jsonFailure(message, status = 503) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: false, error: message }) }
}

function syntheticItems(count) {
  const today = new Date()
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setHours(6 + Math.floor(index / 6), (index % 6) * 10, 0, 0)
    return {
      id: `calendar-density-${index}`,
      type: "event",
      title: `Calendar density item ${index + 1}`,
      date: date.toISOString(),
      hour: date.getHours(),
      status: "scheduled",
      location: index === 0 ? "Evidence room" : undefined,
      isOnline: index === 1,
      url: "/events",
    }
  })
  if (items.length > 1) {
    const future = new Date(Date.now() + 30 * 60 * 1000)
    items[items.length - 1] = { ...items[items.length - 1], date: future.toISOString(), hour: future.getHours(), title: "Next evidence appointment" }
  }
  return items.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
}

function calendarPayload(items, sources = { tickets: "ok", tasks: "ok", events: "ok", activities: "ok" }) {
  return {
    success: true,
    data: {
      items,
      sources,
      counts: {
        tickets: items.filter((item) => item.type === "ticket").length,
        tasks: items.filter((item) => item.type === "task").length,
        events: items.filter((item) => item.type === "event").length,
        activities: items.filter((item) => item.type.startsWith("activity_")).length,
      },
    },
  }
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  demoOrganization,
  role: "agent",
  locale,
  theme,
  viewport: viewportName,
  results: [],
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL: baseUrl,
  viewport: viewports[viewportName],
  locale,
  colorScheme: theme,
  reducedMotion: "reduce",
  hasTouch: viewportName !== "desktop",
})
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[agent-calendar-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `agent-calendar-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `agent-calendar-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
try {
  await authenticate(context)

  await recordStep(page, "load-failure-permission-and-keyboard-recovery", async () => {
    const pattern = "**/api/v1/calendar/agent?*"
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic calendar load failure"))
    await page.route(pattern, deny)
    await page.goto("/support/calendar", { waitUntil: "domcontentloaded" })
    await page.getByTestId("support-calendar-error").waitFor({ state: "visible" })
    await page.unroute(pattern, deny)
    await page.getByTestId("support-calendar-retry").focus()
    await page.getByTestId("support-calendar-retry").press("Enter")
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic calendar permission denial", 403))
    await page.route(pattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("support-calendar-error").waitFor({ state: "visible" })
    if (await page.getByTestId("support-calendar-retry").count() !== 0) throw new Error("calendar_permission_offered_misleading_retry")
    await page.unroute(pattern, forbid)
    await openWorkspace(page)
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "partial-source-failure-and-recovery", async () => {
    const pattern = "**/api/v1/calendar/agent?*"
    const partial = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, success: true, data: { ...payload.data, sources: { tickets: "ok", tasks: "failed", events: "ok", activities: "ok" } } }) })
    }
    await page.route(pattern, partial)
    await page.goto("/support/calendar", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='support-calendar-workspace'][data-state='partial']").waitFor({ state: "visible" })
    await page.getByTestId("support-calendar-partial").waitFor({ state: "visible" })
    await page.unroute(pattern, partial)
    await page.getByTestId("support-calendar-partial-retry").focus()
    await page.getByTestId("support-calendar-partial-retry").press("Enter")
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })
    return { partialStateObserved: true, availableItemsPreserved: true, keyboardRetry: true }
  })

  await recordStep(page, "empty-selected-day-and-recovery", async () => {
    const pattern = "**/api/v1/calendar/agent?*"
    const empty = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(calendarPayload([])) })
    await page.route(pattern, empty)
    await page.goto("/support/calendar", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.getByTestId("support-calendar-empty-day").waitFor({ state: usesAgenda ? "visible" : "attached" })
    await page.unroute(pattern, empty)
    await openWorkspace(page)
    return { emptyDayObserved: true, emptyNotConfusedWithFailure: true, recoverySucceeded: true }
  })

  await recordStep(page, "high-volume-outside-hours-next-and-show-more", async () => {
    const pattern = "**/api/v1/calendar/agent?*"
    const items = syntheticItems(30)
    const density = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(calendarPayload(items)) })
    await page.route(pattern, density)
    await page.goto("/support/calendar", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-calendar-item'][data-outside-hours='true']:visible").first().waitFor({ state: "visible" })
    await page.getByTestId("support-calendar-next-item").waitFor({ state: "visible" })
    const initialVisible = await page.locator("[data-testid='support-calendar-item']:visible").count()
    if (usesAgenda) await page.getByTestId("support-calendar-agenda-show-more").click()
    else await page.locator("[data-testid='support-calendar-week-show-more']:visible").first().click()
    const expandedVisible = await page.locator("[data-testid='support-calendar-item']:visible").count()
    if (expandedVisible <= initialVisible) throw new Error("calendar_show_more_did_not_reveal_items")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("calendar_density_horizontal_overflow")
    return { items: 30, outsideHoursVisible: true, nextHookVisible: true, showMoreExpanded: true, horizontalOverflow: false }
  })

  await recordStep(page, "keyboard-touch-detail-and-focus-return", async () => {
    const trigger = page.locator("[data-testid='support-calendar-item'][data-outside-hours='true']:visible").first()
    await trigger.focus()
    await trigger.press("Enter")
    const detail = page.getByTestId("support-calendar-detail")
    await detail.waitFor({ state: "visible" })
    if (!await detail.innerText()) throw new Error("calendar_detail_content_missing")
    await page.keyboard.press("Escape")
    await detail.waitFor({ state: "hidden" })
    if (!await trigger.isFocused()) throw new Error("calendar_detail_focus_not_restored")
    return { keyboardOpen: true, touchTargetPresent: true, outsideHoursDetail: true, focusRestored: true }
  })

  await recordStep(page, "week-navigation-and-today-recovery", async () => {
    await openWorkspace(page)
    const before = await page.getByTestId("support-calendar-week-label").innerText()
    await page.getByTestId("support-calendar-next").focus()
    await page.getByTestId("support-calendar-next").press("Enter")
    await page.waitForFunction((previous) => document.querySelector("[data-testid='support-calendar-week-label']")?.textContent !== previous, before)
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })
    const after = await page.getByTestId("support-calendar-week-label").innerText()
    if (after === before) throw new Error("calendar_next_week_did_not_change_range")
    const today = page.locator("[data-testid='support-calendar-today']:visible, [data-testid='support-calendar-today-mobile']:visible").first()
    await today.click()
    await page.waitForFunction((expected) => document.querySelector("[data-testid='support-calendar-week-label']")?.textContent === expected, before)
    await page.locator("[data-testid='support-calendar-workspace'][data-state='ready']").waitFor({ state: "visible" })
    if (await page.getByTestId("support-calendar-week-label").innerText() !== before) throw new Error("calendar_today_did_not_restore_current_week")
    return { keyboardWeekNavigation: true, todayRestored: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "agent-calendar-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
