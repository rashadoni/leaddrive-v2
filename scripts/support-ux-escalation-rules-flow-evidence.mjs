import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Escalation Rules flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Escalation Rules flow evidence refuses a non-local host")
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

function rule(index, overrides = {}) {
  return {
    id: `escalation-evidence-${index}`,
    name: `Escalation evidence rule ${index + 1}`,
    triggerType: index % 3 === 2 ? "resolution_warning" : index % 3 === 1 ? "resolution_breach" : "first_response_breach",
    triggerMinutes: (index % 8) * 30,
    level: (index % 5) + 1,
    actions: [{ type: "notify", target: index % 2 === 0 ? "manager" : "admin" }],
    isActive: index % 4 !== 3,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    ...overrides,
  }
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) }
}

function payload(rules, canWrite = true) {
  return { success: true, data: rules, permissions: { canWrite } }
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/settings/escalation",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("escalation_rules_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/escalation", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='escalation-rules-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Escalation Rules")
}

function installRuleApi(page, initialRules, options = {}) {
  let rules = structuredClone(initialRules)
  let patchAttempts = 0
  let deleteAttempts = 0
  const pattern = "**/api/v1/escalation-rules**"
  const handler = async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const id = decodeURIComponent(url.pathname.split("/").pop() || "")
    if (method === "GET") return route.fulfill(json(payload(rules, options.canWrite !== false)))
    if (method === "POST") {
      const body = request.postDataJSON()
      const created = { ...body, id: `escalation-created-${rules.length}`, createdAt: new Date().toISOString() }
      rules = [...rules, created]
      return route.fulfill(json({ success: true, data: created }, 201))
    }
    if (method === "PATCH") {
      patchAttempts += 1
      if (options.failFirstPatch && patchAttempts === 1) return route.fulfill(json({ success: false, error: "Synthetic escalation save failure" }, 503))
      const body = request.postDataJSON()
      rules = rules.map((item) => item.id === id ? { ...item, ...body } : item)
      return route.fulfill(json({ success: true, data: rules.find((item) => item.id === id) }))
    }
    if (method === "DELETE") {
      deleteAttempts += 1
      if (options.failFirstDelete && deleteAttempts === 1) return route.fulfill(json({ success: false, error: "Synthetic escalation delete failure" }, 503))
      rules = rules.filter((item) => item.id !== id)
      return route.fulfill(json({ success: true, data: { deleted: id } }))
    }
    return route.abort()
  }
  return page.route(pattern, handler)
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
  console.log(`[escalation-rules-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `escalation-rules-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `escalation-rules-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
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
    const pattern = "**/api/v1/escalation-rules**"
    const fail = async (route) => route.fulfill(json({ success: false, error: "Synthetic escalation load failure" }, 503))
    await page.route(pattern, fail)
    await page.goto("/settings/escalation", { waitUntil: "domcontentloaded" })
    await page.getByTestId("escalation-rules-error").waitFor({ state: "visible" })
    await page.unroute(pattern, fail)
    await installRuleApi(page, [rule(0)])
    await page.getByTestId("escalation-rules-retry").focus()
    await page.getByTestId("escalation-rules-retry").press("Enter")
    await page.locator("[data-testid='escalation-rules-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })

    const forbid = async (route) => route.fulfill(json({ success: false, error: "Synthetic escalation permission denial" }, 403))
    await page.route(pattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='escalation-rules-error'][data-retryable='false']").waitFor({ state: "visible" })
    if (await page.getByTestId("escalation-rules-retry").count() !== 0) throw new Error("escalation_permission_offered_misleading_retry")
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "read-only-permission-suppresses-mutations", async () => {
    await installRuleApi(page, [rule(0)], { canWrite: false })
    await openWorkspace(page)
    await page.getByTestId("escalation-rules-read-only").waitFor({ state: "visible" })
    for (const selector of ["escalation-rule-toggle", "escalation-rule-edit", "escalation-rule-duplicate", "escalation-rule-delete"]) {
      if (await page.getByTestId(selector).count() !== 0) throw new Error(`read_only_exposed_${selector}`)
    }
    return { readOnlyStateObserved: true, mutationsSuppressed: true }
  })

  await recordStep(page, "empty-filter-and-forty-rule-density", async () => {
    await installRuleApi(page, [])
    await openWorkspace(page)
    await page.getByTestId("escalation-rules-empty").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })
    await installRuleApi(page, Array.from({ length: 40 }, (_, index) => rule(index)))
    await openWorkspace(page)
    if (await page.getByTestId("escalation-rule-row").count() !== 40) throw new Error("escalation_density_row_count_mismatch")
    await page.getByTestId("escalation-rules-search").fill("no matching escalation rule")
    await page.getByTestId("escalation-rules-filter-empty").waitFor({ state: "visible" })
    await page.getByTestId("escalation-rules-reset-filters").click()
    if (await page.getByTestId("escalation-rule-row").count() !== 40) throw new Error("escalation_filter_reset_failed")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("escalation_density_horizontal_overflow")
    return { emptyObserved: true, rules: 40, filteredEmptyObserved: true, resetRecovered: true, horizontalOverflow: false }
  })

  await recordStep(page, "edit-failure-retains-draft-and-focus", async () => {
    const original = rule(0)
    await installRuleApi(page, [original], { failFirstPatch: true })
    await openWorkspace(page)
    const edit = page.locator(`[data-rule-id='${original.id}']`).getByTestId("escalation-rule-edit")
    await edit.focus()
    await edit.press("Enter")
    const name = page.getByTestId("escalation-rule-name")
    await name.fill("Recovered escalation draft")
    await page.getByTestId("escalation-rule-save").click()
    await page.getByTestId("escalation-rule-form").getByRole("alert").waitFor({ state: "visible" })
    if (await name.inputValue() !== "Recovered escalation draft") throw new Error("escalation_failed_edit_lost_draft")
    await page.getByTestId("escalation-rule-save").click()
    await page.getByTestId("escalation-rule-dialog").waitFor({ state: "hidden" })
    await page.locator(`[data-rule-id='${original.id}']`).getByText("Recovered escalation draft").waitFor({ state: "visible" })
    await edit.focus()
    await edit.press("Enter")
    await page.keyboard.press("Escape")
    if (!await edit.isFocused()) throw new Error("escalation_dialog_focus_not_restored")
    return { keyboardEdit: true, draftRetainedAfterFailure: true, retrySucceeded: true, focusRestored: true }
  })

  await recordStep(page, "duplicate-conflict-block-and-safe-create", async () => {
    const original = rule(0)
    await installRuleApi(page, [original])
    await openWorkspace(page)
    await page.locator(`[data-rule-id='${original.id}']`).getByTestId("escalation-rule-duplicate").click()
    const active = page.getByTestId("escalation-rule-form-active")
    if (await active.getAttribute("aria-checked") !== "false") throw new Error("escalation_duplicate_not_inactive")
    await active.click()
    await page.getByTestId("escalation-rule-conflict").waitFor({ state: "visible" })
    if (!await page.getByTestId("escalation-rule-save").isDisabled()) throw new Error("escalation_conflict_did_not_block_save")
    await active.click()
    await page.getByTestId("escalation-rule-save").click()
    await page.getByTestId("escalation-rule-dialog").waitFor({ state: "hidden" })
    if (await page.getByTestId("escalation-rule-row").count() !== 2) throw new Error("escalation_safe_duplicate_not_created")
    return { duplicateInactiveByDefault: true, conflictWarned: true, conflictBlocked: true, safeDuplicateCreated: true }
  })

  await recordStep(page, "toggle-rollback-and-delete-recovery", async () => {
    const original = rule(0)
    await installRuleApi(page, [original], { failFirstPatch: true, failFirstDelete: true })
    await openWorkspace(page)
    const row = page.locator(`[data-rule-id='${original.id}']`)
    const toggle = row.getByTestId("escalation-rule-toggle")
    await toggle.click()
    await page.locator("[data-testid='escalation-rules-status'][data-kind='error']").waitFor({ state: "visible" })
    if (await toggle.getAttribute("aria-checked") !== "true") throw new Error("escalation_toggle_failure_did_not_roll_back")
    await toggle.click()
    await page.locator("[data-testid='escalation-rules-status'][data-kind='success']").waitFor({ state: "visible" })
    await row.getByTestId("escalation-rule-delete").click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button").last().click()
    await dialog.getByRole("alert").waitFor({ state: "visible" })
    if (!await dialog.isVisible()) throw new Error("escalation_failed_delete_closed_confirmation")
    await dialog.getByRole("button").last().click()
    await dialog.waitFor({ state: "hidden" })
    if (await page.locator(`[data-rule-id='${original.id}']`).count() !== 0) throw new Error("escalation_delete_retry_failed")
    return { toggleRollback: true, toggleRetry: true, deleteFailureRetainedDialog: true, deleteRetrySucceeded: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "escalation-rules-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
