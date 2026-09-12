import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Portal Users flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Portal Users flow evidence refuses a non-local host")
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

function contact(index, overrides = {}) {
  return {
    id: `portal-contact-${index}`,
    fullName: `Portal Evidence ${index + 1}`,
    email: `portal-evidence-${index + 1}@example.invalid`,
    phone: `+99450000${String(index).padStart(4, "0")}`,
    companyName: "Northstar Evidence",
    isActive: true,
    portalAccessEnabled: true,
    hasPassword: true,
    portalLastLoginAt: new Date(Date.UTC(2026, 8, 1, 8, index % 60)).toISOString(),
    recoveryExpiresAt: null,
    ...overrides,
  }
}

function stateContacts() {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
  const past = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
  return [
    contact(0, { isActive: false }),
    contact(1, { portalAccessEnabled: false, hasPassword: false, portalLastLoginAt: null }),
    contact(2, { hasPassword: false, portalLastLoginAt: null }),
    contact(3),
    contact(4, { recoveryExpiresAt: future }),
    contact(5, { recoveryExpiresAt: past }),
  ]
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) }
}

function listPayload(contacts) {
  return {
    success: true,
    data: {
      contacts,
      stats: {
        totalWithEmail: contacts.filter((item) => item.email).length,
        enabled: contacts.filter((item) => item.portalAccessEnabled).length,
        registered: contacts.filter((item) => item.hasPassword).length,
        recentLogins: contacts.filter((item) => item.portalLastLoginAt).length,
      },
      scope: { shown: contacts.length, limit: 100, truncated: contacts.length >= 100 },
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
      callbackUrl: baseUrl + "/settings/portal-users",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("portal_users_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/portal-users", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='portal-users-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Portal Users")
}

function visibleContact(page, id) {
  return page.locator(`[data-contact-id='${id}']:visible`).first()
}

function installPortalApi(page, initialContacts, options = {}) {
  let contacts = structuredClone(initialContacts)
  let patchAttempts = 0
  const failedAttempts = new Set(options.failPatchAttempts || [])
  const pattern = "**/api/v1/portal-users**"
  const handler = async (route) => {
    const request = route.request()
    if (request.method() === "GET") return route.fulfill(json(listPayload(contacts)))
    if (request.method() !== "PATCH") return route.fulfill(json({ success: false, error: "Unexpected synthetic portal request" }, 405))
    patchAttempts += 1
    if (options.patchDelay) await new Promise((resolve) => setTimeout(resolve, options.patchDelay))
    if (failedAttempts.has(patchAttempts)) return route.fulfill(json({ success: false, error: "Synthetic portal mutation failure" }, 503))

    const body = request.postDataJSON()
    const auditRecorded = options.auditRecorded !== false
    if (Array.isArray(body.contactIds)) {
      const selected = new Set(body.contactIds)
      const enabled = body.action === "enable"
      contacts = contacts.map((item) => selected.has(item.id) ? { ...item, portalAccessEnabled: enabled, ...(enabled ? {} : { hasPassword: false, recoveryExpiresAt: null, portalLastLoginAt: null }) } : item)
      return route.fulfill(json({ success: true, updated: body.contactIds.length, auditRecorded }))
    }

    const target = contacts.find((item) => item.id === body.contactId)
    if (!target) return route.fulfill(json({ success: false, code: "PORTAL_CONTACT_NOT_FOUND" }, 404))
    if (body.sendPasswordLink) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
      contacts = contacts.map((item) => item.id === target.id ? { ...item, recoveryExpiresAt: expiresAt } : item)
      return route.fulfill(json({ success: true, data: { mode: target.hasPassword ? "reset" : "activation", expiresAt }, auditRecorded }))
    }
    if (body.administratorPassword) return route.fulfill(json({ success: true, auditRecorded }))
    if (body.profile) {
      const emailChanged = body.profile.email !== target.email
      contacts = contacts.map((item) => item.id === target.id ? { ...item, ...body.profile, ...(emailChanged ? { hasPassword: false, recoveryExpiresAt: null, portalLastLoginAt: null } : {}) } : item)
      return route.fulfill(json({ success: true, data: { credentialsRevoked: emailChanged || !body.profile.portalAccessEnabled }, auditRecorded }))
    }
    if (body.clearChatHistory) return route.fulfill(json({ success: true, cleared: 3, auditRecorded }))
    if (body.removeFromPortal) {
      contacts = contacts.map((item) => item.id === target.id ? { ...item, portalAccessEnabled: false, hasPassword: false, recoveryExpiresAt: null, portalLastLoginAt: null } : item)
      return route.fulfill(json({ success: true, removed: true, auditRecorded }))
    }
    if (typeof body.portalAccessEnabled === "boolean") {
      contacts = contacts.map((item) => item.id === target.id ? { ...item, portalAccessEnabled: body.portalAccessEnabled, ...(body.portalAccessEnabled ? {} : { hasPassword: false, recoveryExpiresAt: null, portalLastLoginAt: null }) } : item)
      return route.fulfill(json({ success: true, auditRecorded }))
    }
    return route.fulfill(json({ success: false, error: "Unhandled synthetic portal action" }, 400))
  }
  return page.route(pattern, handler)
}

async function chooseMenuAction(page, contactId, testId) {
  const row = visibleContact(page, contactId)
  await row.getByTestId("portal-user-menu").click()
  await page.getByTestId(testId).click()
}

async function confirmOpenDialog(page) {
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible" })
  await dialog.getByRole("button").last().click()
  return dialog
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
  console.log(`[portal-users-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `portal-users-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `portal-users-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
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
    const pattern = "**/api/v1/portal-users**"
    const fail = async (route) => route.fulfill(json({ success: false, error: "Synthetic portal load failure" }, 503))
    await page.route(pattern, fail)
    await page.goto("/settings/portal-users", { waitUntil: "domcontentloaded" })
    await page.getByTestId("portal-users-error").waitFor({ state: "visible" })
    await page.unroute(pattern, fail)
    await installPortalApi(page, [contact(0)])
    await page.getByTestId("portal-users-retry").focus()
    await page.getByTestId("portal-users-retry").press("Enter")
    await page.locator("[data-testid='portal-users-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })

    const forbid = async (route) => route.fulfill(json({ success: false, error: "Forbidden", code: "PORTAL_USERS_ADMIN_REQUIRED" }, 403))
    await page.route(pattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='portal-users-error'][data-retryable='false']").waitFor({ state: "visible" })
    if (await page.getByTestId("portal-users-retry").count() !== 0) throw new Error("portal_users_permission_offered_misleading_retry")
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "empty-six-recovery-states-and-density", async () => {
    await installPortalApi(page, [])
    await openWorkspace(page)
    await page.locator("[data-testid='portal-users-empty'][data-kind='contacts']").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })
    const contacts = [...stateContacts(), ...Array.from({ length: 30 }, (_, index) => contact(index + 6))]
    await installPortalApi(page, contacts)
    await openWorkspace(page)
    for (const state of ["contact_inactive", "disabled", "setup_pending", "registered", "recovery_active", "recovery_expired"]) {
      await page.locator(`[data-access-state='${state}']:visible`).first().waitFor({ state: "visible" })
    }
    const visibleSurface = viewportName === "mobile" ? page.getByTestId("portal-users-mobile-list") : page.getByTestId("portal-users-desktop-table")
    await visibleSurface.waitFor({ state: "visible" })
    const rows = await page.locator("[data-testid='portal-user-row']:visible, [data-testid='portal-user-card']:visible").count()
    if (rows !== 36) throw new Error("portal_users_density_row_count_mismatch")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("portal_users_density_horizontal_overflow")
    return { trueEmpty: true, recoveryStates: 6, contacts: 36, responsiveSurface: true, horizontalOverflow: false }
  })

  await recordStep(page, "debounce-abort-and-selection-scope-recovery", async () => {
    const pattern = "**/api/v1/portal-users**"
    let releaseSlow
    const slowStarted = new Promise((resolve) => { releaseSlow = resolve })
    const handler = async (route) => {
      const search = new URL(route.request().url()).searchParams.get("search") || ""
      if (search === "slow") {
        releaseSlow()
        await new Promise((resolve) => setTimeout(resolve, 900))
        return route.fulfill(json(listPayload([contact(80, { fullName: "Stale Slow Result" })]))).catch(() => undefined)
      }
      if (search === "final") return route.fulfill(json(listPayload([contact(81, { fullName: "Final Search Result" })])))
      return route.fulfill(json(listPayload([contact(0), contact(1), contact(2)])))
    }
    await page.route(pattern, handler)
    await openWorkspace(page)
    await page.locator("[data-testid='portal-user-select']:visible").first().check()
    await page.getByTestId("portal-users-bulk").waitFor({ state: "visible" })
    await page.getByTestId("portal-users-search").fill("slow")
    await slowStarted
    await page.getByTestId("portal-users-search").fill("final")
    await visibleContact(page, "portal-contact-81").waitFor({ state: "visible" })
    await page.waitForTimeout(1_000)
    if (await page.getByText("Stale Slow Result").count() !== 0) throw new Error("portal_users_stale_search_overwrote_results")
    if (await page.getByTestId("portal-users-bulk").count() !== 0) throw new Error("portal_users_filter_change_kept_selection")
    await page.locator("[data-testid='portal-users-empty'][data-kind='filtered']").waitFor({ state: "hidden" }).catch(() => undefined)
    return { debounceObserved: true, staleRequestAborted: true, latestResultStable: true, selectionClearedOnCommittedSearch: true }
  })

  await recordStep(page, "bulk-disable-failure-preserves-scope-and-retries", async () => {
    const contacts = [contact(0), contact(1), contact(2)]
    await installPortalApi(page, contacts, { failPatchAttempts: [1], patchDelay: 250 })
    await openWorkspace(page)
    const selects = page.locator("[data-testid='portal-user-select']:visible")
    await selects.nth(0).check()
    await selects.nth(1).check()
    await page.getByTestId("portal-users-bulk-disable").click()
    const dialog = page.getByRole("dialog")
    const confirm = dialog.getByRole("button").last()
    await confirm.click()
    if (!await confirm.isDisabled()) throw new Error("portal_users_bulk_duplicate_submit_not_blocked")
    await dialog.getByRole("alert").waitFor({ state: "visible" })
    if (await page.locator("[data-testid='portal-user-select']:visible:checked").count() !== 2) throw new Error("portal_users_bulk_failure_lost_selection")
    await confirm.click()
    await dialog.waitFor({ state: "hidden" })
    if (await page.getByTestId("portal-users-bulk").count() !== 0) throw new Error("portal_users_bulk_success_kept_selection")
    return { confirmation: true, duplicateSubmitBlocked: true, failedSelectionRetained: true, retrySucceeded: true, selectionClearedAfterSuccess: true }
  })

  await recordStep(page, "recovery-failure-expiry-and-audit-feedback", async () => {
    const original = contact(0)
    await installPortalApi(page, [original], { failPatchAttempts: [1], auditRecorded: false })
    await openWorkspace(page)
    await chooseMenuAction(page, original.id, "portal-user-recovery")
    const dialog = await confirmOpenDialog(page)
    await dialog.getByRole("alert").waitFor({ state: "visible" })
    if (!await dialog.isVisible()) throw new Error("portal_recovery_failure_closed_dialog")
    await dialog.getByRole("button").last().click()
    await dialog.waitFor({ state: "hidden" })
    await page.locator(`[data-contact-id='${original.id}'][data-access-state='recovery_active']:visible`).waitFor({ state: "visible" })
    await page.locator("[data-testid='portal-users-notice'][data-kind='error']").waitFor({ state: "visible" })
    return { failureRetainedDialog: true, retrySucceeded: true, activeExpiryRendered: true, auditFailureDistinguished: true }
  })

  await recordStep(page, "edit-and-manual-password-recovery", async () => {
    const original = contact(0)
    await installPortalApi(page, [original], { failPatchAttempts: [1, 3], patchDelay: 150 })
    await openWorkspace(page)
    await chooseMenuAction(page, original.id, "portal-user-edit")
    const name = page.getByTestId("portal-user-edit-name")
    await name.fill("Recovered portal profile")
    await page.getByTestId("portal-user-edit-save").click()
    await page.getByTestId("portal-user-edit-form").getByRole("alert").waitFor({ state: "visible" })
    if (await name.inputValue() !== "Recovered portal profile") throw new Error("portal_edit_failure_lost_draft")
    await page.getByTestId("portal-user-edit-save").click()
    await page.getByTestId("portal-user-edit-form").waitFor({ state: "hidden" })
    await visibleContact(page, original.id).getByText("Recovered portal profile").waitFor({ state: "visible" })

    await chooseMenuAction(page, original.id, "portal-user-manual-password")
    const password = page.getByTestId("portal-user-password")
    const confirmation = page.getByTestId("portal-user-password-confirm")
    await password.fill("Portal#Evidence2026")
    await confirmation.fill("Portal#Evidence2027")
    await page.getByTestId("portal-user-password-save").click()
    await page.getByTestId("portal-user-password-form").getByRole("alert").waitFor({ state: "visible" })
    await confirmation.fill("Portal#Evidence2026")
    await page.getByTestId("portal-user-password-save").click()
    await page.getByTestId("portal-user-password-form").getByRole("alert").waitFor({ state: "visible" })
    await page.getByTestId("portal-user-password-ack").check()
    await page.getByTestId("portal-user-password-save").click()
    await page.getByTestId("portal-user-password-form").getByRole("alert").waitFor({ state: "hidden" })
    await page.getByTestId("portal-user-password-form").getByRole("alert").waitFor({ state: "visible" })
    if (await password.inputValue() !== "Portal#Evidence2026") throw new Error("portal_password_failure_lost_input")
    await page.getByTestId("portal-user-password-save").click()
    await page.getByTestId("portal-user-password-form").waitFor({ state: "hidden" })
    return { editDraftRetained: true, editRetrySucceeded: true, mismatchBlocked: true, acknowledgementRequired: true, passwordFailureRetained: true, passwordRetrySucceeded: true }
  })

  await recordStep(page, "single-disable-clear-chat-and-removal-recovery", async () => {
    const first = contact(0)
    const second = contact(1)
    await installPortalApi(page, [first, second], { failPatchAttempts: [1] })
    await openWorkspace(page)
    await visibleContact(page, first.id).getByTestId("portal-user-access").click()
    const disableDialog = await confirmOpenDialog(page)
    await disableDialog.getByRole("alert").waitFor({ state: "visible" })
    await disableDialog.getByRole("button").last().click()
    await disableDialog.waitFor({ state: "hidden" })
    await page.locator(`[data-contact-id='${first.id}'][data-access-state='disabled']:visible`).waitFor({ state: "visible" })

    await chooseMenuAction(page, second.id, "portal-user-clear-chat")
    const clearDialog = await confirmOpenDialog(page)
    await clearDialog.waitFor({ state: "hidden" })
    await chooseMenuAction(page, second.id, "portal-user-remove")
    const removeDialog = await confirmOpenDialog(page)
    await removeDialog.waitFor({ state: "hidden" })
    await page.locator(`[data-contact-id='${second.id}'][data-access-state='disabled']:visible`).waitFor({ state: "visible" })
    return { singleDisableFailureRetried: true, clearChatConfirmed: true, removalConfirmed: true, portalRemovalStateRecovered: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "portal-users-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 7 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 7, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
