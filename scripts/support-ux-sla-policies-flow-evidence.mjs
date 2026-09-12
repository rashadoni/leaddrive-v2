import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating SLA Policies evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating SLA Policies evidence refuses a non-local host")
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
const protectedPolicyId = requiredEnv("SUPPORT_EVIDENCE_SLA_POLICY_ID")
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
      callbackUrl: baseUrl + "/settings/sla-policies",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("sla_policies_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/sla-policies", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='sla-policies-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "SLA Policies")
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
  console.log(`[sla-policies-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `sla-policies-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `sla-policies-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
let createdPolicyId = ""
try {
  await authenticate(context)

  await recordStep(page, "load-failure-permission-and-keyboard-recovery", async () => {
    const collectionPattern = "**/api/v1/sla-policies"
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic SLA load failure"))
    await page.route(collectionPattern, deny)
    await page.goto("/settings/sla-policies", { waitUntil: "domcontentloaded" })
    await page.getByTestId("sla-policies-load-error").waitFor({ state: "visible" })
    await page.unroute(collectionPattern, deny)
    await page.getByTestId("sla-policies-load-retry").focus()
    await page.getByTestId("sla-policies-load-retry").press("Enter")
    await page.locator("[data-testid='sla-policies-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic permission denial", 403))
    await page.route(collectionPattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("sla-policies-load-error").waitFor({ state: "visible" })
    if (await page.getByTestId("sla-policies-load-retry").count() !== 0) throw new Error("sla_permission_offered_misleading_retry")
    await page.unroute(collectionPattern, forbid)
    await openWorkspace(page)
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "empty-state-and-recovery", async () => {
    const collectionPattern = "**/api/v1/sla-policies"
    const empty = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) })
    await page.route(collectionPattern, empty)
    await openWorkspace(page)
    await page.getByTestId("sla-policies-empty-state").waitFor({ state: "visible" })
    await page.getByTestId("sla-policies-empty-create").waitFor({ state: "visible" })
    await page.unroute(collectionPattern, empty)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator(`[data-testid='sla-policy-row'][data-policy-id='${protectedPolicyId}']`).first().waitFor({ state: "visible" })
    return { emptyStateObserved: true, createPathPresent: true, recoverySucceeded: true }
  })

  await recordStep(page, "client-validation-preview-and-keyboard", async () => {
    await openWorkspace(page)
    await page.getByTestId("sla-policies-create").click()
    const form = page.getByTestId("sla-policy-form")
    await form.waitFor({ state: "visible" })
    await page.getByTestId("sla-policy-preview").waitFor({ state: "visible" })
    await page.getByTestId("sla-resolution-hours").fill("2")
    await page.getByTestId("sla-response-hours").fill("4")
    await page.getByTestId("sla-policy-validation-error").waitFor({ state: "visible" })
    if (!await page.getByTestId("sla-policy-submit").isDisabled()) throw new Error("invalid_sla_targets_remained_submittable")
    await page.getByTestId("sla-resolution-hours").fill("8")
    await page.getByTestId("sla-policy-validation-error").waitFor({ state: "visible" })
    if (!await page.getByTestId("sla-policy-submit").isDisabled()) throw new Error("active_priority_conflict_remained_submittable")
    await page.getByTestId("sla-policy-active").focus()
    await page.getByTestId("sla-policy-active").press("Space")
    await page.getByTestId("sla-policy-validation-error").waitFor({ state: "hidden" })
    if (await page.getByTestId("sla-policy-submit").isDisabled()) throw new Error("inactive_alternative_remained_blocked")
    await page.keyboard.press("Escape")
    await form.waitFor({ state: "hidden" })
    return { previewObserved: true, targetOrderBlocked: true, conflictBlocked: true, keyboardAlternativeEnabled: true }
  })

  await recordStep(page, "create-failure-stale-refresh-and-recovery", async () => {
    await openWorkspace(page)
    await page.getByTestId("sla-policies-create").click()
    await page.locator("#sla-policy-name").fill("Disposable evidence policy")
    await page.getByTestId("sla-policy-active").click()
    const collectionPattern = "**/api/v1/sla-policies"
    const denyPost = async (route) => route.request().method() === "POST"
      ? route.fulfill(jsonFailure("Synthetic SLA save failure"))
      : route.continue()
    await page.route(collectionPattern, denyPost)
    await page.getByTestId("sla-policy-submit").focus()
    await page.getByTestId("sla-policy-submit").press("Enter")
    await page.getByTestId("sla-policy-save-error").waitFor({ state: "visible" })
    if (await page.locator("#sla-policy-name").inputValue() !== "Disposable evidence policy") throw new Error("sla_save_failure_discarded_values")
    await page.unroute(collectionPattern, denyPost)

    const denyRefresh = async (route) => route.request().method() === "GET"
      ? route.fulfill(jsonFailure("Synthetic SLA refresh failure"))
      : route.continue()
    await page.route(collectionPattern, denyRefresh)
    await page.getByTestId("sla-policy-submit").click()
    await page.getByTestId("sla-policy-form").waitFor({ state: "hidden" })
    await page.getByTestId("sla-policies-refresh-error").waitFor({ state: "visible" })
    if (await page.locator(`[data-testid='sla-policy-row'][data-policy-id='${protectedPolicyId}']`).count() === 0) throw new Error("sla_refresh_failure_discarded_snapshot")
    await page.unroute(collectionPattern, denyRefresh)
    await page.getByTestId("sla-policies-refresh-retry").click()
    const created = page.getByTestId("sla-policy-row").filter({ hasText: "Disposable evidence policy" }).first()
    await created.waitFor({ state: "visible" })
    createdPolicyId = await created.getAttribute("data-policy-id") || ""
    if (!createdPolicyId) throw new Error("created_sla_policy_id_missing")
    return { keyboardSubmit: true, valuesPreserved: true, staleSnapshotPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "dependency-delete-is-blocked", async () => {
    await openWorkspace(page)
    await page.getByTestId(`sla-policy-actions-${protectedPolicyId}`).first().click()
    const deleteAction = page.getByTestId(`sla-policy-delete-${protectedPolicyId}`)
    await deleteAction.waitFor({ state: "visible" })
    if (await deleteAction.getAttribute("aria-disabled") !== "true") throw new Error("linked_sla_policy_delete_not_blocked")
    await page.keyboard.press("Escape")
    return { dependencyImpactVisible: true, destructiveActionBlocked: true }
  })

  await recordStep(page, "delete-failure-retry-and-cleanup", async () => {
    if (!createdPolicyId) throw new Error("disposable_sla_policy_missing")
    await openWorkspace(page)
    const itemPattern = `**/api/v1/sla-policies/${createdPolicyId}`
    const denyDelete = async (route) => route.request().method() === "DELETE"
      ? route.fulfill(jsonFailure("Synthetic SLA delete failure"))
      : route.continue()
    await page.route(itemPattern, denyDelete)
    await page.getByTestId(`sla-policy-actions-${createdPolicyId}`).first().click()
    await page.getByTestId(`sla-policy-delete-${createdPolicyId}`).click()
    const confirmation = page.getByRole("dialog")
    await confirmation.locator("button").last().click()
    await confirmation.getByRole("alert").waitFor({ state: "visible" })
    if (await page.locator(`[data-testid='sla-policy-row'][data-policy-id='${createdPolicyId}']`).count() === 0) throw new Error("sla_delete_failure_removed_policy")
    await page.unroute(itemPattern, denyDelete)
    await confirmation.locator("button").last().click()
    await confirmation.waitFor({ state: "hidden" })
    await page.locator(`[data-testid='sla-policy-row'][data-policy-id='${createdPolicyId}']`).first().waitFor({ state: "hidden" })
    return { deleteRollback: true, retrySucceeded: true, disposableFixtureRemoved: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "sla-policies-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
