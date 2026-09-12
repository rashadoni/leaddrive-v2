import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") throw new Error("VoIP flow evidence is restricted to the ephemeral target")
const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) throw new Error("VoIP flow evidence refuses a non-local host")
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
  if (values.length !== 1 || !allowed.has(values[0])) throw new Error(`${name} must select exactly one supported value`)
  return values[0]
}

const locale = singleSelection("SUPPORT_EVIDENCE_LOCALES", "az", new Set(["az", "ru", "en"]))
const theme = singleSelection("SUPPORT_EVIDENCE_THEMES", "light", new Set(["light", "dark"]))
const viewportName = singleSelection("SUPPORT_EVIDENCE_VIEWPORTS", "desktop", new Set(["desktop", "tablet", "narrow-tablet", "mobile"]))
const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 900 }, "narrow-tablet": { width: 768, height: 900 }, mobile: { width: 375, height: 812 } }
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const agent = { email: requiredEnv("SUPPORT_EVIDENCE_AGENT_EMAIL"), password: requiredEnv("SUPPORT_EVIDENCE_AGENT_PASSWORD") }

function silentWav() {
  const sampleRate = 8000
  const samples = 4000
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVEfmt ", 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

async function authenticate(context) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json()
  const response = await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: agent.email, password: agent.password, callbackUrl: baseUrl + "/support/voip", json: "true" } })
  if (!response.ok()) throw new Error("dashboard_authentication_failed")
}

async function openWorkspace(page) {
  const response = await page.goto("/support/voip", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.getByTestId("voip-workspace").waitFor({ state: "visible", timeout: 30_000 })
  const tourOverlay = page.getByTestId("tour-overlay")
  if (await tourOverlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) await page.keyboard.press("Escape")
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "VoIP")
}

