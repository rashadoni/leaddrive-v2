import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Customer Support Portal flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Customer Support Portal flow evidence refuses a non-local host")
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
  if (values.length !== 1 || !allowed.has(values[0])) throw new Error(`${name} must select exactly one supported value for flow evidence`)
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
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const portalUser = {
  email: requiredEnv("SUPPORT_EVIDENCE_PORTAL_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_PORTAL_PASSWORD"),
  slug: requiredEnv("SUPPORT_EVIDENCE_PORTAL_SLUG"),
}
const ticketId = requiredEnv("SUPPORT_EVIDENCE_PORTAL_TICKET_ID")
const closureToken = requiredEnv("SUPPORT_EVIDENCE_CLOSURE_TOKEN")

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) }
}

function ticketPayload(overrides = {}) {
  return {
    id: ticketId,
    ticketNumber: "SUP-EVIDENCE-101",
    subject: "Evidence portal request",
    description: "A customer-visible request used only in the disposable evidence tenant.",
    status: "resolved",
    category: "technical",
    categoryRef: { name: "Technical", slug: "technical" },
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:30:00.000Z",
    resolvedAt: "2026-09-06T08:30:00.000Z",
    closedAt: null,
    slaDueAt: "2026-09-07T08:00:00.000Z",
    slaFirstResponseDueAt: "2026-09-06T10:00:00.000Z",
    firstResponseAt: "2026-09-06T08:15:00.000Z",
    comments: [],
    ...overrides,
  }
}

function closurePayload(status = "pending") {
  return {
    id: "closure-evidence-1",
    status,
    dueAt: "2026-09-13T08:30:00.000Z",
    ticket: { ticketNumber: "SUP-EVIDENCE-101", subject: "Evidence portal request", status: status === "confirmed" ? "closed" : "resolved" },
  }
}

async function authenticate(context) {
  const response = await context.request.post("/api/v1/public/portal-auth", { data: portalUser })
  const body = await response.json().catch(() => null)
  if (!response.ok() || !body?.success || !body?.data || !body?.token) throw new Error("customer_portal_authentication_failed")
  assertDemoTenant(JSON.stringify(body.data), demoOrganization, "Customer Support Portal authentication")
  await context.addCookies([{ name: "portal-token", value: body.token, url: baseUrl, httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "Lax" }])
  await context.addInitScript((user) => localStorage.setItem("portal-user", JSON.stringify(user)), body.data)
}

async function installPortalConfig(page, supportAi = false) {
  await page.route("**/api/v1/public/portal-config**", (route) => route.fulfill(json({
    success: true,
    data: { features: { supportAi, loyalty: false, complaints_register: false }, brands: [], productCategories: [] },
  })))
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overflow) throw new Error(`${label}_horizontal_overflow`)
}

