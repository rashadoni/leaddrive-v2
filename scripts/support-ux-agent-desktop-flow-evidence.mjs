import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Agent Desktop evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Agent Desktop evidence refuses a non-local host")
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
    throw new Error(`${name} must select exactly one supported value for mutating flow evidence`)
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
      callbackUrl: baseUrl + "/support/agent-desktop",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("dashboard_authentication_failed")
}

async function openWorkspace(page) {
  const response = await page.goto("/support/agent-desktop", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("body").waitFor({ state: "visible" })
  await page.getByTestId("agent-desktop-workspace").waitFor({ state: "visible", timeout: 30_000 })
  const tourOverlay = page.getByTestId("tour-overlay")
  if (await tourOverlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) await page.keyboard.press("Escape")
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Agent Desktop")
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
  console.log(`[agent-desktop-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `agent-desktop-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `agent-desktop-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
try {
  await authenticate(context)

  await recordStep(page, "dashboard-load-failure-and-recovery", async () => {
    const pattern = "**/api/v1/support/agent-desktop"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic dashboard failure" }) })
    await page.route(pattern, deny)
    await page.goto("/support/agent-desktop", { waitUntil: "domcontentloaded" })
    await page.getByTestId("agent-desktop-load-error").waitFor({ state: "visible" })
    assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Agent Desktop load error")
    await page.unroute(pattern, deny)
    await page.getByTestId("agent-desktop-retry-load").focus()
    await page.getByTestId("agent-desktop-retry-load").press("Enter")
    await page.getByTestId("agent-desktop-workspace").waitFor({ state: "visible" })
    return { errorObserved: true, keyboardRetry: true, recoverySucceeded: true }
  })

  await recordStep(page, "availability-load-failure-and-recovery", async () => {
    const pattern = "**/api/v1/users/me/availability"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic availability failure" }) })
    await page.route(pattern, deny)
    await openWorkspace(page)
    await page.getByTestId("agent-desktop-availability-error").waitFor({ state: "visible" })
    if (!await page.getByTestId("agent-desktop-availability").isDisabled()) throw new Error("unknown_availability_switch_enabled")
    await page.unroute(pattern, deny)
    await page.getByTestId("agent-desktop-retry-availability").click()
    await page.getByTestId("agent-desktop-availability-error").waitFor({ state: "hidden" })
    if (await page.getByTestId("agent-desktop-availability").isDisabled()) throw new Error("recovered_availability_switch_disabled")
    return { unknownStateDisabled: true, retrySucceeded: true }
  })

  await recordStep(page, "availability-save-rollback-and-recovery", async () => {
    await openWorkspace(page)
    const toggle = page.getByTestId("agent-desktop-availability")
    const original = await toggle.getAttribute("data-state") === "checked"
    const requested = !original
    const pattern = "**/api/v1/users/me/availability"
    const denyPatch = async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic save failure" }) })
      } else await route.continue()
    }
    await page.route(pattern, denyPatch)
    await toggle.focus()
    const [failed] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/users/me/availability" && candidate.request().method() === "PATCH"),
      page.keyboard.press("Space"),
    ])
    if (failed.status() !== 503) throw new Error(`availability_failure_intercept_missed_${failed.status()}`)
    await page.getByTestId("agent-desktop-availability-error").waitFor({ state: "visible" })
    if ((await toggle.getAttribute("data-state") === "checked") !== original) throw new Error("availability_failure_did_not_rollback")
    await page.unroute(pattern, denyPatch)
    const [saved] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/users/me/availability" && candidate.request().method() === "PATCH"),
      page.getByTestId("agent-desktop-retry-availability").click(),
    ])
    if (!saved.ok()) throw new Error(`availability_retry_http_${saved.status()}`)
    await page.getByTestId("agent-desktop-availability-saved").waitFor({ state: "visible" })
    await page.waitForFunction((expected) => (document.querySelector("[data-testid='agent-desktop-availability']")?.getAttribute("data-state") === "checked") === expected, requested)
      .catch(() => { throw new Error("availability_retry_not_applied") })
    const [restored] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/users/me/availability" && candidate.request().method() === "PATCH"),
      toggle.click(),
    ])
    if (!restored.ok()) throw new Error(`availability_restore_http_${restored.status()}`)
    await page.waitForFunction((expected) => (document.querySelector("[data-testid='agent-desktop-availability']")?.getAttribute("data-state") === "checked") === expected, original)
      .catch(() => { throw new Error("availability_fixture_not_restored") })
    return { keyboardToggle: true, rollbackObserved: true, retrySucceeded: true, fixtureRestored: true }
  })

  await recordStep(page, "stale-refresh-and-recovery", async () => {
    await openWorkspace(page)
    const nextCaseText = await page.getByTestId("agent-desktop-next-case").innerText()
    const pattern = "**/api/v1/support/agent-desktop"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic refresh failure" }) })
    await page.route(pattern, deny)
    await page.getByTestId("agent-desktop-refresh").click()
    await page.getByTestId("agent-desktop-refresh-error").waitFor({ state: "visible" })
    if (await page.getByTestId("agent-desktop-next-case").innerText() !== nextCaseText) throw new Error("refresh_failure_discarded_snapshot")
    await page.unroute(pattern, deny)
    await page.getByTestId("agent-desktop-retry-refresh").click()
    await page.getByTestId("agent-desktop-refresh-error").waitFor({ state: "hidden" })
    return { staleSnapshotPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "empty-queue-and-recovery", async () => {
    const pattern = "**/api/v1/support/agent-desktop"
    const empty = async (route) => {
      const original = await route.fetch()
      const json = await original.json()
      await route.fulfill({
        response: original,
        json: { success: true, data: { ...json.data, queue: { ...json.data.queue, total: 0, shown: 0, nextTicket: null, tickets: [], byPriority: {} } } },
      })
    }
    await page.route(pattern, empty)
    await openWorkspace(page)
    await page.getByTestId("agent-desktop-empty-queue").waitFor({ state: "visible" })
    await page.unroute(pattern, empty)
    await page.getByTestId("agent-desktop-refresh").click()
    await page.getByTestId("agent-desktop-empty-queue").waitFor({ state: "hidden" })
    return { emptyStateObserved: true, recoverySucceeded: true }
  })

  await recordStep(page, "dashboard-permission-state", async () => {
    const pattern = "**/api/v1/support/agent-desktop"
    const deny = async (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic permission denial" }) })
    await page.route(pattern, deny)
    await page.goto("/support/agent-desktop", { waitUntil: "domcontentloaded" })
    await page.getByTestId("agent-desktop-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("agent-desktop-retry-load").count() !== 0) throw new Error("permission_state_offered_misleading_retry")
    assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Agent Desktop permission state")
    return { permissionMessageObserved: true, misleadingRetryAbsent: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "agent-desktop-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
