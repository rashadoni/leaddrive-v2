/**
 * Independent acceptance derived from the 2026-10-04 Support UX audit.
 * Executes real handlers against disposable, authenticated CI fixtures.
 * Only whitelisted assertion IDs/statuses are persisted; never response bodies,
 * cookies, credentials, DOM dumps, screenshots, or raw exception messages.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { chromium } from "playwright"
import { makeScriptPrisma } from "./_rls.mjs"

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])
const CONFIRM = "ephemeral-audit-20261004-v1"
class AcceptanceFailure extends Error {
  constructor(code, diagnostics = {}) {
    super(code)
    this.name = "AcceptanceFailure"
    this.code = code
    this.actualHTTPStatus = diagnostics.actualHTTPStatus
    this.expectedHTTPStatus = diagnostics.expectedHTTPStatus
  }
}
const SAFE_ERROR_NAMES = new Set(["AcceptanceFailure", "Error", "TimeoutError", "TypeError", "RangeError",
  "ReferenceError", "SyntaxError", "PrismaClientKnownRequestError", "PrismaClientInitializationError",
  "PrismaClientValidationError"])
export function safeFailure(error) {
  return {
    code: error instanceof AcceptanceFailure ? error.code : "UNEXPECTED_FAILURE",
    errorName: SAFE_ERROR_NAMES.has(error?.name) ? error.name : "UnknownError",
    ...(Number.isInteger(error?.actualHTTPStatus) && error.actualHTTPStatus >= 100 && error.actualHTTPStatus <= 599
      ? { actualHTTPStatus: error.actualHTTPStatus } : {}),
    ...(Number.isInteger(error?.expectedHTTPStatus) && error.expectedHTTPStatus >= 100 && error.expectedHTTPStatus <= 599
      ? { expectedHTTPStatus: error.expectedHTTPStatus } : {}),
  }
}
function checkHttp(response, expected, code = "HTTP_STATUS_UNEXPECTED") {
  if (response.status() !== expected) {
    throw new AcceptanceFailure(code, { actualHTTPStatus: response.status(), expectedHTTPStatus: expected })
  }
}
// Attach rejection handlers to both branches before either callback runs.
// Await settlement of both so a timed-out click cannot leave an orphan response
// promise (or a still-running click) behind when the next case starts.
export async function observeAction(waitForResult, action) {
  const [observed, performed] = await Promise.allSettled([
    Promise.resolve().then(waitForResult),
    Promise.resolve().then(action),
  ])
  if (performed.status === "rejected") throw performed.reason
  if (observed.status === "rejected") throw observed.reason
  return observed.value
}
function check(condition, code) {
  if (!condition) throw new AcceptanceFailure(code)
}
export function assertAcceptanceTarget(env) {
  check(env.CI === "true" && env.GITHUB_ACTIONS === "true", "CI_ONLY")
  check(env.SUPPORT_EVIDENCE_TARGET_MODE === "ephemeral", "EPHEMERAL_ONLY")
  check(env.SUPPORT_AUDIT_ACCEPTANCE === CONFIRM, "CONFIRMATION_REQUIRED")
  check(/^[a-f0-9]{40}$/.test(env.SUPPORT_EVIDENCE_COMMIT || ""), "EXACT_SHA_REQUIRED")
  check(env.GITHUB_SHA === env.SUPPORT_EVIDENCE_COMMIT, "CHECKOUT_SHA_MISMATCH")
  let app, database
  try { app = new URL(env.SCREENSHOT_BASE_URL); database = new URL(env.DATABASE_URL) }
  catch { throw new AcceptanceFailure("TARGET_URL_INVALID") }
  check(LOCAL.has(app.hostname) && app.protocol === "http:", "LOCAL_APP_ONLY")
  check(LOCAL.has(database.hostname) && ["postgres:", "postgresql:"].includes(database.protocol)
    && database.pathname === "/support_ux_evidence", "DISPOSABLE_DATABASE_ONLY")
  check(env.SCREENSHOT_DEMO_ORG === "Northstar Support Lab", "SYNTHETIC_ORG_REQUIRED")
  check(Boolean(env.SUPPORT_EVIDENCE_ORGANIZATION_ID), "ORG_ID_REQUIRED")
  return { baseUrl: app.origin, hostname: app.hostname, orgId: env.SUPPORT_EVIDENCE_ORGANIZATION_ID }
}

async function main() {
  const target = assertAcceptanceTarget(process.env)
  const commit = process.env.SUPPORT_EVIDENCE_COMMIT
  const outputDirectory = path.resolve("artifacts", "support-ux", commit)
  await mkdir(outputDirectory, { recursive: true })
  const report = { schemaVersion: 1, commit, suite: "support-audit-functional", target: "ephemeral-localhost",
    generatedAt: new Date().toISOString(), cases: [], cleanup: "pending", passed: false }
  const checkpoint = () => writeFileSync(path.join(outputDirectory, "audit-functional-progress.json"),
    JSON.stringify({ schemaVersion: 1, commit, phase, completedCases: report.cases.length,
      cases: report.cases, passed: false }) + "\n")
  const cleanups = []
  let db, browser, context, page
  let phase = "bootstrap"
  checkpoint()
  let blockedExternalRequests = 0
  const orgId = target.orgId
  const prefix = "Audit-" + randomUUID().slice(0, 8)
  async function record(id, action) {
    phase = id
    checkpoint()
    try {
      await action()
      report.cases.push({ id, status: "passed" })
    } catch (error) {
      report.cases.push({ id, status: "failed", stage: phase,
        ...safeFailure(error) })
    } finally {
      checkpoint()
      if (page) {
        await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
        const composer = page.getByTestId("ticket-comment-composer")
        if (await composer.isVisible().catch(() => false)) await composer.fill("").catch(() => undefined)
      }
    }
  }
  const mark = (name) => { phase = name; checkpoint() }
  async function api(method, url, data, expected = 200, request = context.request) {
    const response = await request.fetch(url, { method, ...(data === undefined ? {} : { data }) })
    checkHttp(response, expected)
    return response.json()
  }
  async function actionResponse(endpoint, method, action, expected = 200, code = "HTTP_STATUS_UNEXPECTED") {
    const response = await observeAction(
      () => page.waitForResponse(item => new URL(item.url()).pathname === endpoint && item.request().method() === method),
      action,
    )
    checkHttp(response, expected, code)
    return response
  }
  async function ticketControlSynced(kind, value) {
    await page.waitForFunction(({ kind, value }) => {
      const select = document.querySelector("[data-testid='ticket-" + kind + "-select']")
      const submit = document.querySelector("[data-testid='ticket-" + kind + "-submit']")
      return select?.value === value && submit?.getAttribute("data-state") === "synced"
    }, { kind, value })
  }
  async function ticketControlReady(kind) {
    await page.locator("[data-testid='ticket-" + kind + "-submit'][data-state='ready']:not(:disabled)")
      .waitFor({ state: "visible" })
  }
  async function eventually(predicate, code) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new AcceptanceFailure(code)
  }
  async function signIn(browserContext, email, password) {
    check(email.endsWith("@support-evidence.invalid") && Boolean(password), "SYNTHETIC_CREDENTIALS_REQUIRED")
    const csrfResponse = await browserContext.request.get("/api/auth/csrf")
    checkHttp(csrfResponse, 200, "CSRF_FAILED")
    const csrf = await csrfResponse.json()
    const response = await browserContext.request.post("/api/auth/callback/credentials", {
      form: { csrfToken: csrf.csrfToken, email, password, callbackUrl: target.baseUrl + "/tickets", json: "true" },
    })
    checkHttp(response, 200, "AUTH_FAILED")
    const sessionResponse = await browserContext.request.get("/api/auth/session")
    const session = await sessionResponse.json()
    check(Boolean(session?.user?.id) && session.user.email === email, "AUTH_SESSION_MISMATCH")
    return session.user.id
  }
  async function newContext(viewport = { width: 1440, height: 1000 }) {
    const result = await browser.newContext({ baseURL: target.baseUrl, viewport, locale: "en",
      timezoneId: "Asia/Baku", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" })
    await result.route("**/*", async route => {
      let origin
      try { origin = new URL(route.request().url()).origin } catch { origin = "" }
      if (origin !== target.baseUrl) { blockedExternalRequests += 1; await route.abort("blockedbyclient") }
      else await route.continue()
    })
    await result.addCookies([{ name: "NEXT_LOCALE", value: "en", domain: target.hostname, path: "/" }])
    return result
  }
  async function open(url, ready) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    check(Boolean(response) && response.status() < 400, "PAGE_LOAD_FAILED")
    if (ready) await page.getByTestId(ready).waitFor({ state: "visible", timeout: 30000 })
    // Tour is a real product overlay, not a test mock. Dismiss only unrelated tours.
    const overlay = page.getByTestId("tour-overlay")
    if (await overlay.waitFor({ state: "visible", timeout: 1200 }).then(() => true).catch(() => false)) {
      await page.keyboard.press("Escape")
      await overlay.waitFor({ state: "hidden" })
    }
  }
  async function ticket(label, data = {}) {
    const row = await db.ticket.create({ data: { organizationId: orgId, ticketNumber: prefix + "-" + label,
      subject: prefix + " " + label, description: "Synthetic audit acceptance fixture", status: "new",
      priority: "medium", source: "agent", ...data } })
    cleanups.push(async () => {
      await db.auditLog.deleteMany({ where: { organizationId: orgId, entityId: row.id } })
      await db.ticket.deleteMany({ where: { organizationId: orgId, id: row.id } })
    })
    return row
  }
  try {
    mark("bootstrap-database")
    db = await makeScriptPrisma({ orgId })
    const org = await db.organization.findFirst({ where: { id: orgId },
      select: { slug: true, name: true, provisionedBy: true } })
    check(org?.slug === "support-evidence" && org.name === "Northstar Support Lab"
      && org.provisionedBy === "support-ux-evidence-ci", "FIXTURE_IDENTITY_MISMATCH")
    mark("bootstrap-browser")
    browser = await chromium.launch({ headless: true })
    context = await newContext()
    const actorId = await signIn(context, process.env.SUPPORT_EVIDENCE_ADMIN_EMAIL, process.env.SUPPORT_EVIDENCE_ADMIN_PASSWORD)
    const actor = await db.user.findFirst({ where: { id: actorId, organizationId: orgId } })
    check(actor?.role === "admin", "ADMIN_IDENTITY_MISMATCH")
    page = await context.newPage()
    page.setDefaultTimeout(20000)

    await record("UX01-empty-report-ui-api-csv", async () => {
      const query = prefix + "-no-match"
      mark("ux01-api-empty")
      const payload = await api("GET", "/api/v1/reports?q=" + encodeURIComponent(query))
      const totals = payload.data.serviceDesk.totals
      check(totals.slaComplianceRate === null && totals.slaComplianceSampleSize === 0
        && totals.slaCompliantTickets === 0, "EMPTY_SAMPLE_NOT_NULL")
      mark("ux01-ui-empty")
      await open("/tickets?view=reports&q=" + encodeURIComponent(query), "ticketing-report-workspace")
      const workspace = page.getByTestId("ticketing-report-workspace")
      const metric = workspace.getByText("Active without SLA breach", { exact: true }).locator("../..")
      check((await metric.innerText()).includes("No data") && !(await metric.innerText()).includes("100%"), "EMPTY_UI_PERCENT")
      check((await page.getByTestId("ticketing-report-sla-sample").innerText()).includes("0"), "SAMPLE_MISSING")
      await page.getByTestId("ticketing-report-scope").waitFor({ state: "visible" })
      mark("ux01-csv")
      const download = await observeAction(
        () => page.waitForEvent("download"),
        () => workspace.getByRole("button", { name: "CSV", exact: true }).click(),
      )
      const csv = await readFile(await download.path(), "utf8")
      check(/Active without SLA breach.*No data/.test(csv), "CSV_EMPTY_METRIC_MISMATCH")
      mark("ux01-nonempty-api")
      const full = (await api("GET", "/api/v1/reports")).data.serviceDesk.totals
      check(full.slaComplianceSampleSize > 0
        && full.slaComplianceRate === Math.round(100 * full.slaCompliantTickets / full.slaComplianceSampleSize),
      "NONEMPTY_RATE_COUNTS_MISMATCH")
      for (const view of ["list", "kanban"]) {
        mark("ux01-filter-reset-" + view)
        await open("/tickets?view=" + view + "&q=" + encodeURIComponent(query), "tickets-workspace")
        await page.getByTestId("tickets-search").fill(query)
        // DataTable intentionally renders separate desktop and mobile empty
        // states. Exercise the one visible at this viewport, without first().
        const empty = page.getByTestId(view === "list" ? "tickets-no-results-state" : "tickets-kanban-no-results-state")
          .filter({ visible: true })
        await empty.waitFor({ state: "visible" })
        check(await empty.count() === 1, "VISIBLE_EMPTY_STATE_NOT_UNIQUE")
        await empty.getByRole("button", { name: "Reset filters", exact: true }).click()
        await empty.waitFor({ state: "hidden" })
        await page.waitForFunction(() => document.querySelector("[data-testid='tickets-search']")?.value === ""
          && !new URLSearchParams(window.location.search).has("q"))
        const resultSelector = view === "list"
          ? "[data-testid='tickets-workspace'] tbody tr[tabindex='0']:visible"
          : "[data-testid='tickets-kanban-viewport'] article:visible"
        await eventually(async () => await page.locator(resultSelector).count() > 0, "RESET_DID_NOT_RESTORE_TICKETS")
      }
    })

    await record("UX02-working-calendar-capture-stale-history", async () => {
      cleanups.push(() => db.slaPolicy.deleteMany({ where: { organizationId: orgId, name: { startsWith: prefix } } }))
      const history = await db.ticket.findMany({ where: { organizationId: orgId },
        select: { id: true, slaDueAt: true, slaFirstResponseDueAt: true, slaCalendarSnapshot: true }, orderBy: { id: "asc" } })
      const old = await db.businessHours.findUnique({ where: { organizationId_channelType: { organizationId: orgId, channelType: "all" } } })
      cleanups.push(async () => {
        if (old) {
          const { id, organizationId: ignoredOrg, createdAt, ...values } = old
          void ignoredOrg; void createdAt
          await db.businessHours.update({ where: { id }, data: values })
        } else await db.businessHours.deleteMany({ where: { organizationId: orgId, channelType: "all" } })
      })
      const schedule = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(day => [day,
        { enabled: !["sun", "sat"].includes(day), intervals: ["sun", "sat"].includes(day) ? [] : [{ start: "09:00", end: "18:00" }] }]))
      const source = await db.businessHours.upsert({
        where: { organizationId_channelType: { organizationId: orgId, channelType: "all" } },
        create: { organizationId: orgId, channelType: "all", timezone: "Asia/Baku", schedule,
          holidays: [{ date: "2026-10-12", name: "Synthetic holiday", closed: true }], isActive: true },
        update: { timezone: "Asia/Baku", schedule, holidays: [{ date: "2026-10-12", name: "Synthetic holiday", closed: true }], isActive: true },
      })
      mark("ux02-stale-source")
      const preview = (await api("GET", "/api/v1/sla-policies/calendar")).data
      await db.businessHours.update({ where: { id: source.id }, data: { updatedAt: new Date(source.updatedAt.getTime() + 5000) } })
      const stale = await api("POST", "/api/v1/sla-policies", { name: prefix + "-stale", priority: "low",
        firstResponseHours: 4, resolutionHours: 8, businessHoursOnly: true, isActive: false,
        businessCalendarAction: "capture", expectedCalendarUpdatedAt: preview.sourceUpdatedAt }, 409)
      check(stale.code === "SLA_CALENDAR_SOURCE_CHANGED", "STALE_SOURCE_ACCEPTED")
      mark("ux02-ui-capture")
      await open("/settings/sla-policies", "sla-policies-workspace")
      await page.getByTestId("sla-policies-create").click()
      const form = page.getByTestId("sla-policy-form")
      await form.waitFor({ state: "visible" })
      await page.locator("#sla-policy-name").fill(prefix + "-working")
      await page.locator("#sla-policy-priority").selectOption("low")
      await page.getByTestId("sla-policy-active").uncheck()
      await page.getByTestId("sla-response-hours").fill("4")
      await page.getByTestId("sla-resolution-hours").fill("8")
      await page.locator("#sla-calendar-selection option[value='capture']").waitFor({ state: "attached" })
      await page.waitForFunction(() => !document.querySelector("#sla-calendar-selection option[value='capture']")?.disabled)
      await page.locator("#sla-calendar-selection").selectOption("capture")
      await form.locator("summary").filter({ hasText: "Asia/Baku" }).click()
      check((await form.innerText()).includes("09:00–18:00") && (await form.innerText()).includes("2026-10-12"),
        "CALENDAR_DETAILS_MISSING")
      check(/working/i.test(await page.getByTestId("sla-policy-preview").innerText()), "WORKING_PREVIEW_MISSING")
      await actionResponse("/api/v1/sla-policies", "POST",
        () => page.getByTestId("sla-policy-submit").click(), 201, "CALENDAR_UI_SAVE_FAILED")
      await form.waitFor({ state: "hidden" })
      const saved = await db.slaPolicy.findFirst({ where: { organizationId: orgId, name: prefix + "-working" } })
      check(Boolean(saved), "CAPTURED_POLICY_MISSING")
      // The prefix-scoped cleanup was registered before the create request.
      check(saved.businessHoursOnly && saved.businessCalendar?.timezone === "Asia/Baku"
        && saved.businessCalendar?.holidays?.[0]?.date === "2026-10-12", "SAVED_CALENDAR_MISMATCH")
      const pinned = JSON.stringify(saved.businessCalendar)
      await db.businessHours.update({ where: { id: source.id }, data: { timezone: "UTC" } })
      check(JSON.stringify((await db.slaPolicy.findUnique({ where: { id: saved.id } })).businessCalendar) === pinned,
        "CALENDAR_NOT_PINNED")
      const after = await db.ticket.findMany({ where: { organizationId: orgId },
        select: { id: true, slaDueAt: true, slaFirstResponseDueAt: true, slaCalendarSnapshot: true }, orderBy: { id: "asc" } })
      check(JSON.stringify(history) === JSON.stringify(after), "HISTORICAL_DEADLINES_CHANGED")
    })

    await record("UX03-template-copy-draft-active-independence", async () => {
      mark("ux03-template-original")
      const templates = (await api("GET", "/api/v1/entitlement-templates")).templates
      const original = templates.find(item => item.supportLevel === "basic")
      check(Boolean(original), "BASIC_TEMPLATE_MISSING")
      const templateBody = item => ({ supportLevel: "basic", name: item.name, description: item.description,
        isActive: item.isActive, definitions: item.definitions.map(def => ({
          type: def.type, name: def.name, severityTier: def.severityTier || "all",
          dueValue: def.dueWithinSeconds / 60, dueUnit: "minutes", isRequired: def.isRequired,
        })) })
      cleanups.push(() => api("PUT", "/api/v1/entitlement-templates", templateBody(original)))
      await api("PUT", "/api/v1/entitlement-templates", { supportLevel: "basic", name: prefix + "-template",
        isActive: true, definitions: [{ type: "resolution", name: "Synthetic resolution",
          severityTier: "all", dueValue: 4, dueUnit: "hours", isRequired: true }] })
      const company = await db.company.create({ data: { organizationId: orgId, name: prefix + "-company" } })
      cleanups.push(() => db.company.deleteMany({ where: { id: company.id, organizationId: orgId } }))
      const created = await api("POST", "/api/v1/entitlements", { companyId: company.id,
        slaPolicyId: process.env.SUPPORT_EVIDENCE_SLA_POLICY_ID, supportLevel: "basic" }, 201)
      const entitlementId = created.createdEntitlementId
      check(Boolean(entitlementId), "ENTITLEMENT_NOT_CREATED")
      cleanups.push(() => db.entitlement.deleteMany({ where: { id: entitlementId, organizationId: orgId } }))
      check((await db.entitlement.findUnique({ where: { id: entitlementId } })).status === "draft", "COPY_NOT_DRAFT")
      mark("ux03-copy-and-template-edit")
      await api("POST", "/api/v1/entitlements/" + entitlementId + "/milestones", { mode: "template", template: "basic" })
      const definitions = await db.entitlementMilestoneDefinition.findMany({ where: { organizationId: orgId, entitlementId } })
      check(definitions.length === 1 && definitions[0].dueWithinSeconds === 14400, "TEMPLATE_COPY_MISMATCH")
      await api("PUT", "/api/v1/entitlement-templates", { supportLevel: "basic", name: prefix + "-changed",
        isActive: true, definitions: [{ type: "resolution", name: "Changed resolution",
          severityTier: "all", dueValue: 9, dueUnit: "hours", isRequired: true }] })
      check((await db.entitlementMilestoneDefinition.findUnique({ where: { id: definitions[0].id } })).dueWithinSeconds === 14400,
        "TEMPLATE_RETROACTIVELY_CHANGED_COPY")
      mark("ux03-activate")
      await api("PATCH", "/api/v1/entitlements/" + entitlementId, { action: "activate" })
      check((await db.entitlement.findUnique({ where: { id: entitlementId } })).status === "active", "ACTIVATION_FAILED")
      await open("/support/entitlements")
      await page.getByRole("heading", { name: "Support terms", exact: true }).waitFor({ state: "visible" })
    })

    await record("UX04-mobile-tour-visible-targets-skip-replay", async () => {
      await page.setViewportSize({ width: 375, height: 812 })
      try {
        mark("ux04-mobile-tour-start")
        await open("/support/skill-routing", "skill-routing-workspace")
        await page.getByTestId("skill-routing-tab-agents").click()
        await page.getByRole("button", { name: "Replay tour", exact: true }).click()
        await page.getByTestId("tour-overlay").waitFor({ state: "visible" })
        for (const [index, targetId] of ["sr-header", "sr-queues", "sr-agents"].entries()) {
          mark("ux04-visible-step-" + index)
          const element = page.locator("[data-tour-id='" + targetId + "']")
          await element.waitFor({ state: "visible" })
          const box = await element.boundingBox()
          check(box && box.width > 0 && box.height > 0 && box.x < 375 && box.x + box.width > 0
            && box.y < 812 && box.y + box.height > 0, "TOUR_TARGET_HIDDEN")
          if (index < 2) await page.getByRole("button", { name: "Next", exact: true }).click()
        }
        await page.keyboard.press("Escape")
        await page.getByTestId("tour-overlay").waitFor({ state: "hidden" })
        check(await page.getByTestId("skill-routing-tab-agents").getAttribute("aria-selected") === "true", "TOUR_LOST_USER_TAB")
        await page.getByRole("button", { name: "Replay tour", exact: true }).click()
        await page.getByTestId("tour-overlay").waitFor({ state: "visible" })
        await page.keyboard.press("Escape")
        await page.getByTestId("tour-overlay").waitFor({ state: "hidden" })
      } finally { await page.setViewportSize({ width: 1440, height: 1000 }) }
    })

    await record("UX05-quick-full-status-assignment-draft", async () => {
      const row = await ticket("quick")
      await open("/tickets/" + row.id, "ticket-detail-workspace")
      const draft = "Synthetic unsent reply preserved"
      await page.getByTestId("ticket-comment-composer").fill(draft)
      mark("ux05-quick-status")
      await actionResponse("/api/v1/tickets/" + row.id, "PUT",
        () => page.locator("[aria-label='Ticket status progress']").getByRole("button", { name: "In Progress", exact: true }).click(),
        200, "QUICK_STATUS_FAILED")
      check((await db.ticket.findUnique({ where: { id: row.id } })).status === "in_progress", "QUICK_STATUS_NOT_SAVED")
      await ticketControlSynced("status", "in_progress")
      mark("ux05-full-status")
      await page.getByTestId("ticket-status-select").selectOption("waiting")
      check((await db.ticket.findUnique({ where: { id: row.id } })).status === "in_progress", "FULL_STATUS_SAVED_PREMATURELY")
      await ticketControlReady("status")
      await actionResponse("/api/v1/tickets/" + row.id, "PUT",
        () => page.getByTestId("ticket-status-submit").click(), 200, "FULL_STATUS_FAILED")
      check((await db.ticket.findUnique({ where: { id: row.id } })).status === "waiting", "FULL_STATUS_NOT_SAVED")
      await ticketControlSynced("status", "waiting")
      mark("ux05-self-and-full-assignment")
      await actionResponse("/api/v1/tickets/" + row.id, "PUT",
        () => page.getByTestId("ticket-quick-assign-self").click(), 200, "SELF_ASSIGN_FAILED")
      check((await db.ticket.findUnique({ where: { id: row.id } })).assignedTo === actorId, "SELF_ASSIGN_NOT_SAVED")
      await ticketControlSynced("assignee", actorId)
      const agent = await db.user.findFirst({ where: { organizationId: orgId, email: process.env.SUPPORT_EVIDENCE_AGENT_EMAIL }, select: { id: true } })
      await page.getByTestId("ticket-assignee-select").selectOption(agent.id)
      check((await db.ticket.findUnique({ where: { id: row.id } })).assignedTo === actorId, "FULL_ASSIGN_SAVED_PREMATURELY")
      await ticketControlReady("assignee")
      await actionResponse("/api/v1/tickets/" + row.id, "PUT",
        () => page.getByTestId("ticket-assignee-submit").click(), 200, "FULL_ASSIGN_FAILED")
      check((await db.ticket.findUnique({ where: { id: row.id } })).assignedTo === agent.id, "FULL_ASSIGN_NOT_SAVED")
      await ticketControlSynced("assignee", agent.id)
      mark("ux05-audit-correspondence")
      await eventually(async () => {
        const audits = await db.auditLog.findMany({ where: { organizationId: orgId, entityType: "ticket", entityId: row.id, action: "update" }, select: { newValue: true } })
        return audits.some(item => item.newValue?.status === "in_progress")
          && audits.some(item => item.newValue?.status === "waiting")
          && audits.some(item => item.newValue?.assignedTo === actorId)
          && audits.some(item => item.newValue?.assignedTo === agent.id)
      }, "QUICK_FULL_AUDIT_MISMATCH")
      check(await page.getByTestId("ticket-comment-composer").inputValue() === draft, "DRAFT_LOST")
      await page.getByTestId("ticket-comment-composer").fill("")
    })

    await record("UX06-empty-queue-agent-manager-real-permissions", async () => {
      const work = await ticket("unassigned")
      for (const role of ["support", "manager"]) {
        mark("ux06-role-" + role)
        const user = await db.user.create({ data: { organizationId: orgId, email: prefix.toLowerCase() + "-" + role + "@support-evidence.invalid",
          name: "Synthetic queue reviewer", role, passwordHash: actor.passwordHash, passwordChangedAt: new Date(),
          isActive: true, isAvailable: true, preferredLanguage: "en" } })
        cleanups.push(() => db.user.deleteMany({ where: { id: user.id, organizationId: orgId } }))
        const roleContext = await newContext()
        try {
          await signIn(roleContext, user.email, process.env.SUPPORT_EVIDENCE_ADMIN_PASSWORD)
          const rolePage = await roleContext.newPage()
          await rolePage.goto("/support/agent-desktop", { waitUntil: "domcontentloaded" })
          await rolePage.getByTestId("agent-desktop-empty-queue").waitFor({ state: "visible" })
          if (await rolePage.getByTestId("tour-overlay").isVisible()) await rolePage.keyboard.press("Escape")
          const link = rolePage.getByTestId("agent-desktop-empty-queue").getByRole("link")
          check(await link.getAttribute("href") === "/tickets?owner=unassigned", "EMPTY_QUEUE_WRONG_DESTINATION")
          await link.click()
          await rolePage.waitForURL("**/tickets?owner=unassigned")
          await rolePage.getByTestId("tickets-workspace").waitFor({ state: "visible" })
          const listing = await api("GET", "/api/v1/tickets?owner=unassigned", undefined, 200, roleContext.request)
          check(JSON.stringify(listing).includes(work.id), "UNASSIGNED_WORK_INACCESSIBLE")
          const denied = await roleContext.request.patch("/api/v1/portal-users", { data: { contactIds: [prefix], action: "enable" } })
          checkHttp(denied, 403, "PORTAL_PERMISSION_EXPANDED")
        } finally { await roleContext.close() }
      }
    })

    await record("UX07-macro-preview-cancel-lost-response-retry-audience", async () => {
      const row = await ticket("macro")
      const actions = [
        { type: "set_priority", value: "high" },
        { type: "add_comment", value: "Synthetic public macro comment" },
        { type: "add_internal_note", value: "Synthetic internal macro note" },
        { type: "add_tag", value: "audit-confirmed" },
      ]
      // Create through the public contract: stored shortcuts are Alt+1..9 and
      // ordering is nonnegative. The existing ticket keyboard handler uses the
      // active collection's Ctrl ordinal; do not hide that mismatch in fixtures.
      const macro = (await api("POST", "/api/v1/ticket-macros", {
        name: prefix + "-macro", actions, isActive: true, sortOrder: 0, shortcutKey: "Alt+1",
      }, 201)).data
      check(Boolean(macro?.id), "MACRO_FIXTURE_CREATE_FAILED")
      cleanups.push(() => db.ticketMacro.deleteMany({ where: { id: macro.id, organizationId: orgId } }))
      const activeMacros = (await api("GET", "/api/v1/ticket-macros")).data.filter(item => item.isActive)
      const shortcutOrdinal = activeMacros.findIndex(item => item.id === macro.id) + 1
      check(shortcutOrdinal >= 1 && shortcutOrdinal <= 9, "MACRO_CTRL_ORDINAL_UNAVAILABLE")
      report.shortcutCoverage = {
        stored: "Alt+1", exercised: "Ctrl+" + shortcutOrdinal,
        limitation: "STORED_ALT_SHORTCUT_NOT_VERIFIED_LEGACY_CTRL_ORDINAL_ONLY",
      }
      await open("/tickets/" + row.id, "ticket-detail-workspace")
      const draft = "Synthetic unsent macro draft"
      await page.getByTestId("ticket-comment-composer").fill(draft)
      mark("ux07-preview-cancel")
      await page.locator("[data-tour-id='ticket-macros']").click()
      const macroMenuItem = page.getByRole("button", { name: macro.name, exact: false })
      await macroMenuItem.focus()
      await macroMenuItem.press("Enter")
      const dialog = page.getByRole("dialog").filter({ hasText: macro.name })
      await dialog.waitFor({ state: "visible" })
      check(await dialog.locator("ol li").count() === actions.length, "MACRO_ACTION_PREVIEW_INCOMPLETE")
      const previewText = await dialog.innerText()
      check(previewText.includes(actions[1].value) && previewText.includes(actions[2].value)
        && previewText.includes("visible to the customer in the portal") && previewText.includes("internal notes are for your team")
        && previewText.includes("does not send an email"), "MACRO_AUDIENCE_UNCLEAR")
      await page.keyboard.press("x")
      check((await db.ticket.findUnique({ where: { id: row.id } })).status === "new", "SHORTCUT_MUTATED_BEHIND_PREVIEW")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
      mark("ux07-menu-cancel-focus-return")
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-tour-id") === "ticket-macros")
      check(await db.ticketComment.count({ where: { ticketId: row.id } }) === 0
        && (await db.ticketMacro.findUnique({ where: { id: macro.id } })).usageCount === 0, "CANCEL_EXECUTED_MACRO")
      check(await page.getByTestId("ticket-comment-composer").inputValue() === draft, "CANCEL_LOST_DRAFT")
      mark("ux07-menu-escape-focus-return")
      await page.locator("[data-tour-id='ticket-macros']").click()
      await macroMenuItem.focus()
      await macroMenuItem.press("Enter")
      await dialog.waitFor({ state: "visible" })
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-tour-id") === "ticket-macros")
      mark("ux07-shortcut-preview")
      await page.getByTestId("ticket-quick-actions-hint").click()
      await page.keyboard.press("Control+" + shortcutOrdinal)
      await dialog.waitFor({ state: "visible" })
      mark("ux07-lost-response")
      const sentRequestIds = []
      let intercepted = 0
      let firstAttemptCommitted = false
      await page.route("**/api/v1/ticket-macros/" + macro.id + "/apply", async route => {
        sentRequestIds.push(route.request().postDataJSON().requestId)
        if (intercepted++ === 0) {
          const committedResponse = await route.fetch()
          firstAttemptCommitted = committedResponse.ok()
          await route.abort("failed")
        } else await route.continue()
      })
      await dialog.getByRole("button", { name: "Apply these actions", exact: true }).click()
      await dialog.getByRole("alert").waitFor({ state: "visible" })
      check(firstAttemptCommitted && await db.ticketComment.count({ where: { ticketId: row.id } }) === 2, "LOST_RESPONSE_DID_NOT_COMMIT")
      mark("ux07-retry-same-request")
      await dialog.getByRole("button", { name: "Apply these actions", exact: true }).click()
      await dialog.waitFor({ state: "hidden" })
      check(sentRequestIds.length === 2 && sentRequestIds[0] === sentRequestIds[1], "RETRY_CHANGED_REQUEST_ID")
      const comments = await db.ticketComment.findMany({ where: { ticketId: row.id } })
      check(comments.length === 2 && comments.some(item => !item.isInternal && item.comment === actions[1].value)
        && comments.some(item => item.isInternal && item.comment === actions[2].value), "MACRO_DUPLICATE_OR_AUDIENCE_WRONG")
      const stored = await db.ticket.findUnique({ where: { id: row.id } })
      check(stored.priority === "high" && stored.tags.includes("audit-confirmed"), "MACRO_ACTION_NOT_PERSISTED")
      check((await db.ticketMacro.findUnique({ where: { id: macro.id } })).usageCount === 1, "MACRO_USAGE_DUPLICATED")
      check(await db.auditLog.count({ where: { organizationId: orgId, entityId: row.id, entityType: "ticket_macro_application" } }) === 1,
        "MACRO_RECEIPT_NOT_UNIQUE")
      check(await page.getByTestId("ticket-comment-composer").inputValue() === draft, "APPLY_LOST_DRAFT")
      await page.getByTestId("ticket-comment-composer").fill("")
    })

    await record("UX08-calendar-datekind-zone-midnight", async () => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku",
        year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]))
      const day = parts.year + "-" + parts.month + "-" + parts.day
      const due = new Date(day + "T00:30:00+04:00")
      const row = await ticket("calendar", { slaDueAt: due })
      mark("ux08-api-local-midnight")
      const from = new Date(day + "T00:00:00+04:00").toISOString()
      const to = new Date(day + "T23:59:59.999+04:00").toISOString()
      const payload = await api("GET", "/api/v1/calendar/agent?" + new URLSearchParams({ from, to }))
      const item = payload.data.items.find(item => item.id === row.id)
      check(item?.dateKind === "sla_due" && item.date === due.toISOString(), "CALENDAR_SOURCE_DATE_MISMATCH")
      mark("ux08-ui-datekind")
      await open("/support/calendar", "support-calendar-workspace")
      check((await page.getByTestId("support-calendar-timezone").innerText()).includes("Asia/Baku"), "CALENDAR_ZONE_MISSING")
      const card = page.locator("[data-testid='support-calendar-item'][data-item-id='ticket-" + row.id + "']:visible")
      await card.waitFor({ state: "visible" })
      check(/SLA/i.test(await card.innerText()), "CALENDAR_CARD_DATE_KIND_MISSING")
      await card.click()
      const detail = page.getByTestId("support-calendar-detail")
      await detail.waitFor({ state: "visible" })
      check(/SLA/i.test(await detail.innerText()) && (await detail.innerText()).includes("Asia/Baku"), "DETAIL_DATE_KIND_OR_ZONE_MISSING")
      await page.keyboard.press("Escape")
      mark("ux08-dst-midnight-boundary")
      const before = await ticket("before-midnight", { status: "resolved", resolvedAt: new Date("2026-11-01T03:30:00Z") })
      const inside = await ticket("after-midnight", { status: "resolved", resolvedAt: new Date("2026-11-01T04:30:00Z") })
      const dst = await api("GET", "/api/v1/calendar/agent?" + new URLSearchParams({
        from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T04:59:59.999Z" }))
      check(!dst.data.items.some(item => item.id === before.id) && dst.data.items.some(item => item.id === inside.id && item.dateKind === "resolved"),
        "DST_LOCAL_DAY_BOUNDARY_WRONG")
    })

    await record("UX09-portal-prerequisite-ui-server-recovery", async () => {
      const contact = await db.contact.create({ data: { organizationId: orgId, fullName: prefix + " missing email", isActive: true } })
      cleanups.push(async () => {
        await db.auditLog.deleteMany({ where: { organizationId: orgId, entityId: contact.id } })
        await db.contact.deleteMany({ where: { organizationId: orgId, id: contact.id } })
      })
      mark("ux09-server-denial")
      const denial = await api("PATCH", "/api/v1/portal-users", { contactId: contact.id, portalAccessEnabled: true }, 400)
      check(denial.code === "PORTAL_EMAIL_REQUIRED", "MISSING_EMAIL_NOT_REJECTED")
      const bulkDenial = await api("PATCH", "/api/v1/portal-users", { contactIds: [contact.id], action: "enable" }, 400)
      check(bulkDenial.code === "PORTAL_BULK_INELIGIBLE", "BULK_MISSING_EMAIL_NOT_REJECTED")
      await open("/settings/portal-users", "portal-users-workspace")
      await page.getByTestId("portal-users-search").fill(prefix)
      const row = page.locator("[data-contact-id='" + contact.id + "']:visible")
      await row.waitFor({ state: "visible" })
      mark("ux09-bulk-ui-disabled")
      await row.getByRole("checkbox").check()
      check(await page.getByTestId("portal-users-bulk-enable").isDisabled(), "BULK_INELIGIBLE_UI_ENABLED")
      await page.getByTestId("portal-users-clear-selection").click()
      mark("ux09-email-next-step")
      await row.getByTestId("portal-user-access").click()
      await page.getByTestId("portal-user-edit-form").waitFor({ state: "visible" })
      const unchanged = await db.contact.findUnique({ where: { id: contact.id } })
      check(!unchanged.portalAccessEnabled && unchanged.portalVerificationToken === null, "PREMATURE_PORTAL_ENABLE")
      const savedEmail = prefix.toLowerCase() + "@support-evidence.invalid"
      await page.locator("#portal-user-email").fill(savedEmail)
      await actionResponse("/api/v1/portal-users", "PATCH",
        () => page.getByTestId("portal-user-edit-save").click(), 200, "EMAIL_SAVE_FAILED")
      await page.getByTestId("portal-user-edit-form").waitFor({ state: "hidden" })
      mark("ux09-ready-enable")
      // Closing the edit form precedes its list refresh. The old row still
      // offers "Add email first"; wait for the saved data and intended action.
      await row.getByText(savedEmail, { exact: true }).waitFor({ state: "visible" })
      const enableAccess = row.getByRole("button", { name: "Enable access", exact: true })
        .and(row.locator("[data-testid='portal-user-access']:enabled"))
      await enableAccess.waitFor({ state: "visible" })
      await eventually(() => enableAccess.evaluate(el => document.activeElement === el),
        "PROFILE_SAVE_FOCUS_NOT_RESTORED")
      await actionResponse("/api/v1/portal-users", "PATCH",
        () => enableAccess.click(), 200, "READY_ENABLE_FAILED")
      const ready = await db.contact.findUnique({ where: { id: contact.id } })
      check(ready.portalAccessEnabled && ready.portalVerificationToken === null, "READY_STATE_OR_UNREQUESTED_INVITE")
    })

    await record("UX10-complaint-historical-state-close-focus", async () => {
      const row = await ticket("complaint", { category: "complaint", status: "resolved",
        slaDueAt: new Date("2026-09-01T08:00:00Z"), resolvedAt: new Date("2026-09-01T09:00:00Z") })
      await db.complaintMeta.create({ data: { ticketId: row.id, organizationId: orgId, externalRegistryNumber: 990001, complaintType: "complaint" } })
      const met = await ticket("complaint-met", { category: "complaint", status: "closed",
        slaDueAt: new Date("2026-09-01T08:00:00Z"), closedAt: new Date("2026-09-01T07:00:00Z") })
      const unknown = await ticket("complaint-unknown", { category: "complaint", status: "resolved",
        slaDueAt: new Date("2026-09-01T08:00:00Z") })
      await db.complaintMeta.createMany({ data: [met, unknown].map((item, index) => ({
        ticketId: item.id, organizationId: orgId, externalRegistryNumber: 990002 + index, complaintType: "complaint",
      })) })
      mark("ux10-historical-label")
      await open("/complaints", "complaints-workspace")
      await page.getByTestId("complaints-search").fill(prefix + " complaint")
      await page.getByText("Completed after deadline", { exact: false }).first().waitFor({ state: "visible" })
      const historic = page.getByText("Completed after deadline", { exact: false }).filter({ visible: true }).first()
      check(!/text-red/.test(await historic.getAttribute("class") || ""), "HISTORICAL_STATE_ACTIVE_RED")
      await page.getByText("Completed within deadline", { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible" })
      await page.getByText("Recorded deadline; completion time unavailable", { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible" })
      mark("ux10-close-button-focus")
      const trigger = page.getByTestId("complaints-filter-trigger")
      await trigger.click()
      await page.locator("#complaints-filter-title").waitFor({ state: "visible" })
      await page.getByRole("button", { name: "Close filters", exact: true }).click()
      await page.locator("#complaints-filter-title").waitFor({ state: "hidden" })
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "complaints-filter-trigger")
      mark("ux10-escape-focus")
      await trigger.click()
      await page.locator("#complaints-filter-title").waitFor({ state: "visible" })
      await page.keyboard.press("Escape")
      await page.locator("#complaints-filter-title").waitFor({ state: "hidden" })
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "complaints-filter-trigger")
    })

    await record("postgres-upgrade-rollback-concurrency", async () => {
      const { runAuditPostgresEvidence } = await import("./support-ux-audit-postgres-evidence.mjs")
      const result = await runAuditPostgresEvidence({ admin: db, context: context.request, orgId, actorId, outputDirectory })
      check(result?.passed === true && result.caseCount > 0, "POSTGRES_ACCEPTANCE_INCOMPLETE")
    })
  } catch (error) {
    report.cases.push({ id: "bootstrap", status: "failed", stage: phase,
      ...safeFailure(error) })
  } finally {
    let cleaned = true
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch { cleaned = false }
    }
    report.cleanup = cleaned ? "passed" : "failed"
    report.blockedExternalRequests = blockedExternalRequests
    if (context) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
    if (db) await db.$disconnect().catch(() => undefined)
    report.passed = cleaned && report.cases.length === 11 && report.cases.every(item => item.status === "passed")
    await writeFile(path.join(outputDirectory, "audit-functional-evidence.json"), JSON.stringify(report, null, 2) + "\n")
    console.log(JSON.stringify({ suite: report.suite, commit, passed: report.passed,
      cases: report.cases, cleanup: report.cleanup }))
    if (!report.passed) process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(JSON.stringify({ suite: "support-audit-functional", passed: false, code: "STARTUP_GUARD_FAILED" }))
    process.exitCode = 1
  })
}