await mkdir(outputDirectory, { recursive: true })
const report = { generatedAt: new Date().toISOString(), commit, targetHost: hostname, demoOrganization, role: "agent", locale, theme, viewport: viewportName, results: [] }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ baseURL: baseUrl, viewport: viewports[viewportName], locale, colorScheme: theme, reducedMotion: "reduce", hasTouch: viewportName !== "desktop" })
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[voip-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `voip-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `voip-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
try {
  await authenticate(context)

  await recordStep(page, "history-load-failure-and-recovery", async () => {
    const pattern = "**/api/v1/calls**"
    const deny = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === "GET" && url.pathname === "/api/v1/calls") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic history failure" }) })
      else await route.continue()
    }
    await page.route(pattern, deny)
    await page.goto("/support/voip", { waitUntil: "domcontentloaded" })
    await page.getByTestId("voip-load-error").waitFor({ state: "visible" })
    await page.unroute(pattern, deny)
    await page.getByTestId("voip-retry-load").focus()
    await page.getByTestId("voip-retry-load").press("Enter")
    await page.getByTestId("voip-workspace").waitFor({ state: "visible" })
    return { errorObserved: true, keyboardRetry: true, recoverySucceeded: true }
  })

  await recordStep(page, "stale-refresh-and-recovery", async () => {
    await openWorkspace(page)
    const summary = await page.getByTestId("voip-summary").innerText()
    const pattern = "**/api/v1/calls**"
    const deny = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === "GET" && url.pathname === "/api/v1/calls") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic refresh failure" }) })
      else await route.continue()
    }
    await page.route(pattern, deny)
    await page.getByTestId("voip-refresh-calls").click()
    await page.getByTestId("voip-refresh-error").waitFor({ state: "visible" })
    if (await page.getByTestId("voip-summary").innerText() !== summary) throw new Error("refresh_failure_discarded_summary")
    await page.unroute(pattern, deny)
    await page.getByTestId("voip-retry-refresh").click()
    await page.getByTestId("voip-refresh-error").waitFor({ state: "hidden" })
    return { staleSnapshotPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "connection-failure-and-recovery", async () => {
    const pattern = "**/api/v1/calls/providers"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic provider failure" }) })
    await page.route(pattern, deny)
    await openWorkspace(page)
    await page.waitForFunction(() => document.querySelector("[data-testid='voip-connection-state']")?.getAttribute("data-state") === "error")
    await page.unroute(pattern, deny)
    await page.getByTestId("voip-retry-connection").click()
    await page.waitForFunction(() => ["configured", "not_configured"].includes(document.querySelector("[data-testid='voip-connection-state']")?.getAttribute("data-state") || ""))
    return { errorObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "debounced-no-results-and-reset", async () => {
    await openWorkspace(page)
    const pattern = "**/api/v1/calls**"
    let requestCount = 0
    const count = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === "GET" && url.pathname === "/api/v1/calls") requestCount += 1
      await route.continue()
    }
    await page.route(pattern, count)
    await page.getByTestId("voip-search").pressSequentially("zzzzz", { delay: 20 })
    await page.getByTestId("voip-no-results").waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(450)
    if (requestCount !== 1) throw new Error(`raw_keystrokes_requested_${requestCount}_times`)
    await page.getByTestId("voip-clear-filters").click()
    await page.getByTestId("voip-no-results").waitFor({ state: "hidden" })
    return { typedCharacters: 5, historyRequests: requestCount, resetSucceeded: true }
  })

  await recordStep(page, "empty-history-and-recovery", async () => {
    const pattern = "**/api/v1/calls**"
    const empty = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== "GET" || url.pathname !== "/api/v1/calls") return route.continue()
      const original = await route.fetch()
      const json = await original.json()
      await route.fulfill({ response: original, json: { ...json, data: [], summary: { total: 0, inbound: 0, outbound: 0, missed: 0, averageDurationSeconds: null, durationSample: 0 }, pagination: { ...json.pagination, total: 0, pages: 1 } } })
    }
    await page.route(pattern, empty)
    await openWorkspace(page)
    await page.getByTestId("voip-empty-state").waitFor({ state: "visible" })
    await page.unroute(pattern, empty)
    await page.getByTestId("voip-refresh-calls").click()
    await page.getByTestId("voip-empty-state").waitFor({ state: "hidden" })
    return { emptyStateObserved: true, recoverySucceeded: true }
  })

  await recordStep(page, "recording-error-keyboard-and-recovery", async () => {
    const callsPattern = "**/api/v1/calls**"
    const mediaPath = "/api/v1/calls/evidence/recording"
    const injectRecording = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== "GET" || url.pathname !== "/api/v1/calls") return route.continue()
      const original = await route.fetch()
      const json = await original.json()
      if (!json.data?.[0]) throw new Error("recording_reference_call_missing")
      json.data[0] = { ...json.data[0], recordingPlaybackUrl: mediaPath }
      await route.fulfill({ response: original, json })
    }
    const mediaPattern = `**${mediaPath}`
    const denyMedia = async (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic media failure" })
    await page.route(callsPattern, injectRecording)
    await page.route(mediaPattern, denyMedia)
    await openWorkspace(page)
    const player = page.getByTestId("call-recording-player").first()
    const audio = page.getByTestId("call-recording-audio").first()
    await audio.focus()
    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.querySelector("[data-testid='call-recording-player']")?.getAttribute("data-state") === "error", null, { timeout: 10_000 })
    await page.unroute(mediaPattern, denyMedia)
    await page.route(mediaPattern, async (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: silentWav() }))
    await player.getByTestId("call-recording-retry").click()
    await page.waitForFunction(() => document.querySelector("[data-testid='call-recording-player']")?.getAttribute("data-state") === "ready", null, { timeout: 10_000 })
    await audio.focus()
    await page.keyboard.press("Space")
    await page.waitForFunction(() => ["playing", "ended"].includes(document.querySelector("[data-testid='call-recording-player']")?.getAttribute("data-state") || ""), null, { timeout: 10_000 })
    return { keyboardControlFocused: true, errorObserved: true, retrySucceeded: true, nativePlaybackStarted: true }
  })

  await recordStep(page, "history-permission-state", async () => {
    const pattern = "**/api/v1/calls**"
    const deny = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === "GET" && url.pathname === "/api/v1/calls") await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic permission denial" }) })
      else await route.continue()
    }
    await page.route(pattern, deny)
    await page.goto("/support/voip", { waitUntil: "domcontentloaded" })
    await page.getByTestId("voip-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("voip-retry-load").count() !== 0) throw new Error("permission_state_offered_misleading_retry")
    assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "VoIP permission state")
    return { permissionObserved: true, misleadingRetryAbsent: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "voip-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 7 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 7, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
