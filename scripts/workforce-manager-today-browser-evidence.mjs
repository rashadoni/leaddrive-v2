import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { createJiti } from "jiti"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Disposable hosted browser proof only; this is never a production seed tool.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Hosted Actions required")
assert.equal(process.env.CI, "true", "Explicit CI required")
assert.equal(process.env.WF_MANAGER_TODAY_BROWSER, "1", "Fixture opt-in required")
assert.notEqual(process.env.NODE_ENV, "production", "Production is excluded")
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const origin = new URL(process.env.WF_MANAGER_TODAY_BROWSER_BASE_URL)
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname), "Loopback application required")
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname), "Loopback fixture database required")
  assert.equal(url.pathname, "/workforce_manager_today_browser", "Dedicated Today fixture database required")
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
assert.match(process.env.WF_MANAGER_TODAY_BROWSER_HEAD_SHA || "", /^[a-f0-9]{40}$/, "Candidate HEAD must be exact full SHA")
assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/, "Checked CI SHA must be exact full SHA")
const outputDirectory = process.env.WF_MANAGER_TODAY_BROWSER_OUTPUT_DIR || "artifacts/workforce-manager-today-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const endpoint = "/api/v1/workforce/today"
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
  candidateHead: process.env.WF_MANAGER_TODAY_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA,
  harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
  startedAt: new Date().toISOString(),
  date,
  environment: "hosted Chromium / loopback Next dev / disposable PostgreSQL16",
  authentication: "real CSRF, credentials provider and session; no auth mocks",
  authenticationDiagnostics: [],
  cases: [],
  status: "RUNNING",
  limitations: ["Development bundle, not production build", "Synthetic disposable data only", "No positive immutable current-workday snapshot rendering acceptance", "No human AT/native zoom/whole-page keyboard/Android/physical/load/pilot acceptance", "Geometry/text checks do not prove pixel occlusion or whole-page accessibility", "Read-only manager Today; no production feature/grant activation"],
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
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).workforcePage
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

