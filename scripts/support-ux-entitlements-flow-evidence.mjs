import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Support Entitlements evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Support Entitlements evidence refuses a non-local host")
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
const entitlementId = requiredEnv("SUPPORT_EVIDENCE_ENTITLEMENT_ID")
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}
const originalNotes = "Synthetic Support UX evidence entitlement"

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/support/entitlements",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("support_entitlements_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/support/entitlements", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='support-entitlements-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Support Entitlements")
}

async function openDetails(page) {
  await openWorkspace(page)
  const trigger = page.locator(`[data-testid='support-entitlement-open-${entitlementId}']:visible`).first()
  await trigger.waitFor({ state: "visible" })
  await trigger.click()
  await page.locator(`[data-testid='support-entitlement-detail-sheet'][data-entitlement-id='${entitlementId}']`).waitFor({ state: "visible" })
  return trigger
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
  console.log(`[support-entitlements-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `support-entitlements-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `support-entitlements-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
let createdMilestoneId = ""
try {
  await authenticate(context)

  await recordStep(page, "load-failure-permission-and-keyboard-recovery", async () => {
    const collectionPattern = "**/api/v1/entitlements"
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic entitlement load failure"))
    await page.route(collectionPattern, deny)
    await page.goto("/support/entitlements", { waitUntil: "domcontentloaded" })
    await page.getByTestId("support-entitlements-load-error").waitFor({ state: "visible" })
    await page.unroute(collectionPattern, deny)
    await page.getByTestId("support-entitlements-load-retry").focus()
    await page.getByTestId("support-entitlements-load-retry").press("Enter")
    await page.locator("[data-testid='support-entitlements-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic entitlement permission denial", 403))
    await page.route(collectionPattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("support-entitlements-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("support-entitlements-load-retry").count() !== 0) throw new Error("entitlement_permission_offered_misleading_retry")
    await page.unroute(collectionPattern, forbid)
    await openWorkspace(page)
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "density-0-1-20-100-and-rule-independence", async () => {
    const collectionPattern = "**/api/v1/entitlements"
    let targetCount = 0
    const density = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      const source = payload.entitlements?.[0]
      if (!source && targetCount > 0) throw new Error("entitlement_density_source_missing")
      const definitions = source ? Array.from({ length: 100 }, (_, index) => ({
        ...source.definitions[index % Math.max(source.definitions.length, 1)],
        id: `density-definition-${index}`,
        name: `Density rule ${index + 1}`,
      })) : []
      const entitlements = Array.from({ length: targetCount }, (_, index) => ({
        ...source,
        id: `density-entitlement-${targetCount}-${index}`,
        companyId: `density-company-${index}`,
        companyName: `${source.companyName} ${index + 1}`,
        definitionCount: definitions.length,
        definitions,
      }))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...payload,
          entitlements,
          totalEntitlements: entitlements.length,
          activeCount: entitlements.length,
        }),
      })
    }
    await page.route(collectionPattern, density)
    const observed = []
    for (const count of [0, 1, 20, 100]) {
      targetCount = count
      await page.goto("/support/entitlements", { waitUntil: "domcontentloaded" })
      if (count === 0) {
        await page.getByTestId("support-entitlements-empty-state").waitFor({ state: "visible" })
      } else {
        await page.locator("[data-testid='support-entitlements-workspace'][data-state='ready']").waitFor({ state: "visible" })
        const rows = page.locator("[data-testid='support-entitlement-row']:visible")
        if (await rows.count() !== count) throw new Error(`entitlement_density_${count}_rendered_incorrectly`)
        const firstHeight = await rows.first().evaluate((node) => node.getBoundingClientRect().height)
        if (firstHeight > 140) throw new Error(`entitlement_density_row_expanded_by_rules_${firstHeight}`)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      if (overflow) throw new Error(`entitlement_density_${count}_horizontal_overflow`)
      observed.push(count)
    }
    return { observed, definitionsPerTerm: 100, horizontalOverflow: false }
  })

  await recordStep(page, "filters-no-results-and-reset", async () => {
    await openWorkspace(page)
    await page.getByTestId("support-entitlements-filter-status").selectOption("cancelled")
    await page.getByTestId("support-entitlements-no-results").waitFor({ state: "visible" })
    await page.getByTestId("support-entitlements-reset-filters").focus()
    await page.getByTestId("support-entitlements-reset-filters").press("Enter")
    await page.locator(`[data-testid='support-entitlement-row'][data-entitlement-id='${entitlementId}']:visible`).waitFor({ state: "visible" })
    return { combinedToolbarUsed: true, noResultsObserved: true, keyboardReset: true }
  })

  await recordStep(page, "detail-context-focus-and-lifecycle-rollback", async () => {
    const trigger = await openDetails(page)
    await page.getByTestId("support-entitlement-milestone-summary").waitFor({ state: "visible" })
    await page.getByTestId("support-entitlement-lifecycle-suspend").click()
    const reason = "Disposable evidence suspension"
    await page.getByTestId("support-entitlement-lifecycle-reason").fill(reason)
    const itemPattern = `**/api/v1/entitlements/${entitlementId}`
    const denyPatch = async (route) => route.request().method() === "PATCH"
      ? route.fulfill(jsonFailure("Synthetic lifecycle failure"))
      : route.continue()
    await page.route(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-lifecycle-confirm").click()
    await page.getByTestId("support-entitlement-lifecycle-error").waitFor({ state: "visible" })
    if (await page.getByTestId("support-entitlement-lifecycle-reason").inputValue() !== reason) throw new Error("lifecycle_failure_discarded_reason")
    await page.unroute(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-lifecycle-confirm").click()
    await page.getByTestId("support-entitlement-lifecycle-dialog").waitFor({ state: "hidden" })
    await page.getByTestId("support-entitlement-lifecycle-resume").waitFor({ state: "visible" })
    await page.keyboard.press("Escape")
    await page.getByTestId("support-entitlement-detail-sheet").waitFor({ state: "hidden" })
    await page.waitForFunction((id) => document.activeElement?.getAttribute("data-testid") === `support-entitlement-open-${id}`, entitlementId)
    if (!await trigger.isFocused()) throw new Error("entitlement_detail_focus_not_restored")
    return { summaryFirst: true, reasonPreserved: true, lifecycleRollback: true, suspendedForDisposableChecks: true, focusRestored: true }
  })

  await recordStep(page, "edit-failure-value-retention-and-recovery", async () => {
    await openDetails(page)
    await page.getByTestId("support-entitlement-edit").click()
    await page.getByTestId("support-entitlement-form").waitFor({ state: "visible" })
    const changedNotes = "Disposable edited evidence note"
    await page.locator("#entitlement-notes").fill(changedNotes)
    const itemPattern = `**/api/v1/entitlements/${entitlementId}`
    const denyPatch = async (route) => route.request().method() === "PATCH"
      ? route.fulfill(jsonFailure("Synthetic support term save failure"))
      : route.continue()
    await page.route(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-submit").focus()
    await page.getByTestId("support-entitlement-submit").press("Enter")
    await page.getByTestId("support-entitlement-form-error").waitFor({ state: "visible" })
    if (await page.locator("#entitlement-notes").inputValue() !== changedNotes) throw new Error("entitlement_save_failure_discarded_values")
    await page.unroute(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-submit").click()
    await page.getByTestId("support-entitlement-form").waitFor({ state: "hidden" })
    await page.getByTestId("support-entitlement-detail-sheet").waitFor({ state: "visible" })
    return { keyboardSubmit: true, valuesPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "milestone-failure-retry-and-cleanup", async () => {
    await openDetails(page)
    await page.getByTestId("support-entitlement-manage-milestones").click()
    await page.getByTestId("support-entitlement-milestone-editor").waitFor({ state: "visible" })
    await page.getByTestId("support-entitlement-milestone-type").selectOption("problem_identified")
    await page.getByTestId("support-entitlement-milestone-severity").selectOption("critical")
    const milestoneName = "Disposable evidence milestone"
    await page.locator("#milestone-name").fill(milestoneName)
    const collectionPattern = `**/api/v1/entitlements/${entitlementId}/milestones`
    const denyPost = async (route) => route.request().method() === "POST"
      ? route.fulfill(jsonFailure("Synthetic milestone save failure"))
      : route.continue()
    await page.route(collectionPattern, denyPost)
    await page.getByTestId("support-entitlement-milestone-submit").click()
    await page.getByTestId("support-entitlement-detail-error").waitFor({ state: "visible" })
    if (await page.locator("#milestone-name").inputValue() !== milestoneName) throw new Error("milestone_save_failure_discarded_values")
    await page.unroute(collectionPattern, denyPost)
    await page.getByTestId("support-entitlement-milestone-submit").click()
    const created = page.getByTestId("support-entitlement-milestone-row").filter({ hasText: milestoneName }).first()
    await created.waitFor({ state: "visible" })
    createdMilestoneId = await created.getAttribute("data-milestone-id") || ""
    if (!createdMilestoneId) throw new Error("created_milestone_id_missing")

    const itemPattern = `**/api/v1/entitlements/${entitlementId}/milestones/${createdMilestoneId}`
    const denyDelete = async (route) => route.request().method() === "DELETE"
      ? route.fulfill(jsonFailure("Synthetic milestone delete failure"))
      : route.continue()
    await page.route(itemPattern, denyDelete)
    await page.getByTestId(`support-entitlement-milestone-delete-${createdMilestoneId}`).click()
    const confirmation = page.getByRole("dialog").last()
    await confirmation.locator("button").last().click()
    await confirmation.getByRole("alert").waitFor({ state: "visible" })
    if (await created.count() === 0) throw new Error("milestone_delete_failure_removed_definition")
    await page.unroute(itemPattern, denyDelete)
    await confirmation.locator("button").last().click()
    await confirmation.waitFor({ state: "hidden" })
    await created.waitFor({ state: "hidden" })
    return { lazyEditorObserved: true, valuesPreserved: true, createRetrySucceeded: true, deleteRollback: true, disposableFixtureRemoved: true }
  })

  await recordStep(page, "fixture-restore-and-resume-recovery", async () => {
    await openDetails(page)
    await page.getByTestId("support-entitlement-edit").click()
    await page.locator("#entitlement-notes").fill(originalNotes)
    await page.getByTestId("support-entitlement-submit").click()
    await page.getByTestId("support-entitlement-detail-sheet").waitFor({ state: "visible" })
    await page.getByTestId("support-entitlement-lifecycle-resume").click()
    const reason = "Restore synthetic fixture to active"
    await page.getByTestId("support-entitlement-lifecycle-reason").fill(reason)
    const itemPattern = `**/api/v1/entitlements/${entitlementId}`
    const denyPatch = async (route) => route.request().method() === "PATCH"
      ? route.fulfill(jsonFailure("Synthetic resume failure"))
      : route.continue()
    await page.route(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-lifecycle-confirm").click()
    await page.getByTestId("support-entitlement-lifecycle-error").waitFor({ state: "visible" })
    if (await page.getByTestId("support-entitlement-lifecycle-reason").inputValue() !== reason) throw new Error("resume_failure_discarded_reason")
    await page.unroute(itemPattern, denyPatch)
    await page.getByTestId("support-entitlement-lifecycle-confirm").click()
    await page.getByTestId("support-entitlement-lifecycle-dialog").waitFor({ state: "hidden" })
    await page.getByTestId("support-entitlement-lifecycle-suspend").waitFor({ state: "visible" })
    return { notesRestored: true, resumeRollback: true, retrySucceeded: true, entitlementRestoredActive: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "support-entitlements-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 7 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 7, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
