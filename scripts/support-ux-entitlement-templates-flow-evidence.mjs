import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Entitlement Templates evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Entitlement Templates evidence refuses a non-local host")
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
      callbackUrl: baseUrl + "/settings/entitlement-templates",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("entitlement_templates_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/entitlement-templates", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='entitlement-templates-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Entitlement Templates")
}

function jsonFailure(message, status = 503) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: false, error: message }) }
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
  console.log(`[entitlement-templates-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `entitlement-templates-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `entitlement-templates-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
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
    const collectionPattern = "**/api/v1/entitlement-templates"
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic template load failure"))
    await page.route(collectionPattern, deny)
    await page.goto("/settings/entitlement-templates", { waitUntil: "domcontentloaded" })
    await page.getByTestId("entitlement-templates-load-error").waitFor({ state: "visible" })
    await page.unroute(collectionPattern, deny)
    await page.getByTestId("entitlement-templates-load-retry").focus()
    await page.getByTestId("entitlement-templates-load-retry").press("Enter")
    await page.locator("[data-testid='entitlement-templates-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic template permission denial", 403))
    await page.route(collectionPattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("entitlement-templates-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("entitlement-templates-load-retry").count() !== 0) throw new Error("template_permission_offered_misleading_retry")
    await page.unroute(collectionPattern, forbid)
    await openWorkspace(page)
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "read-only-permission-state-and-recovery", async () => {
    const collectionPattern = "**/api/v1/entitlement-templates"
    const readOnly = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, permissions: { canWrite: false } }) })
    }
    await page.route(collectionPattern, readOnly)
    await page.goto("/settings/entitlement-templates", { waitUntil: "domcontentloaded" })
    const workspace = page.locator("[data-testid='entitlement-templates-workspace'][data-state='ready'][data-permission='read-only']")
    await workspace.waitFor({ state: "visible" })
    if (!await page.locator("#template-name").isDisabled()) throw new Error("template_read_only_name_remained_editable")
    if (await page.getByTestId("entitlement-template-add-rule").count() !== 0) throw new Error("template_read_only_add_rule_visible")
    if (await page.getByTestId("entitlement-template-save").count() !== 0) throw new Error("template_read_only_save_visible")
    await page.unroute(collectionPattern, readOnly)
    await openWorkspace(page)
    return { readOnlyObserved: true, editorDisabled: true, mutationControlsAbsent: true, recoverySucceeded: true }
  })

  await recordStep(page, "rule-density-0-1-30-and-preview", async () => {
    const collectionPattern = "**/api/v1/entitlement-templates"
    let targetCount = 0
    const density = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      const templates = payload.templates.map((template) => {
        if (template.supportLevel !== "standard") return template
        const source = template.definitions[0]
        const definitions = Array.from({ length: targetCount }, (_, index) => ({
          ...source,
          id: `density-template-rule-${targetCount}-${index}`,
          name: `Density rule ${index + 1}`,
          sortOrder: index * 10,
        }))
        return { ...template, isActive: targetCount > 0, definitions }
      })
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, templates }) })
    }
    await page.route(collectionPattern, density)
    const observed = []
    for (const count of [0, 1, 30]) {
      targetCount = count
      await page.goto("/settings/entitlement-templates", { waitUntil: "domcontentloaded" })
      await page.locator("[data-testid='entitlement-templates-workspace'][data-state='ready']").waitFor({ state: "visible" })
      if (count === 0) {
        await page.getByTestId("entitlement-template-empty-rules").waitFor({ state: "visible" })
      } else {
        const rows = page.getByTestId("entitlement-template-rule")
        if (await rows.count() !== count) throw new Error(`template_density_${count}_rendered_incorrectly`)
        const firstHeight = await rows.first().evaluate((node) => node.getBoundingClientRect().height)
        if (firstHeight > 80) throw new Error(`template_density_row_not_compact_${firstHeight}`)
      }
      if (await page.getByTestId("entitlement-template-rule-editor").count() !== 0) throw new Error("template_density_mounted_permanent_rule_editor")
      await page.getByTestId("entitlement-template-preview").waitFor({ state: "visible" })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      if (overflow) throw new Error(`template_density_${count}_horizontal_overflow`)
      observed.push(count)
    }
    return { observed, progressiveEditors: true, previewObserved: true, horizontalOverflow: false }
  })

  await recordStep(page, "draft-level-switch-and-route-recovery", async () => {
    await openWorkspace(page)
    const original = await page.locator("#template-description").inputValue()
    const changed = "Disposable local draft for route recovery"
    await page.locator("#template-description").fill(changed)
    await page.locator("[data-testid='entitlement-template-save-bar'][data-dirty='true']").waitFor({ state: "visible" })
    await page.getByTestId("entitlement-template-tab-premium").click()
    await page.locator("[data-testid='entitlement-template-tab-standard'][data-draft='true']").waitFor({ state: "visible" })
    await page.getByTestId("entitlement-template-tab-standard").click()
    if (await page.locator("#template-description").inputValue() !== changed) throw new Error("template_level_switch_discarded_draft")
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='entitlement-templates-workspace'][data-state='ready']").waitFor({ state: "visible" })
    if (await page.locator("#template-description").inputValue() !== changed) throw new Error("template_route_reload_discarded_draft")
    await page.getByTestId("entitlement-template-discard").click()
    if (await page.locator("#template-description").inputValue() !== original) throw new Error("template_discard_failed_to_restore_baseline")
    return { crossLevelDraftIndicator: true, levelRecovery: true, routeRecovery: true, discardRestored: true }
  })

  await recordStep(page, "validation-keyboard-reorder-and-delete-discard", async () => {
    await openWorkspace(page)
    const rows = page.getByTestId("entitlement-template-rule")
    if (await rows.count() < 2) throw new Error("template_reorder_fixture_requires_two_rules")
    const firstKey = await rows.nth(0).getAttribute("data-rule-key")
    const secondKey = await rows.nth(1).getAttribute("data-rule-key")
    if (!firstKey || !secondKey) throw new Error("template_rule_keys_missing")
    await page.getByTestId(`entitlement-template-rule-down-${firstKey}`).focus()
    await page.getByTestId(`entitlement-template-rule-down-${firstKey}`).press("Space")
    if (await rows.nth(0).getAttribute("data-rule-key") !== secondKey) throw new Error("template_keyboard_reorder_failed")
    await page.locator("#template-name").fill("")
    if (!await page.getByTestId("entitlement-template-save").isDisabled()) throw new Error("template_invalid_draft_remained_saveable")
    await page.getByTestId("entitlement-template-status").waitFor({ state: "visible" })
    await page.getByTestId("entitlement-template-discard").click()

    const restoredRows = page.getByTestId("entitlement-template-rule")
    const beforeDelete = await restoredRows.count()
    const deleteKey = await restoredRows.first().getAttribute("data-rule-key")
    if (!deleteKey) throw new Error("template_delete_rule_key_missing")
    await page.getByTestId(`entitlement-template-rule-delete-${deleteKey}`).click()
    const confirmation = page.getByRole("dialog").last()
    await confirmation.locator("button").last().click()
    await confirmation.waitFor({ state: "hidden" })
    if (await restoredRows.count() !== beforeDelete - 1) throw new Error("template_delete_did_not_update_draft")
    await page.getByTestId("entitlement-template-discard").click()
    if (await restoredRows.count() !== beforeDelete) throw new Error("template_delete_discard_did_not_restore_rule")
    return { keyboardReorder: true, validationReasonObserved: true, destructiveConfirmation: true, discardRestored: true }
  })

  await recordStep(page, "save-failure-value-retention-retry-and-restore", async () => {
    await openWorkspace(page)
    const original = await page.locator("#template-description").inputValue()
    const changed = "Disposable saved recovery evidence"
    await page.locator("#template-description").fill(changed)
    const collectionPattern = "**/api/v1/entitlement-templates"
    const denyPut = async (route) => route.request().method() === "PUT"
      ? route.fulfill(jsonFailure("Synthetic template save failure"))
      : route.continue()
    await page.route(collectionPattern, denyPut)
    await page.getByTestId("entitlement-template-save").focus()
    await page.getByTestId("entitlement-template-save").press("Enter")
    await page.getByTestId("entitlement-templates-save-error").waitFor({ state: "visible" })
    if (await page.locator("#template-description").inputValue() !== changed) throw new Error("template_save_failure_discarded_values")
    await page.unroute(collectionPattern, denyPut)
    await page.getByTestId("entitlement-template-save").click()
    await page.locator("[data-testid='entitlement-template-save-bar'][data-dirty='false']").waitFor({ state: "visible" })
    await page.locator("#template-description").fill(original)
    await page.getByTestId("entitlement-template-save").click()
    await page.locator("[data-testid='entitlement-template-save-bar'][data-dirty='false']").waitFor({ state: "visible" })
    return { keyboardSubmit: true, valuesPreserved: true, retrySucceeded: true, fixtureRestored: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "entitlement-templates-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