async function seed() {
  currentDate()
  const passwordHash = await bcrypt.hash(password, 4)
  const organizations = []
  for (const key of ["a", "b"]) organizations.push(await admin.organization.create({ data: {
    name: `Today browser fixture ${key}`, slug: `wf-today-${suffix}-${key}`, plan: "enterprise",
    modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"], settings: {},
  } }))
  const [organization, foreign] = organizations
  const people = []
  for (const [key, role] of [["issuer", "admin"], ["manager", "manager"], ["approver", "manager"], ["denied", "manager"]]) {
    const user = await admin.user.create({ data: {
      organizationId: organization.id, email: `today-${suffix}-${key}@example.test`,
      name: `Today fixture ${key}`, passwordHash, role, require2fa: false, totpEnabled: false, smsAuthEnabled: false, preferredLanguage: "en",
    } })
    people.push({ ...user, key, slug: organization.slug })
  }
  const [issuer, manager, approver, denied] = people
  const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: "Today authorized team", code: `TODAY-A-${suffix}`, isActive: true } })
  const otherTeam = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: "Today out-of-scope team", code: `TODAY-B-${suffix}`, isActive: true } })
  const foreignTeam = await admin.mtmTeam.create({ data: { organizationId: foreign.id, name: "Today foreign team", code: `TODAY-F-${suffix}`, isActive: true } })
  await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
  const employees = []
  for (let ordinal = 1; ordinal <= 26; ordinal++) {
    const number = String(ordinal).padStart(3, "0")
    employees.push(await admin.mtmAgent.create({ data: {
      id: `wf_today_${suffix}_${number}`, organizationId: organization.id, teamId: team.id,
      name: `Today Employee ${String(ordinal).padStart(2, "0")}`, role: "AGENT", status: "ACTIVE", userId: null,
    } }))
  }
  const sentinels = []
  for (const [key, org, selectedTeam, status] of [["inactive", organization, team, "INACTIVE"], ["outscope", organization, otherTeam, "ACTIVE"], ["foreign", foreign, foreignTeam, "ACTIVE"]]) {
    sentinels.push(await admin.mtmAgent.create({ data: {
      id: `wf_today_${suffix}_000_${key}`, organizationId: org.id, teamId: selectedTeam.id,
      name: `EXCLUDED ${key} fixture ${suffix}`, role: "AGENT", status, userId: null,
    } }))
  }
  for (const [principal, role] of [[manager, "TEAM_MANAGER"], [approver, "TIME_APPROVER"]]) {
    await admin.workforceAccessGrant.create({ data: {
      organizationId: organization.id, principalUserId: principal.id, role, scopeKind: "TEAM", scopeTeamId: team.id,
      scopeSiteId: null, scopeAgentId: null, effectiveFrom: earlier(2), effectiveUntil: null,
      operationId: `today-${suffix}-${principal.key}`, grantedByUserId: issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
    } })
  }
  const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } })
  const { workforceShiftDefinitionHash } = await jiti.import("../src/lib/workforce/shift-definition.ts")
  const { createWorkforceExceptionCaseDraft } = await jiti.import("../src/lib/workforce/exception-case-ledger.ts")
  const definition = { startTime: "00:00", endTime: "23:59", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }
  const template = await admin.workforceShiftTemplate.create({ data: {
    organizationId: organization.id, teamId: null, code: `TODAY-${suffix}`, isDefault: false, version: 1,
    status: "DRAFT", name: "Today published UTC fixture", timezone: "UTC", definition,
    definitionHash: workforceShiftDefinitionHash(definition), provenance: "TENANT_ADMIN", createdByUserId: issuer.id, createdAt: earlier(3),
  } })
  const segment = await admin.workforceShiftSegment.create({ data: {
    organizationId: organization.id, templateId: template.id, sequence: 1, mode: "REMOTE", siteId: null,
    startTime: "00:00", endTime: "23:59", lateGraceSeconds: 0,
  } })
  await admin.workforceShiftTemplate.update({ where: { id: template.id }, data: { status: "ACTIVE", activatedByUserId: issuer.id, activatedAt: earlier(2) } })
  for (const [index, employee] of employees.entries()) {
    await admin.workforceEmployeeTeamMembership.create({ data: { organizationId: organization.id, agentId: employee.id, teamId: team.id, effectiveAt: earlier(2), source: "BROWSER_FIXTURE_BASELINE" } })
    if (index !== 4) await admin.workforceShiftAssignment.create({ data: { organizationId: organization.id, agentId: employee.id, templateId: template.id, effectiveFrom: earlier(2), effectiveTo: null, assignedByUserId: issuer.id } })
  }
  await admin.mtmWorkCalendarDay.create({ data: { organizationId: organization.id, date: workDate, kind: "EXCEPTION_WORKDAY", source: "ADMIN", name: "Today fixture working date", teamId: null, agentId: null } })
  for (const [index, kind, source] of [[3, "COMPANY_HOLIDAY", "WORKFORCE_LEAVE"], [5, "PUBLIC_HOLIDAY", "ADMIN"]]) {
    await admin.mtmWorkCalendarDay.create({ data: { organizationId: organization.id, date: workDate, kind, source, name: "Today excused fixture", teamId: null, agentId: employees[index].id } })
  }
  const draft = createWorkforceExceptionCaseDraft({ organizationId: organization.id, agentId: employees[1].id, kind: "NO_SHOW", detectorVersion: "workforce-no-show-v1", links: { segmentId: segment.id, expectedWorkDate: date } })
  await admin.workforceExceptionCase.create({ data: {
    organizationId: draft.organizationId, agentId: draft.agentId, kind: draft.kind,
    detectorVersion: draft.detectorVersion, deduplicationKey: draft.deduplicationKey,
    workdayId: null, workdayEventId: null, evidenceId: null, segmentId: draft.links.segmentId, expectedWorkDate: workDate,
  } })
  await admin.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: employees[2].id, workDate: earlier(1), status: "STARTED", startedAt: new Date(earlier(1).getTime() + 8 * 3_600_000), totalPausedSeconds: 0 } })
  currentDate()
  return { organizations, organization, foreign, manager, approver, denied, employees, sentinels, template }
}