await mkdir(outputDirectory, { recursive: true })
const report = { generatedAt: new Date().toISOString(), commit, targetHost: hostname, demoOrganization, role: "customer", locale, theme, viewport: viewportName, results: [] }

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ baseURL: baseUrl, viewport: viewports[viewportName], locale, colorScheme: theme, reducedMotion: "reduce", hasTouch: viewportName !== "desktop" })
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[customer-portal-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `customer-portal-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `customer-portal-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await context.setOffline(false).catch(() => undefined)
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
try {
  await authenticate(context)

  await recordStep(page, "ticket-list-recovery-filter-draft-and-offline", async () => {
    await installPortalConfig(page)
    let getAttempts = 0
    await page.route(/\/api\/v1\/public\/portal-tickets(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") return route.fulfill(json({ error: "Synthetic create failure" }, 503))
      getAttempts += 1
      if (getAttempts === 1) return route.fulfill(json({ error: "Synthetic list failure" }, 503))
      return route.fulfill(json({ success: true, data: [ticketPayload()] }))
    })
    await page.goto("/portal/tickets", { waitUntil: "domcontentloaded" })
    await page.getByTestId("portal-tickets-error").waitFor({ state: "visible" })
    await page.getByTestId("portal-tickets-retry").focus()
    await page.getByTestId("portal-tickets-retry").press("Enter")
    await page.locator("[data-testid='portal-tickets-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.getByTestId("portal-tickets-search").fill("no matching evidence ticket")
    await page.locator("[data-testid='portal-tickets-empty-state'][data-kind='filtered']").waitFor({ state: "visible" })
    await page.getByTestId("portal-tickets-search").fill("")
    await page.getByTestId("portal-new-ticket-toggle").click()
    await page.getByTestId("portal-new-ticket-subject").fill("Draft survives create failure")
    await page.getByTestId("portal-new-ticket-description").fill("Evidence draft body")
    await page.getByTestId("portal-new-ticket-submit").click()
    await page.getByTestId("portal-new-ticket-error").waitFor({ state: "visible" })
    if (await page.getByTestId("portal-new-ticket-subject").inputValue() !== "Draft survives create failure") throw new Error("portal_create_failure_lost_draft")
    const storedDraft = await page.evaluate(() => localStorage.getItem("portal:new-ticket"))
    if (!storedDraft) throw new Error("portal_create_failure_draft_not_persisted")
    await context.setOffline(true)
    await page.getByTestId("portal-tickets-offline").waitFor({ state: "visible" })
    if (!await page.getByTestId("portal-new-ticket-submit").isDisabled()) throw new Error("portal_offline_create_not_blocked")
    await assertNoHorizontalOverflow(page, "portal_ticket_list")
    return { transientRecovery: true, keyboardRetry: true, filteredEmpty: true, failedMutationDraftRetained: true, offlineDraftState: true }
  })

  await recordStep(page, "ticket-detail-load-attachment-send-recovery-and-reopen", async () => {
    await installPortalConfig(page)
    let detailGets = 0
    let sendAttempts = 0
    let currentTicket = ticketPayload()
    const detailPattern = new RegExp(`/api/v1/public/portal-tickets/${ticketId}(?:\\?.*)?$`)
    await page.route(detailPattern, async (route) => {
      if (route.request().method() === "GET") {
        detailGets += 1
        if (detailGets === 1) return route.fulfill(json({ error: "Synthetic ticket failure" }, 503))
        return route.fulfill(json({ success: true, data: currentTicket }))
      }
      if (route.request().method() === "POST") {
        sendAttempts += 1
        if (sendAttempts === 1) return route.fulfill(json({ error: "Synthetic reply failure" }, 503))
        const requestBody = route.request().postDataJSON()
        currentTicket = ticketPayload({ status: "open", resolvedAt: null, comments: [{ id: "comment-evidence-1", comment: requestBody.comment, isAgent: false, authorName: "Evidence Customer", createdAt: "2026-09-06T09:00:00.000Z", attachments: [] }] })
        return route.fulfill(json({ success: true, data: currentTicket.comments[0] }))
      }
      return route.fulfill(json({ success: true, data: currentTicket }))
    })
    await page.route(`**/api/v1/public/portal-tickets/${ticketId}/files`, async (route) => {
      if (route.request().method() === "POST") return route.fulfill(json({ success: true, data: { id: "attachment-evidence-1", commentId: null, originalName: "evidence.txt", fileSize: 16, mimeType: "text/plain" } }))
      return route.fulfill(json({ success: true, data: [] }))
    })
    await page.goto(`/portal/tickets/${encodeURIComponent(ticketId)}`, { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='portal-ticket-workspace'][data-state='error']").waitFor({ state: "visible" })
    await page.getByTestId("portal-ticket-retry").click()
    await page.locator("[data-testid='portal-ticket-workspace'][data-state='ready'][data-terminal='true']").waitFor({ state: "visible" })
    await page.getByTestId("portal-ticket-file").setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("portal evidence\n") })
    await page.getByText("evidence.txt", { exact: true }).waitFor({ state: "visible" })
    await page.getByTestId("portal-ticket-reply").fill("Please reopen this request")
    await page.getByTestId("portal-ticket-send").click()
    await page.getByTestId("portal-ticket-mutation-error").waitFor({ state: "visible" })
    if (await page.getByTestId("portal-ticket-reply").inputValue() !== "Please reopen this request") throw new Error("portal_reply_failure_lost_draft")
    await page.getByTestId("portal-ticket-send").focus()
    await page.getByTestId("portal-ticket-send").press("Enter")
    await page.locator("[data-testid='portal-ticket-workspace'][data-status='open'][data-terminal='false']").waitFor({ state: "visible" })
    await page.getByTestId("portal-ticket-send-success").waitFor({ state: "visible" })
    if (await page.getByTestId("portal-ticket-reply").inputValue() !== "") throw new Error("portal_successful_reply_draft_not_cleared")
    await assertNoHorizontalOverflow(page, "portal_ticket_detail")
    return { loadRecovery: true, attachmentLinkedToDraft: true, failedReplyRetained: true, keyboardRetry: true, terminalReplyReopened: true }
  })

  await recordStep(page, "chat-disabled-unavailable-and-manual-handoff", async () => {
    const configPattern = "**/api/v1/public/portal-config**"
    const unavailable = (route) => route.fulfill(json({ error: "Synthetic configuration failure" }, 503))
    await page.route(configPattern, unavailable)
    await page.goto("/portal/chat", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='portal-chat-workspace'][data-state='unavailable']").waitFor({ state: "visible" })
    await page.unroute(configPattern, unavailable)
    await installPortalConfig(page, false)
    await page.getByTestId("portal-chat-retry-availability").focus()
    await page.getByTestId("portal-chat-retry-availability").press("Enter")
    await page.locator("[data-testid='portal-chat-workspace'][data-state='disabled']").waitFor({ state: "visible" })
    await page.getByTestId("portal-chat-manual-ticket").click()
    await page.waitForURL(/\/portal\/tickets\?action=new$/)
    await page.getByTestId("portal-new-ticket-form").waitFor({ state: "visible" })
    await assertNoHorizontalOverflow(page, "portal_chat_disabled")
    return { unavailableState: true, keyboardRecovery: true, disabledState: true, manualTicketReachable: true }
  })

  await recordStep(page, "chat-send-offline-degraded-and-escalation-recovery", async () => {
    await installPortalConfig(page, true)
    let sends = 0
    await page.route("**/api/v1/public/portal-chat", async (route) => {
      sends += 1
      if (sends === 1) return route.fulfill(json({ error: "Synthetic chat failure" }, 503))
      const escalated = sends >= 3
      return route.fulfill(json({ success: true, data: {
        sessionId: "portal-chat-evidence",
        reply: { id: `reply-${sends}`, content: escalated ? "A support specialist is now assigned." : "Use manual support if this answer is incomplete.", createdAt: "2026-09-06T09:05:00.000Z" },
        degraded: sends === 2,
        escalated,
        escalationTicketId: escalated ? ticketId : null,
        escalationTicketNumber: escalated ? "SUP-EVIDENCE-101" : null,
      } }))
    })
    await page.goto("/portal/chat", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='portal-chat-workspace'][data-state='enabled']").waitFor({ state: "visible" })
    await context.setOffline(true)
    await page.getByTestId("portal-chat-input").fill("Keep this offline draft")
    await page.getByTestId("portal-chat-offline").waitFor({ state: "visible" })
    if (!await page.getByTestId("portal-chat-send").isDisabled()) throw new Error("portal_chat_offline_send_not_blocked")
    await context.setOffline(false)
    await page.getByTestId("portal-chat-input").press("Enter")
    await page.getByTestId("portal-chat-send-error").waitFor({ state: "visible" })
    await page.getByTestId("portal-chat-retry-send").click()
    await page.getByText("Use manual support if this answer is incomplete.", { exact: true }).waitFor({ state: "visible" })
    if (await page.getByTestId("portal-chat-log").getByRole("button").count() === 0) throw new Error("portal_chat_degraded_manual_handoff_missing")
    await page.getByTestId("portal-chat-input").fill("I need a human specialist")
    await page.getByTestId("portal-chat-send").click()
    await page.getByText("SUP-EVIDENCE-101", { exact: false }).waitFor({ state: "visible" })
    await assertNoHorizontalOverflow(page, "portal_chat_enabled")
    return { offlineDraft: true, failedSendRecovery: true, degradedManualHandoff: true, escalationTicketLink: true }
  })

  await recordStep(page, "closure-load-save-recovery-and-terminal-outcomes", async () => {
    let getAttempts = 0
    let postAttempts = 0
    let status = "pending"
    const closurePattern = `**/api/v1/public/ticket-closure/${closureToken}`
    await page.route(closurePattern, async (route) => {
      if (route.request().method() === "GET") {
        getAttempts += 1
        if (getAttempts === 1) return route.fulfill(json({ error: "Synthetic closure load failure" }, 503))
        return route.fulfill(json({ success: true, data: closurePayload(status) }))
      }
      postAttempts += 1
      if (postAttempts === 1) return route.fulfill(json({ error: "Synthetic closure save failure" }, 503))
      status = route.request().postDataJSON().action === "confirm" ? "confirmed" : "rejected"
      return route.fulfill(json({ success: true, data: closurePayload(status) }))
    })
    await page.goto(`/ticket-closure/${encodeURIComponent(closureToken)}`, { waitUntil: "domcontentloaded" })
    await page.getByTestId("ticket-closure-error").waitFor({ state: "visible" })
    await page.getByTestId("ticket-closure-retry").focus()
    await page.getByTestId("ticket-closure-retry").press("Enter")
    await page.locator("[data-testid='ticket-closure-workspace'][data-state='ready'][data-status='pending']").waitFor({ state: "visible" })
    await page.getByTestId("ticket-closure-confirm").click()
    await page.getByTestId("ticket-closure-save-error").waitFor({ state: "visible" })
    if (!await page.getByTestId("ticket-closure-confirm").isEnabled()) throw new Error("portal_closure_failure_not_recoverable")
    await page.getByTestId("ticket-closure-confirm").click()
    await page.locator("[data-testid='ticket-closure-workspace'][data-status='confirmed']").waitFor({ state: "visible" })
    await page.getByTestId("ticket-closure-success").waitFor({ state: "visible" })
    for (const terminalStatus of ["rejected", "expired", "canceled"]) {
      status = terminalStatus
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator(`[data-testid='ticket-closure-workspace'][data-status='${terminalStatus}']`).waitFor({ state: "visible" })
      await page.getByTestId("ticket-closure-outcome").waitFor({ state: "visible" })
    }
    await assertNoHorizontalOverflow(page, "ticket_closure")
    return { loadRecovery: true, keyboardRetry: true, failedSaveRecoverable: true, confirmed: true, rejected: true, expired: true, canceled: true }
  })

  await recordStep(page, "direct-route-authentication-and-invalid-resource-boundaries", async () => {
    const isolated = await browser.newContext({ baseURL: baseUrl, viewport: viewports[viewportName] })
    const isolatedPage = await isolated.newPage()
    try {
      await isolatedPage.goto("/portal/tickets", { waitUntil: "domcontentloaded" })
      await isolatedPage.waitForURL(/\/portal\/login(?:\?.*)?$/, { timeout: 15_000 })
    } finally {
      await isolated.close()
    }
    await installPortalConfig(page)
    await page.route("**/api/v1/public/portal-tickets/not-a-tenant-ticket", (route) => route.fulfill(json({ error: "Not found" }, 404)))
    await page.goto("/portal/tickets/not-a-tenant-ticket", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='portal-ticket-workspace'][data-state='error']").waitFor({ state: "visible" })
    if (await page.getByTestId("portal-ticket-conversation").count() !== 0) throw new Error("portal_invalid_direct_route_exposed_ticket_content")
    return { unauthenticatedPortalRedirect: true, invalidDirectResourceDenied: true, protectedContentAbsent: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "customer-portal-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
