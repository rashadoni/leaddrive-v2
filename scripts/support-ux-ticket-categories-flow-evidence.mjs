import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Ticket Categories evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Ticket Categories evidence refuses a non-local host")
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
const categoryId = requiredEnv("SUPPORT_EVIDENCE_TICKET_CATEGORY_ID")
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/settings/ticket-categories",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("ticket_categories_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/ticket-categories", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='ticket-categories-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Ticket Categories")
}

function jsonFailure(message, status = 503) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: false, error: message }) }
}

function categoryRow(page) {
  return page.locator(`[data-testid='ticket-category-row'][data-category-id='${categoryId}']`)
}

async function openCategoryAction(page, action) {
  await page.getByTestId(`ticket-category-actions-${categoryId}`).click()
  await page.getByTestId(`ticket-category-${action}-${categoryId}`).click()
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
  console.log(`[ticket-categories-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `ticket-categories-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `ticket-categories-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
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
    const listPattern = /\/api\/v1\/ticket-categories\?/
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic category load failure"))
    await page.route(listPattern, deny)
    await page.goto("/settings/ticket-categories", { waitUntil: "domcontentloaded" })
    await page.getByTestId("ticket-categories-load-error").waitFor({ state: "visible" })
    await page.unroute(listPattern, deny)
    await page.getByTestId("ticket-categories-load-retry").focus()
    await page.getByTestId("ticket-categories-load-retry").press("Enter")
    await page.locator("[data-testid='ticket-categories-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic permission denial", 403))
    await page.route(listPattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("ticket-categories-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("ticket-categories-load-retry").count() !== 0) throw new Error("category_permission_offered_misleading_retry")
    await page.unroute(listPattern, forbid)
    await openWorkspace(page)
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "empty-state-and-recovery", async () => {
    const listPattern = /\/api\/v1\/ticket-categories\?/
    const empty = async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { categories: [], tree: [], total: 0 } }),
    })
    await page.route(listPattern, empty)
    await openWorkspace(page)
    await page.getByTestId("ticket-categories-empty-state").waitFor({ state: "visible" })
    await page.getByTestId("ticket-categories-empty-create").waitFor({ state: "visible" })
    await page.unroute(listPattern, empty)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("ticket-categories-tree").waitFor({ state: "visible" })
    return { emptyStateObserved: true, createPathPresent: true, recoverySucceeded: true }
  })

  await recordStep(page, "filters-no-results-and-reset", async () => {
    await openWorkspace(page)
    await page.getByTestId("ticket-categories-search").fill("no-result-support-evidence")
    await page.getByTestId("ticket-categories-empty-state").waitFor({ state: "visible" })
    await page.getByTestId("ticket-categories-clear-filters").click()
    await categoryRow(page).waitFor({ state: "visible" })
    if (await page.getByTestId("ticket-categories-search").inputValue() !== "") throw new Error("category_filter_reset_failed")
    return { noResultsObserved: true, resetSucceeded: true }
  })

  await recordStep(page, "hierarchy-keyboard-and-forced-context", async () => {
    await openWorkspace(page)
    const toggle = page.getByTestId(`ticket-category-toggle-${categoryId}`)
    await toggle.focus()
    await toggle.press("Space")
    if (await toggle.getAttribute("aria-expanded") !== "false") throw new Error("category_tree_keyboard_collapse_failed")
    await toggle.press("Space")
    if (await toggle.getAttribute("aria-expanded") !== "true") throw new Error("category_tree_keyboard_expand_failed")
    await toggle.press("Space")
    await page.getByTestId("ticket-categories-search").fill("Sign-in troubleshooting")
    if (await toggle.getAttribute("aria-expanded") !== "true" || !await toggle.isDisabled()) throw new Error("category_tree_forced_context_failed")
    if (await page.getByTestId("ticket-category-row").count() < 2) throw new Error("category_tree_missing_parent_context")
    await page.getByTestId("ticket-categories-clear-filters").click()
    return { keyboardDisclosure: true, forcedAncestorContext: true }
  })

  await recordStep(page, "editor-advanced-and-discard-guard", async () => {
    await openWorkspace(page)
    await openCategoryAction(page, "edit")
    const editor = page.getByTestId("ticket-category-editor")
    await editor.waitFor({ state: "visible" })
    const advanced = page.getByTestId("ticket-category-advanced-toggle")
    if (await advanced.getAttribute("aria-expanded") !== "false") throw new Error("advanced_options_open_by_default")
    await advanced.focus()
    await advanced.press("Enter")
    if (await advanced.getAttribute("aria-expanded") !== "true") throw new Error("advanced_options_keyboard_open_failed")
    const originalName = await page.locator("#category-name").inputValue()
    await page.locator("#category-name").fill(`${originalName} temporary`)
    await page.keyboard.press("Escape")
    const discard = page.getByRole("dialog").last()
    await discard.locator("button").last().click()
    await editor.waitFor({ state: "hidden" })
    if ((await categoryRow(page).innerText()).includes("temporary")) throw new Error("discard_guard_persisted_unsaved_value")
    return { progressiveDisclosure: true, keyboardOpen: true, discardGuard: true }
  })

  await recordStep(page, "save-failure-value-retention-and-focus-return", async () => {
    await openWorkspace(page)
    await openCategoryAction(page, "edit")
    const originalName = await page.locator("#category-name").inputValue()
    const itemPattern = `**/api/v1/ticket-categories/${categoryId}`
    const denyPatch = async (route) => route.request().method() === "PATCH"
      ? route.fulfill(jsonFailure("Synthetic category save failure"))
      : route.continue()
    await page.route(itemPattern, denyPatch)
    await page.getByTestId("ticket-category-save").focus()
    await page.getByTestId("ticket-category-save").press("Enter")
    await page.getByTestId("ticket-category-save-error").waitFor({ state: "visible" })
    if (await page.locator("#category-name").inputValue() !== originalName) throw new Error("category_save_failure_discarded_values")
    await page.unroute(itemPattern, denyPatch)
    await page.getByTestId("ticket-category-save").click()
    await page.getByTestId("ticket-category-editor").waitFor({ state: "hidden" })
    await categoryRow(page).waitFor({ state: "visible" })
    if (!await categoryRow(page).evaluate((element) => document.activeElement === element)) throw new Error("category_save_focus_not_restored")
    return { keyboardSubmit: true, valueRetention: true, retrySucceeded: true, focusRestored: true }
  })

  await recordStep(page, "deactivate-rollback-restore-and-focus", async () => {
    await openWorkspace(page)
    const itemPattern = `**/api/v1/ticket-categories/${categoryId}`
    const denyDelete = async (route) => route.request().method() === "DELETE"
      ? route.fulfill(jsonFailure("Synthetic category deactivation failure"))
      : route.continue()
    await page.route(itemPattern, denyDelete)
    await openCategoryAction(page, "deactivate")
    const confirmation = page.getByRole("dialog")
    await confirmation.locator("button").last().click()
    await confirmation.getByRole("alert").waitFor({ state: "visible" })
    if (await categoryRow(page).getAttribute("data-active") !== "true") throw new Error("deactivation_failure_changed_state")
    await page.unroute(itemPattern, denyDelete)
    await confirmation.locator("button").last().click()
    await confirmation.waitFor({ state: "hidden" })
    await page.locator(`[data-testid='ticket-category-row'][data-category-id='${categoryId}'][data-active='false']`).waitFor({ state: "visible" })
    if (!await categoryRow(page).evaluate((element) => document.activeElement === element)) throw new Error("deactivation_focus_not_restored")

    const denyRestore = async (route) => route.request().method() === "PATCH"
      ? route.fulfill(jsonFailure("Synthetic category restore failure"))
      : route.continue()
    await page.route(itemPattern, denyRestore)
    await openCategoryAction(page, "restore")
    await page.getByTestId("ticket-categories-action-error").waitFor({ state: "visible" })
    if (await categoryRow(page).getAttribute("data-active") !== "false") throw new Error("restore_failure_changed_state")
    await page.unroute(itemPattern, denyRestore)
    await openCategoryAction(page, "restore")
    await page.locator(`[data-testid='ticket-category-row'][data-category-id='${categoryId}'][data-active='true']`).waitFor({ state: "visible" })
    if (!await categoryRow(page).evaluate((element) => document.activeElement === element)) throw new Error("restore_focus_not_restored")
    return { deactivationRollback: true, impactConfirmation: true, restoreRollback: true, fixtureRestored: true, focusRestored: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "ticket-categories-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 7 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 7, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