async function checkedRead(response, fixture, { page = 1, exceptions = true } = {}) {
  currentDate()
  assert.equal(response.status(), 200)
  const headers = await response.headers()
  assert.ok(headers["cache-control"]?.includes("private"))
  assert.ok(headers["cache-control"]?.includes("no-store"))
  assert.equal(headers["x-content-type-options"], "nosniff")
  const result = await response.json()
  assert.equal(result.success, true)
  const data = result.data
  assert.equal(data.date, date)
  assert.equal(data.timezone, "UTC")
  assert.equal(data.scope, "GRANT")
  assert.equal(data.summaryScope, "LOADED_PAGE")
  assert.equal(data.pagination.pageSize, 25)
  assert.equal(data.employeeToday, null)
  assert.deepEqual(data.summary, { started: 0, paused: 0, completed: 0, notStarted: page === 1 ? 25 : 1, previousOpen: page === 1 ? 1 : 0 })
  const wanted = page === 1 ? fixture.employees.slice(0, 25) : fixture.employees.slice(25)
  assert.deepEqual(data.people.map(person => person.id), wanted.map(person => person.id))
  assert.equal(data.pagination.nextCursor, page === 1 ? fixture.employees[24].id : null)
  const forbidden = ["latitude", "longitude", "coordinates", "evidenceId", "caseId", "actorUserId", "reason", "reasonText"]
  function minimized(value) {
    if (value == null || typeof value !== "object") return
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!forbidden.includes(key), "Today must not disclose raw or case-private fields")
      minimized(nested)
    }
  }
  minimized(data)
  for (const sentinel of fixture.sentinels) assert.ok(!JSON.stringify(result).includes(sentinel.id) && !JSON.stringify(result).includes(sentinel.name))
  for (const person of data.people) {
    assert.equal(person.workday, null)
    assert.equal(person.status, "NOT_STARTED")
    assert.equal(person.attendance.acceptedStartRecorded, false)
    assert.deepEqual(person.boundaries, { rawEvidence: "EXCLUDED", location: "EXCLUDED", reasons: "EXCLUDED", actors: "EXCLUDED", caseIdentifiers: "EXCLUDED", presenceConclusion: "NOT_INFERRED" })
    if (exceptions) assert.ok(Array.isArray(person.exceptions))
    else assert.equal(person.exceptions, null)
  }
  if (page === 1) {
    const [scheduled, noShow, previous, leave, unavailable, holiday] = data.people
    assert.equal(scheduled.attendance.state, "SCHEDULED_NOT_STARTED")
    assert.equal(scheduled.plan.source, "EFFECTIVE_PUBLISHED_SCHEDULE")
    assert.equal(scheduled.calendar.state, "SCHEDULED")
    assert.equal(scheduled.calendar.attendanceExpected, true)
    assert.equal(noShow.attendance.state, exceptions ? "NO_SHOW" : "SCHEDULED_NOT_STARTED")
    assert.equal(noShow.plan.source, exceptions ? "PERSISTED_NO_SHOW_CASE" : "EFFECTIVE_PUBLISHED_SCHEDULE")
    if (exceptions) assert.deepEqual(noShow.exceptions, [{ type: "NO_SHOW", status: "OPEN" }])
    assert.equal(previous.previousOpenWorkday.status, "STARTED")
    assert.equal(previous.previousOpenWorkday.workDate.slice(0, 10), earlier(1).toISOString().slice(0, 10))
    assert.equal(previous.attendance.state, "SCHEDULED_NOT_STARTED")
    assert.equal(leave.attendance.state, "NOT_EXPECTED")
    assert.equal(leave.calendar.state, "APPROVED_LEAVE")
    assert.equal(leave.calendar.excused, true)
    assert.equal(leave.calendar.noShowEligible, false)
    assert.equal(leave.plan.state, "NON_WORKING_DAY")
    assert.equal(leave.plan.source, "CALENDAR")
    assert.equal(unavailable.attendance.state, "SCHEDULE_UNAVAILABLE")
    assert.equal(unavailable.plan.state, "UNAVAILABLE")
    assert.equal(holiday.calendar.state, "PUBLIC_HOLIDAY")
    assert.equal(holiday.attendance.state, "NOT_EXPECTED")
    assert.equal(holiday.plan.state, "NON_WORKING_DAY")
    assert.equal(holiday.plan.source, "CALENDAR")
  } else {
    assert.equal(data.people[0].attendance.state, "SCHEDULED_NOT_STARTED")
    assert.equal(data.people[0].plan.source, "EFFECTIVE_PUBLISHED_SCHEDULE")
  }
  currentDate()
  return data
}
function responseForToday(response) {
  const url = new URL(response.url())
  return url.origin === origin.origin && url.pathname === endpoint && response.request().method() === "GET"
}
async function tabTo(page, locator) {
  for (let tabs = 1; tabs <= 180; tabs++) {
    await page.keyboard.press("Tab")
    if (await locator.evaluate(element => document.activeElement === element)) return tabs
  }
  throw new Error("Native Tab could not reach Today pagination")
}
async function openToday(principal, locale, viewport) {
  currentDate()
  const context = await browser.newContext({ baseURL, locale: "en-US", viewport, serviceWorkers: "block" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }])
  await authenticate(context, principal)
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(120_000)
  const workforceWrites = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/workforce/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) workforceWrites.push({ path: url.pathname, method: request.method() })
  })
  const firstResponse = page.waitForResponse(response => responseForToday(response) && !new URL(response.url()).searchParams.has("cursor"), { timeout: 120_000 })
  await page.goto("/workforce", { waitUntil: "domcontentloaded" })
  const response = await firstResponse
  assert.notEqual(new URL(page.url()).pathname, "/login")
  return { context, page, response, workforceWrites, ui: await copy(locale) }
}
async function managerScenario(fixture, principal, locale, viewport, exceptions) {
  const scenario = `today-${principal.key}-${locale}`
  stage = `${scenario}-real-authentication`
  const view = await openToday(principal, locale, viewport)
  stage = `${scenario}-first-response`
  const first = await checkedRead(view.response, fixture, { exceptions })
  stage = `${scenario}-localized-first-page`
  const section = view.page.locator('section[aria-labelledby="workforce-manager-today-list"]')
  const articles = section.locator("article")
  await articles.nth(24).waitFor()
  assert.equal(await articles.count(), 25)
  for (let index = 0; index < 25; index++) {
    const article = articles.nth(index)
    const person = first.people[index]
    assert.ok((await article.innerText()).includes(person.name))
    assert.ok((await article.innerText()).includes(view.ui.managerAttendanceState[person.attendance.state]))
    assert.ok((await article.innerText()).includes(view.ui.managerCalendarState[person.calendar.state]))
    assert.ok((await article.innerText()).includes(view.ui.managerPresenceBoundary))
    assert.ok((await article.innerText()).includes(exceptions ? view.ui.managerExceptionsTitle : view.ui.managerExceptionsRestricted))
  }
  const previousText = view.ui.previousOpen.replace("{date}", earlier(1).toISOString().slice(0, 10))
  assert.ok((await articles.nth(2).innerText()).includes(previousText))
  assert.ok((await articles.nth(4).innerText()).includes(view.ui.managerPlanState.UNAVAILABLE))
  assert.ok((await articles.nth(3).innerText()).includes(view.ui.managerPlanState.NON_WORKING_DAY))
  assert.ok((await articles.nth(5).innerText()).includes(view.ui.managerPlanState.NON_WORKING_DAY))
  if (exceptions) {
    assert.ok((await articles.nth(1).innerText()).includes(view.ui.timesheetApprovalException.NO_SHOW))
    assert.ok((await articles.nth(1).innerText()).includes(view.ui.timesheetExceptionStatus.OPEN))
  } else {
    assert.equal((await section.innerText()).includes(view.ui.timesheetApprovalException.NO_SHOW), false)
  }
  assert.equal(await section.getByText(fixture.employees[25].name, { exact: true }).count(), 0)
  await view.page.screenshot({ path: `${outputDirectory}/${principal.key}-${locale}-first-page.png`, fullPage: true })
  const loadMore = section.getByRole("button", { name: view.ui.managerLoadMore, exact: true })
  assert.equal(await loadMore.isEnabled(), true)
  stage = `${scenario}-native-tab`
  const tabs = await tabTo(view.page, loadMore)
  assert.equal(await loadMore.evaluate(element => element.matches(":focus-visible")), true)
  await view.page.screenshot({ path: `${outputDirectory}/${principal.key}-${locale}-native-pagination.png` })
  const nextResponse = view.page.waitForResponse(response => responseForToday(response) && new URL(response.url()).searchParams.get("cursor") === fixture.employees[24].id)
  stage = `${scenario}-native-enter-second-response`
  await view.page.keyboard.press("Enter")
  const second = await checkedRead(await nextResponse, fixture, { page: 2, exceptions })
  await articles.nth(25).waitFor()
  assert.equal(await articles.count(), 26)
  const names = await articles.locator(":scope > div:first-child > p.truncate.font-medium").allTextContents()
  assert.deepEqual(names, fixture.employees.map(employee => employee.name))
  assert.equal(new Set(names).size, 26)
  assert.ok((await section.innerText()).includes(view.ui.managerLoadedPeople.replace("{count}", "26")))
  assert.ok((await articles.nth(25).innerText()).includes(view.ui.managerAttendanceState[second.people[0].attendance.state]))
  assert.equal(await loadMore.count(), 0)
  await articles.nth(25).scrollIntoViewIfNeeded()
  stage = `${scenario}-absent-employee-page-two-geometry`
  assert.equal(await articles.nth(25).isVisible(), true)
  const absenceGeometry = await articles.nth(25).evaluate((article, expectedText) => {
    const person = article.querySelector(":scope > div:first-child > p.truncate.font-medium")
    const state = article.querySelector(":scope > div:first-child > div.mt-3")
    return [person, state].map(element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      const css = getComputedStyle(element)
      return { positive: rect.width > 0 && rect.height > 0, withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, untruncated: element.scrollWidth <= element.clientWidth, displayed: css.display !== "none" && css.visibility === "visible" && Number(css.opacity) > 0, stateTextMatched: element === state ? element.textContent.trim() === expectedText : true }
    })
  }, view.ui.managerAttendanceState[second.people[0].attendance.state])
  assert.equal(absenceGeometry.length, 2)
  for (const geometry of absenceGeometry) assert.deepEqual(geometry, { positive: true, withinViewport: true, untruncated: true, displayed: true, stateTextMatched: true })
  await view.page.screenshot({ path: `${outputDirectory}/${principal.key}-${locale}-absent-page-two.png` })
  assert.deepEqual(view.workforceWrites, [])
  stage = `${scenario}-preserved-real-session`
  await assertSession(view.context, principal)
  receipts.cases.push({ name: `${principal.key}-${locale}`, status: "PASS", firstPage: 25, secondPage: 1, finalUniqueOrderedPeople: 26, scheduledWithoutWorkdayExplained: true, persistedNoShowAuthority: exceptions, exceptionsNullWithoutAuthority: !exceptions, previousOpenRetained: true, leaveAndHolidayExplained: true, unavailableScheduleExplained: true, nativePaginationTabs: tabs, nativePaginationEnter: true, pageTwoAbsenceGeometry: absenceGeometry, readOnlyWorkforceRequests: true, realSessionPreserved: true, viewport })
  if (principal.key === "manager" && locale === "en") {
    stage = `${scenario}-forged-tenant-headers`
    // The actual proxy strips caller tenant headers on loopback. The request
    // therefore remains bound to its authenticated tenant rather than 403.
    const forged = await view.context.request.get(endpoint, { headers: { "x-organization-id": fixture.foreign.id, "x-tenant-slug": fixture.foreign.slug } })
    await checkedRead(forged, fixture, { exceptions: true })
    await assertSession(view.context, principal)
    receipts.cases.push({ name: "forged-tenant-headers-remain-session-bound", status: "PASS", responseStatus: 200, foreignPeopleExcluded: true, authenticatedTenantPreserved: true, noHeaderDerived403Claim: true })
  }
  await view.context.close()
}

