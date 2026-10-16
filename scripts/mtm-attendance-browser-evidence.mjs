import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { requireFixture, seedFixture } from './fixtures/mtm-attendance-e2e.mjs'

requireFixture()
const origin = new URL(process.env.MTM_E2E_BASE_URL)
assert.equal(origin.protocol, 'http:')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname))
assert.equal(origin.pathname + origin.search + origin.hash, '/')
assert.equal(origin.username + origin.password, '')
const head = process.env.MTM_E2E_HEAD_SHA
assert.match(head ?? '', /^[a-f0-9]{40}$/)
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), head)
const output = process.env.MTM_E2E_OUTPUT || 'artifacts/mtm-attendance-e2e'
await mkdir(output, { recursive: true })
const english = JSON.parse(await readFile('messages/en.json', 'utf8'))
const messages = english.mtmAttendance
/** Personnel labels (`personnel.*`), for the screens rebuilt on 2026-10-14. */
const pt = key => { const value = key.split('.').reduce((node, part) => node?.[part], english.personnel); assert.equal(typeof value, 'string', `Missing label personnel.${key}`); return value }
const t = (key, vars = {}) => {
  assert.equal(typeof messages[key], 'string', `Missing label ${key}`)
  return messages[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`))
}
const routes = ['', 'timesheet', 'settings', 'requests', 'decisions', 'employees', 'branches', 'branches/report', 'shifts', 'leave-balances', 'months', 'installations', 'branch-qr', 'review', 'location-settings', 'recordings']
// The former pages are tabs of the four Personnel destinations now. Each route
// key keeps its case name; the value is [address, sidebar destination].
const destinations = {
  '': ['', ''], timesheet: ['timesheet', 'timesheet'], settings: ['settings?tab=hours', 'settings'], requests: ['requests', ''],
  decisions: ['timesheet?view=decisions', 'timesheet'], employees: ['people?tab=employees', 'people'], branches: ['people?tab=branches', 'people'],
  'branches/report': ['timesheet?view=branches', 'timesheet'], shifts: ['settings?tab=shifts', 'settings'], 'leave-balances': ['settings?tab=leave', 'settings'],
  months: ['timesheet?view=months', 'timesheet'], installations: ['people?tab=phones', 'people'], 'branch-qr': ['settings?tab=qr', 'settings'],
  review: ['review', ''], 'location-settings': ['settings?tab=location', 'settings'], recordings: ['recordings', null],
  'day-kinds': ['settings?tab=day-kinds', 'settings'], 'request-limits': ['settings?tab=requests', 'settings'], 'hr-access': ['settings?tab=access', 'settings'],
}
const personnelHrefs = ['/mtm/attendance', '/mtm/attendance/timesheet', '/mtm/attendance/people', '/mtm/attendance/reports', '/mtm/attendance/settings']
const caseNames = ['fixture-rls', 'credentials-and-roles', 'hr-read-grant', 'mobile-workday', 'report-scope-exports', 'views-crud', 'deliveries-crud', 'rules-calendar', 'day-kinds-quotas', 'employee-participation', 'employment-history', 'branches-assignments', 'geo-policy-consent', 'requests-decisions', 'hr-recording-batch', 'installation-decisions', 'shift-day-night', 'leave-policy-profile', 'month-freeze', 'risk-dismissal', ...routes.map(route => `page:${route || 'report'}`), 'browser-report-tabs-filters-pagination', 'browser-views-save-rename-delete-cancel', 'browser-employee-search-switch-history', 'browser-branch-create-edit-archive-cancel', 'browser-request-approve-reject-revoke', 'browser-qr-toggle-refresh-hide', 'browser-locales-mobile-width', 'hr-revoke-fresh-session', 'final-privacy-invariants', 'browser-settings-hr-catalogue-quotas', 'browser-delivery-create-edit-cancel-delete', 'browser-batch-recording-and-decision-journal', 'browser-shift-publish-cancel-and-leave-profile', 'browser-geo-off-legal-block-and-branch-summary', 'browser-installation-approve-revoke-history', 'browser-month-frozen-download']
caseNames.push('browser-rules-calendar-crud', 'browser-hr-grant-revoke', 'browser-kind-create-archive-restore', 'browser-employment-record', 'browser-primary-branch-assignment', 'browser-risk-dismissal', 'browser-leave-policy-publication', 'browser-month-preview-close-blockers', 'browser-sidebar-click-traversal', 'browser-branch-lost-acknowledgement-retry', 'browser-catalogue-competing-tabs', 'browser-private-document-download-and-permissions')
const manifest = {
  version: 1, status: 'RUNNING', headSha: head, workflowSha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  environment: 'GitHub Linux, headed Chromium with Openbox under Xvfb, Next development server, isolated PostgreSQL 16',
  productionMutation: false, physicalAPK: 'NOT_RUN', outboundEmail: 'NOT_RUN',
  startedAt: new Date().toISOString(), cases: [], sourceBindings: [], controls: [], timings: [],
  limitations: [
    'Browser navigation and action families are separate records; page opening does not prove every button.',
    'Mobile workday and employee submission use the real mobile HTTP transport, not a physical APK or OS permissions.',
    'Fictional disposable organizations, policies and coordinates only; no client settings, legal approvals or external delivery.',
    'Current schema plus explicit attendance production migrations/guards; not a replay of every unrelated historical CRM migration.',
    'Development rendering; production build, physical phone, provider delivery, QR camera and overnight soak are distinct gates.',
  ],
}
for (const path of ['.github/workflows/mtm-attendance-e2e.yml', 'scripts/mtm-attendance-browser-evidence.mjs', 'scripts/fixtures/mtm-attendance-e2e.mjs', 'prisma/schema.prisma', ...execFileSync('git', ['ls-files', 'src/components/mtm/attendance-*', 'src/app/(dashboard)/mtm/attendance/*', 'src/lib/mtm/attendance-*', 'prisma/migrations/*mtm_attendance*/migration.sql'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)]) {
  const bytes = await readFile(path)
  manifest.sourceBindings.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
let fixture, browser, page
const sessions = {}, mobiles = {}
const state = {}
const apiRoot = '/api/v1/mtm/attendance'
const mobileRoot = '/api/v2/mtm/mobile/route-field/attendance'
const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
const today = dateKey(new Date())
const date = delta => new Date(Date.parse(`${today}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
const configuration = (from = today, to = from) => ({ version: 1, mode: 'DAY', columns: ['employee', 'date', 'status', 'worked'], showTotals: true, filters: { from, to, form: 'ALL' } })
async function persist() { await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n') }
async function run(name, transport, action) {
  const startedAt = new Date().toISOString()
  try {
    const detail = await action()
    manifest.cases.push({ name, transport, status: 'PASS', startedAt, completedAt: new Date().toISOString(), ...detail })
    console.log(`PASS ${name}`)
  } catch (error) {
    // Never dump response bodies, headers, auth tokens, raw SQL or runtime logs.
    const code = String(error?.message ?? '').match(/\bMTM_[A-Z_]+\b/)?.[0]
    const diagnostic = error?.safeDiagnostic ?? (error?.code === 'ERR_ASSERTION' ? 'Assertion mismatch' : error?.name || 'Error')
    manifest.cases.push({ name, transport, status: 'FAIL', startedAt, completedAt: new Date().toISOString(), diagnostic, ...(code ? { code } : {}), sourceLine: error?.stack?.match(/mtm-attendance-browser-evidence\.mjs:(\d+):/)?.[1] ?? null })
    console.log(`FAIL ${name}: ${diagnostic}`)
    if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure-${name.replace(/[^a-z0-9-]/gi, '-')}.png`, fullPage: false }).catch(() => {})
  }
  await persist()
}
async function request(session, path, { method = 'GET', body, status = 200, raw = false } = {}) {
  const response = await session.request.fetch(path, { method, ...(body === undefined ? {} : { data: body }), timeout: 120000 })
  if (response.status() !== status) {
    const error = new Error('Unexpected HTTP status')
    const json = await response.json().catch(() => null)
    error.safeDiagnostic = `${method} ${new URL(path, origin).pathname}: expected ${status}, received ${response.status()}${/^MTM_[A-Z_]+$/.test(json?.code ?? '') ? ` ${json.code}` : ''}`
    throw error
  }
  if (raw) return response
  const json = await response.json()
  if (status < 400) assert.equal(json.success, true)
  return json.data
}
const api = (role, path, options) => request(sessions[role], `${apiRoot}${path}`, options)
const mobile = (role, path, options) => request(mobiles[role], `${mobileRoot}${path}`, options)
async function poll(check, label, timeout = 20000) {
  const end = Date.now() + timeout
  do { if (await check()) return; await delay(100) } while (Date.now() < end)
  const error = new Error('Timed out'); error.safeDiagnostic = label; throw error
}
function playwrightFocusSession(targetPage) {
  // Focus emulation owns a Chromium capture handle per CDP session. A new
  // public CDPSession cannot release the handle enabled by Playwright itself.
  // Use the pinned in-process driver's original session, without patching the
  // driver or page. Fail closed if a dependency upgrade changes this structure.
  const implementation = targetPage._connection?.toImpl?.(targetPage)
  const delegate = implementation?.delegate
  const frame = delegate?._mainFrameSession
  if (!implementation || delegate?._page !== implementation || frame?._crPage !== delegate
    || frame?._targetId !== delegate?._targetId || typeof frame?._client?.send !== 'function') {
    const error = new Error('Unsupported Playwright focus session')
    error.safeDiagnostic = 'Pinned Playwright original focus session unavailable; review driver compatibility'
    throw error
  }
  return frame._client
}
async function readyPage(path) {
  const target = path in destinations ? destinations[path][0] : path
  await page.goto(`/mtm/attendance${target ? `/${target}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('h1').first().waitFor({ timeout: 120000 })
  await poll(async () => !(await page.locator('[aria-busy="true"]').count()), 'Page still busy', 120000)
}
// Office staff auto-enrolled at activation; a field agent is not HR attendance.
const rosterCard = name => fixture.admin.mtmAgent.findFirstOrThrow({ where: { organizationId: fixture.organization.id, name } })
/** Closed months pick a month with arrows (the browser's month input printed English in Azerbaijani). */
async function chooseMonth(target) {
  const picker = page.getByTestId('attendance-months-picker')
  for (let step = 0; step < 36 && await picker.getAttribute('data-month') !== target; step++) {
    await picker.getByRole('button', { name: pt((await picker.getAttribute('data-month')) > target ? 'previousMonth' : 'nextMonth'), exact: true }).click()
  }
  assert.equal(await picker.getAttribute('data-month'), target)
}
async function openTimesheetExtras() {
  await readyPage('timesheet')
  // Saved forms and deliveries open from the timesheet's "More" menu.
  if (!(await page.getByTestId('attendance-timesheet-extras').count())) {
    await page.getByTestId('attendance-timesheet-more').click()
    await page.getByRole('menuitem', { name: pt('customFormAndDelivery'), exact: true }).click()
  }
  await page.getByTestId('attendance-personal-views').waitFor({ timeout: 120000 })
}
async function readyLeaveBalances() {
  const started = Date.now()
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === `${apiRoot}/leave-balances` && response.request().method() === 'GET', { timeout: 120000 })
  void waiting.catch(() => {})
  await readyPage('leave-balances')
  const response = await waiting
  const body = await response.json().catch(() => null)
  manifest.timings.push({ route: `${apiRoot}/leave-balances`, phase: 'navigation-to-complete-response', elapsedMs: Date.now() - started, status: response.status() })
  if (response.status() !== 200 || body?.success !== true) {
    const error = new Error('Leave report did not load')
    error.safeDiagnostic = `GET leave-balances: received ${response.status()}${/^MTM_[A-Z_]+$/.test(body?.code ?? '') ? ` ${body.code}` : ''}`
    throw error
  }
  assert.ok(body.data.rows.length)
  await page.getByTestId('leave-row').first().waitFor()
}
async function clickResponse(locator, path, method = 'POST', status = 200, parseBody = true) {
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method, { timeout: 120000 })
  void waiting.catch(() => {}) // A failed click must not leave an unhandled listener rejection.
  await locator.click()
  const response = await waiting
  if (response.status() !== status) {
    const error = new Error('Unexpected browser HTTP status')
    error.safeDiagnostic = `${method} ${path}: expected ${status}, received ${response.status()}`
    throw error
  }
  if (!parseBody) return
  const body = await response.json()
  if (status < 400) assert.equal(body.success, true)
  return body.data
}
const button = (key, scope = page) => scope.getByRole('button', { name: t(key), exact: true })
async function login(context, user, slug) {
  const csrfResponse = await context.request.get('/api/auth/csrf', { timeout: 120000 })
  assert.equal(csrfResponse.status(), 200)
  const { csrfToken } = await csrfResponse.json()
  const response = await context.request.post('/api/auth/callback/credentials', { timeout: 120000,
    headers: { 'X-Auth-Return-Redirect': '1' }, form: { csrfToken, email: user.email, password: fixture.password, organizationSlug: slug, callbackUrl: `${origin.origin}/mtm/attendance` } })
  assert.equal(response.status(), 200)
  assert.equal(new URL((await response.json()).url, origin).searchParams.get('error'), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith('authjs.session-token')))
  const session = await (await context.request.get('/api/auth/session')).json()
  assert.equal(session.user.id, user.id)
  assert.equal(session.user.organizationId, user.organizationId)
}
async function mobileLogin(role) {
  const response = await request(sessions[role], '/api/v1/mtm/mobile/auth', { method: 'POST', body: { email: fixture.users[role].email, password: fixture.password, organizationSlug: fixture.organization.slug } })
  assert.equal(response.agent.id, fixture.agents[role].id)
  const context = await browser.newContext({ baseURL: origin.origin, extraHTTPHeaders: { Authorization: `Bearer ${response.token}`, 'x-field-device-id': `rf-e2e-${randomUUID()}` } })
  mobiles[role] = context
}
try {
  await run('fixture-rls', 'database', async () => { fixture = await seedFixture(); return { automaticEmployees: 58, restrictedRole: true, crossTenantDenied: true } })
  assert.ok(fixture, 'Fixture provisioning failed')
  // Native tab visibility is part of the QR lifecycle; no synthetic visibility events.
  assert.ok(process.env.DISPLAY, 'Hosted virtual display required')
  browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows'] })
  await run('credentials-and-roles', 'authenticated-http', async () => {
    for (const role of ['admin', 'hr', 'manager', 'employee', 'field', 'foreign']) {
      const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
      await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: origin.origin }])
      await context.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
      sessions[role] = context
      await login(context, fixture.users[role], role === 'foreign' ? fixture.foreignOrganization.slug : fixture.organization.slug)
    }
    await mobileLogin('employee'); await mobileLogin('field')
    return { webRoles: 6, actualMobileCredentialLogins: 2, mockedAuthentication: false }
  })
  assert.ok(sessions.admin && mobiles.employee)
  page = await sessions.admin.newPage()
  page.setDefaultTimeout(30000)
  await run('hr-read-grant', 'authenticated-http+database', async () => {
    const directory = await api('admin', '/access?search=Fixture%20hr')
    const row = directory.users.find(item => item.id === fixture.users.hr.id)
    assert.ok(row?.canGrant)
    const grant = await api('admin', `/access/${row.id}`, { method: 'PATCH', body: { allEmployees: true, version: row.version } })
    assert.equal(grant.allEmployees, true)
    await api('admin', `/access/${row.id}`, { method: 'PATCH', body: { allEmployees: false, version: row.version }, status: 409 })
    const report = await api('hr', `/report?from=${today}&to=${today}&form=ALL`)
    assert.ok(report.rows.some(row => row.employeeId === fixture.agents.outside.id))
    await api('hr', '/rules', { method: 'POST', body: {}, status: 403 })
    state.hrGrant = grant
  })
  await run('mobile-workday', 'mobile-http+database', async () => {
    const workdayId = randomUUID(), start = Date.now() - 240000
    for (const [index, action] of ['START', 'PAUSE', 'RESUME', 'FINISH'].entries()) {
      const data = { action, ...(action === 'START' ? { id: workdayId } : { workdayId }), occurredAt: new Date(start + index * 60000).toISOString() }
      const body = { operations: [{ operationId: randomUUID(), op: 'create', entity: 'workdays', data, clientTimestamp: Date.now() }] }
      for (let retry = 0; retry < 2; retry++) {
        const response = await mobiles.employee.request.post('/api/v1/mtm/mobile/sync/push', { data: body, timeout: 120000 })
        assert.equal(response.status(), 200)
        const result = (await response.json()).results
        assert.equal(result[0].status, 'ok'); assert.equal(result[0].serverId, workdayId)
      }
    }
    const workday = await fixture.admin.mtmAgentWorkday.findUniqueOrThrow({ where: { id: workdayId } })
    assert.equal(workday.status, 'COMPLETED'); assert.equal(workday.totalPausedSeconds, 60)
    assert.equal(workday.agentId, fixture.agents.employee.id)
    assert.equal(await fixture.admin.mtmAgentWorkdayEvent.count({ where: { workdayId } }), 4)
    await assert.rejects(() => fixture.admin.mtmAgentWorkday.update({ where: { id: workdayId }, data: { completedAt: new Date() } }))
    state.workdayId = workdayId
    return { transitions: 4, exactOperationRetries: 4, persistedEvents: 4 }
  })
  await run('report-scope-exports', 'authenticated-http', async () => {
    state.report = await api('admin', `/report?from=${today}&to=${today}&form=ALL`)
    assert.ok(state.report.rows.length > 50)
    const manager = await api('manager', `/report?from=${today}&to=${today}&form=ALL`)
    assert.ok(manager.rows.some(row => row.employeeId === fixture.agents.employee.id))
    assert.ok(manager.rows.every(row => row.teamId === fixture.team.id))
    const foreign = await api('foreign', `/report?from=${today}&to=${today}&form=ALL`)
    assert.ok(foreign.rows.every(row => row.employeeId === fixture.agents.foreign.id))
    await api('employee', '/rules', { status: 403 }); await api('field', '/rules', { status: 403 })
    await api('admin', '/report?from=invalid&to=invalid&form=ALL', { status: 400 })
    for (const format of ['xlsx', 'pdf']) {
      const response = await api('admin', '/export', { method: 'POST', body: { config: configuration(), format, locale: 'en', snapshot: state.report.snapshot }, raw: true })
      const bytes = await response.body()
      assert.ok(bytes.length > 200)
      assert.equal(bytes.subarray(0, format === 'pdf' ? 4 : 2).toString(), format === 'pdf' ? '%PDF' : 'PK')
    }
    const foreignResponse = await api('foreign', '/export', { method: 'POST', body: { config: configuration(), format: 'xlsx', locale: 'en', snapshot: state.report.snapshot }, raw: true, status: 409 })
    assert.equal(foreignResponse.status(), 409)
    return { formats: ['xlsx', 'pdf'], teamScope: true, foreignScope: true }
  })
  await run('views-crud', 'authenticated-http', async () => {
    const input = { name: 'Fixture private form', config: configuration(), requestId: randomUUID() }
    const view = await api('admin', '/views', { method: 'POST', body: input })
    assert.equal((await api('admin', '/views', { method: 'POST', body: input })).id, view.id)
    assert.ok(!(await api('hr', '/views')).some(row => row.id === view.id))
    const next = await api('admin', `/views/${view.id}`, { method: 'PATCH', body: { name: 'Fixture renamed form', config: input.config, version: view.version } })
    await api('admin', `/views/${view.id}`, { method: 'PATCH', body: { name: 'Stale', config: input.config, version: view.version }, status: 409 })
    await api('admin', `/views/${view.id}`, { method: 'DELETE', body: { version: next.version } })
    assert.ok(!(await api('admin', '/views')).some(row => row.id === view.id))
  })
  await run('deliveries-crud', 'authenticated-http+database', async () => {
    assert.deepEqual((await api('admin', '/deliveries')).schedules, [])
    const input = { name: 'Fixture disabled delivery', config: configuration(), frequency: 'DAILY', format: 'xlsx', locale: 'en', recipients: ['fixture@example.invalid'], enabled: false }
    await api('admin', '/deliveries', { method: 'POST', body: { requestId: randomUUID(), input: { ...input, recipients: ['bad-address'] } }, status: 400 })
    const body = { requestId: randomUUID(), input }
    const schedule = await api('admin', '/deliveries', { method: 'POST', body })
    assert.equal((await api('admin', '/deliveries', { method: 'POST', body })).id, schedule.id)
    const changed = await api('admin', `/deliveries/${schedule.id}`, { method: 'PATCH', body: { version: schedule.version, input: { ...input, format: 'pdf', frequency: 'WEEKLY' } } })
    await api('admin', `/deliveries/${schedule.id}`, { method: 'DELETE', body: { version: schedule.version }, status: 409 })
    await api('admin', `/deliveries/${schedule.id}`, { method: 'DELETE', body: { version: changed.version } })
    assert.deepEqual((await api('admin', '/deliveries')).schedules, [])
    const count = await fixture.admin.$queryRaw`SELECT count(*)::int AS n FROM mtm_attendance_deliveries`
    assert.equal(count[0].n, 0)
    return { externalSend: 'NOT_RUN', schedulesRemain: 0 }
  })
  await run('rules-calendar', 'authenticated-http', async () => {
    const rules = await api('admin', '/rules')
    const input = { effectiveFrom: rules.minEffectiveFrom, startTime: '09:00', endTime: '18:00', lunchMinutes: 60, lateGraceMinutes: 10, weekendDays: [0, 6] }
    await api('admin', '/rules', { method: 'POST', body: { ...input, endTime: '08:00' }, status: 400 })
    await api('admin', '/rules', { method: 'POST', body: input, status: 201 })
    assert.equal((await api('admin', '/rules')).versions.length, 1)
    const holiday = await api('admin', '/calendar', { method: 'POST', body: { date: date(15), kind: 'COMPANY_HOLIDAY', name: 'Fixture holiday' } })
    const revised = await api('admin', '/calendar', { method: 'POST', body: { date: date(15), kind: 'EXCEPTION_WORKDAY', name: 'Fixture exception', id: holiday.id, version: holiday.updatedAt } })
    await api('admin', '/calendar', { method: 'DELETE', body: { id: holiday.id, version: holiday.updatedAt }, status: 409 })
    await api('admin', '/calendar', { method: 'DELETE', body: { id: revised.id, version: revised.updatedAt } })
    await api('admin', '/calendar', { method: 'POST', body: { date: date(-1), kind: 'COMPANY_HOLIDAY', name: 'Forbidden past' }, status: 409 })
  })
  await run('day-kinds-quotas', 'authenticated-http', async () => {
    const catalogue = await api('admin', '/day-kinds')
    const items = catalogue.items.map(item => item.key === 'REMOTE_WORK' ? { ...item, names: { az: 'Sınaq uzaq iş', ru: 'Тестовая удалённая работа', en: 'Fixture remote work' } } : item)
    const changed = await api('admin', '/day-kinds', { method: 'PUT', body: { version: catalogue.version, items } })
    assert.ok(changed.version)
    await api('admin', '/day-kinds', { method: 'PUT', body: { version: catalogue.version, items }, status: 409 })
    await api('admin', '/day-kinds', { method: 'PUT', body: { version: changed.version, items: items.filter(item => item.key !== 'WORKED') }, status: 400 })
    const limits = await api('admin', '/request-limits')
    const updated = await api('admin', '/request-limits', { method: 'PUT', body: { version: limits.version, monthlyMinutes: 600, monthlyRequests: 4 } })
    assert.equal(updated.monthlyMinutes, 600)
    await api('admin', '/request-limits', { method: 'PUT', body: { version: updated.version, monthlyMinutes: -1, monthlyRequests: 4 }, status: 400 })
  })
  await run('employee-participation', 'authenticated-http+database', async () => {
    // Owner, 2026-10-14: a field agent's day is the field manager's, not HR
    // attendance — it is not in the directory; office staff are.
    const before = await fixture.admin.mtmAgent.findUniqueOrThrow({ where: { id: fixture.agents.manager.id } })
    const directory = await api('admin', '/employees')
    assert.equal(directory.employees.length, 57)
    assert.equal(directory.employees.some(row => row.id === fixture.agents.field.id), false)
    assert.ok(directory.employees.every(row => row.included))
    assert.ok(directory.employees.every(row => row.history.length === 0))
    const row = directory.employees.find(row => row.id === before.id)
    const input = { clientRequestId: randomUUID(), agentId: row.id, included: false, previousEventId: row.participationVersion }
    const result = await api('admin', '/employees/participation', { method: 'POST', body: input })
    assert.equal((await api('admin', '/employees/participation', { method: 'POST', body: input })).idempotent, true)
    await api('admin', '/employees/participation', { method: 'POST', body: { ...input, included: true }, status: 409 })
    await api('hr', '/employees/participation', { method: 'POST', body: { ...input, clientRequestId: randomUUID() }, status: 403 })
    const after = await fixture.admin.mtmAgent.findUniqueOrThrow({ where: { id: before.id } })
    assert.equal(after.attendanceExcluded, true)
    for (const key of ['role', 'teamId', 'userId', 'passwordHash', 'canPlanOwnRoutes', 'canSelfPublishRoutes']) assert.equal(after[key], before[key])
    // The field agent still files leave and sick leave with HR.
    await mobile('field', '/requests')
    await request(mobiles.field, '/api/v1/mtm/mobile/bootstrap')
    await api('admin', '/employees/participation', { method: 'POST', body: { ...input, clientRequestId: randomUUID(), included: true, previousEventId: result.eventId } })
    assert.equal((await api('admin', '/employees')).employees.find(row => row.id === before.id).included, true)
  })
  await run('employment-history', 'authenticated-http+database', async () => {
    const base = { agentId: fixture.agents.outside.id, reason: 'Fictional employment history', previousEventId: null }
    const hire = await api('admin', '/employees/history', { method: 'POST', body: { ...base, clientRequestId: randomUUID(), kind: 'HIRE', date: date(-20) } })
    const termination = await api('admin', '/employees/history', { method: 'POST', body: { ...base, clientRequestId: randomUUID(), previousEventId: hire.eventId, kind: 'TERMINATION', date: date(-10) } })
    await api('admin', '/employees/history', { method: 'POST', body: { ...base, clientRequestId: randomUUID(), previousEventId: termination.eventId, kind: 'REHIRE', date: date(-9) } })
    const row = (await api('admin', '/employees')).employees.find(row => row.id === base.agentId)
    assert.deepEqual(row.history.map(item => item.kind), ['HIRE', 'TERMINATION', 'REHIRE'])
    await api('admin', '/employees/history', { method: 'POST', body: { ...base, clientRequestId: randomUUID(), kind: 'HIRE', date: date(-20) }, status: 409 })
  })
  await run('branches-assignments', 'authenticated-http', async () => {
    const input = { requestId: randomUUID(), expectedRevisionId: null, branchId: null, name: 'Fixture office branch', address: 'Fictional address', latitude: 40.4, longitude: 49.8, radiusMeters: 300, active: true }
    const { branch } = await api('admin', '/branches', { method: 'POST', body: input })
    assert.equal((await api('admin', '/branches', { method: 'POST', body: input })).branch.id, branch.id)
    const revision = await api('admin', '/branches', { method: 'POST', body: { ...input, requestId: randomUUID(), branchId: branch.id, expectedRevisionId: branch.revisionId, radiusMeters: 400 } })
    await api('admin', '/branches', { method: 'POST', body: { ...input, requestId: randomUUID(), branchId: branch.id, expectedRevisionId: branch.revisionId, radiusMeters: 500 }, status: 409 })
    await api('admin', '/branches/assignments', { method: 'POST', body: { requestId: randomUUID(), expectedRevisionId: null, agentId: fixture.agents.employee.id, branchId: branch.id } })
    const rows = await api('admin', '/branches/assignments?search=Fixture%20employee')
    assert.equal(rows.employees.find(row => row.id === fixture.agents.employee.id).primary.branchId, branch.id)
    await api('manager', '/branches/assignments', { method: 'POST', body: { requestId: randomUUID(), expectedRevisionId: null, agentId: fixture.agents.outside.id, branchId: branch.id }, status: 403 })
    state.branch = revision.branch
  })
  await run('geo-policy-consent', 'authenticated-http+mobile-http', async () => {
    assert.equal((await api('admin', '/location-policy')).policy, null)
    const empty = { requestId: randomUUID(), expectedRevisionId: null, enabled: true, texts: { az: '', ru: '', en: '' }, legalReviewConfirmed: false }
    await api('admin', '/location-policy', { method: 'POST', body: empty, status: 400 })
    const texts = { az: 'Yalnız uydurma CI sınaq mətni; hüquqi təsdiq deyil.', ru: 'Только вымышленный текст для CI; не юридическое согласование.', en: 'Fictional CI-only consent text; not legal approval.' }
    const { policy } = await api('admin', '/location-policy', { method: 'POST', body: { ...empty, requestId: randomUUID(), texts, legalReviewConfirmed: true } })
    const consent = await mobile('employee', '/location-consent', { method: 'POST', body: { requestId: randomUUID(), policyRevisionId: policy.id, expectedConsentId: null, accepted: true } })
    assert.equal((await mobile('employee', '/location-consent')).maySendLocation, true)
    await mobile('employee', '/location-consent', { method: 'POST', body: { requestId: randomUUID(), policyRevisionId: policy.id, expectedConsentId: consent.consent.id, accepted: false } })
    assert.equal((await mobile('employee', '/location-consent')).maySendLocation, false)
    await api('admin', '/location-policy', { method: 'POST', body: { ...empty, requestId: randomUUID(), expectedRevisionId: policy.id, enabled: false, texts, legalReviewConfirmed: false } })
    assert.equal((await api('admin', '/location-policy')).policy.enabled, false)
    return { fixturePolicyOnly: true, coordinatesSubmitted: false, finalState: 'OFF' }
  })
  await run('requests-decisions', 'mobile-http+authenticated-http+database', async () => {
    const submit = async (kind, delta) => {
      const input = { clientRequestId: randomUUID(), kind, unit: 'DAYS', startDate: date(delta), endDate: date(delta), reason: 'Fictional employee request', attachmentIds: [] }
      const { request: submitted } = await mobile('employee', '/requests', { method: 'POST', body: input, status: 201 })
      assert.equal((await mobile('employee', '/requests', { method: 'POST', body: input })).request.id, submitted.id)
      return submitted
    }
    const approved = await submit('ANNUAL_LEAVE', 20)
    await api('hr', `/requests/${approved.id}/decision`, { method: 'POST', body: { decision: 'APPROVED', version: approved.version, note: null }, status: 403 })
    await api('foreign', `/requests/${approved.id}/decision`, { method: 'POST', body: { decision: 'APPROVED', version: approved.version, note: null }, status: 404 })
    const decided = await api('manager', `/requests/${approved.id}/decision`, { method: 'POST', body: { decision: 'APPROVED', version: approved.version, note: 'Fixture approved' } })
    const item = decided.request
    assert.equal(item.status, 'APPROVED')
    await api('admin', `/requests/${approved.id}/revoke`, { method: 'POST', body: { version: item.version, reason: 'Fixture revocation' } })
    const rejected = await submit('SICK_LEAVE', 21)
    await api('admin', `/requests/${rejected.id}/decision`, { method: 'POST', body: { decision: 'REJECTED', version: rejected.version, note: null }, status: 400 })
    assert.equal((await api('admin', `/requests/${rejected.id}/decision`, { method: 'POST', body: { decision: 'REJECTED', version: rejected.version, note: 'Fictional rejection reason' } })).request.status, 'REJECTED')
    const cancelled = await submit('REMOTE_WORK', 22)
    await mobile('employee', `/requests/${cancelled.id}`, { method: 'DELETE' })
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) await api('admin', `/requests?status=${status}`)
    state.uiApprove = await submit('ANNUAL_LEAVE', 23)
    state.uiReject = await submit('SICK_LEAVE', 24)
    const own = await mobile('employee', '/requests')
    assert.ok(own.items.some(row => row.id === cancelled.id && row.status === 'CANCELLED'))
    return { submitReplay: true, reviewerScope: true, approveRejectRevokeCancel: true }
  })
  await run('hr-recording-batch', 'authenticated-http+database', async () => {
    const directory = await api('admin', '/recordings')
    const input = { clientRequestId: randomUUID(), agentIds: [fixture.agents.employee.id, fixture.agents.outside.id], dayKindKey: 'REMOTE_WORK', catalogueVersion: directory.catalogue.version, unit: 'DAYS', startDate: date(26), endDate: date(26), reason: 'Fictional batch remote day' }
    await api('admin', '/recordings', { method: 'POST', body: input, status: 201 })
    assert.equal((await api('admin', '/recordings', { method: 'POST', body: input })).idempotent, true)
    await api('hr', '/recordings', { method: 'POST', body: { ...input, clientRequestId: randomUUID() }, status: 403 })
    await api('admin', '/recordings', { method: 'POST', body: { ...input, clientRequestId: randomUUID(), agentIds: [fixture.agents.employee.id, fixture.agents.employee.id] }, status: 400 })
    const report = await api('admin', `/report?from=${date(26)}&to=${date(26)}&form=ALL`)
    assert.equal(report.rows.filter(row => input.agentIds.includes(row.employeeId) && row.kind === 'APPROVED_REQUEST').length, 2)
  })
  await run('installation-decisions', 'mobile-http+authenticated-http', async () => {
    // A field agent's day is not HR attendance: no phone approval for it.
    await mobile('field', '/installation', { method: 'POST', body: { requestId: randomUUID() }, status: 403 })
    for (const [role, action] of [['employee', 'APPROVE'], ['employee', 'REJECT']]) {
      await mobile(role, '/installation', { method: 'POST', body: { requestId: randomUUID() } })
      const queue = await api('admin', '/installations?status=PENDING')
      const row = queue.items.find(item => item.employeeId === fixture.agents[role].id)
      assert.ok(row)
      const input = { requestId: randomUUID(), action, reason: 'Fictional device decision' }
      await api('hr', `/installations/${row.id}`, { method: 'POST', body: input, status: 403 })
      await api('admin', `/installations/${row.id}`, { method: 'POST', body: input })
      assert.equal((await api('admin', `/installations/${row.id}`, { method: 'POST', body: input })).idempotent, true)
      if (action === 'APPROVE') await api('admin', `/installations/${row.id}`, { method: 'POST', body: { requestId: randomUUID(), action: 'REVOKE', reason: 'Fixture revoked' } })
      assert.equal((await mobile(role, '/installation')).state, action === 'APPROVE' ? 'REVOKED' : 'REJECTED')
    }
  })
  await run('shift-day-night', 'authenticated-http', async () => {
    let directory = await api('admin', `/shifts?from=${date(1)}&to=${date(30)}`)
    for (const night of [false, true]) {
      const roster = directory.rosters.find(item => item.teamId === fixture.team.id)
      assert.ok(roster)
      const input = { requestId: randomUUID(), expectedRevisionId: directory.revisionId, expectedRosterHash: roster.hash, teamId: fixture.team.id, reason: 'Fictional shift', value: { from: date(night ? 5 : 1), to: date(night ? 8 : 4), timezone: 'Asia/Baku', attribution: night ? 'END_DAY' : 'START_DAY', cycle: [{ kind: 'WORK', startTime: night ? '22:00' : '09:00', endTime: night ? '06:00' : '18:00', nextDay: night, lunchMinutes: 60, lateGraceMinutes: 10 }, { kind: 'OFF' }], preHolidayMinutes: null, preHolidayConfirmed: false, overtimeThresholdMinutes: 30 } }
      await api('admin', '/shifts', { method: 'POST', body: input })
      await api('admin', '/shifts', { method: 'POST', body: { ...input, requestId: randomUUID() }, status: 409 })
      directory = await api('admin', `/shifts?from=${date(1)}&to=${date(30)}`)
    }
    assert.ok(directory.plans.some(plan => plan.value.cycle.some(day => day.nextDay)))
    assert.ok(directory.plans.length >= 2)
  })
  await run('leave-policy-profile', 'authenticated-http', async () => {
    const year = Number(today.slice(0, 4))
    const initial = await api('admin', `/leave-balances?year=${year}`)
    assert.equal(initial.policy, null)
    const policy = { requestId: randomUUID(), expectedRevisionId: null, year, reason: 'Fictional policy only', policy: { basisDate: `${year}-01-01`, counting: 'WORKING_DAYS', minutesPerDay: 480, reviewed: true, tiers: [{ category: 'Fixture category', minimumYears: 0, days: 20 }] } }
    await api('admin', '/leave-balances/policy', { method: 'POST', body: policy })
    await api('admin', '/leave-balances/profiles', { method: 'POST', body: { requestId: randomUUID(), expectedRevisionId: null, year, reason: 'Fictional opening balance', agentId: fixture.agents.employee.id, profile: { category: 'Fixture category', serviceStart: `${year - 1}-01-01`, openingDays: 2 } } })
    const balances = await api('admin', `/leave-balances?year=${year}`)
    const employee = balances.rows.find(row => row.employeeId === fixture.agents.employee.id)
    assert.equal(employee.state, 'READY'); assert.equal(employee.allowanceDays, 20)
    await api('hr', '/leave-balances/policy', { method: 'POST', body: { ...policy, requestId: randomUUID() }, status: 403 })
  })
  await run('month-freeze', 'authenticated-http+database', async () => {
    const previous = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1)
    const month = previous.toISOString().slice(0, 7), workDate = `${month}-15`
    const agentId = fixture.agents.outside.id
    // Historical fixture fact uses the same DB guards; it is not a phone claim.
    const workday = await fixture.admin.mtmAgentWorkday.create({ data: { organizationId: fixture.organization.id, agentId, workDate: new Date(`${workDate}T00:00:00Z`), status: 'COMPLETED', startedAt: new Date(`${workDate}T05:00:00Z`), completedAt: new Date(`${workDate}T14:00:00Z`), totalPausedSeconds: 0 } })
    await fixture.admin.mtmAgentWorkdayEvent.createMany({ data: ['START', 'FINISH'].map(type => ({ organizationId: fixture.organization.id, agentId, workdayId: workday.id, clientEventId: randomUUID(), type, occurredAt: type === 'START' ? workday.startedAt : workday.completedAt, appliedAt: type === 'START' ? workday.startedAt : workday.completedAt, claimedAt: type === 'START' ? workday.startedAt : workday.completedAt, serverReceivedAt: type === 'START' ? workday.startedAt : workday.completedAt })) })
    const selection = { month, agentIds: [agentId] }
    const preview = await api('admin', '/months/preview?locale=en', { method: 'POST', body: selection })
    assert.deepEqual(preview.blockers, [])
    await api('admin', '/months', { method: 'POST', body: { ...selection, requestId: randomUUID(), preview: { hash: '0'.repeat(64), asOf: preview.asOf } }, status: 409 })
    const input = { ...selection, requestId: randomUUID(), preview: { hash: preview.hash, asOf: preview.asOf } }
    const closed = await api('admin', '/months', { method: 'POST', body: input })
    assert.equal((await api('admin', '/months', { method: 'POST', body: input })).idempotent, true)
    const snapshot = await api('admin', `/months/${closed.id}?locale=en`)
    await fixture.admin.mtmAgent.update({ where: { id: agentId }, data: { name: 'Fixture renamed after close' } })
    assert.deepEqual((await api('admin', `/months/${closed.id}?locale=en`)).table, snapshot.table)
    for (const format of ['xlsx', 'pdf']) assert.ok((await (await api('admin', `/months/${closed.id}/export?locale=en&format=${format}`, { raw: true })).body()).length > 200)
    await api('foreign', `/months/${closed.id}?locale=en`, { status: 404 })
    state.closedMonth = closed
    return { stalePreviewRejected: true, exactRetry: true, frozenAfterRename: true }
  })
  await run('risk-dismissal', 'authenticated-http+database', async () => {
    assert.ok(state.workdayId)
    const event = await fixture.admin.mtmAgentWorkdayEvent.findFirstOrThrow({ where: { workdayId: state.workdayId, type: 'START' } })
    await fixture.admin.mtmAttendanceMarkEvidence.create({ data: { organizationId: fixture.organization.id, agentId: fixture.agents.employee.id, eventId: event.id, redactedRequestHash: 'a'.repeat(64), installationId: `rf-e2e-${randomUUID()}`, action: 'START', claimedAt: event.occurredAt, serverReceivedAt: event.serverReceivedAt, locationState: 'NO_CONSENT' } })
    const risk = await fixture.admin.mtmAttendanceRiskCase.create({ data: { organizationId: fixture.organization.id, agentId: fixture.agents.employee.id, eventId: event.id, kind: 'CLOCK_DIFFERENCE', workDate: new Date(`${today}T00:00:00Z`), timezone: 'Asia/Baku', detectorVersion: 'mtm-attendance-risk-v1', policySnapshot: { allowSharedInstallations: false, rejectMockLocations: true, clockDifferenceSeconds: 300 }, details: { version: 1, deltaSeconds: 600, thresholdSeconds: 300 } } })
    const query = `/review?from=${today}&to=${today}&status=OPEN&kind=ALL`
    assert.ok((await api('admin', query)).items.some(row => row.id === risk.id))
    await api('hr', `/review/${risk.id}`, { method: 'POST', body: { requestId: randomUUID(), reason: 'Fictional review' }, status: 403 })
    const input = { requestId: randomUUID(), reason: 'Fictional clock verified' }
    await api('admin', `/review/${risk.id}`, { method: 'POST', body: input })
    await api('admin', `/review/${risk.id}`, { method: 'POST', body: input })
    assert.ok(!(await api('admin', query)).items.some(row => row.id === risk.id))
    assert.equal((await fixture.admin.mtmAgentWorkday.findUniqueOrThrow({ where: { id: state.workdayId } })).status, 'COMPLETED')
    return { detector: 'synthetic seeded case; detector logic NOT_RUN here', reviewPreservesWorkday: true }
  })
  const pageEndpoints = { '': '/report', timesheet: '/report', settings: '/rules', requests: '/requests', decisions: '/decisions', employees: '/employees', branches: '/branches', 'branches/report': '/report', shifts: '/shifts', 'leave-balances': '/leave-balances', months: '/months', installations: '/installations', 'branch-qr': '/branch-qr', review: '/review', 'location-settings': '/location-policy', recordings: '/recordings' }
  for (const route of routes) await run(`page:${route || 'report'}`, 'browser-navigation', async () => {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === `${apiRoot}${pageEndpoints[route]}` && response.request().method() === 'GET', { timeout: 120000 })
    void loaded.catch(() => {})
    await readyPage(route)
    assert.equal((await loaded).status(), 200)
    const errors = await page.locator('[role="alert"]').allTextContents()
    assert.equal(errors.filter(text => [t('reportLoadError'), t('reportAccessUnavailable')].includes(text.trim())).length, 0)
    // Inventory is evidence of discoverable controls, not a claim they were clicked.
    const controls = await page.locator('main button, main a, main input, main select, main textarea').evaluateAll(elements => elements.map(element => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), type: element.getAttribute('type'), name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 160), href: element.getAttribute('href'), disabled: element.hasAttribute('disabled') })))
    manifest.controls.push({ route: `/mtm/attendance${destinations[route][0] ? `/${destinations[route][0]}` : ''}`, coverage: 'inventory-only; see named action cases for exercised controls', controls })
    await page.screenshot({ path: `${output}/page-${route.replaceAll('/', '-') || 'report'}.png`, fullPage: false })
    const section = destinations[route][1]
    if (section !== null) {
      const link = page.locator(`aside a[href="/mtm/attendance${section ? `/${section}` : ''}"]`)
      // The section appears once the organization's attendance switch is
      // known (it stays hidden while loading), so wait for it before counting.
      await link.first().waitFor({ state: 'attached', timeout: 120000 })
      assert.equal(await link.count(), 1, 'Exactly one Personnel sidebar destination')
      assert.equal(await link.getAttribute('aria-current'), 'page')
    }
    return { headingVisible: true, realDataRead: true, controlsInventoried: controls.length }
  })
  await run('browser-report-tabs-filters-pagination', 'browser-action+database-backed-http', async () => {
    await readyPage('timesheet')
    // One screen (owner, 2026-10-14): the month opens at once, without a tab row.
    await page.getByTestId('attendance-month-grid').waitFor({ timeout: 120000 })
    assert.equal(await page.getByTestId('attendance-tabs').count(), 0)
    const people = () => page.getByTestId('attendance-month-person')
    assert.equal(await people().count(), 50)
    const firstPerson = await people().first().innerText()
    await button('reportNext').click()
    await poll(async () => await people().first().innerText() !== firstPerson, 'Timesheet next page')
    await button('reportPrevious').click()
    await poll(async () => await people().first().innerText() === firstPerson, 'Timesheet previous page')
    // Each deviation is a filter button whose count is the people it keeps.
    const filters = {}
    for (const kind of ['late', 'absent', 'missing-finish', 'overtime']) {
      const filter = page.getByTestId(`attendance-filter-${kind}`)
      const expected = Number((await filter.innerText()).match(/(\d+)\s*$/)?.[1])
      assert.ok(Number.isInteger(expected), `Filter ${kind} shows a count`)
      await filter.click()
      await poll(async () => await filter.getAttribute('aria-pressed') === 'true', `Filter ${kind} on`)
      await poll(async () => await people().count() === Math.min(expected, 50), `Filter ${kind} keeps its people`, 120000)
      await filter.click()
      await poll(async () => await filter.getAttribute('aria-pressed') === 'false', `Filter ${kind} off`)
      filters[kind] = expected
    }
    // The day card opens from a real cell with the marks and one action.
    await page.getByTestId('attendance-month-cell').first().click()
    const card = page.getByTestId('attendance-day-popover')
    await card.waitFor()
    assert.equal(await card.locator('a').count(), 1)
    await page.keyboard.press('Escape')
    // The month arrows reload the report for the previous month by themselves.
    const previousMonth = `${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1, 12)).toISOString().slice(0, 7)}-01`
    const reloaded = page.waitForResponse(response => new URL(response.url()).pathname === `${apiRoot}/report` && response.request().method() === 'GET'
      && new URL(response.url()).searchParams.get('from') === previousMonth, { timeout: 120000 })
    await page.getByRole('button', { name: pt('previousMonth'), exact: true }).click()
    assert.equal((await reloaded).status(), 200)
    await page.getByRole('button', { name: pt('nextMonth'), exact: true }).click()
    await page.getByTestId('attendance-month-grid').waitFor({ timeout: 120000 })
    // Scope to the timesheet: the sidebar has its own menu search field.
    const sheet = page.getByTestId('attendance-timesheet')
    const team = sheet.locator(`select[aria-label="${t('reportTeam')}"]`)
    await team.selectOption(fixture.team.id)
    await poll(async () => await team.inputValue() === fixture.team.id, 'Team filter applied')
    await sheet.locator('input[type="search"]').fill(fixture.users.employee.name)
    await poll(async () => (await people().count()) === 1, 'Search narrows to one employee')
    assert.ok((await people().innerText()).includes(fixture.users.employee.name))
    // A real file download follows the button and confirms the browser flow.
    for (const key of ['exportExcel', 'exportPdf']) {
      const download = page.waitForEvent('download', { timeout: 120000 })
      await button(key).click()
      const file = await download
      assert.equal(await file.failure(), null)
      assert.match(file.suggestedFilename(), key === 'exportPdf' ? /\.pdf$/i : /\.xlsx$/i)
    }
    // Rarer reports sit under "More" and come back to the timesheet.
    await page.getByTestId('attendance-timesheet-more').click()
    for (const view of ['branches', 'decisions', 'months']) assert.equal(await page.getByRole('menuitem', { name: pt(`tabs.${view}`), exact: true }).count(), 1)
    await page.getByRole('menuitem', { name: pt('tabs.decisions'), exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('view') === 'decisions', { timeout: 120000 })
    await page.getByTestId('attendance-back-to-timesheet').click()
    await page.getByTestId('attendance-month-grid').waitFor({ timeout: 120000 })
    return { oneScreen: true, filters, monthDayCard: true, pagination: true, monthArrows: true, teamAndSearchFilter: true, browserDownloads: 2, moreMenu: 3 }
  })
  await run('browser-views-save-rename-delete-cancel', 'browser-action+database-backed-http', async () => {
    await openTimesheetExtras()
    const section = page.getByTestId('attendance-personal-views')
    await section.locator('#attendance-view-name').fill('Fixture browser form')
    await clickResponse(button('viewsSave', section), `${apiRoot}/views`)
    let row = page.getByTestId('attendance-personal-view').filter({ hasText: 'Fixture browser form' })
    await row.waitFor()
    await row.getByRole('button', { name: t('viewsOpenNamed', { name: 'Fixture browser form' }) }).click()
    await page.getByTestId('attendance-custom-table').waitFor()
    await row.getByRole('button', { name: t('viewsEditNamed', { name: 'Fixture browser form' }) }).click()
    await section.locator('#attendance-view-name').fill('Fixture browser renamed')
    const saved = (await api('admin', '/views')).find(view => view.name === 'Fixture browser form')
    await clickResponse(button('viewsSaveChanges', section), `${apiRoot}/views/${saved.id}`, 'PATCH')
    row = page.getByTestId('attendance-personal-view').filter({ hasText: 'Fixture browser renamed' })
    await row.getByRole('button', { name: t('viewsDeleteNamed', { name: 'Fixture browser renamed' }) }).click()
    await button('viewsCancel', row).click()
    assert.ok((await api('admin', '/views')).some(view => view.id === saved.id))
    await row.getByRole('button', { name: t('viewsDeleteNamed', { name: 'Fixture browser renamed' }) }).click()
    await clickResponse(button('viewsConfirmDelete', row), `${apiRoot}/views/${saved.id}`, 'DELETE')
    assert.ok(!(await api('admin', '/views')).some(view => view.id === saved.id))
    return { createdRenamedOpenedDeleted: true, deleteCancellation: true }
  })
  await run('browser-employee-search-switch-history', 'browser-action+database-backed-http', async () => {
    await readyPage('employees')
    await page.getByTestId('employee-row').first().waitFor()
    assert.equal(await page.getByTestId('employee-row').count(), 25)
    await button('employeesNext').click(); await button('employeesPrevious').click()
    await page.locator('#employee-search').fill('Fixture roster 00')
    const row = page.getByTestId('employee-row')
    assert.equal(await row.count(), 1)
    const toggle = row.getByRole('switch')
    assert.equal(await toggle.getAttribute('aria-checked'), 'true')
    await clickResponse(toggle, `${apiRoot}/employees/participation`)
    await poll(async () => await toggle.getAttribute('aria-checked') === 'false' && await toggle.isEnabled(), 'Exclusion confirmed')
    await page.locator('#employee-participation').selectOption('INCLUDED')
    assert.equal(await row.count(), 0)
    await page.locator('#employee-participation').selectOption('EXCLUDED')
    await row.waitFor()
    await clickResponse(row.getByRole('switch'), `${apiRoot}/employees/participation`)
    await page.locator('#employee-participation').selectOption('ALL')
    await row.getByRole('button', { name: pt('employeeCardTitle').replace('{name}', 'Fixture roster 00') }).click()
    const history = page.getByTestId('employees-history')
    await history.waitFor()
    await button('employeesClose', history).click()
    assert.equal(await history.count(), 0)
    assert.equal((await rosterCard('Fixture roster 00')).role, 'EMPLOYEE')
    return { pagination: true, search: true, inclusionFilter: true, switchRoundTrip: true, historyOpenClose: true }
  })
  await run('browser-branch-create-edit-archive-cancel', 'browser-action+database-backed-http', async () => {
    await readyPage('branches')
    await button('branchesAdd').click()
    await button('branchesCancel').click()
    assert.equal(await page.getByTestId('branches-editor').count(), 0)
    await button('branchesAdd').click()
    const editor = page.getByTestId('branches-editor')
    for (const [id, value] of Object.entries({ name: 'Fixture browser branch', address: 'Fictional branch address', latitude: '40.42', longitude: '49.81', radiusMeters: '250' })) await editor.locator(`#branch-${id}`).fill(value)
    const created = await clickResponse(button('branchesSave', editor), `${apiRoot}/branches`)
    await page.getByTestId('branch-row').filter({ hasText: 'Fixture browser branch' }).getByRole('button').click()
    await editor.locator('#branch-active').selectOption('false')
    await clickResponse(button('branchesSave', editor), `${apiRoot}/branches`)
    assert.equal((await api('admin', '/branches')).branches.find(branch => branch.id === created.branch.id).active, false)
  })
  await run('browser-request-approve-reject-revoke', 'browser-action+mobile-http', async () => {
    assert.ok(state.uiApprove && state.uiReject, 'Employee request fixture must succeed')
    await readyPage('requests')
    let row = page.getByTestId(`attendance-request-${state.uiApprove.id}`)
    await button('requestsOpen', row).click()
    await row.locator('textarea').fill('Fixture browser approval')
    await clickResponse(button('requestsApprove', row), `${apiRoot}/requests/${state.uiApprove.id}/decision`)
    await page.getByRole('combobox', { name: t('requestsTitle'), exact: true }).selectOption('APPROVED')
    row = page.getByTestId(`attendance-request-${state.uiApprove.id}`)
    await button('requestsOpen', row).click()
    await button('revocationOpen', row).click()
    await button('revocationKeep', row).click()
    await button('revocationOpen', row).click()
    await row.locator('textarea').fill('Fixture browser revocation')
    await clickResponse(button('revocationConfirm', row), `${apiRoot}/requests/${state.uiApprove.id}/revoke`)
    await page.getByRole('combobox', { name: t('requestsTitle'), exact: true }).selectOption('PENDING')
    row = page.getByTestId(`attendance-request-${state.uiReject.id}`)
    await button('requestsOpen', row).click()
    assert.equal(await button('requestsReject', row).isEnabled(), false)
    await row.locator('textarea').fill('Fixture browser rejection')
    await clickResponse(button('requestsReject', row), `${apiRoot}/requests/${state.uiReject.id}/decision`)
    const own = await mobile('employee', '/requests')
    assert.equal(own.items.find(item => item.id === state.uiApprove.id).status, 'CANCELLED')
    assert.equal(own.items.find(item => item.id === state.uiReject.id).status, 'REJECTED')
  })
  await run('browser-qr-toggle-refresh-hide', 'browser-action+database-backed-http', async () => {
    assert.ok(state.branch)
    await readyPage('branch-qr')
    const toggle = page.getByRole('switch', { name: t('qrRule') })
    assert.equal(await toggle.getAttribute('aria-checked'), 'false')
    let visibilitySession, windowId
    try {
      // The component aborts the old PUT response while loading its new state.
      // Prove the real status and resulting state without reading a discarded body.
      await clickResponse(toggle, '/api/v1/mtm/settings', 'PUT', 200, false)
      await poll(async () => await toggle.getAttribute('aria-checked') === 'true', 'QR enabled')
      assert.equal((await api('admin', '/branch-qr')).enabled, true)
      const qr = page.getByRole('img', { name: t('qrImageAlt') })
      await qr.waitFor({ timeout: 120000 })
      assert.ok((await qr.getAttribute('src')).startsWith('data:image/png;base64,'))
      await button('qrRefresh').click()
      await qr.waitFor({ timeout: 120000 })
      // Release Playwright's own per-session capture handle before minimizing
      // the native window. A separate CDP session cannot undo that override.
      // Never assign document.visibilityState or dispatch synthetic events.
      visibilitySession = playwrightFocusSession(page)
      await visibilitySession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      ;({ windowId } = await visibilitySession.send('Browser.getWindowForTarget'))
      await visibilitySession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
      await poll(async () => (await visibilitySession.send('Browser.getWindowBounds', { windowId })).bounds.windowState === 'minimized', 'Native Chromium window minimized')
      await poll(async () => {
        const visibilityState = await page.evaluate(() => document.visibilityState)
        manifest.qrLifecycle = { nativeWindowState: 'minimized', visibilityState, focusOverrideSession: 'Playwright original main-frame session' }
        return visibilityState === 'hidden'
      }, 'QR native window background visibility')
      await poll(async () => await qr.count() === 0, 'QR hidden in background')
      manifest.qrLifecycle.qrAbsentWhileHidden = true
      await visibilitySession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      await page.bringToFront()
      await poll(async () => await page.evaluate(() => document.visibilityState) === 'visible', 'QR native window foreground visibility')
      await qr.waitFor({ timeout: 120000 })
      manifest.qrLifecycle.qrRestoredInForeground = true
      await clickResponse(toggle, '/api/v1/mtm/settings', 'PUT', 200, false)
      await poll(async () => await toggle.getAttribute('aria-checked') === 'false', 'QR disabled')
      assert.equal(await qr.count(), 0)
    } finally {
      // Failed lifecycle assertions must still leave the disposable policy OFF.
      try {
        await request(sessions.admin, '/api/v1/mtm/settings', { method: 'PUT', body: { attendanceBranchQrEnabled: false } })
      } finally {
        if (visibilitySession) {
          try {
            if (windowId !== undefined) await visibilitySession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
            await page.bringToFront()
          } finally {
            await visibilitySession.send('Emulation.setFocusEmulationEnabled', { enabled: true })
          }
        }
      }
    }
    return { enabledThenDisabled: true, refresh: true, hidesInBackground: true, nativeWindowMinimizeAndRestore: true, playwrightFocusOverrideDisabled: true, cameraScan: 'NOT_RUN' }
  })
  await run('browser-settings-hr-catalogue-quotas', 'browser-action+database-backed-http', async () => {
    await readyPage('request-limits')
    const limits = page.getByTestId('attendance-request-limits')
    await limits.getByRole('button').first().click()
    await page.locator('#attendance-limits-hours').fill('12')
    await page.locator('#attendance-limits-count').fill('5')
    await clickResponse(button('limitsSave', limits), `${apiRoot}/request-limits`, 'PUT')
    assert.equal((await api('admin', '/request-limits')).monthlyMinutes, 720)
    await readyPage('day-kinds')
    const kinds = page.getByTestId('attendance-day-kinds')
    await button('kindsOpen', kinds).click()
    await button('kindsAdd', kinds).click()
    await button('kindsCancel', page.getByTestId('attendance-kind-editor')).click()
    await button('kindsPresetRu', kinds).click()
    await button('kindsCancel', kinds).click()
    await page.locator('#attendance-kinds-search').fill('Fixture remote work')
    const row = page.getByTestId('attendance-kind-row').filter({ hasText: 'Fixture remote work' })
    await button('kindsEdit', row).click()
    await page.locator('#attendance-kind-name-en').fill('Fixture browser remote')
    await clickResponse(button('kindsSave', page.getByTestId('attendance-kind-editor')), `${apiRoot}/day-kinds`, 'PUT')
    assert.equal((await api('admin', '/day-kinds')).items.find(item => item.key === 'REMOTE_WORK').names.en, 'Fixture browser remote')
    await readyPage('hr-access')
    const hr = page.getByTestId('attendance-hr-access')
    await hr.getByRole('button').first().click()
    await page.locator('#attendance-hr-search').fill('Fixture hr')
    await clickResponse(button('hrSearch', hr), `${apiRoot}/access`, 'GET')
    const hrRow = page.getByTestId('attendance-hr-user').filter({ hasText: 'Fixture hr' })
    await hrRow.getByRole('button', { name: t('hrRevokeNamed', { name: 'Fixture hr' }) }).click()
    await button('hrCancel', hrRow).click()
    assert.equal((await api('admin', '/access?search=Fixture%20hr')).users[0].allEmployees, true)
    return { limitsSaved: true, catalogueEdited: true, presetCancelled: true, hrSearchRevokeCancelled: true }
  })
  await run('browser-delivery-create-edit-cancel-delete', 'browser-action+database-backed-http', async () => {
    await openTimesheetExtras()
    const section = page.getByTestId('attendance-deliveries')
    await section.getByRole('button').first().click()
    await button('deliveryNew', section).click()
    await page.locator('#attendance-delivery-name').fill('Fixture browser delivery')
    await page.locator('#attendance-delivery-recipients').fill('invalid-email')
    await page.getByLabel(t('deliveryEnableOnSave')).uncheck()
    await button('deliverySave', section).click()
    assert.equal((await api('admin', '/deliveries')).schedules.length, 0)
    await page.locator('#attendance-delivery-recipients').fill('fixture@example.invalid')
    const schedule = await clickResponse(button('deliverySave', section), `${apiRoot}/deliveries`)
    const row = page.getByTestId('attendance-delivery-schedule')
    await row.getByRole('button', { name: t('deliveryEditNamed', { name: schedule.name }) }).click()
    await page.locator('#attendance-delivery-format').selectOption('pdf')
    await page.locator('#attendance-delivery-frequency').selectOption('MONTHLY')
    await clickResponse(button('deliverySave', section), `${apiRoot}/deliveries/${schedule.id}`, 'PATCH')
    await row.getByRole('button', { name: t('deliveryDeleteNamed', { name: schedule.name }) }).click()
    await button('deliveryCancel', row).click()
    await row.getByRole('button', { name: t('deliveryDeleteNamed', { name: schedule.name }) }).click()
    await clickResponse(button('deliveryConfirmDelete', row), `${apiRoot}/deliveries/${schedule.id}`, 'DELETE')
    assert.equal((await api('admin', '/deliveries')).schedules.length, 0)
    return { realEmailsSent: 0, remainedDisabled: true }
  })
  await run('browser-batch-recording-and-decision-journal', 'browser-action+database-backed-http', async () => {
    await readyPage('recordings')
    await page.locator('#hr-recording-mode').selectOption('TEAM')
    await page.locator('#hr-recording-target').selectOption(fixture.team.id)
    await page.locator('#hr-recording-kind').selectOption('REMOTE_WORK')
    await page.locator('#hr-recording-from').fill(date(27)); await page.locator('#hr-recording-to').fill(date(27))
    await page.locator('#hr-recording-reason').fill('Fictional browser team day')
    assert.ok(await page.getByTestId('hr-recording-preview').locator('li').count() >= 2)
    await clickResponse(button('hrRecordingSave'), `${apiRoot}/recordings`, 'POST', 201)
    await button('hrRecordingNew').click()
    assert.equal(await page.locator('#hr-recording-target').inputValue(), '')
    await readyPage('decisions')
    await page.locator('#attendance-journal-from').fill(today)
    await page.locator('#attendance-journal-to').fill(date(30))
    await page.locator('#attendance-journal-status').selectOption('APPROVED')
    await clickResponse(button('journalApply'), `${apiRoot}/decisions`, 'GET')
    await page.getByTestId('attendance-journal-row').first().waitFor()
    const download = page.waitForEvent('download', { timeout: 120000 })
    await button('exportExcel').click(); assert.equal(await (await download).failure(), null)
    // The journal is a table, not a list of links. Check the actual requestId
    // destination explicitly; do not claim a non-existent journal control.
    await readyPage(`requests?requestId=${state.uiReject.id}`)
    await page.getByTestId(`attendance-request-${state.uiReject.id}`).waitFor()
    return { teamRecording: true, journalFilterAndExport: true, focusedRequest: 'Direct browser URL navigation; journal has no detail link' }
  })
  await run('browser-shift-publish-cancel-and-leave-profile', 'browser-action+database-backed-http', async () => {
    await readyPage('shifts')
    await button('shiftCreate').click(); await button('shiftCancel').click(); await button('shiftCreate').click()
    const editor = page.getByTestId('shift-create')
    await editor.getByLabel(t('shiftTeam')).selectOption(fixture.team.id)
    await editor.getByLabel(t('shiftFrom')).fill(date(10)); await editor.getByLabel(t('shiftTo')).fill(date(12))
    await editor.getByLabel(t('shiftStart')).first().fill('22:00'); await editor.getByLabel(t('shiftEnd')).first().fill('06:00')
    await editor.getByLabel(t('shiftNextDay')).first().check()
    await button('shiftAdd', editor).click(); await button('shiftRemove', editor).last().click()
    await editor.getByLabel(t('shiftReason')).fill('Fictional browser night shift')
    await clickResponse(button('shiftPublish', editor), `${apiRoot}/shifts`)
    assert.ok((await api('admin', `/shifts?from=${date(10)}&to=${date(12)}`)).plans.length)
    await readyLeaveBalances()
    await clickResponse(button('leaveNext'), `${apiRoot}/leave-balances`, 'GET')
    await clickResponse(button('leavePrev'), `${apiRoot}/leave-balances`, 'GET')
    const row = page.getByTestId('leave-row').filter({ hasText: 'Fixture employee' })
    await button('leaveEdit', row).click()
    const profile = page.getByTestId('leave-profile')
    await profile.getByLabel(t('leaveOpening'), { exact: false }).fill('3')
    await profile.getByLabel(t('leaveReason')).fill('Fictional browser balance update')
    await clickResponse(button('leavePublish', profile), `${apiRoot}/leave-balances/profiles`)
    assert.equal((await api('admin', `/leave-balances?year=${today.slice(0, 4)}`)).rows.find(row => row.employeeId === fixture.agents.employee.id).profile.value.openingDays, 3)
  })
  await run('browser-geo-off-legal-block-and-branch-summary', 'browser-action+database-backed-http', async () => {
    await readyPage('location-settings')
    const editor = page.getByTestId('geo-policy-editor')
    await editor.locator('#geo-text-en').fill('')
    assert.equal(await editor.getByLabel(t('geoPolicyEnable')).isEnabled(), false)
    await clickResponse(button('geoPolicySave', editor), `${apiRoot}/location-policy`)
    assert.equal((await api('admin', '/location-policy')).policy.enabled, false)
    await readyPage('branches/report')
    await page.locator('#attendance-branch-from').fill(today); await page.locator('#attendance-branch-to').fill(today)
    await clickResponse(button('reportApply'), `${apiRoot}/report`, 'GET')
    await page.locator('#attendance-branch-team').selectOption(fixture.team.id)
    await page.locator('#attendance-branch-employee').selectOption(fixture.agents.employee.id)
    const download = page.waitForEvent('download', { timeout: 120000 })
    await button('exportPdf').click(); assert.equal(await (await download).failure(), null)
  })
  await run('browser-installation-approve-revoke-history', 'browser-action+mobile-http', async () => {
    await mobile('employee', '/installation', { method: 'POST', body: { requestId: randomUUID() } })
    const queue = await api('admin', '/installations?status=PENDING')
    const item = queue.items.find(item => item.employeeId === fixture.agents.employee.id)
    assert.ok(item)
    await readyPage('installations')
    let row = page.getByTestId('installation-row').filter({ hasText: 'Fixture employee' })
    await button('installationApprove', row).click()
    assert.equal(await button('installationSave').isEnabled(), false)
    await page.locator('#installation-reason').fill('Fictional browser approval')
    await clickResponse(button('installationSave'), `${apiRoot}/installations/${item.id}`)
    await page.getByRole('combobox').last().selectOption('APPROVED')
    row = page.getByTestId('installation-row').filter({ hasText: 'Fixture employee' })
    await button('installationHistory', row).click()
    await button('installationRevoke', row).click()
    await page.locator('#installation-reason').fill('Fictional browser revoke')
    await clickResponse(button('installationSave'), `${apiRoot}/installations/${item.id}`)
    assert.equal((await mobile('employee', '/installation')).state, 'REVOKED')
  })
  await run('browser-month-frozen-download', 'browser-action+database-backed-http', async () => {
    assert.ok(state.closedMonth)
    await readyPage('months')
    await chooseMonth(state.closedMonth.month)
    await page.getByLabel(t('monthCloseChooseSaved')).selectOption(state.closedMonth.id)
    await button('monthCloseExcel').waitFor()
    for (const key of ['monthCloseExcel', 'monthClosePdf']) {
      const download = page.waitForEvent('download', { timeout: 120000 })
      await button(key).click(); assert.equal(await (await download).failure(), null)
    }
    assert.ok(await page.getByText(t('monthCloseFrozen'), { exact: true }).isVisible())
  })
  await run('browser-rules-calendar-crud', 'browser-action+database-backed-http', async () => {
    // Settings is one page of cards (2026-10-14); a card opens its editor.
    await readyPage('settings?tab=')
    await page.getByTestId('attendance-settings-hub').waitFor({ timeout: 120000 })
    assert.equal(await page.locator('[data-testid^="attendance-settings-card-"]').count(), 9)
    // The organization switch sits on top of Personnel → Settings (moved from MTM settings).
    await page.getByTestId('attendance-feature-on').waitFor({ timeout: 120000 })
    await page.getByTestId('attendance-settings-card-hours').click()
    await page.waitForURL(url => url.searchParams.get('tab') === 'hours', { timeout: 120000 })
    await page.getByTestId('attendance-rules').waitFor({ timeout: 120000 })
    const before = await api('admin', '/rules')
    const rules = page.getByTestId('attendance-rules')
    await page.locator('#attendance-start').fill('09:30')
    await page.locator('#attendance-end').fill('18:30')
    await page.locator('#attendance-lunch').fill('60')
    await page.locator('#attendance-grace').fill('15')
    await page.locator('#attendance-effective-from').fill(before.minEffectiveFrom)
    const savedRule = await clickResponse(button('rulesSave', rules), `${apiRoot}/rules`, 'POST', 201)
    assert.equal(savedRule.startTime, '09:30')
    assert.equal((await api('admin', '/rules')).current.id, before.current.id)
    // Holidays are their own card now, next to working hours.
    await readyPage('settings?tab=holidays')
    const calendar = page.getByTestId('attendance-calendar'), calendarDate = date(16)
    await page.locator('#attendance-calendar-year').selectOption(calendarDate.slice(0, 4))
    await page.locator('#attendance-calendar-date').fill(calendarDate)
    await page.locator('#attendance-calendar-kind').selectOption('COMPANY_HOLIDAY')
    await page.locator('#attendance-calendar-name').fill('Fixture browser holiday')
    const holiday = await clickResponse(button('calendarAdd', calendar), `${apiRoot}/calendar`)
    let row = page.getByTestId('attendance-calendar-day').filter({ hasText: 'Fixture browser holiday' })
    await row.getByRole('button').first().click()
    await button('calendarCancelEdit', calendar).click()
    await row.getByRole('button').first().click()
    await page.locator('#attendance-calendar-name').fill('Fixture edited holiday')
    await clickResponse(button('calendarSaveChanges', calendar), `${apiRoot}/calendar`)
    row = page.getByTestId('attendance-calendar-day').filter({ hasText: 'Fixture edited holiday' })
    await row.getByRole('button').last().click(); await button('calendarCancel', row).click()
    await row.getByRole('button').last().click()
    await clickResponse(button('calendarConfirmDelete', row), `${apiRoot}/calendar`, 'DELETE')
    assert.ok(!(await api('admin', `/calendar?from=${calendarDate}&to=${calendarDate}`)).days.some(day => day.id === holiday.id))
  })
  await run('browser-hr-grant-revoke', 'browser-action+authenticated-http', async () => {
    await readyPage('hr-access')
    const section = page.getByTestId('attendance-hr-access')
    await button('hrOpen', section).click()
    await page.locator('#attendance-hr-search').fill('Fixture hr')
    await clickResponse(button('hrSearch', section), `${apiRoot}/access`, 'GET')
    const row = page.getByTestId('attendance-hr-user').filter({ hasText: 'Fixture hr' })
    await row.getByRole('button', { name: t('hrRevokeNamed', { name: 'Fixture hr' }) }).click()
    await clickResponse(button('hrConfirmRevoke', row), `${apiRoot}/access/${fixture.users.hr.id}`, 'PATCH')
    await api('hr', `/report?from=${today}&to=${today}&form=ALL`, { status: 403 })
    await row.getByRole('button', { name: t('hrGrantNamed', { name: 'Fixture hr' }) }).click()
    await clickResponse(button('hrConfirmGrant', row), `${apiRoot}/access/${fixture.users.hr.id}`, 'PATCH')
    await api('hr', `/report?from=${today}&to=${today}&form=ALL`)
    await button('hrClose', section).click()
    return { originalSessionRevokedThenRestored: true }
  })
  await run('browser-kind-create-archive-restore', 'browser-action+database-backed-http', async () => {
    await readyPage('day-kinds')
    const kinds = page.getByTestId('attendance-day-kinds')
    await button('kindsOpen', kinds).click(); await button('kindsAdd', kinds).click()
    for (const locale of ['az', 'ru', 'en']) await page.locator(`#attendance-kind-name-${locale}`).fill('Fixture browser custom')
    await page.locator('#attendance-kind-code').fill('FXL')
    await page.locator('#attendance-kind-group').selectOption('WORK')
    await page.locator('#attendance-kind-unit').selectOption('HOURS')
    await page.locator('#attendance-kind-paid').selectOption('true')
    await page.getByLabel(t('kindsCountsAsWorked')).check()
    await clickResponse(button('kindsSave', page.getByTestId('attendance-kind-editor')), `${apiRoot}/day-kinds`, 'PUT')
    const kind = (await api('admin', '/day-kinds')).items.find(item => item.code === 'FXL')
    assert.ok(kind); assert.equal(kind.countsAsWorked, true)
    await page.locator('#attendance-kinds-search').fill('Fixture browser custom')
    const row = page.getByTestId('attendance-kind-row').filter({ hasText: 'Fixture browser custom' })
    await button('kindsArchive', row).click(); await button('kindsCancel', kinds).click()
    await button('kindsArchive', row).click()
    await clickResponse(button('kindsConfirm', kinds), `${apiRoot}/day-kinds`, 'PUT')
    await poll(async () => await row.count() === 0, 'Archived kind hidden')
    await page.getByLabel(t('kindsShowArchived')).check()
    await button('kindsRestore', row).click()
    await clickResponse(button('kindsConfirm', kinds), `${apiRoot}/day-kinds`, 'PUT')
    assert.equal((await api('admin', '/day-kinds')).items.find(item => item.key === kind.key).archived, false)
  })
  await run('browser-employment-record', 'browser-action+database-backed-http', async () => {
    await readyPage('employees')
    await page.locator('#employee-search').fill('Fixture roster 01')
    const row = page.getByTestId('employee-row').filter({ hasText: 'Fixture roster 01' })
    await row.getByRole('button', { name: pt('employeeCardTitle').replace('{name}', 'Fixture roster 01') }).click()
    const history = page.getByTestId('employees-history')
    await page.locator('#employment-kind').selectOption('HIRE')
    await page.locator('#employment-date').fill(date(-90))
    await page.locator('#employment-reason').fill('Fictional documented employment date')
    await clickResponse(button('employeesSaveChange', history), `${apiRoot}/employees/history`)
    await row.getByRole('button', { name: pt('employeeCardTitle').replace('{name}', 'Fixture roster 01') }).click()
    await history.getByTestId('employment-event').waitFor()
    assert.equal((await rosterCard('Fixture roster 01')).role, 'EMPLOYEE')
    await button('employeesClose', history).click()
  })
  await run('browser-primary-branch-assignment', 'browser-action+database-backed-http', async () => {
    assert.ok(state.branch)
    await readyPage('branches'); await button('branchesAssignments').click()
    // Field agents stay in MTM: the HR branch list does not offer them (#796).
    await page.locator('#branch-employee-search').fill('Fixture field')
    await clickResponse(button('branchesFind'), `${apiRoot}/branches/assignments`, 'GET')
    assert.equal(await page.getByTestId('branch-employee').filter({ hasText: 'Fixture field' }).count(), 0)
    // An office employee no other case touches (00–02 belong to other cases).
    const office = await rosterCard('Fixture roster 07')
    await page.locator('#branch-employee-search').fill('Fixture roster 07')
    await clickResponse(button('branchesFind'), `${apiRoot}/branches/assignments`, 'GET')
    const row = page.getByTestId('branch-employee').filter({ hasText: 'Fixture roster 07' })
    await row.getByRole('combobox').selectOption(state.branch.id)
    await clickResponse(row.getByRole('button', { name: t('branchesAssignNamed', { name: 'Fixture roster 07' }) }), `${apiRoot}/branches/assignments`)
    const directory = await api('admin', '/branches/assignments?search=Fixture%20roster%2007')
    assert.equal(directory.employees.find(employee => employee.id === office.id).primary.branchId, state.branch.id)
  })
  await run('browser-risk-dismissal', 'browser-action+synthetic-risk-fixture', async () => {
    assert.ok(state.workdayId)
    const event = await fixture.admin.mtmAgentWorkdayEvent.findFirstOrThrow({ where: { workdayId: state.workdayId, type: 'FINISH' } })
    const workday = await fixture.admin.mtmAgentWorkday.findUniqueOrThrow({ where: { id: state.workdayId } })
    await fixture.admin.mtmAttendanceMarkEvidence.create({ data: { organizationId: fixture.organization.id, agentId: fixture.agents.employee.id, eventId: event.id, redactedRequestHash: 'b'.repeat(64), installationId: `rf-e2e-${randomUUID()}`, action: 'FINISH', claimedAt: event.occurredAt, serverReceivedAt: event.serverReceivedAt, locationState: 'NO_CONSENT' } })
    const risk = await fixture.admin.mtmAttendanceRiskCase.create({ data: { organizationId: fixture.organization.id, agentId: fixture.agents.employee.id, eventId: event.id, kind: 'CLOCK_DIFFERENCE', workDate: workday.workDate, timezone: 'Asia/Baku', detectorVersion: 'mtm-attendance-risk-v1', policySnapshot: { allowSharedInstallations: false, rejectMockLocations: true, clockDifferenceSeconds: 300 }, details: { version: 1, deltaSeconds: 600, thresholdSeconds: 300 } } })
    await readyPage('review')
    await page.locator('#risk-from').fill(today); await page.locator('#risk-to').fill(today)
    await page.locator('#risk-status').selectOption('OPEN')
    await page.locator('#risk-kind').selectOption('CLOCK_DIFFERENCE')
    await clickResponse(button('journalApply'), `${apiRoot}/review`, 'GET')
    const row = page.getByTestId('risk-row').filter({ hasText: 'Fixture employee' })
    await button('riskReview', row).click()
    assert.equal(await button('riskDismiss').isEnabled(), false)
    await page.locator('#risk-reason').fill('Fictional clock verified through browser')
    await clickResponse(button('riskDismiss'), `${apiRoot}/review/${risk.id}`)
    await page.locator('#risk-status').selectOption('DISMISSED')
    await clickResponse(button('journalApply'), `${apiRoot}/review`, 'GET')
    assert.ok(await page.getByTestId('risk-row').count() >= 2)
    assert.deepEqual(await fixture.admin.mtmAgentWorkday.findUniqueOrThrow({ where: { id: workday.id } }), workday)
    return { detector: 'Seeded finding; only review/dismissal is browser-tested' }
  })
  await run('browser-leave-policy-publication', 'browser-action+database-backed-http', async () => {
    await readyLeaveBalances()
    const policy = page.getByTestId('leave-policy')
    await policy.locator('summary').click()
    await policy.getByLabel(t('leaveNormDays')).first().fill('21')
    await button('leaveAddTier', policy).click(); await button('leaveRemoveTier', policy).last().click()
    await policy.getByLabel(t('leaveReason')).fill('Fictional browser policy revision; not client legal approval')
    await policy.getByLabel(t('leaveConfirmed')).check()
    await clickResponse(button('leavePublish', policy), `${apiRoot}/leave-balances/policy`)
    assert.equal((await api('admin', `/leave-balances?year=${today.slice(0, 4)}`)).rows.find(row => row.employeeId === fixture.agents.employee.id).allowanceDays, 21)
  })
  await run('browser-month-preview-close-blockers', 'browser-action+synthetic-historical-facts', async () => {
    assert.ok(state.closedMonth)
    const month = state.closedMonth.month, workDate = `${month}-15`
    const blocked = await rosterCard('Fixture roster 02')
    for (const [agentId, completed] of [[fixture.agents.manager.id, true], [blocked.id, false]]) {
      const workday = await fixture.admin.mtmAgentWorkday.create({ data: { organizationId: fixture.organization.id, agentId, workDate: new Date(`${workDate}T00:00:00Z`), status: completed ? 'COMPLETED' : 'STARTED', startedAt: new Date(`${workDate}T05:00:00Z`), completedAt: completed ? new Date(`${workDate}T14:00:00Z`) : null, totalPausedSeconds: 0 } })
      for (const type of completed ? ['START', 'FINISH'] : ['START']) {
        const occurredAt = type === 'START' ? workday.startedAt : workday.completedAt
        await fixture.admin.mtmAgentWorkdayEvent.create({ data: { organizationId: fixture.organization.id, agentId, workdayId: workday.id, clientEventId: randomUUID(), type, occurredAt, appliedAt: occurredAt, claimedAt: occurredAt, serverReceivedAt: occurredAt } })
      }
    }
    await readyPage('months'); await chooseMonth(month)
    await page.getByRole('checkbox', { name: /Fixture manager/ }).check()
    const preview = await clickResponse(button('monthClosePreview'), `${apiRoot}/months/preview`)
    assert.deepEqual(preview.blockers, [])
    assert.equal(await button('monthCloseAction').isEnabled(), false)
    await page.getByLabel(t('monthCloseConfirm')).check()
    const closed = await clickResponse(button('monthCloseAction'), `${apiRoot}/months`)
    assert.equal(closed.employeeCount, 1)
    await page.getByRole('checkbox', { name: /Fixture roster 02/ }).check()
    const blockedPreview = await clickResponse(button('monthClosePreview'), `${apiRoot}/months/preview`)
    assert.ok(blockedPreview.blockers.length)
    await page.getByText(t('monthCloseBlocked'), { exact: true }).waitFor()
    assert.equal(await button('monthCloseAction').count(), 0)
    return { completedEmployeeClosed: true, unfinishedWorkdayBlocksClose: true, historicalFacts: 'DB fixture, not phone claims' }
  })
  await run('browser-sidebar-click-traversal', 'browser-navigation-click', async () => {
    await readyPage('')
    for (const href of personnelHrefs) {
      const link = page.locator(`aside a[href="${href}"]`)
      await link.scrollIntoViewIfNeeded()
      const bounds = await link.boundingBox()
      assert.ok(bounds)
      // Use the unobstructed right side of the real link. Next development's
      // issue badge overlays the bottom-left of this development-only runner.
      await link.click({ position: { x: bounds.width - 20, y: bounds.height / 2 } })
      await page.waitForURL(url => url.pathname === href, { timeout: 120000 })
      await page.locator('h1').first().waitFor()
      assert.equal(await link.getAttribute('aria-current'), 'page')
    }
    // HR work no longer sits among the field-sales links.
    assert.equal(await page.locator('aside a[href^="/mtm/attendance/"]').count(), personnelHrefs.length - 1)
    return { actualSidebarClicks: personnelHrefs.length, proves: 'Navigation only; mutations have separate case records' }
  })
  await run('browser-branch-lost-acknowledgement-retry', 'browser-action+real-commit-response-drop', async () => {
    await readyPage('branches'); await button('branchesAdd').click()
    const editor = page.getByTestId('branches-editor')
    for (const [id, value] of Object.entries({ name: 'Fixture response-drop branch', address: 'Fictional address', latitude: '40.43', longitude: '49.82', radiusMeters: '200' })) await editor.locator(`#branch-${id}`).fill(value)
    const pattern = `${origin.origin}${apiRoot}/branches`
    let firstBody, committed, interceptionError
    const retryBodies = []
    const intercept = async route => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postDataJSON()
      if (firstBody) { retryBodies.push(body); return route.continue() }
      firstBody = body
      try {
        // The real handler commits first; only its acknowledgement is lost.
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        const json = await response.json(); assert.equal(json.success, true)
        committed = json.data
      } catch (error) { interceptionError = error }
      await route.abort('failed')
    }
    await page.route(pattern, intercept)
    try {
      await button('branchesSave', editor).click()
      await button('branchesCheckWrite').waitFor()
      if (interceptionError) throw interceptionError
      assert.ok(committed?.branch?.id)
      assert.equal(await button('branchesAdd').isEnabled(), false)
      const repeated = await clickResponse(button('branchesCheckWrite'), `${apiRoot}/branches`)
      assert.equal(repeated.idempotent, true)
      assert.equal(repeated.branch.id, committed.branch.id)
      assert.deepEqual(retryBodies, [firstBody])
      const rows = (await api('admin', '/branches')).branches.filter(branch => branch.name === 'Fixture response-drop branch')
      assert.equal(rows.length, 1); assert.equal(rows[0].version, 1)
    } finally { await page.unroute(pattern, intercept) }
    return { actualServerCommit: true, droppedResponses: 1, sameRequestRetried: true, duplicateBranches: 0 }
  })
  await run('browser-catalogue-competing-tabs', 'browser-action+database-backed-http', async () => {
    const original = page, concurrent = await sessions.admin.newPage()
    const loads = []
    manifest.competingTabs = { stage: 'open', loads }
    try {
      for (const target of [original, concurrent]) {
        page = target
        await page.bringToFront()
        await readyPage('day-kinds')
        const kinds = page.getByTestId('attendance-day-kinds')
        manifest.competingTabs.stage = target === original ? 'load-original' : 'load-concurrent'
        // Opening this panel starts its own request; the page heading does not
        // establish a loaded catalogue. Fail on the real response before trying
        // controls that render only when that catalogue has valid items.
        const catalogue = await clickResponse(button('kindsOpen', kinds), `${apiRoot}/day-kinds`, 'GET')
        loads.push({ tab: target === original ? 'original' : 'concurrent', version: catalogue.version, items: catalogue.items.length })
        assert.ok(catalogue.items.some(item => item.key === 'REMOTE_WORK' && item.names.en === 'Fixture browser remote'))
        if (loads.length === 2) assert.equal(loads[0].version, catalogue.version)
        const row = page.locator('[data-testid="attendance-kind-row"][data-kind="REMOTE_WORK"]')
        manifest.competingTabs.stage = target === original ? 'edit-original' : 'edit-concurrent'
        await page.locator('#attendance-kinds-search').fill('Fixture browser remote')
        await button('kindsEdit', row).click()
        await page.locator('#attendance-kind-name-en').fill(target === original ? 'Fixture stale tab must not save' : 'Fixture concurrent remote')
      }
      manifest.competingTabs.stage = 'save-concurrent'
      await clickResponse(button('kindsSave', page.getByTestId('attendance-kind-editor')), `${apiRoot}/day-kinds`, 'PUT')
      page = original
      await page.bringToFront()
      manifest.competingTabs.stage = 'reject-stale-original'
      await clickResponse(button('kindsSave', page.getByTestId('attendance-kind-editor')), `${apiRoot}/day-kinds`, 'PUT', 409)
      await page.getByText(t('kindsChanged'), { exact: true }).waitFor()
      assert.equal(await button('kindsSave', page.getByTestId('attendance-kind-editor')).isEnabled(), false)
      manifest.competingTabs.stage = 'reload-original'
      await clickResponse(button('kindsReload', page.getByTestId('attendance-day-kinds')), `${apiRoot}/day-kinds`, 'GET')
      assert.equal((await api('admin', '/day-kinds')).items.find(item => item.key === 'REMOTE_WORK').names.en, 'Fixture concurrent remote')
      await poll(async () => await button('kindsAdd', page.getByTestId('attendance-day-kinds')).isEnabled(), 'Catalogue reloaded after conflict')
      manifest.competingTabs.stage = 'complete'
    } catch (error) {
      // Retain the actual failing tab before cleanup closes it. The outer case
      // screenshot otherwise only shows the original page restored below.
      await page.screenshot({ path: `${output}/failure-browser-catalogue-competing-tabs-active.png`, fullPage: false }).catch(() => {})
      throw error
    } finally { page = original; await concurrent.close(); await original.bringToFront() }
    return { realCompetingBrowserTabs: 2, staleWriteRejected: true, newerValuePreserved: true, reloadRestoresControls: true }
  })
  await run('browser-private-document-download-and-permissions', 'mobile-multipart-http+browser-download+role-http', async () => {
    const clientRequestId = randomUUID(), clientAttachmentId = randomUUID()
    // Synthetic pixels and metadata only, generated in the disposable runner.
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).jpeg()
      .withExif({ IFD0: { ImageDescription: 'Fictional CI document, no personal data' } }).toBuffer()
    assert.ok((await sharp(bytes).metadata()).exif)
    const upload = async (buffer, attachmentId, expectedStatus) => {
      const response = await mobiles.employee.request.post(`${mobileRoot}/attachments`, {
        multipart: { clientRequestId, clientAttachmentId: attachmentId, file: { name: 'fixture.jpg', mimeType: 'image/jpeg', buffer } }, timeout: 120000,
      })
      const json = await response.json().catch(() => null)
      if (response.status() !== expectedStatus) {
        const error = new Error('Unexpected document upload status')
        error.safeDiagnostic = `POST attachments (${buffer.length} bytes): expected ${expectedStatus}, received ${response.status()}${/^MTM_[A-Z_]+$/.test(json?.code ?? '') ? ` ${json.code}` : ''}`
        throw error
      }
      if (expectedStatus < 400) assert.equal(json.success, true)
      return json.data
    }
    const selected = await upload(bytes, clientAttachmentId, 201)
    assert.equal((await upload(bytes, clientAttachmentId, 200)).id, selected.id)
    await upload(Buffer.from('Not an image'), randomUUID(), 400)
    await upload(Buffer.alloc(5 * 1024 * 1024 + 1), randomUUID(), 413)
    const unselected = await upload(bytes, randomUUID(), 201)
    const own = await mobile('employee', `/attachments/${selected.id}`, { raw: true })
    const sanitizedBytes = await own.body()
    assert.equal(own.headers()['content-type'], 'image/jpeg')
    assert.equal((await sharp(sanitizedBytes).metadata()).exif, undefined)
    await api('admin', `/attachments/${selected.id}`, { status: 404 })
    await mobile('field', `/attachments/${selected.id}`, { status: 404 })
    const submitted = await mobile('employee', '/requests', { method: 'POST', status: 201, body: {
      clientRequestId, kind: 'SICK_LEAVE', unit: 'DAYS', startDate: date(28), endDate: date(28),
      reason: 'Fictional document request for access verification', attachmentIds: [selected.id],
    } })
    for (const [role, status] of [['hr', 403], ['employee', 403], ['field', 403], ['foreign', 404]]) await api(role, `/attachments/${selected.id}`, { status })
    await api('admin', `/attachments/${unselected.id}`, { status: 404 })
    const manager = await api('manager', `/attachments/${selected.id}`, { raw: true })
    assert.deepEqual(await manager.body(), sanitizedBytes)
    assert.equal(manager.headers()['cache-control'], 'private, no-store')
    assert.equal(manager.headers()['x-content-type-options'], 'nosniff')
    await readyPage(`requests?requestId=${submitted.request.id}`)
    const row = page.getByTestId(`attendance-request-${submitted.request.id}`)
    // A focused request URL automatically expands its details.
    await button('requestsClose', row).waitFor()
    assert.equal(await button('requestsClose', row).getAttribute('aria-expanded'), 'true')
    const link = row.getByRole('link', { name: t('requestsDocument', { number: 1 }), exact: true })
    assert.equal(await link.getAttribute('href'), `${apiRoot}/attachments/${selected.id}`)
    const waiting = page.waitForEvent('download', { timeout: 120000 }); void waiting.catch(() => {})
    await link.click()
    const download = await waiting
    assert.equal(await download.failure(), null)
    const stream = await download.createReadStream(), chunks = []
    assert.ok(stream)
    for await (const chunk of stream) chunks.push(chunk)
    assert.deepEqual(Buffer.concat(chunks), sanitizedBytes)
    return { actualBrowserDocumentDownload: true, draftAndUnselectedHidden: true, deniedRoles: 4, otherEmployeeDenied: true, sameTeamReviewerAllowed: true, exifRemoved: true, invalidFileAndSizeRejected: true, upload: 'Actual mobile multipart HTTP, not APK picker', admissionBackend: 'Application development memory fallback; production Redis gate NOT_RUN' }
  })
  await run('browser-locales-mobile-width', 'browser-navigation+layout', async () => {
    for (const locale of ['az', 'ru', 'en']) {
      await sessions.admin.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: origin.origin }])
      await readyPage('employees')
      await page.getByTestId('employee-row').first().waitFor()
      const translated = JSON.parse(await readFile(`messages/${locale}.json`, 'utf8')).mtmAttendance
      assert.equal(await page.locator('h1').first().innerText(), translated.employeesTitle)
      await page.screenshot({ path: `${output}/employees-${locale}.png`, fullPage: false })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await readyPage('employees')
    await page.getByTestId('employee-row').first().waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${output}/employees-mobile.png`, fullPage: false })
    await page.setViewportSize({ width: 1440, height: 1000 })
    return { locales: ['az', 'ru', 'en'], viewport: '390x844', physicalPhone: 'NOT_RUN' }
  })
  await run('hr-revoke-fresh-session', 'authenticated-http', async () => {
    const row = (await api('admin', '/access?search=Fixture%20hr')).users.find(row => row.id === fixture.users.hr.id)
    assert.equal(row.allEmployees, true)
    await api('admin', `/access/${row.id}`, { method: 'PATCH', body: { version: row.version, allEmployees: false } })
    await api('hr', '/rules', { status: 403 })
    await api('hr', `/report?from=${today}&to=${today}&form=ALL`, { status: 403 })
    return { originalSessionImmediatelyDenied: true }
  })
  await run('final-privacy-invariants', 'authenticated-http+database', async () => {
    assert.notEqual((await api('admin', '/location-policy')).policy?.enabled, true)
    assert.equal((await api('admin', '/branch-qr')).enabled, false)
    assert.equal((await api('admin', '/deliveries')).schedules.length, 0)
    assert.equal(await fixture.admin.mtmAttendanceMarkEvidence.count({ where: { latitude: { not: null } } }), 0)
    assert.equal(await fixture.admin.user.count({ where: { organizationId: fixture.foreignOrganization.id } }), 1)
    assert.equal(await fixture.admin.mtmAgentWorkday.count({ where: { organizationId: fixture.foreignOrganization.id } }), 0)
    return { geoOff: true, qrOff: true, noMailSchedules: true, noCoordinates: true, otherTenantUntouched: true }
  })
} catch (error) {
  manifest.cases.push({ name: 'harness', status: 'FAIL', diagnostic: error?.safeDiagnostic || error?.name || 'Harness error' })
} finally {
  for (const name of caseNames) if (!manifest.cases.some(item => item.name === name)) manifest.cases.push({ name, status: 'NOT_RUN', reason: 'Earlier setup did not complete' })
  for (const [name, reason] of [
    ['physical-apk-os-permissions', 'Separate S23 device run; this workflow has no USB phone'],
    ['external-email-delivery', 'No recipients/providers; schedules are disabled and no cron is invoked'],
    ['camera-qr-offline-replay', 'Actual camera, offline Android queue, kill/restart and OS permission flows need the physical device'],
    ['overnight-soak', 'Bounded CI scenarios; this is not an overnight endurance run'],
    ['all-control-combinations', 'Finite named action families; inventory alone does not prove every control or all possible combinations'],
  ]) manifest.cases.push({ name, status: 'NOT_RUN', reason })
  manifest.completedAt = new Date().toISOString()
  manifest.summary = Object.fromEntries(['PASS', 'FAIL', 'NOT_RUN'].map(status => [status, manifest.cases.filter(item => item.status === status).length]))
  manifest.status = manifest.summary.FAIL ? 'FAIL' : caseNames.some(name => manifest.cases.find(item => item.name === name)?.status !== 'PASS') ? 'NOT_RUN' : 'PASS'
  await persist()
  await browser?.close().catch(() => {})
  await fixture?.app.$disconnect().catch(() => {})
  await fixture?.admin.$disconnect().catch(() => {})
  console.log(JSON.stringify({ status: manifest.status, headSha: head, summary: manifest.summary }))
  if (manifest.status !== 'PASS') process.exitCode = 1
}
