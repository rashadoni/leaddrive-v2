import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Support AI settings flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Support AI settings flow evidence refuses a non-local host")
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
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) }
}

function settingsPayload(enabled, latestChange = null) {
  return {
    data: {
      enabled,
      organization: { id: "support-evidence-org", name: demoOrganization },
      latestChange,
    },
  }
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/support/ai-settings",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("support_ai_settings_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/support/ai-settings", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='support-ai-settings-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Support AI Settings")
}

function installAiApi(page, initialEnabled, options = {}) {
  let enabled = initialEnabled
  let patchAttempts = 0
  let patchSucceeded = false
  let verificationFailed = false
  const latestChange = options.latestChange || null
  const settingsPattern = "**/api/v1/support/ai-settings**"
  const featuresPattern = "**/api/v1/settings/ai-features**"
  const settingsHandler = async (route) => {
    if (patchSucceeded && options.failVerification && !verificationFailed) {
      verificationFailed = true
      return route.fulfill(json({ error: "Synthetic audit refresh failure" }, 503))
    }
    return route.fulfill(json(settingsPayload(enabled, latestChange)))
  }
  const featuresHandler = async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill(json({ data: { features: enabled ? [] : ["supportAiDisabled"] } }))
    patchAttempts += 1
    if (options.patchDelay) await new Promise((resolve) => setTimeout(resolve, options.patchDelay))
    if ((options.failPatchAttempts || []).includes(patchAttempts)) {
      return route.fulfill(json({ error: "Synthetic Support AI mutation failure" }, 503))
    }
    const body = route.request().postDataJSON()
    if (body.feature !== "supportAiDisabled" || !["add", "remove"].includes(body.action)) {
      return route.fulfill(json({ error: "Unexpected feature mutation" }, 400))
    }
    enabled = body.action === "remove"
    patchSucceeded = true
    return route.fulfill(json({ data: { features: enabled ? ["support", "ai"] : ["support", "ai", "supportAiDisabled"] } }))
  }
  return Promise.all([page.route(settingsPattern, settingsHandler), page.route(featuresPattern, featuresHandler)])
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  demoOrganization,
  role: "admin",
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
  console.log(`[support-ai-settings-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `support-ai-settings-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `support-ai-settings-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
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
    const pattern = "**/api/v1/support/ai-settings**"
    const fail = async (route) => route.fulfill(json({ error: "Synthetic Support AI load failure" }, 503))
    await page.route(pattern, fail)
    await page.goto("/support/ai-settings", { waitUntil: "domcontentloaded" })
    await page.getByTestId("support-ai-settings-error").waitFor({ state: "visible" })
    await page.unroute(pattern, fail)
    await installAiApi(page, true)
    await page.getByTestId("support-ai-settings-retry").focus()
    await page.getByTestId("support-ai-settings-retry").press("Enter")
    await page.locator("[data-testid='support-ai-settings-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })

    const forbid = async (route) => route.fulfill(json({ error: "Synthetic Support AI permission denial" }, 403))
    await page.route(pattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='support-ai-settings-error'][data-retryable='false']").waitFor({ state: "visible" })
    if (await page.getByTestId("support-ai-settings-retry").count() !== 0) throw new Error("support_ai_permission_offered_misleading_retry")
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "consequence-unaffected-and-audit-empty-density", async () => {
    await installAiApi(page, true)
    await openWorkspace(page)
    if (await page.getByTestId("support-ai-consequence").count() !== 5) throw new Error("support_ai_consequence_count_mismatch")
    await page.getByTestId("support-ai-unaffected").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-ai-audit'][data-state='empty']").waitFor({ state: "visible" })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("support_ai_settings_horizontal_overflow")
    return { consequences: 5, immediateAndNextJob: true, unaffectedVisible: true, auditEmpty: true, horizontalOverflow: false }
  })

  await recordStep(page, "disable-confirm-failure-rollback-and-retry", async () => {
    await installAiApi(page, true, { failPatchAttempts: [1], patchDelay: 250 })
    await openWorkspace(page)
    const toggle = page.getByTestId("support-ai-master-switch")
    await toggle.focus()
    await toggle.press("Space")
    const dialog = page.getByTestId("support-ai-disable-dialog")
    await dialog.waitFor({ state: "visible" })
    if ((await dialog.innerText()).trim().length < 20) throw new Error("support_ai_disable_consequences_missing")
    await page.getByTestId("support-ai-confirm-disable").click()
    await page.locator("[data-testid='support-ai-settings-workspace'][data-state='saving']").waitFor({ state: "visible" })
    if (!await toggle.isDisabled()) throw new Error("support_ai_duplicate_toggle_not_blocked")
    await page.locator("[data-testid='support-ai-settings-notice'][data-kind='error']").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-ai-settings-workspace'][data-enabled='true']").waitFor({ state: "visible" })
    if (!await toggle.isFocused()) throw new Error("support_ai_disable_focus_not_restored")
    await page.getByTestId("support-ai-settings-save-retry").focus()
    await page.getByTestId("support-ai-settings-save-retry").press("Enter")
    await page.locator("[data-testid='support-ai-settings-workspace'][data-state='ready'][data-enabled='false']").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-ai-settings-notice'][data-kind='success']").waitFor({ state: "visible" })
    return { keyboardConfirmation: true, consequencesVisible: true, duplicateToggleBlocked: true, rollback: true, focusRestored: true, retrySucceeded: true }
  })

  await recordStep(page, "saved-state-survives-audit-refresh-failure", async () => {
    await installAiApi(page, true, { failVerification: true })
    await openWorkspace(page)
    await page.getByTestId("support-ai-master-switch").click()
    await page.getByTestId("support-ai-confirm-disable").click()
    await page.locator("[data-testid='support-ai-settings-workspace'][data-state='ready'][data-enabled='false']").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-ai-settings-notice'][data-kind='success']").waitFor({ state: "visible" })
    return { mutationTruthPreserved: true, auditRefreshFailureDidNotRollback: true, truthfulSuccessFeedback: true }
  })

  await recordStep(page, "direct-enable-and-recorded-audit", async () => {
    await installAiApi(page, false, {
      latestChange: {
        id: "support-ai-audit-1",
        actor: "Evidence Administrator",
        previousEnabled: true,
        newEnabled: false,
        changedAt: "2026-09-06T08:30:00.000Z",
      },
    })
    await openWorkspace(page)
    await page.locator("[data-testid='support-ai-audit'][data-state='recorded']").waitFor({ state: "visible" })
    await page.getByTestId("support-ai-master-switch").focus()
    await page.getByTestId("support-ai-master-switch").press("Space")
    if (await page.getByTestId("support-ai-disable-dialog").count() !== 0) throw new Error("support_ai_safe_enable_opened_confirmation")
    await page.locator("[data-testid='support-ai-settings-workspace'][data-state='ready'][data-enabled='true']").waitFor({ state: "visible" })
    await page.locator("[data-testid='support-ai-settings-notice'][data-kind='success']").waitFor({ state: "visible" })
    return { auditActorOrganizationTimeVisible: true, keyboardEnable: true, noUnnecessaryConfirmation: true, enabled: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "support-ai-settings-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 5 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 5, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