async function verifyUnscopedRls(fixture, phase) {
  currentDate()
  const [role] = await app.$queryRawUnsafe(`SELECT current_user AS name, current_database() AS database, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolinherit, current_setting('app.org_id', true) AS tenant, current_setting('app.rls_bypass', true) AS bypass FROM pg_roles r WHERE r.rolname = current_user`)
  assert.equal(role.name, "wf_manager_today_browser")
  assert.equal(role.database, "workforce_manager_today_browser")
  for (const permission of ["rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication", "rolinherit"]) assert.equal(role[permission], false)
  assert.ok(role.tenant == null || role.tenant === "")
  assert.notEqual(role.bypass, "on")
  const tables = ["users", ...factTables].sort()
  const metadata = await app.$queryRawUnsafe(`SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner, EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'wf_manager_today_tenant') AS policy FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[]) ORDER BY c.relname`, tables)
  assert.equal(metadata.length, 20)
  assert.deepEqual(metadata.map(table => table.name), tables)
  const counts = []
  for (const table of metadata) {
    assert.equal(table.enabled, true)
    assert.equal(table.forced, true)
    assert.equal(table.policy, true)
    assert.notEqual(table.owner, role.name)
    assert.match(table.name, /^[a-z_]+$/)
    const [row] = await app.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table.name}"`)
    assert.equal(Number(row.count), 0, "Unscoped application role must see zero rows")
    const [populated] = await admin.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table.name}" WHERE "organizationId" IN ($1, $2)`, fixture.organization.id, fixture.foreign.id)
    counts.push({ table: table.name, syntheticRows: Number(populated.count), unscopedVisibleRows: Number(row.count), forcedRls: true, appOwnsTable: false })
  }
  assert.equal(counts.find(row => row.table === "users").syntheticRows, 4)
  assert.equal(counts.find(row => row.table === "mtm_agents").syntheticRows, 29)
  assert.equal(counts.find(row => row.table === "workforce_exception_cases").syntheticRows, 1)
  assert.equal(counts.find(row => row.table === "mtm_agent_workdays").syntheticRows, 1)
  currentDate()
  return { phase, role: role.name, tenantContextAbsent: true, bypassAbsent: true, unsafeRolePrivilegesAbsent: true, counts }
}

