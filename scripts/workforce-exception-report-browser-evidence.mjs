import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Disposable hosted aggregate report browser proof only; this is never a production seed tool.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Hosted Actions required")
assert.equal(process.env.CI, "true", "Explicit CI required")
assert.equal(process.env.WF_EXCEPTION_REPORT_BROWSER, "1", "Fixture opt-in required")
assert.notEqual(process.env.NODE_ENV, "production", "Production is excluded")
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const origin = new URL(process.env.WF_EXCEPTION_REPORT_BROWSER_BASE_URL)
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname), "Loopback application required")
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname), "Loopback fixture database required")
  assert.equal(url.pathname, "/workforce_manager_today_browser", "Dedicated report fixture database required")
  assert.equal(url.username, role, "Exact fixture database role required")
  return url
}
const adminURL = database(process.env.ADMIN_DATABASE_URL, "postgres")
const appURL = database(process.env.DATABASE_URL, "wf_manager_today_browser")
const fenceURL = database(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres")
assert.equal(adminURL.host, appURL.host)
assert.equal(adminURL.protocol, appURL.protocol)
assert.equal(adminURL.search, appURL.search)
assert.equal(fenceURL.href, adminURL.href, "Disposable RLS client fence must match the admin fixture target")
assert.match(process.env.WF_EXCEPTION_REPORT_BROWSER_HEAD_SHA || "", /^[a-f0-9]{40}$/, "Candidate HEAD must be exact full SHA")
assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/, "Checked CI SHA must be exact full SHA")
const outputDirectory = process.env.WF_EXCEPTION_REPORT_BROWSER_OUTPUT_DIR || "artifacts/workforce-exception-report-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const endpoint = "/api/v1/workforce/exception-reports"
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`
const date = new Date().toISOString().slice(0, 10)
const workDate = new Date(`${date}T00:00:00.000Z`)
const earlier = days => new Date(workDate.getTime() - days * 86_400_000)
function currentDate() {
  assert.equal(new Date().toISOString().slice(0, 10), date, "Real UTC date crossed midnight; preserve failure without reseeding")
}
const receipts = {
  version: 1,
  candidateHead: process.env.WF_EXCEPTION_REPORT_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA,
  harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
  startedAt: new Date().toISOString(),
  date,
  environment: "hosted Chromium / loopback Next dev / disposable PostgreSQL16",
  authentication: "real CSRF, credentials provider and session; no auth mocks",
  authenticationDiagnostics: [],
  sources: [],
  cases: [],
  status: "RUNNING",
  limitations: ["Development bundle, not production build", "Synthetic disposable data only", "Historical selected Prisma-schema imports, not canonical terminal/approval/workday correction writer acceptance", "No human AT/native zoom/whole-page keyboard/Android/physical/load/pilot acceptance", "Geometry/text checks do not prove pixel occlusion or whole-page accessibility", "Aggregate report facts are SELECT-only; real view-audit INSERT and auth metadata writes are expected; no production feature/grant activation"],
}
const contexts = []
const authenticationPostTimes = []
let browser
let activePage
let stage = "fixture-preparing"
const factTables = [
  "mtm_teams", "mtm_agents", "mtm_settings", "mtm_work_calendar_days",
  "workforce_employee_team_memberships", "mtm_agent_workdays", "mtm_agent_workday_events",
  "workforce_access_grants", "workforce_access_grant_revocations",
  "workforce_shift_templates", "workforce_shift_segments", "workforce_shift_assignments",
  "workforce_shift_default_assignments", "workforce_shift_team_default_assignments",
  "workforce_policy_snapshots", "workforce_shift_snapshots", "workforce_workday_schedule_snapshots",
  "workforce_exception_cases", "workforce_exception_decisions",
  "workforce_exception_employee_responses", "mtm_hrm_requests", "workforce_time_corrections",
]
async function facts(organizationIds) {
  const result = []
  for (const table of factTables) {
    assert.match(table, /^[a-z_]+$/)
    // Identifiers are fixed above; only synthetic tenant ids are parameters.
    const rows = await admin.$queryRawUnsafe(`SELECT row_to_json(fact) AS document FROM public."${table}" AS fact WHERE "organizationId" IN ($1, $2) ORDER BY id LIMIT 501`, ...organizationIds)
    assert.ok(rows.length <= 500, "Fixture fact snapshot must remain bounded")
    result.push({ table, count: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows.map(row => row.document))).digest("hex") })
  }
  return result
}
async function copy(locale) {
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).workforceExceptionReport
}
async function assertSession(context, principal) {
  const response = await context.request.get("/api/auth/session", { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const session = await response.json()
  assert.equal(session.user.id, principal.id)
  assert.equal(session.user.organizationId, principal.organizationId)
  currentDate()
}


const baseURL = origin.href
async function authenticate(context, principal) {
  const diagnostic = { ordinal: receipts.authenticationDiagnostics.length + 1, csrfStatus: null, callbackStatus: null, pacingWaitMs: 0 }
  receipts.authenticationDiagnostics.push(diagnostic)
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
  diagnostic.csrfStatus = csrf.status()
  assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json()
  assert.equal(typeof csrfToken, "string")
  // The unchanged proxy/principal policies allow 10 auth POSTs per 60s.
  // Respect that real policy with at most eight fixture callbacks per 61s;
  // never retry credentials, spoof an IP, or disable the production limiter.
  const authenticationWindowMs = 61_000
  const pruneAuthenticationPosts = () => {
    const cutoff = Date.now() - authenticationWindowMs
    while (authenticationPostTimes.length && authenticationPostTimes[0] <= cutoff) authenticationPostTimes.shift()
  }
  pruneAuthenticationPosts()
  if (authenticationPostTimes.length >= 8) {
    diagnostic.pacingWaitMs = Math.max(0, authenticationPostTimes[0] + authenticationWindowMs - Date.now()) + 25
    assert.ok(diagnostic.pacingWaitMs <= 62_000, "Fixture authentication wait must remain bounded")
    await delay(diagnostic.pacingWaitMs)
    pruneAuthenticationPosts()
  }
  assert.ok(authenticationPostTimes.length < 8, "Fixture authentication must remain within its conservative budget")
  authenticationPostTimes.push(Date.now())
  diagnostic.callbackStartedAt = new Date().toISOString()
  const response = await context.request.post("/api/auth/callback/credentials", {
    timeout: 120_000,
    headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: `${baseURL}/workforce` },
  })
  diagnostic.callbackStatus = response.status()
  assert.equal(response.status(), 200, "Real credentials callback must succeed")
  const redirect = new URL((await response.json()).url, baseURL)
  assert.equal(redirect.origin, origin.origin)
  assert.equal(redirect.searchParams.get("error"), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith("authjs.session-token")))
  await assertSession(context, principal)
}


// Fixed historical date windows are deliberately separate from today's real
// default window. No production clock/policy/writer is mocked or activated.
const privateMarkers = []
const views = []
const extraReads = []
const auditKeys = ["start", "end", "caseCount", "employeeCount", "openCount", "awaitingEmployeeResponseCount", "hrReviewCount", "resolvedCount", "dataIntegrityReviewCount", "recordedLinkedCorrectionCases", "firstResolutionSampleCount", "firstResolutionIntegrityExcludedCount"].sort()
async function seed() {
  currentDate()
  const passwordHash = await bcrypt.hash(password, 4)
  const tenants = []
  for (const key of ["a", "b"]) {
    const organization = await admin.organization.create({ data: {
      name: `Report fixture ${key}`, slug: `wf-report-${suffix}-${key}`, plan: "enterprise",
      modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"], settings: {},
    } })
    const principals = []
    for (const role of key === "a" ? ["issuer", "hr", "team", "denied"] : ["issuer", "hr"]) {
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `report-${suffix}-${key}-${role}@example.test`, name: `Report ${key} ${role}`,
        passwordHash, role: role === "issuer" ? "admin" : "manager", require2fa: false, totpEnabled: false, smsAuthEnabled: false, preferredLanguage: "en",
      } })
      principals.push({ ...user, key: role, slug: organization.slug })
    }
    const [issuer, hr, teamManager, denied] = principals
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Report fixture team ${key}`, code: `REPORT-${suffix}-${key}`, isActive: true } })
    await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
    await admin.workforceAccessGrant.create({ data: {
      organizationId: organization.id, principalUserId: hr.id, role: "HR_ADMIN", scopeKind: "ORGANIZATION", scopeTeamId: null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: earlier(2), effectiveUntil: null, operationId: `report-${suffix}-${key}-hr`, grantedByUserId: issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
    } })
    if (teamManager) await admin.workforceAccessGrant.create({ data: {
      organizationId: organization.id, principalUserId: teamManager.id, role: "TEAM_MANAGER", scopeKind: "TEAM", scopeTeamId: team.id, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: earlier(2), effectiveUntil: null, operationId: `report-${suffix}-team`, grantedByUserId: issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
    } })
    const employee = await admin.mtmAgent.create({ data: {
      id: `private_report_${suffix}_${key}_agent`, organizationId: organization.id, teamId: team.id, userId: hr.id,
      name: `PRIVATE REPORT EMPLOYEE ${key.toUpperCase()}`, role: "AGENT", status: "ACTIVE",
    } })
    const workday = await admin.mtmAgentWorkday.create({ data: {
      organizationId: organization.id, agentId: employee.id, workDate: new Date("2025-01-01T00:00:00Z"), status: "COMPLETED",
      startedAt: new Date("2025-01-01T08:00:00Z"), completedAt: new Date("2025-01-01T17:00:00Z"), totalPausedSeconds: 0,
    } })
    privateMarkers.push(employee.id, employee.name, workday.id)
    const specifications = key === "a"
      ? [["linked", 1, 3_600_000], ["zero", 1, 0], ["partial", 1, 3_600_000], ["rejected", 1, 7_200_000], ["reopened", 1, 1_800_000], ["reresolved", 1, 1_800_000], ["unresolved", 1, null], ["integrity", 1, "invalid"], ["only-unresolved", 2, null], ["only-zero", 3, 0]]
      : [["foreign-linked", 1, 7_200_000]]
    for (const [label, day, elapsed] of specifications) {
      const at = new Date(`2025-01-0${day}T00:00:00Z`)
      const record = await admin.workforceExceptionCase.create({ data: {
        organizationId: organization.id, agentId: employee.id, workdayId: workday.id, kind: "NO_SHOW", detectorVersion: "report-browser-history-v1",
        deduplicationKey: createHash("sha256").update(`${suffix}-${key}-${label}`).digest("hex"), createdAt: at,
      } })
      privateMarkers.push(record.id)
      // Explicit historical selected-schema import, not a terminal writer.
      // Current Prisma revision uniqueness/FKs and base case checks remain.
      if (elapsed !== null) {
        const entries = elapsed === "invalid"
          ? [[2, "PRIVATE_UNKNOWN_HISTORICAL", 0]]
          : [[1, "ACKNOWLEDGE", 0], [2, "RESOLVE_NO_CHANGE", elapsed]]
        const classifications = label === "zero" ? ["CLASSIFY_FALSE_POSITIVE", "APPEAL_FULLY_UPHELD"]
          : label === "partial" ? ["CLASSIFY_CONFIRMED_EXCEPTION", "APPEAL_PARTIALLY_UPHELD"]
          : ["rejected", "foreign-linked"].includes(label) ? ["CLASSIFY_CONFIRMED_EXCEPTION", "APPEAL_REJECTED"]
          : ["reopened", "reresolved"].includes(label) ? ["CLASSIFY_FALSE_POSITIVE", "APPEAL_FULLY_UPHELD"] : []
        for (const [offset, code] of classifications.entries()) entries.push([3 + offset, code, elapsed + 1_000 + offset])
        if (["reopened", "reresolved"].includes(label)) entries.push([5, "REOPEN_FOR_REVIEW", elapsed + 2_000])
        if (label === "reresolved") entries.push([6, "RESOLVE_NO_CHANGE", elapsed + 3_000])
        for (const [revision, decisionCode, ms] of entries) await admin.workforceExceptionDecision.create({ data: {
          organizationId: organization.id, caseId: record.id, caseRevision: revision, operationId: `report-${suffix}-${key}-${label}-${revision}`,
          decisionCode, reason: "PRIVATE_REPORT_DECISION_REASON", actorUserId: hr.id, createdAt: new Date(at.getTime() + ms),
        } })
      }
      if (label.includes("linked")) {
        const request = await admin.mtmHrmRequest.create({ data: {
          organizationId: organization.id, agentId: employee.id, clientRequestId: `report-${suffix}-${key}`, type: "TIME_CORRECTION", status: "APPROVED",
          startDate: at, endDate: at, correctionWorkdayId: workday.id, exceptionCaseId: record.id, exceptionCaseRevision: 1,
          requestedStartAt: new Date(at.getTime() + 28_800_000), reason: "PRIVATE_REPORT_REQUEST_REASON", submittedAt: at,
        } })
        const correction = await admin.workforceTimeCorrection.create({ data: {
          organizationId: organization.id, agentId: employee.id, workdayId: workday.id, requestId: request.id, source: "REQUEST_APPROVAL",
          operationId: `report-${suffix}-${key}-ledger`, actorUserId: hr.id, reason: "PRIVATE_REPORT_LEDGER_REASON",
          beforeFacts: { privateBeforeFixture: true }, afterFacts: { privateAfterFixture: true }, occurredAt: at,
        } })
        await admin.workforceExceptionEmployeeResponse.create({ data: {
          organizationId: organization.id, agentId: employee.id, workdayId: workday.id, caseId: record.id, correctionRequestId: request.id,
          responseCode: "CORRECTION_REQUESTED", clientResponseId: `report-${suffix}-${key}-response`, actorUserId: hr.id, observedCaseRevision: 1, createdAt: at,
        } })
        privateMarkers.push(request.id, correction.id)
      }
    }
    tenants.push({ key, organization, issuer, hr, teamManager, denied, employee })
  }
  privateMarkers.push("PRIVATE_REPORT_DECISION_REASON", "PRIVATE_REPORT_REQUEST_REASON", "PRIVATE_REPORT_LEDGER_REASON", "PRIVATE_UNKNOWN_HISTORICAL", "privateBeforeFixture", "privateAfterFixture")
  return tenants
}
function expected(tenant, start, end) {
  if (start !== end || !["2025-01-01", "2025-01-02", "2025-01-03"].includes(start)) {
    assert.ok(start > "2025-01-03" && end >= start, "Only fixed fixture or current empty windows are accepted")
    return { cases: 0, resolved: 0, open: 0, hrReview: 0, integrity: 0, responses: 0, linked: 0, share: null, samples: 0, unresolved: 0, excluded: 0, min: null, max: null, mean: null, classified: finalClassification(0, 0, 0, 0, 0, 0, 0, 0, 0) }
  }
  if (tenant === "b" && start === "2025-01-01") return { cases: 1, resolved: 1, open: 0, hrReview: 0, integrity: 0, responses: 1, linked: 1, share: 1, samples: 1, unresolved: 0, excluded: 0, min: 7_200_000, max: 7_200_000, mean: 7_200_000, classified: finalClassification(0, 1, 0, 0, 1, 0, 0, 0, 0) }
  if (tenant === "a" && start === "2025-01-01") return { cases: 8, resolved: 5, open: 1, hrReview: 1, integrity: 1, responses: 1, linked: 1, share: 1/8, samples: 6, unresolved: 1, excluded: 1, min: 0, max: 7_200_000, mean: 3_000_000, classified: finalClassification(1, 2, 1, 1, 1, 2, 2, 2, 1) }
  if (tenant === "a" && start === "2025-01-02") return { cases: 1, resolved: 0, open: 1, hrReview: 0, integrity: 0, responses: 0, linked: 0, share: 0, samples: 0, unresolved: 1, excluded: 0, min: null, max: null, mean: null, classified: finalClassification(0, 0, 0, 0, 0, 0, 0, 1, 0) }
  if (tenant === "a" && start === "2025-01-03") return { cases: 1, resolved: 1, open: 0, hrReview: 0, integrity: 0, responses: 0, linked: 0, share: 0, samples: 1, unresolved: 0, excluded: 0, min: 0, max: 0, mean: 0, classified: finalClassification(0, 0, 0, 0, 0, 1, 1, 0, 0) }
  throw new Error("Unsupported fixture window")
}
function finalClassification(falsePositiveCases, confirmedCases, fullyUpheldCases, partiallyUpheldCases, rejectedCases, falsePositiveUnclassified, appealUnclassified, unfinishedCases, integrityExcludedCases) {
  const falsePositiveSamples = falsePositiveCases + confirmedCases
  const appealSamples = fullyUpheldCases + partiallyUpheldCases + rejectedCases
  return {
    basis: "EXPLICIT_HR_CLASSIFICATION_OF_CURRENT_RESOLVED_CYCLE",
    falsePositive: { sampleCount: falsePositiveSamples, falsePositiveCases, confirmedCases, share: falsePositiveSamples ? falsePositiveCases / falsePositiveSamples : null, unclassifiedResolvedCases: falsePositiveUnclassified },
    appeal: { sampleCount: appealSamples, fullyUpheldCases, partiallyUpheldCases, rejectedCases, fullyUpheldShare: appealSamples ? fullyUpheldCases / appealSamples : null, partiallyUpheldShare: appealSamples ? partiallyUpheldCases / appealSamples : null, rejectedShare: appealSamples ? rejectedCases / appealSamples : null, unclassifiedResolvedCases: appealUnclassified },
    unfinishedCases, integrityExcludedCases,
  }
}
function noPrivate(value) {
  for (const marker of privateMarkers) assert.equal(value.includes(marker), false, "Report must exclude private fixture subjects and payloads")
}
async function checkedRead(response, tenant) {
  assert.equal(response.status(), 200)
  assert.match(response.headers()["cache-control"] || "", /private/)
  assert.match(response.headers()["cache-control"] || "", /no-store/)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.deepEqual(Object.keys(body).sort(), ["data", "success"])
  assert.deepEqual(Object.keys(body.data).sort(), ["dateBasis", "end", "report", "start", "timezone"])
  assert.equal(body.data.timezone, "UTC")
  assert.equal(body.data.dateBasis, "CASE_RECORDED_AT")
  noPrivate(JSON.stringify(body))
  const report = body.data.report, truth = expected(tenant, body.data.start, body.data.end)
  assert.deepEqual(report.summary, { employees: truth.cases ? 1 : 0, cases: truth.cases, open: truth.open, awaitingEmployeeResponse: 0, hrReview: truth.hrReview, resolved: truth.resolved, dataIntegrityReview: truth.integrity, employeeResponsesReceived: truth.responses })
  const outcome = report.recordedOutcomes
  assert.deepEqual(outcome.linkedCorrection, { cohortCases: truth.cases, recordedLinkedCorrectionCases: truth.linked, share: truth.share, interpretation: "RECORDED_APPROVED_REQUEST_CORRECTION_LINK_NOT_CURRENT_WORKDAY_FACTS" })
  assert.deepEqual(outcome.firstResolution, { basis: "ELAPSED_WALL_CLOCK_FROM_CASE_TO_FIRST_RECORDED_RESOLUTION", sampleCount: truth.samples, unresolvedCases: truth.unresolved, integrityExcludedCases: truth.excluded, minMs: truth.min, maxMs: truth.max, meanMs: truth.mean, meanRounding: "NEAREST_MILLISECOND" })
  assert.equal(Object.hasOwn(outcome, "unavailable"), false)
  assert.deepEqual(outcome.finalClassification, truth.classified)
  return { data: body.data, truth }
}
const isReportResponse = response => new URL(response.url()).pathname === endpoint && response.request().method() === "GET"
async function tabTo(page, locator) {
  for (let tabs = 1; tabs <= 180; tabs++) {
    await page.keyboard.press("Tab")
    if (await locator.evaluate(element => document.activeElement === element)) return tabs
  }
  throw new Error("Native Tab could not reach the report control")
}
async function openReport(principal, locale, width) {
  const context = await browser.newContext({ baseURL, locale: "en-US", viewport: { width, height: 900 }, serviceWorkers: "block" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }])
  await authenticate(context, principal)
  const page = await context.newPage(); activePage = page
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000)
  const view = { context, page, locale, width, principal, ui: await copy(locale), writes: [], getRequests: 0, successfulResponses: 0, failedRequests: 0 }
  views.push(view)
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/workforce/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) view.writes.push(request.method())
    if (url.origin === origin.origin && url.pathname === endpoint && request.method() === "GET") view.getRequests++
  })
  page.on("response", response => { if (isReportResponse(response) && response.status() === 200) view.successfulResponses++ })
  page.on("requestfailed", request => { if (new URL(request.url()).pathname === endpoint) view.failedRequests++ })
  const waiting = page.waitForResponse(isReportResponse, { timeout: 120_000 })
  await page.goto("/workforce/exceptions/report", { waitUntil: "domcontentloaded" })
  view.response = await waiting
  assert.notEqual(new URL(page.url()).pathname, "/login")
  return view
}
async function applyRange(view, day, keyboard = false) {
  const inputs = view.page.locator('input[type="date"]')
  assert.equal(await inputs.count(), 2)
  await inputs.nth(0).fill(day); await inputs.nth(1).fill(day)
  const control = view.page.getByRole("button", { name: view.ui.apply, exact: true })
  await control.waitFor({ state: "visible" })
  const response = view.page.waitForResponse(r => isReportResponse(r) && new URL(r.url()).searchParams.get("start") === day && new URL(r.url()).searchParams.get("end") === day, { timeout: 120_000 })
  if (keyboard) { await tabTo(view.page, control); await view.page.keyboard.press("Enter") } else await control.click()
  return checkedRead(await response, view.principal.tenant)
}
function expectedDuration([milliseconds, locale]) {
  if (milliseconds === null) return null
  const [unit, divisor] = milliseconds >= 86_400_000 ? ["day", 86_400_000] : milliseconds >= 3_600_000 ? ["hour", 3_600_000] : milliseconds >= 60_000 ? ["minute", 60_000] : ["second", 1_000]
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 3 }).format(milliseconds / divisor)
}
async function assertRendered(view, truth) {
  const block = view.page.getByTestId("workforce-exception-recorded-outcomes")
  await block.waitFor({ state: "visible" })
  const value = async testId => (await view.page.getByTestId(testId).innerText()).trim()
  const linkedShareActual = await value("workforce-exception-recorded-link-share")
  const linkedShareNodeExpected = truth.share === null ? view.ui.recordedOutcomes.noCases : new Intl.NumberFormat(view.locale, { style: "percent", maximumFractionDigits: 2 }).format(truth.share)
  const linkedShareBrowserExpected = truth.share === null ? view.ui.recordedOutcomes.noCases : await view.page.evaluate(([share, locale]) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(share), [truth.share, view.locale])
  receipts.aggregateRenderDiagnostics ??= []
  receipts.aggregateRenderDiagnostics.push({
    locale: view.locale, numericShare: truth.share, actualText: linkedShareActual,
    nodeExpected: linkedShareNodeExpected, browserExpected: linkedShareBrowserExpected,
    actualCodePoints: Array.from(linkedShareActual, character => character.codePointAt(0)),
    nodeCodePoints: Array.from(linkedShareNodeExpected, character => character.codePointAt(0)),
    browserCodePoints: Array.from(linkedShareBrowserExpected, character => character.codePointAt(0)),
  })
  // Preserve the original equality until actual diagnostics establish the
  // cause. Numeric fixture/API truth and all semantic assertions stay exact.
  assert.equal(linkedShareActual, linkedShareNodeExpected)
  const expected = await view.page.evaluate(expectedDuration, [truth.mean, view.locale])
  receipts.durationRealms ??= []; receipts.durationRealms.push({ locale: view.locale, equal: expectedDuration([truth.mean, view.locale]) === expected })
  assert.equal(await value("workforce-exception-recorded-resolution-mean"), expected ?? view.ui.recordedOutcomes.noSamples)
  const counts = [["samples", truth.samples], ["unresolved", truth.unresolved], ["integrityExcluded", truth.excluded]]
  for (const [key, count] of counts) {
    const term = block.locator("dt").filter({ hasText: view.ui.recordedOutcomes[key] })
    assert.equal(await term.count(), 1)
    assert.equal((await term.locator("xpath=..").locator("dd").innerText()).trim(), new Intl.NumberFormat(view.locale).format(count))
  }
  const text = await block.innerText()
  const percentage = share => share === null ? view.ui.recordedOutcomes.noClassifiedSamples : new Intl.NumberFormat(view.locale, { style: "percent", maximumFractionDigits: 2 }).format(share)
  assert.equal(await value("workforce-exception-false-positive-share"), percentage(truth.classified.falsePositive.share))
  assert.equal(await value("workforce-exception-appeal-full-share"), percentage(truth.classified.appeal.fullyUpheldShare))
  assert.equal(await value("workforce-exception-appeal-partial-share"), percentage(truth.classified.appeal.partiallyUpheldShare))
  assert.equal(await value("workforce-exception-appeal-rejected-share"), percentage(truth.classified.appeal.rejectedShare))
  assert.ok(text.includes(view.ui.recordedOutcomes.linkedHint))
  assert.ok(text.includes(view.ui.recordedOutcomes.resolutionHint))
  noPrivate(await view.page.locator("body").innerText())
  const geometry = await block.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { left: box.left, right: box.right, width: box.width, viewport: innerWidth, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
  })
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1)
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1)
  return geometry
}
async function localeScenario(tenant, locale, width) {
  stage = `report-${locale}-authenticate`
  const view = await openReport({ ...tenant.hr, tenant: tenant.key }, locale, width)
  stage = `report-${locale}-default-empty`
  const initial = await checkedRead(view.response, tenant.key)
  assert.equal(initial.truth.cases, 0)
  await assertRendered(view, initial.truth)
  stage = `report-${locale}-nonempty-range`
  const selected = await applyRange(view, "2025-01-01", locale === "ru")
  const geometry = await assertRendered(view, selected.truth)
  await view.page.screenshot({ path: `${outputDirectory}/report-${locale}-${width}-nonempty.png`, fullPage: true })
  assert.ok((await view.page.locator('section[aria-labelledby="workforce-exception-report-summary"]').innerText()).includes(view.ui.summaryTitle))
  assert.equal(await view.page.getByTestId("workforce-exception-report-boundary").count(), 1)
  const region = view.page.locator('section[aria-labelledby="workforce-exception-report-types"]').getByRole("region", { name: view.ui.typesTitle, exact: true })
  assert.equal(await region.count(), 1)
  assert.equal(await region.getAttribute("tabindex"), "0")
  let keyboardControls = false
  if (locale === "ru") {
    stage = "report-ru-native-refresh"
    const refresh = view.page.getByRole("button", { name: view.ui.refresh, exact: true })
    await tabTo(view.page, refresh)
    const waiting = view.page.waitForResponse(isReportResponse, { timeout: 120_000 })
    await view.page.keyboard.press("Enter")
    await checkedRead(await waiting, tenant.key)
    await assertRendered(view, selected.truth)
    await tabTo(view.page, region)
    assert.equal(await region.evaluate(element => document.activeElement === element), true)
    keyboardControls = true
    for (const [state, day] of [["empty", "2025-01-04"], ["unresolved-no-sample", "2025-01-02"], ["measured-zero", "2025-01-03"]]) {
      stage = `report-ru-${state}`
      const result = await applyRange(view, day, true)
      await assertRendered(view, result.truth)
      await view.page.screenshot({ path: `${outputDirectory}/report-ru-320-${state}.png`, fullPage: true })
      receipts.cases.push({ name: state, status: "PASS", responseStatus: 200, cases: result.truth.cases, sampleCount: result.truth.samples, meanMs: result.truth.mean })
    }
  }
  assert.deepEqual(view.writes, [])
  receipts.cases.push({ name: `nonempty-${locale}-${width}`, status: "PASS", responseStatus: 200, linkedShare: selected.truth.share, meanMs: selected.truth.mean, integrityExcluded: selected.truth.excluded, geometry, nativeApplyRefreshAndTableFocus: keyboardControls, rawPrivateDataExcluded: true })
  await assertSession(view.context, tenant.hr)
  await view.context.close()
}
async function auditCount(org) { return admin.mtmAuditLog.count({ where: { organizationId: org } }) }
async function deniedScenario(tenant, principal) {
  stage = `denied-${principal.key}`
  const before = await auditCount(tenant.organization.id)
  const view = await openReport({ ...principal, tenant: tenant.key }, "ru", 320)
  assert.equal(view.response.status(), 403)
  assert.match(view.response.headers()["cache-control"] || "", /no-store/)
  const body = await view.response.json(); assert.equal(body.code, "WORKFORCE_GRANULAR_ACCESS_REQUIRED")
  noPrivate(JSON.stringify(body))
  await view.page.getByRole("status").filter({ hasText: view.ui.adminOnly }).waitFor({ state: "visible" })
  assert.equal(await view.page.getByTestId("workforce-exception-recorded-outcomes").count(), 0)
  assert.equal(await view.page.locator('section[aria-labelledby="workforce-exception-report-summary"]').count(), 0)
  noPrivate(await view.page.locator("body").innerText())
  assert.deepEqual(view.writes, [])
  await assertSession(view.context, principal)
  await view.page.screenshot({ path: `${outputDirectory}/report-denied-${principal.key}.png` })
  await view.context.close()
  assert.equal(await auditCount(tenant.organization.id), before, "Denied read must not append a successful report view audit")
  receipts.cases.push({ name: `denied-${principal.key}`, status: "PASS", responseStatus: 403, metricsExcluded: true, successfulViewAuditDelta: 0 })
}
async function foreignScenario(tenants) {
  const [a, b] = tenants
  stage = "foreign-positive-authenticate"
  const foreign = await openReport({ ...b.hr, tenant: "b" }, "en", 768)
  await checkedRead(foreign.response, "b")
  const selected = await applyRange(foreign, "2025-01-01")
  assert.equal(selected.truth.cases, 1)
  await assertRendered(foreign, selected.truth)
  assert.deepEqual(foreign.writes, [])
  await foreign.page.screenshot({ path: `${outputDirectory}/report-foreign-positive.png` })
  await foreign.context.close()
  // The real session resolver ignores the header; it never selects tenantB.
  stage = "foreign-header-cannot-replace-session"
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" }); contexts.push(context)
  await authenticate(context, a.hr)
  const response = await context.request.get(`${endpoint}?start=2025-01-01&end=2025-01-01`, { headers: { "x-organization-id": b.organization.id }, timeout: 120_000 })
  const own = await checkedRead(response, "a"); assert.equal(own.truth.cases, 8)
  extraReads.push({ tenant: "a", successfulResponses: 1, getRequests: 1 })
  await context.close()
  receipts.cases.push({ name: "two-tenant-positive-and-session-header-fence", status: "PASS", ownCases: 8, foreignOwnCases: 1, foreignHeaderSelectsOwnSession: true })
}
async function rlsControls(tenants, phase) {
  const reportTables = ["workforce_exception_cases", "workforce_exception_decisions", "workforce_exception_employee_responses", "mtm_hrm_requests", "workforce_time_corrections"]
  const [role] = await app.$queryRawUnsafe("SELECT current_user AS name,r.rolsuper,r.rolbypassrls,r.rolinherit,current_setting('app.org_id',true) AS tenant,current_setting('app.rls_bypass',true) AS bypass FROM pg_roles r WHERE rolname=current_user")
  assert.equal(role.name, "wf_manager_today_browser")
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false); assert.equal(role.rolinherit, false)
  assert.ok(role.tenant == null || role.tenant === ""); assert.notEqual(role.bypass, "on")
  const rows = []
  for (const table of reportTables) {
    const [meta] = await app.$queryRawUnsafe(`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass`, `public.${table}`)
    assert.equal(meta.enabled, true); assert.equal(meta.forced, true); assert.notEqual(meta.owner, role.name)
    const [empty] = await app.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}"`); assert.equal(Number(empty.count), 0)
    const positive = []
    for (const tenant of tenants) {
      const [ownerRows] = await admin.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, tenant.organization.id)
      assert.ok(Number(ownerRows.count) > 0)
      await app.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${tenant.organization.id}, true)`
        const [own] = await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, tenant.organization.id)
        assert.equal(Number(own.count), Number(ownerRows.count))
        const foreign = tenants.find(other => other.key !== tenant.key)
        const [excluded] = await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, foreign.organization.id)
        assert.equal(Number(excluded.count), 0)
      })
      positive.push({ tenant: tenant.key, rows: Number(ownerRows.count), foreignVisible: 0 })
    }
    rows.push({ table, forcedRls: true, nonowner: true, unscopedVisible: 0, positive })
  }
  return { phase, rows, noBypass: true, positiveBothTenants: true }
}
async function auditProof(tenants) {
  const results = []
  for (const tenant of tenants) {
    const rows = await admin.mtmAuditLog.findMany({ where: { organizationId: tenant.organization.id }, take: 101, orderBy: { id: "asc" } })
    assert.ok(rows.length <= 100)
    for (const row of rows) {
      assert.equal(row.action, "WORKFORCE_EXCEPTION_REPORT_VIEWED"); assert.equal(row.entity, "workforce_exception_report"); assert.equal(row.metadataKind, "workforce_exception_report")
      assert.equal(row.agentId, null); assert.equal(row.oldData, null)
      assert.deepEqual(Object.keys(row.newData).sort(), auditKeys)
      const truth = expected(tenant.key, row.newData.start, row.newData.end)
      assert.equal(row.entityId, `${row.newData.start}:${row.newData.end}`)
      assert.deepEqual(row.newData, {
        start: row.newData.start, end: row.newData.end, caseCount: truth.cases, employeeCount: truth.cases ? 1 : 0, openCount: truth.open,
        awaitingEmployeeResponseCount: 0, hrReviewCount: truth.hrReview, resolvedCount: truth.resolved, dataIntegrityReviewCount: truth.integrity,
        recordedLinkedCorrectionCases: truth.linked, firstResolutionSampleCount: truth.samples, firstResolutionIntegrityExcludedCount: truth.excluded,
      })
      noPrivate(JSON.stringify(row.newData))
    }
    const traffic = [...views, ...extraReads].filter(view => (view.principal?.tenant ?? view.tenant) === tenant.key)
    const success = traffic.reduce((total, view) => total + view.successfulResponses, 0)
    const requests = traffic.reduce((total, view) => total + view.getRequests, 0)
    assert.ok(rows.length >= success && rows.length <= requests)
    assert.ok(success > 0)
    results.push({ tenant: tenant.key, auditedViews: rows.length, observedSuccessful200: success, observedGetAttempts: requests, metadataWhitelist: true, everyAuditMatchesKnownAggregate: true })
  }
  return { results, appendOnlyAuditPrivilegeOnly: true, cancelledDevReadsMayCompleteTheirViewAudit: true, globallyZeroDatabaseWritesClaimed: false }
}
try {
  for (const path of ["scripts/workforce-exception-report-browser-evidence.mjs", "scripts/ci/fixtures/workforce-exception-report-browser.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql", ".github/workflows/workforce-exception-report-browser-evidence.yml", "src/components/workforce/workforce-exception-report.tsx", "src/components/workforce/workforce-exception-recorded-outcomes.tsx", "src/app/api/v1/workforce/exception-reports/route.ts", "src/lib/workforce/exception-case-report-read.ts", "src/lib/workforce/exception-case-report-recorded-outcomes.ts", "messages/en.json", "messages/ru.json", "messages/az.json"]) {
    const raw = await readFile(new URL(`../${path}`, import.meta.url)); receipts.sources.push({ path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") })
  }
  stage = "historical-fixture-seeding"
  const tenants = await seed(), organizationIds = tenants.map(tenant => tenant.organization.id)
  const before = await facts(organizationIds)
  receipts.rlsBefore = await rlsControls(tenants, "BEFORE")
  stage = "hosted-chromium-launch"; browser = await chromium.launch({ headless: true })
  for (const [locale, width] of [["ru", 320], ["az", 768], ["en", 1440]]) await localeScenario(tenants[0], locale, width)
  await deniedScenario(tenants[0], tenants[0].teamManager)
  await deniedScenario(tenants[0], tenants[0].denied)
  await foreignScenario(tenants)
  stage = "business-fact-integrity-after"
  const after = await facts(organizationIds); assert.deepEqual(after, before, "Every captured Workforce fact must remain byte-identical")
  receipts.factImmutability = { tenantCount: 2, tables: before.map((row, index) => ({ ...row, afterSha256: after[index].sha256, unchanged: true })), userAuthenticationMetadataExcluded: true, permittedAuditDeltaSeparate: true }
  receipts.rlsAfter = await rlsControls(tenants, "AFTER")
  receipts.viewAudit = await auditProof(tenants)
  assert.equal(receipts.cases.length, 9)
  currentDate(); receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"; process.exitCode = 1
  const sourceFrame = String(error?.stack || "").split("\n").find(line => line.includes(import.meta.url))
  const position = sourceFrame?.match(/:(\d+):(\d+)\)?$/)
  receipts.failure = { stage, name: ["AssertionError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(error?.name) ? error.name : "Error", sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null, diagnostic: "Original failure preserved; no raw error, stack, body, credentials, cookie or session uploaded" }
  if (activePage && !activePage.isClosed()) {
    try { await activePage.screenshot({ path: `${outputDirectory}/failure-original.png`, fullPage: true }); receipts.failure.screenshot = "failure-original.png" } catch { receipts.failure.screenshot = "NOT_CAPTURED" }
    try {
      await activePage.getByTestId("workforce-exception-recorded-outcomes").screenshot({ path: `${outputDirectory}/failure-outcomes.png` })
      receipts.failure.outcomesScreenshot = "failure-outcomes.png"
    } catch { receipts.failure.outcomesScreenshot = "NOT_CAPTURED" }
  }
} finally {
  const closedContexts = await Promise.allSettled(contexts.map(context => context.close()))
  const closedBrowser = browser ? await Promise.allSettled([browser.close()]) : []
  const disconnected = await Promise.allSettled([app.$disconnect(), admin.$disconnect()])
  const results = [...closedContexts, ...closedBrowser, ...disconnected]
  const labels = [...contexts.map((_, index) => `context-${index + 1}`), ...(browser ? ["browser"] : []), "application-database", "fixture-database"]
  receipts.cleanupActions = results.map((result, index) => ({ action: labels[index], status: result.status === "fulfilled" ? "PASS" : "FAIL" }))
  receipts.cleanup = results.every(result => result.status === "fulfilled") ? "PASS" : "FAIL"
  if (receipts.cleanup === "FAIL") { receipts.status = "FAIL"; process.exitCode = 1 }
  receipts.completedAt = new Date().toISOString()
  await writeFile(`${outputDirectory}/exception-report-receipt.json`, JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: receipts.status, completedCases: receipts.cases.length, cleanup: receipts.cleanup }))
}
