import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Support flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Support flow evidence refuses a non-local host")
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
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}
const demoOrganizationSlug = requiredEnv("SUPPORT_EVIDENCE_PORTAL_SLUG")
const expectedOrganizationId = requiredEnv("SUPPORT_EVIDENCE_ORGANIZATION_ID")
const referenceTicketId = requiredEnv("SUPPORT_EVIDENCE_TICKET_ID")

async function authenticate(context, account = agent, callbackPath = "/tickets") {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: account.email,
      password: account.password,
      organizationSlug: demoOrganizationSlug,
      callbackUrl: baseUrl + callbackPath,
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("dashboard_authentication_failed")
}

async function authenticatedOrganizationId(context) {
  // This route is readable by Support and its query is scoped by the session's
  // immutable org id. Matching the exact synthetic fixture proves both the
  // principal and tenant without granting settings access to an agent.
  const response = await context.request.get(`/api/v1/tickets/${referenceTicketId}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok()
    || body?.success !== true
    || body?.data?.id !== referenceTicketId
    || !body?.data?.subject?.includes(demoOrganization)) {
    const cookieNames = (await context.cookies(baseUrl)).map((cookie) => cookie.name).sort()
    throw new Error(`session_organization_mismatch_${response.status()}_${cookieNames.join(".") || "no-cookies"}`)
  }
  return expectedOrganizationId
}

async function openWorkspace(page, workspacePath) {
  const response = await page.goto(workspacePath, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("body").waitFor({ state: "visible" })
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
  const readySelector = /^\/tickets\/[^/]+/.test(new URL(page.url()).pathname)
    ? "[data-testid='ticket-detail-workspace']"
    : "[data-testid='tickets-workspace']"
  await page.locator(readySelector).waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, workspacePath)
}

async function dismissTour(page) {
  const tourOverlay = page.getByTestId("tour-overlay")
  if (await tourOverlay.waitFor({ state: "visible", timeout: 1_500 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
    await tourOverlay.waitFor({ state: "hidden", timeout: 5_000 })
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
  // Playwright cannot intercept requests already claimed by a Service Worker.
  // These disposable mutation flows deliberately synthesize GET failures, so
  // keep the worker out of this test context instead of silently testing cached
  // success responses.
  serviceWorkers: "block",
})
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[support-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `service-desk-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `service-desk-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

async function submitCaseControl(page, { selectTestId, submitTestId, value, phase }) {
  const select = page.getByTestId(selectTestId)
  const submit = page.getByTestId(submitTestId)
  await select.selectOption(value)
  await submit.focus()
  if (await submit.isDisabled()) throw new Error(`${phase}_submit_disabled`)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const url = new URL(candidate.url())
      return url.pathname === `/api/v1/tickets/${referenceTicketId}` && candidate.request().method() === "PUT"
    }, { timeout: 45_000 }),
    submit.press("Enter"),
  ])
  if (!response.ok()) throw new Error(`${phase}_http_${response.status()}`)
  await page.waitForFunction(({ expected, selectId, submitId }) => {
    const currentSelect = document.querySelector(`[data-testid='${selectId}']`)
    const currentSubmit = document.querySelector(`[data-testid='${submitId}']`)
    return currentSelect?.value === expected && currentSubmit?.dataset.state === "synced"
  }, { expected: value, selectId: selectTestId, submitId: submitTestId }, { timeout: 45_000 }).catch(async () => {
    const observed = await page.evaluate(({ selectId, submitId }) => {
      const currentSelect = document.querySelector(`[data-testid='${selectId}']`)
      const currentSubmit = document.querySelector(`[data-testid='${submitId}']`)
      return { value: currentSelect?.value || null, state: currentSubmit?.dataset.state || null }
    }, { selectId: selectTestId, submitId: submitTestId })
    throw new Error(`${phase}_not_synced_${JSON.stringify(observed)}`)
  })
}

let page = null
try {
  await authenticate(context)
  const agentOrganizationId = await authenticatedOrganizationId(context)
  page = await context.newPage()

  await recordStep(page, "keyboard-open-and-return", async () => {
    await openWorkspace(page, "/tickets?q=Synthetic&focus=mine&view=list")
    const maxScroll = await page.evaluate(() => {
      const scroller = document.querySelector("main")
      return scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : Math.max(0, document.documentElement.scrollHeight - innerHeight)
    })
    const expectedScroll = Math.min(maxScroll, 420)
    if (expectedScroll < 200) throw new Error(`queue_scroll_range_too_small_${maxScroll}`)
    await page.evaluate((top) => {
      const scroller = document.querySelector("main")
      if (scroller) scroller.scrollTo({ top, behavior: "instant" })
      else scrollTo({ top, behavior: "instant" })
    }, expectedScroll)
    const row = page.locator("tbody tr[tabindex='0']:visible, article[role='link']:visible").first()
    await row.waitFor({ state: "visible" })
    await row.focus()
    await Promise.all([
      page.waitForURL((url) => /^\/tickets\/[^/]+/.test(url.pathname), { timeout: 30_000 }),
      page.keyboard.press("Enter"),
    ])
    await page.getByTestId("ticket-detail-workspace").waitFor({ state: "visible", timeout: 30_000 })
    await dismissTour(page)
    const returnTo = new URL(page.url()).searchParams.get("returnTo")
    const returnUrl = returnTo ? new URL(returnTo, baseUrl) : null
    if (returnUrl?.searchParams.get("q") !== "Synthetic"
      || returnUrl.searchParams.get("focus") !== "mine"
      || returnUrl.searchParams.get("view") !== "list") {
      throw new Error("queue_context_missing_from_detail_url")
    }
    await page.getByTestId("ticket-detail-back").click()
    await page.waitForURL((url) => url.pathname === "/tickets"
      && url.searchParams.get("q") === "Synthetic"
      && url.searchParams.get("focus") === "mine"
      && url.searchParams.get("view") === "list", { timeout: 30_000 })
    await page.waitForFunction(
      (expected) => Math.abs((document.querySelector("main")?.scrollTop ?? scrollY) - expected) <= 80,
      expectedScroll,
      { timeout: 5_000 },
    ).catch(() => undefined)
    const restoredScroll = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? scrollY)
    if (Math.abs(restoredScroll - expectedScroll) > 80) throw new Error(`queue_scroll_not_restored_${expectedScroll}_${restoredScroll}`)
    return { expectedScroll, restoredScroll, compactWithoutPageScroll: maxScroll < 120 }
  })

  await recordStep(page, "empty-queue-and-recovery", async () => {
    const ticketsPattern = "**/api/v1/tickets**"
    await page.route(ticketsPattern, async (route) => {
      const request = route.request()
      if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/v1/tickets") return route.continue()
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { tickets: [] } }) })
    })
    await openWorkspace(page, "/tickets")
    await page.locator("[data-testid='tickets-empty-state']:visible").first().waitFor({ state: "visible", timeout: 10_000 })
    await page.unroute(ticketsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/tickets" && candidate.request().method() === "GET"),
      page.getByTestId("tickets-refresh").click(),
    ])
    if (!response.ok()) throw new Error(`empty_queue_recovery_http_${response.status()}`)
    await page.locator("tbody tr[tabindex='0']:visible, article[role='link']:visible").first().waitFor({ state: "visible", timeout: 10_000 })
    return { emptyStateObserved: true, recoverySucceeded: true }
  })

  await recordStep(page, "stale-queue-and-recovery", async () => {
    await openWorkspace(page, "/tickets")
    const firstTicket = page.locator("tbody tr[tabindex='0']:visible, article[role='link']:visible").first()
    await firstTicket.waitFor({ state: "visible" })
    const ticketsPattern = "**/api/v1/tickets**"
    await page.route(ticketsPattern, async (route) => {
      const request = route.request()
      if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/v1/tickets") return route.continue()
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic stale queue" }) })
    })
    const failedResponsePromise = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/tickets" && candidate.request().method() === "GET")
    await page.getByTestId("tickets-refresh").click()
    const failedResponse = await failedResponsePromise
    if (failedResponse.status() !== 503) throw new Error(`stale_queue_intercept_missed_${failedResponse.status()}`)
    await page.getByTestId("tickets-load-error").waitFor({ state: "visible", timeout: 10_000 })
    if (!await firstTicket.isVisible()) throw new Error("stale_queue_discarded_existing_rows")
    await page.unroute(ticketsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/tickets" && candidate.request().method() === "GET"),
      page.getByTestId("tickets-retry-load").click(),
    ])
    if (!response.ok()) throw new Error(`stale_queue_recovery_http_${response.status()}`)
    await page.getByTestId("tickets-workspace").waitFor({ state: "visible", timeout: 10_000 })
    await page.getByTestId("tickets-load-error").waitFor({ state: "hidden", timeout: 10_000 })
    return { staleRowsPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "take-next-ticket", async () => {
    await openWorkspace(page, "/tickets")
    const takeNext = page.getByTestId("tickets-take-next")
    await takeNext.waitFor({ state: "visible" })
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.url().endsWith("/api/v1/tickets/take-next") && candidate.request().method() === "POST"),
      takeNext.click(),
    ])
    if (!response.ok()) throw new Error(`take_next_http_${response.status()}`)
    await page.waitForURL((url) => /^\/tickets\/[^/]+/.test(url.pathname), { timeout: 30_000 })
    await page.getByTestId("ticket-detail-workspace").waitFor({ state: "visible", timeout: 30_000 })
    await dismissTour(page)
    return { destination: new URL(page.url()).pathname }
  })

  await recordStep(page, "internal-note-failure-and-recovery", async () => {
    if (!/^\/tickets\/[^/]+/.test(new URL(page.url()).pathname)) throw new Error("ticket_detail_not_open")
    const internalMode = page.getByTestId("ticket-compose-internal")
    await internalMode.focus()
    await internalMode.press("Enter")
    const composer = page.getByTestId("ticket-comment-composer")
    const note = `Disposable evidence note ${commit.slice(0, 8)}`
    await composer.fill(note)
    const commentsPattern = "**/api/v1/tickets/*/comments"
    let releaseSend
    let sendRequestCount = 0
    const sendGate = new Promise((resolve) => { releaseSend = resolve })
    await page.route(commentsPattern, async (route) => {
      sendRequestCount += 1
      await sendGate
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic evidence failure" }) })
    })
    const send = page.getByTestId("ticket-send-message")
    const failedResponsePromise = page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+\/comments$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST")
    await send.focus()
    await send.press("Enter")
    await page.waitForFunction(() => document.querySelector("[data-testid='ticket-send-message']")?.disabled)
    await page.evaluate(() => document.querySelector("[data-testid='ticket-send-message']")?.click())
    await page.waitForTimeout(100)
    if (sendRequestCount !== 1) throw new Error(`duplicate_send_not_blocked_${sendRequestCount}`)
    releaseSend()
    const failedResponse = await failedResponsePromise
    if (failedResponse.status() !== 503) throw new Error(`send_failure_intercept_missed_${failedResponse.status()}`)
    await page.locator("#ticket-send-error").waitFor({ state: "visible" })
    if (await composer.inputValue() !== note) throw new Error("failed_send_did_not_preserve_draft")
    await page.unroute(commentsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+\/comments$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST"),
      page.getByTestId("ticket-retry-send").click(),
    ])
    if (!response.ok()) throw new Error(`internal_note_retry_http_${response.status()}`)
    await page.waitForFunction(() => document.querySelector("#ticket-comment-composer")?.value === "")
    await page.getByText(note, { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
    return { draftPreserved: true, duplicateSendBlocked: true, retrySucceeded: true }
  })

  await recordStep(page, "comment-permission-and-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const replyMode = page.getByTestId("ticket-compose-reply")
    await replyMode.focus()
    await replyMode.press("Enter")
    const composer = page.getByTestId("ticket-comment-composer")
    const reply = `Permission recovery reply ${commit.slice(0, 8)}`
    await composer.fill(reply)
    const commentsPattern = "**/api/v1/tickets/*/comments"
    await page.route(commentsPattern, async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic permission denial" }) })
    })
    const [deniedResponse] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+\/comments$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST"),
      page.getByTestId("ticket-send-message").focus().then(() => page.getByTestId("ticket-send-message").press("Enter")),
    ])
    if (deniedResponse.status() !== 403) throw new Error(`comment_permission_intercept_missed_${deniedResponse.status()}`)
    await page.locator("#ticket-send-error").waitFor({ state: "visible" })
    if (await composer.inputValue() !== reply) throw new Error("permission_denial_discarded_reply")
    await page.unroute(commentsPattern)
    const [recoveryResponse] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+\/comments$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST"),
      page.getByTestId("ticket-retry-send").click(),
    ])
    if (!recoveryResponse.ok()) throw new Error(`comment_permission_recovery_http_${recoveryResponse.status()}`)
    await page.getByText(reply, { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
    return { permissionDeniedObserved: true, draftPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "composer-mode-navigation-and-draft-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}?returnTo=${encodeURIComponent("/tickets?q=Synthetic")}`)
    const composer = page.getByTestId("ticket-comment-composer")
    const draft = `Navigation draft ${commit.slice(0, 8)}`
    const replyMode = page.getByTestId("ticket-compose-reply")
    const internalMode = page.getByTestId("ticket-compose-internal")
    await replyMode.focus()
    await replyMode.press("Enter")
    await composer.fill(draft)
    await internalMode.focus()
    await internalMode.press("Enter")
    if (await composer.inputValue() !== draft) throw new Error("composer_mode_switch_discarded_draft")
    if (await page.getByTestId("ticket-compose-internal").getAttribute("aria-pressed") !== "true") throw new Error("internal_mode_not_exposed")
    if (!(await composer.getAttribute("aria-describedby"))?.includes("ticket-internal-note-hint")) throw new Error("internal_mode_not_described")
    const back = page.getByTestId("ticket-detail-back")
    await back.focus()
    await back.press("Enter")
    const dialog = page.getByRole("dialog")
    await dialog.waitFor({ state: "visible", timeout: 10_000 })
    const leave = dialog.getByRole("button").last()
    await leave.focus()
    await leave.press("Enter")
    await page.waitForURL((url) => url.pathname === "/tickets" && url.searchParams.get("q") === "Synthetic", { timeout: 30_000 })
    await openWorkspace(page, `/tickets/${referenceTicketId}?returnTo=${encodeURIComponent("/tickets?q=Synthetic")}`)
    if (await composer.inputValue() !== draft) throw new Error("navigation_did_not_restore_draft")
    if (await page.getByTestId("ticket-compose-internal").getAttribute("aria-pressed") !== "true") throw new Error("navigation_did_not_restore_composer_mode")
    await composer.fill("")
    await replyMode.focus()
    await replyMode.press("Enter")
    return { keyboardModeSwitch: true, keyboardLeaveAction: true, modeSwitchPreserved: true, leaveWarningObserved: true, draftRecovered: true, internalModeRecovered: true }
  })

  await recordStep(page, "closed-ticket-and-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const status = page.getByTestId("ticket-status-select")
    const previousStatus = await status.inputValue()
    let restored = false
    try {
      await submitCaseControl(page, {
        selectTestId: "ticket-status-select",
        submitTestId: "ticket-status-submit",
        value: "closed",
        phase: "closed_ticket_close",
      })
      await page.getByTestId("ticket-closed-state").waitFor({ state: "visible", timeout: 10_000 })
      for (const testId of ["ticket-compose-reply", "ticket-compose-internal", "ticket-comment-composer", "ticket-attachment-input", "ticket-send-message"]) {
        if (!await page.getByTestId(testId).isDisabled()) throw new Error(`closed_ticket_control_enabled_${testId}`)
      }
      const reopen = page.getByTestId("ticket-reopen")
      await reopen.focus()
      const [reopenResponse] = await Promise.all([
        page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${referenceTicketId}` && candidate.request().method() === "PUT", { timeout: 45_000 }),
        reopen.press("Enter"),
      ])
      if (!reopenResponse.ok()) throw new Error(`closed_ticket_reopen_http_${reopenResponse.status()}`)
      await page.getByTestId("ticket-closed-state").waitFor({ state: "hidden", timeout: 10_000 })
      await page.waitForFunction(() => {
        const currentStatus = document.querySelector("[data-testid='ticket-status-select']")
        const statusSubmit = document.querySelector("[data-testid='ticket-status-submit']")
        return currentStatus?.value === "open" && statusSubmit?.dataset.state === "synced"
      }, undefined, { timeout: 45_000 })
      if (previousStatus !== "open") {
        await submitCaseControl(page, {
          selectTestId: "ticket-status-select",
          submitTestId: "ticket-status-submit",
          value: previousStatus,
          phase: "closed_ticket_restore",
        })
      }
      if (await page.getByTestId("ticket-comment-composer").isDisabled()) throw new Error("reopened_ticket_composer_disabled")
      restored = true
      return { closedControlsBlocked: true, reopenSucceeded: true, previousStatusRestored: true }
    } finally {
      if (!restored) {
        const restoreStatus = previousStatus === "closed" ? "open" : previousStatus
        const restoreResponse = await context.request.put(`/api/v1/tickets/${referenceTicketId}`, { data: { status: restoreStatus } }).catch(() => null)
        if (!restoreResponse?.ok()) console.error("[support-flow] failed to restore ticket after closed-state evidence")
        await openWorkspace(page, `/tickets/${referenceTicketId}`).catch(() => undefined)
      }
    }
  })

  await recordStep(page, "support-ai-state-failure-and-recovery", async () => {
    const settingsPattern = "**/api/v1/settings/ai-features"
    await page.route(settingsPattern, async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic Support AI state failure" }) })
    })
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    await page.locator("[data-testid='ticket-ai-state'][data-state='unavailable']").waitFor({ state: "visible", timeout: 10_000 })
    if (await page.getByTestId("ticket-comment-composer").isDisabled()) throw new Error("ai_state_failure_blocked_manual_composer")
    await page.unroute(settingsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/settings/ai-features" && candidate.request().method() === "GET"),
      page.getByTestId("ticket-ai-retry-state").click(),
    ])
    if (!response.ok()) throw new Error(`support_ai_state_recovery_http_${response.status()}`)
    await page.getByTestId("ticket-ai-state").waitFor({ state: "hidden", timeout: 10_000 })
    return { unavailableStateObserved: true, manualComposerAvailable: true, retrySucceeded: true }
  })

  await recordStep(page, "attachment-failure-and-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const composer = page.getByTestId("ticket-comment-composer")
    const draft = `Attachment evidence draft ${commit.slice(0, 8)}`
    const fileName = `support-evidence-${commit.slice(0, 8)}.txt`
    await composer.fill(draft)
    const filesPattern = "**/api/v1/tickets/*/files"
    await page.route(filesPattern, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic attachment failure" }) })
    })
    const attachmentInput = page.getByTestId("ticket-attachment-input")
    await attachmentInput.focus()
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 })
    await attachmentInput.press("Enter")
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic non-production Support UX evidence\n"),
    })
    await page.getByTestId("ticket-attachment-error").waitFor({ state: "visible", timeout: 10_000 })
    if (await composer.inputValue() !== draft) throw new Error("attachment_failure_discarded_draft")
    await page.unroute(filesPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+\/files$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST"),
      page.getByTestId("ticket-retry-attachment").click(),
    ])
    if (!response.ok()) throw new Error(`attachment_retry_http_${response.status()}`)
    await page.getByText(fileName, { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
    if (await composer.inputValue() !== draft) throw new Error("attachment_retry_discarded_draft")
    return { keyboardFileChooser: true, draftPreserved: true, failedUploadObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "keyboard-case-controls-and-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const status = page.getByTestId("ticket-status-select")
    const previousStatus = await status.inputValue()
    const nextStatus = previousStatus === "waiting" ? "in_progress" : "waiting"
    await submitCaseControl(page, { selectTestId: "ticket-status-select", submitTestId: "ticket-status-submit", value: nextStatus, phase: "status_change" })
    await submitCaseControl(page, { selectTestId: "ticket-status-select", submitTestId: "ticket-status-submit", value: previousStatus, phase: "status_restore" })

    const assignee = page.getByTestId("ticket-assignee-select")
    const previousAssignee = await assignee.inputValue()
    if (!previousAssignee) throw new Error("reference_ticket_requires_assignee")
    await submitCaseControl(page, { selectTestId: "ticket-assignee-select", submitTestId: "ticket-assignee-submit", value: "", phase: "assignee_clear" })
    await submitCaseControl(page, { selectTestId: "ticket-assignee-select", submitTestId: "ticket-assignee-submit", value: previousAssignee, phase: "assignee_restore" })
    return { statusChangedAndRestored: true, assignmentChangedAndRestored: true }
  })

  await recordStep(page, "support-ai-master-switch-boundary", async () => {
    const adminContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: viewports.desktop,
      locale,
      colorScheme: theme,
      reducedMotion: "reduce",
    })
    await adminContext.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
    await adminContext.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)
    let restored = false
    try {
      await authenticate(adminContext, admin, "/support/ai-settings")
      const adminOrganizationId = await authenticatedOrganizationId(adminContext)
      if (adminOrganizationId !== agentOrganizationId) {
        throw new Error("support_ai_cross_tenant_evidence_session")
      }
      const adminPage = await adminContext.newPage()
      const response = await adminPage.goto("/support/ai-settings", { waitUntil: "domcontentloaded", timeout: 60_000 })
      if (!response || response.status() >= 400) throw new Error(`support_ai_settings_http_${response?.status() || 0}`)
      await adminPage.getByTestId("support-ai-settings-workspace").waitFor({ state: "visible", timeout: 30_000 })
      assertDemoTenant(await adminPage.locator("body").innerText(), demoOrganization, "/support/ai-settings")
      const masterSwitch = adminPage.getByTestId("support-ai-master-switch")
      if (await masterSwitch.getAttribute("aria-checked") !== "true") throw new Error("support_ai_fixture_not_enabled")
      await masterSwitch.click()
      await adminPage.getByTestId("support-ai-confirm-disable").waitFor({ state: "visible", timeout: 10_000 })
      const [disableResponse] = await Promise.all([
        adminPage.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/settings/ai-features" && candidate.request().method() === "PATCH"),
        adminPage.getByTestId("support-ai-confirm-disable").click(),
      ])
      if (!disableResponse.ok()) throw new Error(`support_ai_disable_http_${disableResponse.status()}`)
      const disableBody = await disableResponse.json().catch(() => ({}))
      if (!disableBody?.data?.features?.includes("supportAiDisabled")) {
        throw new Error("support_ai_disable_not_persisted")
      }
      await adminPage.waitForFunction(() => {
        const workspace = document.querySelector("[data-testid='support-ai-settings-workspace']")
        const toggle = document.querySelector("[data-testid='support-ai-master-switch']")
        return workspace?.getAttribute("data-state") === "ready"
          && workspace.getAttribute("data-enabled") === "false"
          && toggle?.getAttribute("aria-checked") === "false"
      })

      let featureStateStatus = 0
      let agentFeatures = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const featureState = await context.request.get("/api/v1/settings/ai-features", {
          headers: { "x-organization-id": agentOrganizationId },
        })
        const featureBody = await featureState.json().catch(() => ({}))
        featureStateStatus = featureState.status()
        agentFeatures = Array.isArray(featureBody?.data?.features) ? featureBody.data.features : []
        if (featureState.ok() && agentFeatures.includes("supportAiDisabled")) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!agentFeatures.includes("supportAiDisabled")) {
        throw new Error(`support_ai_agent_state_not_disabled_${featureStateStatus}_${agentFeatures.join(".") || "empty"}`)
      }

      await openWorkspace(page, `/tickets/${referenceTicketId}`)
      await page.locator("[data-testid='ticket-ai-state'][data-state='disabled']").waitFor({ state: "visible", timeout: 15_000 })
      const composer = page.getByTestId("ticket-comment-composer")
      if (await composer.isDisabled()) throw new Error("support_ai_switch_blocked_manual_composer")
      const aiResponse = await context.request.post("/api/v1/tickets/ai", {
        data: { action: "reply", ticketId: referenceTicketId, lang: locale },
      })
      const aiBody = await aiResponse.json().catch(() => ({}))
      if (aiResponse.status() !== 403 || aiBody?.errorKey !== "supportAiDisabled") {
        throw new Error(`support_ai_boundary_not_enforced_${aiResponse.status()}_${aiBody?.errorKey || "no_error_key"}`)
      }

      const [enableResponse] = await Promise.all([
        adminPage.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/settings/ai-features" && candidate.request().method() === "PATCH"),
        masterSwitch.click(),
      ])
      if (!enableResponse.ok()) throw new Error(`support_ai_restore_http_${enableResponse.status()}`)
      await adminPage.waitForFunction(() => document.querySelector("[data-testid='support-ai-master-switch']")?.getAttribute("aria-checked") === "true")
      restored = true
      return { disabledStateObserved: true, apiBoundaryEnforced: true, manualComposerAvailable: true, settingRestored: true }
    } finally {
      if (!restored) {
        const restoreResponse = await adminContext.request.patch("/api/v1/settings/ai-features", {
          data: { feature: "supportAiDisabled", action: "remove" },
        }).catch(() => null)
        if (!restoreResponse?.ok()) console.error("[support-flow] failed to restore Support AI after evidence failure")
      }
      await adminContext.close()
    }
  })

  await recordStep(page, "keyboard-reprioritize", async () => {
    if (viewportName === "mobile") {
      const ticketResponse = await context.request.get(`/api/v1/tickets/${referenceTicketId}`)
      const ticketBody = await ticketResponse.json().catch(() => ({}))
      if (!ticketResponse.ok() || !ticketBody?.data?.priority) throw new Error(`mobile_reprioritize_setup_http_${ticketResponse.status()}`)
      const previousPriority = ticketBody.data.priority
      let restored = false
      try {
        if (previousPriority === "critical") {
          const setupResponse = await context.request.put(`/api/v1/tickets/${referenceTicketId}`, { data: { priority: "medium" } })
          if (!setupResponse.ok()) throw new Error(`mobile_reprioritize_setup_http_${setupResponse.status()}`)
        }
        await openWorkspace(page, `/tickets/${referenceTicketId}`)
        const escalate = page.getByTestId("ticket-escalate")
        await escalate.waitFor({ state: "visible" })
        await escalate.focus()
        const [response] = await Promise.all([
          page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${referenceTicketId}` && candidate.request().method() === "PUT"),
          escalate.press("Enter"),
        ])
        const responseBody = await response.json().catch(() => ({}))
        if (!response.ok() || responseBody?.data?.priority !== "critical") throw new Error(`mobile_reprioritize_http_${response.status()}`)
        const restoreResponse = await context.request.put(`/api/v1/tickets/${referenceTicketId}`, { data: { priority: previousPriority } })
        if (!restoreResponse.ok()) throw new Error(`mobile_reprioritize_restore_http_${restoreResponse.status()}`)
        restored = true
        return { previousPriority, nextPriority: "critical", visibleMobileControl: true }
      } finally {
        if (!restored) {
          const restoreResponse = await context.request.put(`/api/v1/tickets/${referenceTicketId}`, { data: { priority: previousPriority } }).catch(() => null)
          if (!restoreResponse?.ok()) console.error("[support-flow] failed to restore ticket priority after mobile evidence")
        }
      }
    }
    await openWorkspace(page, "/tickets")
    const edit = page.locator("[data-testid^='ticket-edit-']").first()
    await edit.waitFor({ state: "visible" })
    await edit.press("Enter")
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10_000 })
    const priority = page.getByTestId("ticket-form-priority")
    await priority.waitFor({ state: "visible" })
    const previousPriority = await priority.inputValue()
    const nextPriority = previousPriority === "critical" ? "low" : "critical"
    await priority.selectOption(nextPriority)
    const submit = page.getByTestId("ticket-form-submit")
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "PUT"),
      submit.press("Enter"),
    ])
    if (!response.ok()) throw new Error(`reprioritize_http_${response.status()}`)
    await priority.waitFor({ state: "detached" })
    return { previousPriority, nextPriority }
  })

  await recordStep(page, "explicit-kanban-move", async () => {
    await openWorkspace(page, "/tickets?view=kanban")
    const move = page.locator("[data-testid^='ticket-move-']").first()
    await move.waitFor({ state: "visible" })
    const moveTestId = await move.getAttribute("data-testid")
    if (!moveTestId) throw new Error("kanban_move_control_missing_id")
    const previousStatus = await move.inputValue()
    const nextStatus = previousStatus === "waiting" ? "open" : "waiting"
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "PUT"),
      move.selectOption(nextStatus),
    ])
    if (!response.ok()) throw new Error(`kanban_move_http_${response.status()}`)
    const relocatedMove = page.getByTestId(moveTestId)
    await relocatedMove.waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForFunction(
      ({ testId, expected }) => (document.querySelector(`[data-testid="${testId}"]`))?.value === expected,
      { testId: moveTestId, expected: nextStatus },
      { timeout: 10_000 },
    )
    return { previousStatus, nextStatus }
  })

  await recordStep(page, "kanban-move-failure-and-recovery", async () => {
    await openWorkspace(page, "/tickets?view=kanban")
    const move = page.locator("[data-testid^='ticket-move-']").first()
    await move.waitFor({ state: "visible" })
    const moveTestId = await move.getAttribute("data-testid")
    if (!moveTestId) throw new Error("kanban_failure_control_missing_id")
    const previousStatus = await move.inputValue()
    const failedStatus = previousStatus === "in_progress" ? "waiting" : "in_progress"
    let releaseMutation
    const mutationGate = new Promise((resolve) => { releaseMutation = resolve })
    const ticketPattern = "**/api/v1/tickets/**"
    await page.route(ticketPattern, async (route) => {
      const request = route.request()
      if (request.method() !== "PUT") return route.continue()
      await mutationGate
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic Kanban failure" }) })
    })
    const failedResponsePromise = page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "PUT")
    await move.selectOption(failedStatus)
    await page.waitForFunction((testId) => Boolean(document.querySelector(`[data-testid="${testId}"]`)?.disabled), moveTestId)
    releaseMutation()
    const failedResponse = await failedResponsePromise
    if (failedResponse.status() !== 503) throw new Error(`kanban_failure_intercept_missed_${failedResponse.status()}`)
    await page.waitForFunction(
      ({ testId, expected }) => {
        const control = document.querySelector(`[data-testid="${testId}"]`)
        return control?.value === expected && !control.disabled
      },
      { testId: moveTestId, expected: previousStatus },
      { timeout: 10_000 },
    )
    await page.unroute(ticketPattern)
    const recoveredMove = page.getByTestId(moveTestId)
    const recoveryStatus = previousStatus === "waiting" ? "open" : "waiting"
    const [recoveryResponse] = await Promise.all([
      page.waitForResponse((candidate) => /\/api\/v1\/tickets\/[^/]+$/.test(new URL(candidate.url()).pathname) && candidate.request().method() === "PUT"),
      recoveredMove.selectOption(recoveryStatus),
    ])
    if (!recoveryResponse.ok()) throw new Error(`kanban_recovery_http_${recoveryResponse.status()}`)
    await page.waitForFunction(
      ({ testId, expected }) => document.querySelector(`[data-testid="${testId}"]`)?.value === expected,
      { testId: moveTestId, expected: recoveryStatus },
      { timeout: 10_000 },
    )
    return { previousStatus, failedStatus, rollbackObserved: true, recoveryStatus }
  })

  await recordStep(page, "filtered-no-results-and-reset", async () => {
    await openWorkspace(page, "/tickets?q=__support_evidence_no_match__")
    await page.locator("[data-testid='tickets-no-results-state']:visible").waitFor({ state: "visible" })
    await page.locator("[data-testid='tickets-empty-action']:visible").click()
    await page.getByTestId("tickets-search").waitFor({ state: "visible" })
    await page.waitForFunction(() => document.querySelector("[data-testid='tickets-search']")?.value === "", undefined, { timeout: 10_000 })
    await page.locator("tbody tr[tabindex='0']:visible, article[role='link']:visible").first().waitFor({ state: "visible" })
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.has("q"), undefined, { timeout: 10_000 })
    const resetUrl = new URL(page.url())
    if (resetUrl.pathname !== "/tickets" || resetUrl.searchParams.has("q")) {
      throw new Error(`ticket_filter_url_not_reset_${resetUrl.pathname}${resetUrl.search}`)
    }
    return { noResultsObserved: true, resetRecovered: true }
  })

  await recordStep(page, "reports-error-and-recovery", async () => {
    const reportsPattern = "**/api/v1/reports**"
    await page.route(reportsPattern, async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic report failure" }) })
    })
    await openWorkspace(page, "/tickets?view=reports")
    await page.getByTestId("ticketing-report-error").waitFor({ state: "visible", timeout: 15_000 })
    await page.unroute(reportsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/reports" && candidate.request().method() === "GET"),
      page.getByTestId("ticketing-report-retry").click(),
    ])
    if (!response.ok()) throw new Error(`report_recovery_http_${response.status()}`)
    await page.getByTestId("ticketing-report-workspace").waitFor({ state: "visible", timeout: 20_000 })
    return { reportErrorObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "loading-permission-and-recovery", async () => {
    const ticketsPattern = "**/api/v1/tickets**"
    let releaseRequest
    const requestGate = new Promise((resolve) => { releaseRequest = resolve })
    await page.route(ticketsPattern, async (route) => {
      const request = route.request()
      if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/v1/tickets") return route.continue()
      await requestGate
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic permission denial" }) })
    })
    const navigation = page.goto("/tickets", { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.getByTestId("tickets-loading").waitFor({ state: "visible", timeout: 10_000 })
    releaseRequest()
    await navigation
    await page.getByTestId("tickets-load-error").waitFor({ state: "visible", timeout: 10_000 })
    await page.unroute(ticketsPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/tickets" && candidate.request().method() === "GET"),
      page.getByTestId("tickets-retry-load").click(),
    ])
    if (!response.ok()) throw new Error(`ticket_list_recovery_http_${response.status()}`)
    await page.getByTestId("tickets-load-error").waitFor({ state: "hidden", timeout: 10_000 })
    return { loadingObserved: true, permissionDeniedObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "partial-context-failure-and-recovery", async () => {
    const contextPattern = "**/api/v1/tickets/**/context"
    await page.route(contextPattern, async (route) => {
      const request = route.request()
      if (request.method() !== "GET" || new URL(request.url()).pathname !== `/api/v1/tickets/${referenceTicketId}/context`) return route.continue()
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic context failure" }) })
    })
    const failedResponsePromise = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${referenceTicketId}/context` && candidate.request().method() === "GET")
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const failedResponse = await failedResponsePromise
    if (failedResponse.status() !== 503) throw new Error(`ticket_context_failure_intercept_missed_${failedResponse.status()}`)
    const secondaryContext = page.getByTestId("ticket-secondary-context")
    if (!await secondaryContext.evaluate((element) => element.open)) {
      const toggle = page.getByTestId("ticket-secondary-context-toggle")
      await toggle.focus()
      await toggle.press("Enter")
    }
    await page.getByTestId("ticket-context-error").waitFor({ state: "visible", timeout: 10_000 })
    await page.unroute(contextPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${referenceTicketId}/context` && candidate.request().method() === "GET"),
      page.getByTestId("ticket-context-retry").click(),
    ])
    if (!response.ok()) throw new Error(`ticket_context_recovery_http_${response.status()}`)
    await page.getByTestId("ticket-context-content").waitFor({ state: "visible", timeout: 10_000 })
    return { partialContextErrorObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "stale-ticket-and-recovery", async () => {
    await openWorkspace(page, `/tickets/${referenceTicketId}`)
    const ticketPattern = "**/api/v1/tickets/**"
    await page.route(ticketPattern, async (route) => {
      const request = route.request()
      if (request.method() === "GET" && new URL(request.url()).pathname === `/api/v1/tickets/${referenceTicketId}`) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic stale response" }) })
        return
      }
      await route.continue()
    })
    await page.getByTestId("ticket-detail-stale").waitFor({ state: "visible", timeout: 12_000 })
    await page.unroute(ticketPattern)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${referenceTicketId}` && candidate.request().method() === "GET"),
      page.getByTestId("ticket-detail-retry-stale").click(),
    ])
    if (!response.ok()) throw new Error(`stale_ticket_recovery_http_${response.status()}`)
    await page.getByTestId("ticket-detail-stale").waitFor({ state: "hidden", timeout: 10_000 })
    return { staleStateObserved: true, retrySucceeded: true }
  })
} finally {
  await page?.close()
  await context.close()
  await browser.close()
  await writeFile(path.join(outputDirectory, "service-desk-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
}

if (report.results.length !== 20 || report.results.some((result) => result.status !== "passed")) process.exitCode = 1