async function deniedScenario(fixture) {
  stage = "today-denied-no-grant"
  const view = await openToday(fixture.denied, "ru", { width: 320, height: 900 })
  assert.equal(view.response.status(), 403)
  const headers = await view.response.headers()
  assert.ok(headers["cache-control"]?.includes("private") && headers["cache-control"]?.includes("no-store"))
  assert.equal(headers["x-content-type-options"], "nosniff")
  const body = await view.response.json()
  assert.equal(body.code, "WORKFORCE_TODAY_READ_ACCESS_REQUIRED")
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"])
  for (const employee of [...fixture.employees, ...fixture.sentinels]) assert.ok(!JSON.stringify(body).includes(employee.id) && !JSON.stringify(body).includes(employee.name))
  const alert = view.page.getByRole("alert")
  await alert.waitFor()
  assert.ok((await alert.innerText()).includes(view.ui.loadFailed))
  assert.equal(await view.page.locator('section[aria-labelledby="workforce-manager-today-list"]').count(), 0)
  assert.equal(await view.page.getByText(fixture.employees[0].name, { exact: true }).count(), 0)
  await view.page.screenshot({ path: `${outputDirectory}/denied-ru-no-grant.png` })
  assert.deepEqual(view.workforceWrites, [])
  await assertSession(view.context, fixture.denied)
  receipts.cases.push({ name: "no-grant-real-session-denied", status: "PASS", responseStatus: 403, code: body.code, namesAndFactsExcluded: true, noRosterRendered: true, localizedErrorRendered: true, readOnlyWorkforceRequests: true, realSessionPreserved: true })
  await view.context.close()
}

