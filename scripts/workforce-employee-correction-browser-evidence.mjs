import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { generateSecret, generateSync } from "otplib"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"
import { employeeCorrectionBrowserTarget } from "./workforce-employee-correction-browser-admission.mjs"

// A separate hosted request rehearsal. No production target or personnel decision.
const { origin, admin: adminURL, app: appURL } = employeeCorrectionBrowserTarget(process.env)
const outputDirectory = process.env.WF_EMPLOYEE_CORRECTION_BROWSER_OUTPUT_DIR || "artifacts/workforce-employee-correction-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString()), app = makeRlsTestPrisma(appURL.toString())
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`, privateReason = `PRIVATE_CORRECTION_REHEARSAL_${suffix}`
const protectedMarkers = [password, privateReason], contexts = [], submitted = []
const endpoint = "/api/v1/workforce/requests"
const cells = ["az", "ru", "en"].flatMap(locale => [320, 768, 1440].map(width => ({ locale, width, key: `${locale}-${width}` })))
let browser, stage = "fixture-preparing", initialFacts, tenants
const receipts = {
  version: 1, sourceHead: process.env.WF_EMPLOYEE_CORRECTION_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA, startedAt: new Date().toISOString(),
  environment: "Separate hosted Chromium / canonical Auth.js MFA / disposable PostgreSQL16 and Redis",
  status: "RUNNING", cases: [], sources: [], productionRoutines: [], authenticationDiagnostics: [],
  databaseDiagnostics: [], cleanupDiagnostics: [],
  limitations: [
    "Imported synthetic own cases and workdays only; no expected-schedule materialization or physical attendance evidence",
    "Pending correction requests only; no approval, workday correction, employee response, appeal, payroll or personnel decision",
    "Original ACK/report/HR/native/session jobs and fixtures remain separate and unchanged",
    "No screenshots with entered reason or private request history; actual UI assertions and DB/API facts only",
    "Exact current case-link/revision routines and reconstructed CHECK fragments, not full historical migration replay or default ACL review",
    "Allowlisted write/audit guards are synthetic fixture constraints, not production MtmAuditLog migration evidence",
    "Standard viewports only; native request-form zoom, physical devices, human AT and authenticated production NOT RUN",
  ],
}
const noProtected = value => assert.ok(protectedMarkers.every(marker => !value.includes(marker)), "Protected fixture subject must not be retained")

const authenticationPostTimes = []
async function paceAuthenticationPost(diagnostic) {
  // Credential, verification and canonical session-update POSTs share the
  // real proxy's auth IP budget. Exercise that policy without bypass headers.
  const windowMs = 61_000
  const prune = () => { while (authenticationPostTimes.length && authenticationPostTimes[0] <= Date.now() - windowMs) authenticationPostTimes.shift() }
  prune()
  if (authenticationPostTimes.length >= 8) {
    const waitMs = Math.max(0, authenticationPostTimes[0] + windowMs - Date.now()) + 25
    assert.ok(waitMs <= 62_000)
    diagnostic.pacingWaitMs += waitMs
    for (let remaining = waitMs; remaining > 0; remaining -= 30_000) await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 30_000)))
    prune()
  }
  assert.ok(authenticationPostTimes.length < 8)
  authenticationPostTimes.push(Date.now())
}
async function assertSession(context, principal) {
  const response = await context.request.get("/api/auth/session", { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const session = await response.json()
  assert.equal(session.user.id, principal.id)
  assert.equal(session.user.organizationId, principal.organizationId)
  assert.notEqual(session.user.needs2fa, true)
  assert.notEqual(session.user.needsSetup2fa, true)
  return session
}
async function authenticate(context, principal) {
  const diagnostic = { ordinal: receipts.authenticationDiagnostics.length + 1, csrfStatus: null, callbackStatus: null, mandatoryTotp: principal.require2fa && principal.totpEnabled, verificationStatus: null, sessionUpdateStatus: null, nonceConsumed: null, pacingWaitMs: 0 }
  receipts.authenticationDiagnostics.push(diagnostic)
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
  diagnostic.csrfStatus = csrf.status(); assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string")
  await paceAuthenticationPost(diagnostic)
  const response = await context.request.post("/api/auth/callback/credentials", {
    timeout: 120_000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: `${origin.href}workforce/exceptions/mine` },
  })
  diagnostic.callbackStatus = response.status(); assert.equal(response.status(), 200)
  const redirect = new URL((await response.json()).url, origin.href)
  assert.equal(redirect.origin, origin.origin); assert.equal(redirect.searchParams.get("error"), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith("authjs.session-token")))
  if (diagnostic.mandatoryTotp) {
    const pendingResponse = await context.request.get("/api/auth/session", { timeout: 120_000 })
    assert.equal(pendingResponse.status(), 200)
    const pending = await pendingResponse.json()
    assert.equal(pending.user.id, principal.id)
    assert.equal(pending.user.needs2fa, true)
    assert.equal(pending.user.twoFactorMethod, "totp")
    // Compile the existing route before generating the short-lived token.
    // GET has no mutation and must remain unsupported by this POST-only API.
    const warmup = await context.request.get("/api/v1/auth/verify-2fa", { timeout: 120_000 })
    diagnostic.verificationWarmupStatus = warmup.status(); assert.equal(warmup.status(), 405)
    await paceAuthenticationPost(diagnostic)
    const verification = await context.request.post("/api/v1/auth/verify-2fa", {
      data: { code: generateSync({ secret: principal.totpSecret }) }, timeout: 120_000,
    })
    diagnostic.verificationStatus = verification.status(); assert.equal(verification.status(), 200)
    const verified = await verification.json()
    assert.equal(verified.success, true); assert.equal(verified.data.verified, true)
    assert.match(verified.data.twoFactorNonce, /^[0-9a-f]{64}$/)
    protectedMarkers.push(verified.data.twoFactorNonce)
    const updateCsrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
    assert.equal(updateCsrf.status(), 200)
    const { csrfToken: updateCsrfToken } = await updateCsrf.json()
    assert.equal(typeof updateCsrfToken, "string")
    await paceAuthenticationPost(diagnostic)
    const updated = await context.request.post("/api/auth/session", {
      data: { csrfToken: updateCsrfToken, data: { needs2fa: false, twoFactorNonce: verified.data.twoFactorNonce } }, timeout: 120_000,
    })
    diagnostic.sessionUpdateStatus = updated.status(); assert.equal(updated.status(), 200)
    const consumed = await admin.user.findUnique({ where: { id: principal.id }, select: { twoFactorNonce: true } })
    diagnostic.nonceConsumed = consumed?.twoFactorNonce === null
    assert.equal(diagnostic.nonceConsumed, true, "Canonical session update must consume the server-issued nonce")
  }
  await assertSession(context, principal)
}

async function contextFor(principal, locale, width) {
  const context = await browser.newContext({ baseURL: origin.href, locale: "en-US", viewport: { width, height: 900 }, serviceWorkers: "block" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.href }])
  await authenticate(context, principal)
  return context
}
function extract(source, start, end = ";") {
  const from = source.indexOf(start), to = from < 0 ? -1 : source.indexOf(end, from)
  assert.ok(from >= 0 && to >= from && source.lastIndexOf(start) === from, "Exact unique production statement required")
  return source.slice(from, to + end.length)
}
async function installProductionRoutines() {
  const lifecyclePath = "prisma/migrations/20260830170000_workforce_exception_case_lifecycle/migration.sql"
  const revisionPath = "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql"
  const linkPath = "prisma/migrations/20260831113000_workforce_exception_correction_request_link/migration.sql"
  const contractPath = "prisma/migrations/20260927014300_workforce_exception_case_revisions_contract/migration.sql"
  const [lifecycle, revision, link, contract] = await Promise.all([lifecyclePath, revisionPath, linkPath, contractPath].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")))
  const statements = [
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_case_mutation(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_cases_append_only")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_decisions_append_only")],
    [revisionPath, extract(revision, "CREATE OR REPLACE FUNCTION workforce_next_exception_compatibility_timestamp(", "\n$$;")],
    [revisionPath, extract(revision, "CREATE OR REPLACE FUNCTION workforce_validate_hrm_request_exception_link()", "\n$$;")],
    [linkPath, extract(link, "CREATE TRIGGER workforce_hrm_requests_validate_exception_link")],
  ]
  await admin.$transaction(async tx => {
    const [target] = await tx.$queryRaw`SELECT current_database() AS name, current_user AS role`
    assert.ok(target.name === "workforce_manager_today_browser" && target.role === "postgres", "Disposable administrator required")
    for (const [table, trigger] of [["workforce_exception_cases", "workforce_exception_cases_append_only"], ["workforce_exception_decisions", "workforce_exception_decisions_append_only"]]) {
      const [guard] = await tx.$queryRawUnsafe("SELECT t.tgenabled::text AS enabled, t.tgisinternal AS internal FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2", `public.${table}`, trigger)
      assert.ok(guard && guard.enabled === "O" && guard.internal === false, "Existing fixture guard required")
      await tx.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON public."${table}"`)
    }
    for (const [path, sql] of statements) {
      await tx.$executeRawUnsafe(sql)
      receipts.productionRoutines.push({ path, kind: "EXACT_STATEMENT", bytes: Buffer.byteLength(sql), sha256: createHash("sha256").update(sql).digest("hex") })
    }
    for (const name of ["mtm_hrm_requests_exception_case_revision_check", "mtm_hrm_requests_exception_case_revision_shape_check"]) {
      const start = revision.indexOf(`ADD CONSTRAINT "${name}"`), end = revision.indexOf(" NOT VALID", start)
      assert.ok(start >= 0 && end > start, "Exact request revision CHECK fragment required")
      const fragment = revision.slice(start + 4, end + " NOT VALID".length)
      const sql = `ALTER TABLE public."mtm_hrm_requests" ADD ${fragment};`
      await tx.$executeRawUnsafe(sql)
      receipts.productionRoutines.push({ path: revisionPath, name, kind: "EXACT_CHECK_FRAGMENT_RECONSTRUCTED_ALTER", fragmentSha256: createHash("sha256").update(fragment).digest("hex"), executedSha256: createHash("sha256").update(sql).digest("hex") })
      const validation = extract(contract, `ALTER TABLE "mtm_hrm_requests"\n  VALIDATE CONSTRAINT "${name}"`)
      await tx.$executeRawUnsafe(validation)
      receipts.productionRoutines.push({ path: contractPath, kind: "EXACT_STATEMENT", bytes: Buffer.byteLength(validation), sha256: createHash("sha256").update(validation).digest("hex") })
    }
  })
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 4); protectedMarkers.push(passwordHash)
  const result = []
  for (const key of ["a", "b"]) {
    const organization = await admin.organization.create({ data: { name: `Correction fixture ${key}`, slug: `wf-correction-${suffix}-${key}`, plan: "enterprise", modules: { "workforce-hrm": true }, features: ["workforce-hrm"], settings: {} } })
    const totpSecret = generateSecret(); protectedMarkers.push(totpSecret)
    const principal = await admin.user.create({ data: { organizationId: organization.id, email: `correction-${suffix}-${key}@example.test`, name: `Fixture ${key}`, passwordHash, role: "sales", require2fa: true, totpEnabled: true, totpSecret, smsAuthEnabled: false } })
    protectedMarkers.push(principal.email)
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Correction team ${key}`, code: `COR-${suffix}-${key}`, isActive: true } })
    const agent = await admin.mtmAgent.create({ data: { organizationId: organization.id, userId: principal.id, teamId: team.id, name: `Synthetic correction agent ${key}`, role: "AGENT", status: "ACTIVE" } })
    protectedMarkers.push(agent.name)
    await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
    const records = []
    for (let ordinal = 0; ordinal < (key === "a" ? 18 : 1); ordinal++) {
      const workDate = new Date(Date.UTC(2025, 0, ordinal + 1))
      const workday = await admin.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: agent.id, workDate, status: "COMPLETED", startedAt: new Date(workDate.getTime() + 28_800_000), completedAt: new Date(workDate.getTime() + 61_200_000), totalPausedSeconds: 0 } })
      const record = await admin.workforceExceptionCase.create({ data: { organizationId: organization.id, agentId: agent.id, workdayId: workday.id, kind: "LATE_START", detectorVersion: "correction-browser-history-v1", deduplicationKey: createHash("sha256").update(`${suffix}-${key}-${ordinal}`).digest("hex"), createdAt: workDate } })
      await admin.$executeRaw`INSERT INTO wf_correction_browser_allowed_days("organizationId","workdayId","caseId","agentId","actorUserId") VALUES (${organization.id},${workday.id},${record.id},${agent.id},${principal.id})`
      records.push({ ...record, workDate: workDate.toISOString().slice(0, 10) })
    }
    result.push({ organization, principal: { ...principal, slug: organization.slug }, agent, records })
  }
  return result
}
async function facts() {
  const tables = ["organizations", "mtm_agents", "mtm_agent_workdays", "workforce_exception_cases", "workforce_exception_decisions", "workforce_employee_team_memberships", "workforce_access_grants", "workforce_shift_templates", "workforce_shift_segments", "workforce_time_corrections", "workforce_exception_employee_responses"]
  return fingerprints(tables)
}
async function fingerprints(tables) {
  const result = []
  for (const table of tables) {
    const [row] = await admin.$queryRawUnsafe(`SELECT count(*)::integer AS rows, COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]') AS content FROM public."${table}" t`)
    result.push({ table, rows: row.rows, sha256: createHash("sha256").update(row.content).digest("hex") })
  }
  return result
}
async function counts() { return { requests: await admin.mtmHrmRequest.count(), audit: await admin.mtmAuditLog.count() } }
async function openOwnForm(page, context, tenant, record, locale) {
  await page.goto("/workforce/exceptions/mine", { waitUntil: "domcontentloaded" })
  await page.getByTestId("workforce-my-exceptions-boundary").waitFor()
  const response = await context.request.get("/api/v1/workforce/exceptions/mine", { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const body = await response.json(); noProtected(JSON.stringify(body))
  assert.equal(body.success, true)
  assert.equal(body.data.cases.length, tenant.records.length)
  assert.deepEqual(new Set(body.data.cases.map(row => row.caseId)), new Set(tenant.records.map(row => row.id)))
  const selected = body.data.cases.find(row => row.caseId === record.id); assert.ok(selected)
  const article = page.getByRole("article").filter({ hasText: selected.displayReference })
  await article.waitFor(); assert.equal(await article.count(), 1)
  const labels = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"))
  const link = article.getByRole("link", { name: labels.workforceMyExceptions.requestCorrection, exact: true })
  const href = new URL(await link.getAttribute("href"), origin.href)
  assert.equal(href.origin, origin.origin); assert.equal(href.pathname, "/workforce/requests")
  assert.equal(href.searchParams.get("exceptionCaseId"), record.id)
  assert.equal(href.searchParams.get("correctionWorkdayId"), record.workdayId)
  await link.click(); await page.waitForURL(url => url.pathname === "/workforce/requests")
  const section = page.locator('section[aria-labelledby="workforce-self-request"]')
  await section.waitFor()
  await page.waitForFunction(id => document.querySelector("#workforce-self-request-type")?.value === "TIME_CORRECTION" && document.querySelector("#workforce-self-request-workday")?.value === id, record.workdayId)
  assert.equal(await section.locator("#workforce-self-request-reason").inputValue(), "")
  return { section, labels: labels.workforcePage }
}
async function submitUi(page, context, tenant, record, locale, changedTo) {
  const { section, labels } = await openOwnForm(page, context, tenant, record, locale)
  const selected = changedTo || record
  if (changedTo) {
    await section.locator("#workforce-self-request-type").selectOption("LEAVE")
    await section.locator("#workforce-self-request-type").selectOption("TIME_CORRECTION")
    await section.locator("#workforce-self-request-workday").selectOption(changedTo.workdayId)
  }
  const button = section.getByRole("button", { name: labels.selfRequestSubmit, exact: true })
  assert.equal(await button.isDisabled(), true)
  await section.locator("#workforce-self-request-start-time").fill(`${selected.workDate}T09:15`)
  await section.locator("#workforce-self-request-reason").fill(privateReason)
  assert.equal(await button.isDisabled(), false)
  const before = await counts()
  const waiter = page.waitForResponse(row => new URL(row.url()).pathname === endpoint && row.request().method() === "POST", { timeout: 120_000 })
  // Observe rejection immediately; awaiting the original still records its failure.
  waiter.catch(() => {})
  await button.click()
  const response = await waiter; assert.equal(response.status(), 201)
  const payload = response.request().postDataJSON(), reply = await response.json()
  assert.equal(reply.success, true); assert.equal(reply.idempotent, false)
  assert.ok(payload.reason === privateReason, "Submitted reason must match synthetic input")
  assert.equal(payload.type, "TIME_CORRECTION"); assert.equal(payload.correctionWorkdayId, selected.workdayId)
  assert.equal(payload.startDate, selected.workDate); assert.equal(payload.endDate, selected.workDate)
  assert.equal(payload.exceptionCaseId, changedTo ? undefined : record.id)
  assert.match(payload.clientRequestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)
  const row = await admin.mtmHrmRequest.findUnique({ where: { id: reply.data.id } })
  assert.ok(row && row.organizationId === tenant.organization.id && row.agentId === tenant.agent.id)
  assert.equal(row.status, "PENDING"); assert.equal(row.exceptionCaseId, changedTo ? null : record.id)
  assert.equal(row.exceptionCaseRevision, changedTo ? null : 0)
  assert.ok(row.reason === privateReason, "Stored reason must match synthetic input")
  const after = await counts(); assert.deepEqual(after, { requests: before.requests + 1, audit: before.audit + 1 })
  await page.waitForFunction(() => document.querySelector("#workforce-self-request-reason")?.value === "")
  const ownRows = await admin.mtmHrmRequest.count({ where: { organizationId: tenant.organization.id, agentId: tenant.agent.id } })
  // requestReload is asynchronous; require its actual visible history to settle.
  await page.waitForFunction(({ reason, count }) => {
    const section = document.querySelector('section[aria-labelledby="workforce-request-list"]')
    return section && Array.from(section.querySelectorAll("article")).filter(article =>
      Array.from(article.querySelectorAll("p")).some(node => node.textContent === reason)).length === count
  }, { reason: privateReason, count: ownRows }, { timeout: 120_000 })
  assert.equal(await page.locator('section[aria-labelledby="workforce-request-list"]').getByText(privateReason, { exact: true }).count(), ownRows)
  const replay = await context.request.post(endpoint, { data: payload, timeout: 120_000 })
  assert.equal(replay.status(), 200)
  const replayBody = await replay.json(); assert.equal(replayBody.success, true); assert.equal(replayBody.idempotent, true)
  assert.equal(replayBody.data.id, row.id); assert.deepEqual(await counts(), after)
  submitted.push({ row, payload, tenant, linked: !changedTo })
  return { actualPostStatus: 201, actualReplayStatus: 200, pending: true, ownWorkday: true, sourceLinked: !changedTo, immutableRevision: changedTo ? null : 0, actualUiHistory: true, duplicateRows: 0 }
}
async function boundaries(context) {
  const own = tenants[0].records[0], foreign = tenants[1].records[0]
  const before = await counts(), codes = []
  for (const exceptionCaseId of [foreign.id, `missing-${suffix}`, tenants[0].records[1].id]) {
    const response = await context.request.post(endpoint, { timeout: 120_000, data: { clientRequestId: randomUUID(), type: "TIME_CORRECTION", startDate: own.workDate, endDate: own.workDate, correctionWorkdayId: own.workdayId, exceptionCaseId, requestedStartLocal: `${own.workDate}T09:15`, reason: privateReason } })
    assert.equal(response.status(), 409)
    const body = await response.json(); codes.push(body.code)
    assert.equal(body.code, "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND")
  }
  assert.deepEqual(await counts(), before)
  receipts.cases.push({ name: "foreign-missing-and-different-day-cases-indistinguishable", status: "PASS", actual409: codes.length, requestsAndAuditUnchanged: true })
}
async function sqlRollback(kind, expectedState, sql, values) {
  const before = await counts(), beforeRows = await fingerprints(["mtm_hrm_requests", "mtm_audit_logs"]); let state
  try { await admin.$transaction(tx => tx.$executeRawUnsafe(sql, ...values)) } catch (error) { state = error.meta?.code }
  assert.ok(state === expectedState, "Exact rollback SQLSTATE required")
  assert.deepEqual(await counts(), before)
  assert.deepEqual(await fingerprints(["mtm_hrm_requests", "mtm_audit_logs"]), beforeRows)
  receipts.databaseDiagnostics.push({ kind, expectedSqlState: expectedState, actualSqlState: state, rolledBack: true, persistedRequestAndAuditFingerprintsUnchanged: true })
}
async function databaseProof() {
  const linked = submitted.find(item => item.linked), alternate = tenants[0].records[1]
  await sqlRollback("IMMUTABLE_CASE_LINK", "55000", 'UPDATE mtm_hrm_requests SET "exceptionCaseId"=NULL WHERE id=$1', [linked.row.id])
  await sqlRollback("IMMUTABLE_CASE_REVISION", "55000", 'UPDATE mtm_hrm_requests SET "exceptionCaseRevision"=1 WHERE id=$1', [linked.row.id])
  await sqlRollback("EXACT_LINKED_WORKDAY", "23514", 'UPDATE mtm_hrm_requests SET "correctionWorkdayId"=$1 WHERE id=$2', [alternate.workdayId, linked.row.id])
  await sqlRollback("SYNTHETIC_AUDIT_IMMUTABLE", "55000", 'UPDATE mtm_audit_logs SET "oldData"=\'{}\'::jsonb WHERE "entityId"=$1', [linked.row.id])
  await sqlRollback("EXACT_CASE_IMMUTABLE", "55000", 'UPDATE workforce_exception_cases SET kind=\'OVERTIME\' WHERE id=$1', [tenants[0].records[0].id])
  assert.deepEqual(await counts(), { requests: 19, audit: 19 })
  assert.equal(submitted.filter(item => item.linked).length, 10)
  for (const item of submitted) {
    const rows = await admin.mtmAuditLog.findMany({ where: { entityId: item.row.id } }); assert.equal(rows.length, 1)
    const row = rows[0]; assert.equal(row.action, "WORKFORCE_SELF_REQUEST_SUBMITTED")
    assert.equal(row.entity, "hrm_request"); assert.equal(row.metadataKind, "workforce_self_request")
    assert.equal(row.agentId, item.tenant.agent.id); assert.equal(row.organizationId, item.tenant.organization.id)
    assert.deepEqual(Object.keys(row.newData).sort(), ["correctionRequested", "endDate", "exceptionCaseLinked", "exceptionCaseRevision", "startDate", "type"])
    assert.equal(row.newData.exceptionCaseLinked, item.linked); assert.equal(row.newData.exceptionCaseRevision, item.linked ? 0 : null)
    assert.equal(row.newData.correctionRequested, true); assert.equal(row.oldData, null)
    noProtected(JSON.stringify(row.newData))
  }
  const [role] = await app.$queryRaw`SELECT current_user AS role, r.rolsuper, r.rolbypassrls, r.rolinherit FROM pg_roles r WHERE r.rolname=current_user`
  assert.ok(role.role === "wf_manager_today_browser" && !role.rolsuper && !role.rolbypassrls && !role.rolinherit)
  const [catalog] = await app.$queryRaw`SELECT
    (SELECT count(*)::integer FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relname=ANY(ARRAY['mtm_hrm_requests','mtm_audit_logs','workforce_time_corrections',
        'workforce_exception_employee_responses','wf_correction_browser_allowed_days'])
      AND relrowsecurity AND relforcerowsecurity) AS forced,
    (SELECT count(*)::integer FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,
    (SELECT count(*)::integer FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
    has_table_privilege(current_user,'public.mtm_hrm_requests','INSERT') AS request_insert,
    has_table_privilege(current_user,'public.mtm_audit_logs','INSERT') AS audit_insert,
    has_table_privilege(current_user,'public.mtm_hrm_requests','UPDATE,DELETE,TRUNCATE') AS request_mutation,
    has_table_privilege(current_user,'public.mtm_audit_logs','UPDATE,DELETE,TRUNCATE') AS audit_mutation,
    has_any_column_privilege(current_user,'public.mtm_agent_workdays','INSERT,UPDATE') AS workday_write,
    has_any_column_privilege(current_user,'public.workforce_exception_decisions','INSERT,UPDATE') AS decision_write,
    has_any_column_privilege(current_user,'public.workforce_exception_employee_responses','INSERT,UPDATE') AS response_write,
    has_any_column_privilege(current_user,'public.workforce_time_corrections','INSERT,UPDATE') AS correction_write`
  assert.equal(catalog.forced, 5); assert.equal(catalog.owned, 0); assert.equal(catalog.memberships, 0)
  assert.ok(catalog.request_insert && catalog.audit_insert)
  assert.ok(!catalog.request_mutation && !catalog.audit_mutation && !catalog.workday_write
    && !catalog.decision_write && !catalog.response_write && !catalog.correction_write)
  assert.equal(await app.mtmHrmRequest.count(), 0)
  for (const tenant of tenants) await app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${tenant.organization.id}, true)`
    assert.equal(await tx.mtmHrmRequest.count(), tenant.organization.id === tenants[0].organization.id ? 18 : 1)
    assert.equal(await tx.mtmHrmRequest.count({ where: { organizationId: tenants.find(other => other !== tenant).organization.id } }), 0)
  })
  const finalFacts = await facts(); assert.deepEqual(finalFacts, initialFacts)
  receipts.database = { actualRequests: 19, actualAudits: 19, linkedRequests: 10, unlinkedAfterTypeDayChange: 9, nonownerForcedRls: true, actualRoleCatalog: catalog, unscopedRows: 0, foreignRows: 0, twoPopulatedTenants: true, knownFactControls: finalFacts, unchanged: true, automaticPersonnelDecisions: 0, corrections: 0, employeeResponses: 0, defaultAclReviewed: false, fullHistoricalReplay: false }
}
try {
  const sourcePaths = ["scripts/workforce-employee-correction-browser-evidence.mjs", "scripts/workforce-employee-correction-browser-admission.mjs", "scripts/workforce-employee-correction-browser-admission.test.mjs", "scripts/ci/fixtures/workforce-employee-correction-browser.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql", ".github/workflows/workforce-exception-report-browser-evidence.yml", "scripts/_rls.mjs", "src/lib/auth.ts", "src/lib/permissions.ts", "src/lib/with-workforce-rls-auth.ts", "src/lib/workforce/actor.ts", "src/lib/workforce/self-request.ts", "src/lib/workforce/hrm-request-idempotency.ts", "src/lib/workforce/exception-linked-mutation.ts", "src/lib/workforce/exception-case-writer.ts", "src/lib/workforce/sensitive-response.ts", "src/app/api/v1/workforce/requests/route.ts", "src/app/api/v1/workforce/exceptions/mine/route.ts", "src/components/workforce/workforce-workbench.tsx", "src/components/workforce/workforce-my-exceptions.tsx", "src/app/(dashboard)/workforce/requests/page.tsx", "prisma/schema.prisma", "prisma/migrations/20260830170000_workforce_exception_case_lifecycle/migration.sql", "prisma/migrations/20260831113000_workforce_exception_correction_request_link/migration.sql", "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql", "prisma/migrations/20260927014300_workforce_exception_case_revisions_contract/migration.sql", "messages/az.json", "messages/ru.json", "messages/en.json", "package-lock.json"]
  for (const path of sourcePaths) {
    const b = await readFile(new URL(`../${path}`, import.meta.url)); receipts.sources.push({ path, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") })
  }
  stage = "installing-exact-production-link-routines"; await installProductionRoutines()
  stage = "seeding-imported-own-cases"; tenants = await seed(); initialFacts = await facts()
  assert.deepEqual(await counts(), { requests: 0, audit: 0 })
  browser = await chromium.launch({ headless: true })
  let firstContext
  for (const [index, cell] of cells.entries()) {
    stage = `${cell.key}-canonical-authentication`
    const context = await contextFor(tenants[0].principal, cell.locale, cell.width), page = await context.newPage()
    if (index === 0) firstContext = context
    stage = `${cell.key}-actual-linked-request`; const linked = await submitUi(page, context, tenants[0], tenants[0].records[index * 2], cell.locale)
    stage = `${cell.key}-actual-cleared-source-request`; const unlinked = await submitUi(page, context, tenants[0], tenants[0].records[index * 2], cell.locale, tenants[0].records[index * 2 + 1])
    receipts.cases.push({ name: cell.key, locale: cell.locale, width: cell.width, status: "PASS", linked, unlinked })
  }
  stage = "second-positive-tenant"
  const context = await contextFor(tenants[1].principal, "en", 768), page = await context.newPage()
  const linked = await submitUi(page, context, tenants[1], tenants[1].records[0], "en")
  receipts.cases.push({ name: "second-populated-tenant", status: "PASS", linked })
  stage = "actual-source-ownership-refusals"; await boundaries(firstContext)
  stage = "actual-immutable-attribution-and-rls"; await databaseProof()
  assert.equal(receipts.cases.length, 11); assert.equal(receipts.authenticationDiagnostics.length, 10)
  receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"; process.exitCode = 1
  const code = String(error.code || "")
  receipts.failure = { stage, class: String(error.name || "Error").replace(/[^A-Za-z]/g, "").slice(0, 80), code: /^[A-Z0-9_]{1,40}$/.test(code) ? code : null, frames: String(error.stack || "").split("\n").filter(line => /\.mjs:\d+:\d+\)?$/.test(line)).slice(0, 4), diagnostic: "Original failure stage/code/frames retained; private bodies, reason, identities, credentials and cookies omitted; no private screenshot attempted" }
} finally {
  const close = async (resource, action) => {
    try { await action(); receipts.cleanupDiagnostics.push({ resource, status: "PASS" }) }
    catch { receipts.cleanupDiagnostics.push({ resource, status: "FAIL" }) }
  }
  for (const [index, context] of contexts.entries()) await close(`context-${index + 1}`, () => context.close())
  if (browser) await close("browser", () => browser.close())
  await close("app-prisma", () => app.$disconnect()); await close("admin-prisma", () => admin.$disconnect())
  receipts.cleanup = receipts.cleanupDiagnostics.every(row => row.status === "PASS") ? "PASS" : "FAIL"
  if (receipts.cleanup === "FAIL") { receipts.status = "FAIL"; process.exitCode = 1 }
  receipts.completedAt = new Date().toISOString(); noProtected(JSON.stringify(receipts))
  await writeFile(`${outputDirectory}/employee-correction-receipt.json`, JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: receipts.status, completedCases: receipts.cases.length, cleanup: receipts.cleanup }))
}