try {
  const fixture = await seed()
  stage = "seeded-facts-before"
  const organizationIds = [fixture.organization.id, fixture.foreign.id]
  const before = await facts(organizationIds)
  assert.equal(before.find(row => row.table === "workforce_shift_assignments").count, 25)
  assert.equal(before.find(row => row.table === "workforce_employee_team_memberships").count, 26)
  assert.equal(before.find(row => row.table === "mtm_work_calendar_days").count, 3)
  receipts.rlsBefore = await verifyUnscopedRls(fixture, "BEFORE_AUTHENTICATED_READS")
  stage = "hosted-chromium-launch"
  browser = await chromium.launch({ headless: true })
  for (const [locale, width] of [["ru", 320], ["az", 768], ["en", 1440]]) await managerScenario(fixture, fixture.manager, locale, { width, height: 900 }, true)
  await managerScenario(fixture, fixture.approver, "ru", { width: 320, height: 900 }, false)
  await deniedScenario(fixture)
  stage = "read-only-facts-after"
  const after = await facts(organizationIds)
  assert.deepEqual(after, before, "Every captured Workforce fact must remain byte-identical after real authenticated reads")
  receipts.factImmutability = { status: "PASS", tenantCount: 2, tables: before.map((row, index) => ({ ...row, afterSha256: after[index].sha256, unchanged: true })), userAuthenticationMetadataExcluded: true }
  receipts.rlsAfter = await verifyUnscopedRls(fixture, "AFTER_AUTHENTICATED_READS")
  assert.equal(receipts.cases.length, 6)
  currentDate()
  receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"
  // Deliberately preserve phase/name only: assertions, Prisma errors and URLs
  // can otherwise contain private bodies or masked application credentials.
  const sourceFrame = String(error?.stack || "").split("\n").find(line => line.includes(import.meta.url))
  const position = sourceFrame?.match(/:(\d+):(\d+)\)?$/)
  const safeMessages = ["Real UTC date crossed midnight; preserve failure without reseeding", "Real credentials callback must succeed", "Fixture authentication wait must remain bounded", "Fixture authentication must remain within its conservative budget", "Fixture fact snapshot must remain bounded", "Today must not disclose raw or case-private fields", "Unscoped application role must see zero rows", "Every captured Workforce fact must remain byte-identical after real authenticated reads"]
  const check = safeMessages.find(message => String(error?.message || "").includes(message))
  const safePrimitive = value => typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null ? value : { type: Array.isArray(value) ? "array" : typeof value }
  receipts.failure = {
    stage,
    name: ["AssertionError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(error?.name) ? error.name : "Error",
    sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
    check: check || "Inspect sourcePosition against harnessSha256; no raw error message recorded",
    ...(error?.name === "AssertionError" ? { actual: safePrimitive(error.actual), expected: safePrimitive(error.expected) } : {}),
    diagnostic: "Original hosted assertion failed; no raw payload, stack, token or credentials uploaded",
  }
  if (activePage && !activePage.isClosed()) {
    try { await activePage.screenshot({ path: `${outputDirectory}/failure-original.png`, fullPage: true }); receipts.failure.screenshot = "failure-original.png" } catch { receipts.failure.screenshot = "NOT_CAPTURED" }
  }
  process.exitCode = 1
} finally {
  // A browser must outlive its contexts' request/channel disposal. Keep each
  // rejection fatal, and record only fixed action labels and safe error types.
  const contextCleanup = await Promise.allSettled(contexts.map(context => context.close()))
  const browserCleanup = browser ? await Promise.allSettled([browser.close()]) : []
  const databaseCleanup = await Promise.allSettled([app.$disconnect(), admin.$disconnect()])
  const cleanup = [...contextCleanup, ...browserCleanup, ...databaseCleanup]
  const labels = [...contexts.map((_, index) => `context-${index + 1}`), ...(browser ? ["browser"] : []), "application-database", "fixture-database"]
  receipts.cleanupActions = cleanup.map((result, index) => ({
    action: labels[index],
    status: result.status === "fulfilled" ? "PASS" : "FAIL",
    ...(result.status === "rejected" ? {
      name: ["TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(result.reason?.name) ? result.reason.name : "Error",
    } : {}),
  }))
  receipts.cleanup = cleanup.every(result => result.status === "fulfilled") ? "PASS" : "FAIL"
  if (receipts.cleanup === "FAIL") { receipts.status = "FAIL"; process.exitCode = 1 }
  receipts.completedAt = new Date().toISOString()
  await writeFile(`${outputDirectory}/manager-today-receipt.json`, JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: receipts.status, completedCases: receipts.cases.length, date, cleanup: receipts.cleanup }))
}
