import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { generateSecret, generateSync } from "otplib"
import { chromium } from "playwright"
import { createNativeZoomContext, proveNative200Zoom, captureNativeViewport, isNativeZoomPage } from "./workforce-native-browser-zoom.mjs"
import { employeeExceptionBrowserTarget, assertEmployeeExceptionCaptureAllowed } from "./workforce-employee-exception-browser-admission.mjs"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Separate hosted synthetic employee rehearsal; never a production seed or activation.
const { origin, admin: adminURL, app: appURL } = employeeExceptionBrowserTarget(process.env)
const outputDirectory = process.env.WF_EMPLOYEE_EXCEPTION_BROWSER_OUTPUT_DIR || "artifacts/workforce-employee-exception-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`
const privateReason = "PRIVATE_EMPLOYEE_BROWSER_HISTORICAL_HR_REASON"
const protectedMarkers = [password, privateReason]
const contexts = [], nativeZoomContexts = [], expectedResponses = []
const locales = ["az", "ru", "en"], widths = [320, 768, 1440]
const matrixCells = locales.flatMap(locale => [...widths.map(width => ({ locale, width, nativeZoom: false, key: `${locale}-standard-${width}` })), { locale, width: 320, nativeZoom: true, key: `${locale}-native-320` }])
const endpoint = "/api/v1/workforce/exceptions/mine"
const at = new Date("2025-01-01T00:00:00Z")
const now = new Date()
let browser, activePage, stage = "fixture-preparing", initialFacts, historicalResponse
const receipts = {
  version: 1, sourceHead: process.env.WF_EMPLOYEE_EXCEPTION_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA, startedAt: now.toISOString(),
  environment: "hosted Chromium / real Auth.js MFA / loopback Next dev / disposable PostgreSQL16 and Redis",
  status: "RUNNING", cases: [], sources: [], productionRoutines: [], authenticationDiagnostics: [],
  matrix: { locales, widths, standardExpected: 9, nativeExpected: 3 }, matrixDiagnostics: [],
  nativeZoomDiagnostics: [], nativeCaptureDiagnostics: [], keyboardFocusDiagnostics: [],
  captureDiagnostics: [], networkFaultDiagnostics: [], databaseDiagnostics: [], cleanupDiagnostics: [],
  limitations: [
    "Synthetic isolated tenants and imported historical cases only; no real expected-schedule materialization or physical attendance evidence",
    "Employee actor is a linked AGENT under existing CRM sales read/write permission; no roles or production response flags changed",
    "Only acknowledgement writes and exact-day correction navigation; no correction submission, free-text appeal or personnel decision",
    "One load failure and one committed acknowledgement response loss deliberately injected through browser-network controls; not an operational outage",
    "Exact production ownership/revision/append-only routines and cycle index; not full historical migration replay",
    "Synthetic write allowlist and audit guard are separate fixture constraints, not production MtmAuditLog migration evidence",
    "Real keyboard/native browser zoom bounds; not whole-page overlay nonocclusion, human AT, physical Android or whole C14 acceptance",
    "Development bundle; authenticated production employee session and production mutation NOT RUN",
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
async function contextFor(principal, locale = "en", width = 1280, nativeZoom = false) {
  const owned = nativeZoom ? await createNativeZoomContext(origin.href, "employee-exceptions") : null
  if (owned) nativeZoomContexts.push(owned)
  const context = owned ? owned.context : await browser.newContext({ baseURL: origin.href, locale: "en-US", viewport: { width, height: 900 }, serviceWorkers: "block" })
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
  const responsePath = "prisma/migrations/20260830200000_workforce_exception_employee_responses/migration.sql"
  const indexPath = "prisma/migrations/20260928123000_workforce_exception_response_cycle_unique_index/migration.sql"
  const [lifecycle, revision, response, index] = await Promise.all([lifecyclePath, revisionPath, responsePath, indexPath].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")))
  const statements = [
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_case_mutation(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation(", "\n$$;")],
    [revisionPath, extract(revision, "CREATE OR REPLACE FUNCTION workforce_next_exception_compatibility_timestamp(", "\n$$;")],
    [revisionPath, extract(revision, "CREATE OR REPLACE FUNCTION workforce_assign_exception_decision_revision(", "\n$$;")],
    [revisionPath, extract(revision, "CREATE OR REPLACE FUNCTION workforce_validate_exception_employee_response_insert(", "\n$$;")],
    [responsePath, extract(response, "CREATE OR REPLACE FUNCTION workforce_reject_exception_employee_response_mutation(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_cases_append_only")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_decisions_append_only")],
    [revisionPath, extract(revision, "CREATE TRIGGER workforce_exception_decisions_assign_case_revision")],
    [responsePath, extract(response, "CREATE TRIGGER workforce_exception_employee_responses_validate_insert")],
    [responsePath, extract(response, "CREATE TRIGGER workforce_exception_employee_responses_append_only")],
  ]
  receipts.productionRoutineInstallation = { status: "PENDING", exactStatements: statements.length, constraints: [], cycleIndex: "NOT RUN" }
  await admin.$transaction(async tx => {
    const [target] = await tx.$queryRaw`SELECT current_database() AS name, current_user AS role`
    assert.ok(target.name === "workforce_manager_today_browser" && target.role === "postgres", "Disposable administrator required")
    for (const [table, trigger] of [["workforce_exception_cases", "workforce_exception_cases_append_only"], ["workforce_exception_decisions", "workforce_exception_decisions_append_only"]]) {
      const [existing] = await tx.$queryRawUnsafe("SELECT t.tgenabled::text AS enabled, t.tgisinternal AS internal FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2", `public.${table}`, trigger)
      assert.ok(existing && existing.enabled === "O" && existing.internal === false, "Existing fixture append-only guard required")
      await tx.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON public."${table}"`)
    }
    for (const [path, sql] of statements) {
      await tx.$executeRawUnsafe(sql)
      receipts.productionRoutines.push({ path, kind: "EXACT_STATEMENT", bytes: Buffer.byteLength(sql), sha256: createHash("sha256").update(sql).digest("hex") })
    }
    const names = ["workforce_exception_employee_responses_client_id_check", "workforce_exception_employee_responses_code_check", "workforce_exception_employee_responses_request_shape_check"]
    for (const [ordinal, name] of names.entries()) {
      const start = response.indexOf(`CONSTRAINT "${name}"`)
      const end = ordinal < names.length - 1 ? response.indexOf(`\n  CONSTRAINT "${names[ordinal + 1]}"`, start) : response.indexOf("\n);", start)
      assert.ok(start >= 0 && end > start, "Exact production CHECK fragment required")
      const fragment = response.slice(start, end).trimEnd().replace(/,$/, "")
      const sql = `ALTER TABLE public."workforce_exception_employee_responses" ADD ${fragment};`
      await tx.$executeRawUnsafe(sql)
      receipts.productionRoutineInstallation.constraints.push({ path: responsePath, name, kind: "EXACT_CHECK_FRAGMENT_RECONSTRUCTED_ALTER", fragmentSha256: createHash("sha256").update(fragment).digest("hex"), executedSha256: createHash("sha256").update(sql).digest("hex") })
    }
  })
  receipts.productionRoutineInstallation.status = "COMMITTED"
  // Exactly one executable production statement, submitted outside the
  // transaction above. This concurrent index is not replaced by db push.
  const cycleSql = extract(index, 'CREATE UNIQUE INDEX CONCURRENTLY "workforce_exception_employee_responses_org_case_revision_key"')
  await admin.$executeRawUnsafe(cycleSql)
  const [actual] = await admin.$queryRaw`SELECT i.indisunique, i.indisvalid, i.indisready, i.indnullsnotdistinct, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i WHERE i.indexrelid='public.workforce_exception_employee_responses_org_case_revision_key'::regclass`
  assert.ok(actual?.indisunique && actual.indisvalid && actual.indisready && actual.indnullsnotdistinct === false, "Valid NULLS DISTINCT unique cycle index required")
  assert.ok(actual.definition.includes('("organizationId", "caseId", "observedCaseRevision")'), "Exact cycle key required")
  receipts.productionRoutineInstallation.cycleIndex = "APPLIED_OUTSIDE_TRANSACTION_VALID_UNIQUE_NULLS_DISTINCT"
  receipts.productionRoutines.push({ path: indexPath, kind: "EXACT_STATEMENT_OUTSIDE_TRANSACTION", bytes: Buffer.byteLength(cycleSql), sha256: createHash("sha256").update(cycleSql).digest("hex") })
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 4)
  protectedMarkers.push(passwordHash)
  const tenants = []
  for (const key of ["a", "b", "off"]) {
    const organization = await admin.organization.create({ data: {
      name: `Employee fixture ${key}`, slug: `wf-employee-${suffix}-${key}`, plan: "enterprise", modules: { "workforce-hrm": true },
      features: ["workforce-hrm", ...(key === "off" ? [] : ["workforce-exception-response-v1"])], settings: {},
    } })
    const principals = {}
    for (const name of ["employee", ...(key === "a" ? ["other", "unlinked", "viewer", "admin"] : [])]) {
      const totpSecret = generateSecret(); protectedMarkers.push(totpSecret)
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `employee-${suffix}-${key}-${name}@example.test`, name: `Fixture ${key} ${name}`,
        passwordHash, role: name === "admin" ? "admin" : name === "viewer" ? "viewer" : "sales", require2fa: true, totpEnabled: true, totpSecret, smsAuthEnabled: false,
      } })
      principals[name] = { ...user, slug: organization.slug }
    }
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Fixture ${key} team`, code: `EMP-${suffix}-${key}`, isActive: true } })
    const agent = await admin.mtmAgent.create({ data: { organizationId: organization.id, userId: principals.employee.id, teamId: team.id, name: `Synthetic employee ${key}`, role: "AGENT", status: "ACTIVE" } })
    const others = {}
    for (const name of key === "a" ? ["other", "viewer"] : []) {
      others[name] = await admin.mtmAgent.create({ data: { organizationId: organization.id, userId: principals[name].id, teamId: team.id, name: `Synthetic ${name}`, role: "AGENT", status: "ACTIVE" } })
    }
    await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
    const cases = {}
    const labels = key === "a" ? [...matrixCells.map(cell => cell.key), "stale", "resolved", "reopened"] : ["single"]
    for (const [ordinal, label] of labels.entries()) {
      const workDate = new Date(at.getTime() + ordinal * 86_400_000)
      const workday = await admin.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: agent.id, workDate, status: "COMPLETED", startedAt: new Date(workDate.getTime() + 28_800_000), completedAt: new Date(workDate.getTime() + 61_200_000), totalPausedSeconds: 0 } })
      const record = await admin.workforceExceptionCase.create({ data: { organizationId: organization.id, agentId: agent.id, workdayId: workday.id, kind: "LATE_START", detectorVersion: "employee-browser-history-v1", deduplicationKey: createHash("sha256").update(`${suffix}-${key}-${label}`).digest("hex"), createdAt: workDate } })
      await admin.$executeRaw`INSERT INTO wf_employee_browser_allowed_cases("organizationId","caseId","agentId","workdayId","actorUserId") VALUES (${organization.id},${record.id},${agent.id},${workday.id},${principals.employee.id})`
      const decisions = label === "resolved" ? ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE"] : label === "reopened" ? ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE", "REOPEN_FOR_REVIEW"] : label === "stale" ? ["ACKNOWLEDGE"] : []
      for (const [index, decisionCode] of decisions.entries()) {
        await admin.workforceExceptionDecision.create({ data: { organizationId: organization.id, caseId: record.id, operationId: `employee-${suffix}-${key}-${label}-${index}`, decisionCode, reason: privateReason, actorUserId: principals.employee.id, createdAt: new Date(workDate.getTime() + index * 1_000) } })
        if (label === "reopened" && index === 0) historicalResponse = await admin.workforceExceptionEmployeeResponse.create({ data: {
          organizationId: organization.id, caseId: record.id, agentId: agent.id, workdayId: workday.id,
          actorUserId: principals.employee.id, responseCode: "ACKNOWLEDGED", observedCaseRevision: 1,
          clientResponseId: `historical-${suffix}`, createdAt: workDate,
        } })
      }
      cases[label] = { ...record, reference: `WF-${record.id.slice(-8)}`, workday }
    }
    const noShow = await admin.workforceExceptionCase.create({ data: { organizationId: organization.id, agentId: agent.id, workdayId: null, kind: "NO_SHOW", expectedWorkDate: new Date(at.getTime() - 86_400_000), detectorVersion: "employee-browser-imported-schedule-shape-v1", deduplicationKey: createHash("sha256").update(`${suffix}-${key}-no-show`).digest("hex"), createdAt: at } })
    cases.noShow = { ...noShow, reference: `WF-${noShow.id.slice(-8)}` }
    tenants.push({ organization, principals, team, agent, others, cases })
  }
  return tenants
}

const observeWaiter = promise => { promise.catch(() => {}); return promise }
const responsePath = record => `/api/v1/workforce/exceptions/${encodeURIComponent(record.id)}/response`
const postTimes = []
async function paceEmployeePost() {
  const windowMs = 61_000
  while (postTimes.length && postTimes[0] <= Date.now() - windowMs) postTimes.shift()
  if (postTimes.length >= 8) {
    const waitMs = Math.max(0, postTimes[0] + windowMs - Date.now()) + 25
    assert.ok(waitMs <= 62_000)
    for (let remaining = waitMs; remaining > 0; remaining -= 30_000) await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 30_000)))
    while (postTimes.length && postTimes[0] <= Date.now() - windowMs) postTimes.shift()
  }
  assert.ok(postTimes.length < 8)
  postTimes.push(Date.now())
}
async function ownProjection(context, tenant, recording = "AVAILABLE") {
  const response = await context.request.get(endpoint, { timeout: 120_000, maxRedirects: 0 })
  assert.equal(response.status(), 200)
  const headers = response.headers()
  assert.ok(headers["cache-control"].includes("no-store"))
  assert.equal(headers["x-content-type-options"], "nosniff")
  const body = await response.json(); noProtected(JSON.stringify(body))
  assert.equal(body.success, true)
  assert.deepEqual(Object.keys(body.data).sort(), ["cases", "disposition", "responseRecording"])
  assert.equal(body.data.disposition, "SELF_SERVICE_CORRECTION_ONLY")
  assert.equal(body.data.responseRecording, recording)
  assert.equal(body.data.cases.length, Object.keys(tenant.cases).length)
  assert.deepEqual(new Set(body.data.cases.map(row => row.caseId)), new Set(Object.values(tenant.cases).map(row => row.id)))
  for (const row of body.data.cases) {
    assert.deepEqual(Object.keys(row).sort(), ["availableAction", "availableResponseAction", "caseId", "createdAt", "displayReference", "responseState", "type", "workDate", "workdayId"])
    if (recording === "MIGRATION_REQUIRED") {
      assert.equal(row.responseState, "UNAVAILABLE"); assert.equal(row.availableResponseAction, null)
    }
  }
  const noShow = body.data.cases.find(row => row.caseId === tenant.cases.noShow.id)
  assert.equal(noShow.availableAction, "VIEW_ONLY_NO_SHOW"); assert.equal(noShow.workdayId, null)
  assert.equal(noShow.availableResponseAction, null)
  return body.data
}
async function post(context, record, data, expectedStatus) {
  await paceEmployeePost()
  const response = await context.request.post(responsePath(record), { data, timeout: 120_000, maxRedirects: 0 })
  assert.equal(response.status(), expectedStatus)
  const body = await response.json(); noProtected(JSON.stringify(body))
  if (expectedStatus < 300) {
    assert.equal(body.success, true); assert.deepEqual(Object.keys(body.data), ["responseId"])
    assert.equal(typeof body.data.responseId, "string")
    assert.equal(body.idempotent, expectedStatus === 200)
    assert.ok(response.headers()["cache-control"].includes("no-store"))
    assert.equal(response.headers()["x-content-type-options"], "nosniff")
  } else assert.notEqual(body.success, true)
  return body
}
async function counts() {
  return { responses: await admin.workforceExceptionEmployeeResponse.count(), audit: await admin.mtmAuditLog.count() }
}
async function fixedFacts(tenants) {
  const tables = ["organizations", "mtm_agents", "mtm_agent_workdays", "workforce_exception_cases", "workforce_exception_decisions", "workforce_shift_segments", "workforce_employee_team_memberships", "workforce_access_grants", "mtm_hrm_requests", "workforce_time_corrections"]
  const ids = tenants.map(tenant => tenant.organization.id), result = []
  for (const table of tables) {
    const column = table === "organizations" ? "id" : "organizationId"
    const rows = await admin.$queryRawUnsafe(`SELECT row_to_json(t) AS value FROM public."${table}" t WHERE "${column}" IN ($1,$2,$3) ORDER BY id LIMIT 101`, ...ids)
    assert.ok(rows.length <= 100)
    result.push({ table, rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") })
  }
  const users = await admin.user.findMany({ where: { organizationId: { in: ids } }, orderBy: { id: "asc" }, select: {
    id: true, organizationId: true, role: true, passwordHash: true, require2fa: true, totpEnabled: true, totpSecret: true, smsAuthEnabled: true,
  } })
  result.push({ table: "users-stable-access-and-enrollment", rows: users.length, sha256: createHash("sha256").update(JSON.stringify(users)).digest("hex") })
  const unchanged = await admin.workforceExceptionEmployeeResponse.findUnique({ where: { id: historicalResponse.id } })
  result.push({ table: "historical-response-before-reopened-cycle", rows: 1, sha256: createHash("sha256").update(JSON.stringify(unchanged)).digest("hex") })
  return result
}
async function tabTo(page, locator) {
  await locator.waitFor({ state: "visible" }); assert.equal(await locator.count(), 1)
  for (let ordinal = 0; ordinal < 256; ordinal++) {
    if (await locator.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press("Tab")
  }
  assert.fail("Own control not reachable by bounded real Tab navigation")
}
async function focusedControl(view, locator, phase) {
  const diagnostic = await locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    let left = 0, right = innerWidth, top = 0, bottom = innerHeight
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
        left = Math.max(left, bounds.left + ancestor.clientLeft); right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth)
      }
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
        top = Math.max(top, bounds.top + ancestor.clientTop); bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight)
      }
    }
    return { focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
      viewport: { width: innerWidth, height: innerHeight }, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, clip: { left, right, top, bottom } }
  })
  receipts.keyboardFocusDiagnostics.push({ locale: view.locale, width: view.width, nativeZoom: Boolean(view.nativeZoom), phase, ...diagnostic })
  assert.equal(diagnostic.focused, true); assert.equal(diagnostic.focusVisible, true)
  assert.ok(Object.values(diagnostic.box).every(Number.isFinite) && Object.values(diagnostic.clip).every(Number.isFinite))
  assert.ok(diagnostic.box.width > 0 && diagnostic.box.height >= 43)
  assert.ok(diagnostic.box.left >= diagnostic.clip.left - 1 && diagnostic.box.right <= diagnostic.clip.right + 1)
  assert.ok(diagnostic.box.top >= diagnostic.clip.top - 1 && diagnostic.box.bottom <= diagnostic.clip.bottom + 1)
}
async function capturePrivacy(page) {
  const freeTextValues = await page.locator('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])').evaluateAll(elements => elements.map(element => element.value))
  assertEmployeeExceptionCaptureAllowed({ freeTextValues, visibleText: await page.locator("body").innerText(), protectedMarkers })
  receipts.captureDiagnostics.push({ freeTextEmpty: true, protectedSubjectsAbsent: true })
}
async function safeScreenshot(page, name) {
  await capturePrivacy(page)
  if (isNativeZoomPage(page)) await captureNativeViewport(page, `${outputDirectory}/${name}`, diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
  else await page.screenshot({ path: `${outputDirectory}/${name}` })
}
async function loadPage(page) {
  const response = observeWaiter(page.waitForResponse(row => new URL(row.url()).pathname === endpoint && row.request().method() === "GET", { timeout: 120_000 }))
  await page.goto("/workforce/exceptions/mine", { waitUntil: "domcontentloaded" })
  assert.equal((await response).status(), 200)
  await page.getByTestId("workforce-my-exceptions-boundary").waitFor()
}
async function uiScenario(tenant, cell) {
  stage = `${cell.key}-authenticate`
  const translations = JSON.parse(await readFile(new URL(`../messages/${cell.locale}.json`, import.meta.url), "utf8")).workforceMyExceptions
  const context = await contextFor(tenant.principals.employee, cell.locale, cell.width, cell.nativeZoom)
  const page = await context.newPage(); activePage = page
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000)
  const view = { ...(cell.nativeZoom ? nativeZoomContexts.at(-1) : {}), page, locale: cell.locale, width: cell.width, nativeZoom: null }
  await loadPage(page)
  const projection = await ownProjection(context, tenant)
  const selected = projection.cases.find(row => row.caseId === tenant.cases[cell.key].id)
  assert.deepEqual(selected.availableResponseAction, { kind: "ACKNOWLEDGE", expectedCaseRevision: 0 })
  const reopened = projection.cases.find(row => row.caseId === tenant.cases.reopened.id)
  assert.equal(reopened.responseState, "NOT_ACKNOWLEDGED")
  assert.deepEqual(reopened.availableResponseAction, { kind: "ACKNOWLEDGE", expectedCaseRevision: 3 })
  const article = page.getByRole("article").filter({ hasText: selected.displayReference })
  await article.waitFor(); assert.equal(await article.count(), 1)
  if (cell.nativeZoom) {
    stage = `${cell.key}-native-zoom`
    // Native proof also captures the application: privacy admission precedes it.
    await capturePrivacy(page)
    view.nativeZoom = await proveNative200Zoom(view, outputDirectory, cell.locale, diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
    receipts.nativeZoomDiagnostics.push({ locale: cell.locale, status: "PASS", ...view.nativeZoom })
  }
  stage = `${cell.key}-keyboard-refresh`
  const refresh = page.getByRole("button", { name: translations.refresh, exact: true })
  await tabTo(page, refresh); await focusedControl(view, refresh, "refresh")
  if (cell.nativeZoom) await safeScreenshot(page, `${cell.key}-refresh.png`)
  const refreshed = observeWaiter(page.waitForResponse(row => new URL(row.url()).pathname === endpoint && row.request().method() === "GET"))
  await page.keyboard.press("Enter"); assert.equal((await refreshed).status(), 200)
  const correction = article.getByRole("link", { name: translations.requestCorrection, exact: true })
  await tabTo(page, correction); await focusedControl(view, correction, "exact-day-correction-link")
  await safeScreenshot(page, `${cell.key}-correction-focus.png`)
  const href = await correction.getAttribute("href")
  const target = new URL(href, origin.href)
  assert.equal(target.pathname, "/workforce/requests")
  assert.deepEqual([...target.searchParams.entries()].sort(), [["correctionWorkdayId", selected.workdayId], ["exceptionCaseId", selected.caseId]])
  await page.keyboard.press("Enter")
  await page.waitForURL(url => url.pathname === "/workforce/requests", { timeout: 120_000 })
  assert.equal(new URL(page.url()).searchParams.get("correctionWorkdayId"), selected.workdayId)
  assert.equal(new URL(page.url()).searchParams.get("exceptionCaseId"), selected.caseId)
  await loadPage(page)
  stage = `${cell.key}-keyboard-acknowledgement`
  const acknowledge = article.getByRole("button", { name: translations.acknowledgeForReview, exact: true })
  await tabTo(page, acknowledge); await focusedControl(view, acknowledge, "acknowledge")
  await safeScreenshot(page, `${cell.key}-ack-focus.png`)
  let committed, operationId, responseId
  const losing = cell.key === "az-standard-320"
  const path = responsePath(tenant.cases[cell.key])
  if (losing) {
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== "POST") return route.continue()
      operationId = route.request().postDataJSON().clientResponseId
      const actual = await route.fetch({ timeout: 120_000 })
      committed = actual.status(); responseId = (await actual.json()).data?.responseId
      await route.abort("failed")
    })
    await paceEmployeePost(); await page.keyboard.press("Enter")
    await page.getByRole("alert").filter({ hasText: translations.acknowledgeFailed }).waitFor()
    assert.equal(committed, 201); assert.equal(typeof responseId, "string")
    assert.deepEqual(await counts(), { responses: expectedResponses.length + 2, audit: expectedResponses.length + 1 })
    await safeScreenshot(page, `${cell.key}-committed-response-lost.png`)
    await page.unroute(`**${path}`)
    await tabTo(page, acknowledge); await focusedControl(view, acknowledge, "retry-same-acknowledgement")
  }
  const result = observeWaiter(page.waitForResponse(row => new URL(row.url()).pathname === path && row.request().method() === "POST", { timeout: 120_000 }))
  const request = observeWaiter(page.waitForRequest(row => new URL(row.url()).pathname === path && row.method() === "POST"))
  await paceEmployeePost(); await page.keyboard.press("Enter")
  const actual = await result, payload = (await request).postDataJSON(), body = await actual.json()
  assert.equal(actual.status(), losing ? 200 : 201); noProtected(JSON.stringify(body))
  assert.deepEqual(Object.keys(payload).sort(), ["clientResponseId", "expectedCaseRevision", "responseCode"])
  assert.equal(payload.responseCode, "ACKNOWLEDGED"); assert.equal(payload.expectedCaseRevision, 0)
  assert.equal(body.success, true); assert.equal(body.idempotent, losing)
  if (losing) {
    assert.equal(payload.clientResponseId, operationId); assert.equal(body.data.responseId, responseId)
    receipts.networkFaultDiagnostics.push({ kind: "COMMITTED_POST_RESPONSE_LOST", injected: true, committedStatus: 201, retryStatus: 200, sameOperation: true, sameResponse: true, duplicateRows: 0 })
  }
  expectedResponses.push({ organizationId: tenant.organization.id, caseId: selected.caseId, agentId: tenant.agent.id, workdayId: selected.workdayId, actorUserId: tenant.principals.employee.id, operationId: payload.clientResponseId, revision: 0, responseId: body.data.responseId })
  await article.getByRole("status").filter({ hasText: translations.acknowledgedForReview }).waitFor()
  assert.equal(await article.getByRole("button", { name: translations.acknowledgeForReview, exact: true }).count(), 0)
  await tabTo(page, correction); await focusedControl(view, correction, "correction-remains-after-acknowledgement")
  await safeScreenshot(page, `${cell.key}-acknowledged.png`)
  const after = await ownProjection(context, tenant)
  assert.equal(after.cases.find(row => row.caseId === selected.caseId).responseState, "ACKNOWLEDGED")
  const noShow = page.getByRole("article").filter({ hasText: tenant.cases.noShow.reference })
  assert.equal(await noShow.getByRole("button").count(), 0); assert.equal(await noShow.getByRole("link").count(), 0)
  if (cell.nativeZoom) await safeScreenshot(page, `${cell.key}-final-own-boundary.png`)
  receipts.cases.push({ name: cell.key, status: "PASS", ownOnlyMinimizedProjection: true, reopenedOldResponseNotAcknowledged: true, keyboardRefreshAndAcknowledgement: true, exactDayCorrectionNavigation: true, noShowViewOnly: true, nativeZoom: Boolean(cell.nativeZoom) })
  await context.close()
}

async function loadFailureAndRecovery(tenant) {
  stage = "injected-load-failure-and-real-refresh"
  const context = await contextFor(tenant.principals.employee)
  const page = await context.newPage(); activePage = page
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000)
  const translations = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")).workforceMyExceptions
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected isolated browser load failure" }) }))
  await page.goto("/workforce/exceptions/mine", { waitUntil: "domcontentloaded" })
  await page.getByRole("alert").filter({ hasText: translations.loadFailed }).waitFor()
  assert.equal(await page.getByRole("article").count(), 0)
  await safeScreenshot(page, "injected-load-failure-original.png")
  await page.unroute(`**${endpoint}`)
  const refresh = page.getByRole("button", { name: translations.refresh, exact: true })
  await tabTo(page, refresh); await focusedControl({ page, locale: "en", width: 1280, nativeZoom: null }, refresh, "load-error-real-refresh")
  const response = observeWaiter(page.waitForResponse(row => new URL(row.url()).pathname === endpoint && row.request().method() === "GET"))
  await page.keyboard.press("Enter"); assert.equal((await response).status(), 200)
  await page.getByRole("article").filter({ hasText: tenant.cases.reopened.reference }).waitFor()
  assert.equal(await page.getByRole("alert").count(), 0)
  await ownProjection(context, tenant)
  await safeScreenshot(page, "injected-load-failure-real-recovery.png")
  receipts.networkFaultDiagnostics.push({ kind: "LOAD_FAILURE", injected: true, injectedStatus: 503, realRefreshStatus: 200, recovery: true })
  receipts.cases.push({ name: "injected-load-failure-real-refresh", status: "PASS", injectedFailure: true })
  await context.close()
}
function ackPayload(revision = 0, clientResponseId = randomUUID()) {
  return { responseCode: "ACKNOWLEDGED", clientResponseId, expectedCaseRevision: revision }
}
async function recordPositive(context, tenant, record, revision) {
  const payload = ackPayload(revision), body = await post(context, record, payload, 201)
  expectedResponses.push({ organizationId: tenant.organization.id, caseId: record.id, agentId: tenant.agent.id, workdayId: record.workday.id, actorUserId: tenant.principals.employee.id, operationId: payload.clientResponseId, revision, responseId: body.data.responseId })
  return { payload, body }
}
async function denialsAndCycles(tenants) {
  stage = "actual-api-ownership-role-flag-and-revision-boundaries"
  const [a, b, off] = tenants
  const employee = await contextFor(a.principals.employee)
  const before = await counts()
  const foreign = await post(employee, b.cases.single, ackPayload(), 404)
  const missing = await post(employee, { id: `missing_${suffix}` }, ackPayload(), 404)
  const noShow = await post(employee, a.cases.noShow, ackPayload(), 404)
  assert.deepEqual(foreign, missing); assert.deepEqual(noShow, missing)
  const stale = await post(employee, a.cases.stale, ackPayload(0), 409)
  assert.equal(stale.code, "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT")
  const resolved = await post(employee, a.cases.resolved, ackPayload(2), 409)
  assert.equal(resolved.code, "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE")
  const extra = await post(employee, a.cases.stale, { ...ackPayload(1), explanation: privateReason }, 400)
  assert.equal(extra.code, "WORKFORCE_EXCEPTION_RESPONSE_INVALID")
  const first = expectedResponses[0]
  const replay = await post(employee, a.cases[matrixCells[0].key], ackPayload(first.revision, first.operationId), 200)
  assert.equal(replay.data.responseId, first.responseId)
  const duplicateCycle = await post(employee, a.cases[matrixCells[0].key], ackPayload(0), 409)
  assert.equal(duplicateCycle.code, "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT")
  await post(employee, a.cases.stale, ackPayload(1, first.operationId), 409)
  const anonymous = await browser.newContext({ baseURL: origin.href, serviceWorkers: "block", extraHTTPHeaders: { "Sec-Fetch-Mode": "cors" } }); contexts.push(anonymous)
  assert.equal((await anonymous.request.get(endpoint, { maxRedirects: 0 })).status(), 401)
  await post(anonymous, a.cases.stale, ackPayload(1), 401)
  for (const [name, expectedStatus] of [["other", 404], ["unlinked", 403], ["viewer", 403], ["admin", 403]]) {
    const context = await contextFor(a.principals[name])
    if (name === "other") {
      const body = await context.request.get(endpoint); assert.equal(body.status(), 200)
      assert.deepEqual((await body.json()).data.cases, [])
    } else if (name === "unlinked" || name === "admin") assert.equal((await context.request.get(endpoint)).status(), 403)
    await post(context, a.cases.stale, ackPayload(1), expectedStatus)
    await context.close()
  }
  const offContext = await contextFor(off.principals.employee)
  // Permission rehearsal is confined to the disposable test DB. Restoring the
  // exact SELECT grants is mandatory even if the flag-off GET fails.
  await admin.$executeRawUnsafe("REVOKE SELECT ON workforce_exception_employee_responses,workforce_exception_decisions FROM wf_manager_today_browser")
  try { await ownProjection(offContext, off, "MIGRATION_REQUIRED") }
  finally { await admin.$executeRawUnsafe("GRANT SELECT ON workforce_exception_employee_responses,workforce_exception_decisions TO wf_manager_today_browser") }
  const offResponse = await post(offContext, off.cases.single, ackPayload(), 409)
  assert.equal(offResponse.code, "WORKFORCE_EXCEPTION_RESPONSE_MIGRATION_REQUIRED")
  const offPage = await offContext.newPage(); activePage = offPage
  await loadPage(offPage)
  await offPage.getByTestId("workforce-my-exceptions-response-boundary").waitFor()
  const offTranslations = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")).workforceMyExceptions
  assert.equal(await offPage.getByRole("button", { name: offTranslations.acknowledgeForReview, exact: true }).count(), 0)
  await safeScreenshot(offPage, "flag-off-own-boundary.png")
  assert.deepEqual(await counts(), before, "Every denied request and exact replay must have zero write/audit delta")
  const reopenedBefore = await ownProjection(employee, a)
  assert.equal(reopenedBefore.cases.find(row => row.caseId === a.cases.reopened.id).responseState, "NOT_ACKNOWLEDGED")
  await recordPositive(employee, a, a.cases.reopened, 3)
  const reopenedAfter = await ownProjection(employee, a)
  assert.equal(reopenedAfter.cases.find(row => row.caseId === a.cases.reopened.id).responseState, "ACKNOWLEDGED")
  const otherTenant = await contextFor(b.principals.employee)
  await ownProjection(otherTenant, b)
  assert.deepEqual(await post(otherTenant, a.cases.stale, ackPayload(1), 404), missing)
  await recordPositive(otherTenant, b, b.cases.single, 0)
  receipts.cases.push({ name: "actual-self-boundaries-and-two-positive-tenants", status: "PASS", anonymous401: true, foreignAndMissing404Indistinguishable: true, linkedOtherEmployee404: true, unlinkedAndAdminSelf403: true, viewerWrite403: true, flagOff409AndNoLedgerRead: true, unknownFreeText400WithoutEcho: true, staleAndResolved409: true, replay200NoDuplicate: true, reopenedOldResponseExcludedAndNewCycleRecorded: true })
  await employee.close(); await otherTenant.close(); await offContext.close(); await anonymous.close()
}
async function rollbackProof(client, statement, params, expected, organizationId) {
  let actual
  try {
    await client.$transaction(async tx => {
      if (organizationId) await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`
      await tx.$executeRawUnsafe(statement, ...params)
      throw new Error("UNEXPECTED_SUCCESS_ROLLBACK")
    })
  } catch (error) { actual = error?.meta?.code || null }
  receipts.databaseDiagnostics.push({ expectedSqlState: expected, actualSqlState: actual, rolledBack: true })
  assert.equal(actual, expected)
}
async function databaseProof(tenants) {
  stage = "actual-disposable-response-cycle-audit-and-forced-rls"
  const [role] = await app.$queryRawUnsafe("SELECT current_user AS name,r.rolsuper,r.rolbypassrls,r.rolinherit,current_setting('app.rls_bypass',true) AS bypass FROM pg_roles r WHERE rolname=current_user")
  assert.equal(role.name, "wf_manager_today_browser"); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false); assert.equal(role.rolinherit, false); assert.notEqual(role.bypass, "on")
  for (const table of ["workforce_exception_cases", "workforce_exception_decisions", "workforce_exception_employee_responses", "mtm_audit_logs"]) {
    const [metadata] = await app.$queryRawUnsafe("SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass", `public.${table}`)
    assert.equal(metadata.enabled, true); assert.equal(metadata.forced, true); assert.notEqual(metadata.owner, role.name)
    const [empty] = await app.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}"`)
    assert.equal(Number(empty.count), 0)
    for (const tenant of tenants.slice(0, 2)) await app.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${tenant.organization.id}, true)`
      const foreign = tenants.find(other => other !== tenant)
      const [excluded] = await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, foreign.organization.id)
      assert.equal(Number(excluded.count), 0)
      const [own] = await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, tenant.organization.id)
      if (table !== "workforce_exception_decisions" || tenant === tenants[0]) assert.ok(Number(own.count) > 0)
    })
  }
  const audits = await admin.mtmAuditLog.findMany({ orderBy: { id: "asc" } })
  assert.deepEqual(await counts(), { responses: expectedResponses.length + 1, audit: expectedResponses.length })
  assert.equal(audits.length, expectedResponses.length)
  for (const write of expectedResponses) {
    const response = await admin.workforceExceptionEmployeeResponse.findUnique({ where: { id: write.responseId } })
    assert.ok(response)
    for (const key of ["organizationId", "caseId", "agentId", "workdayId", "actorUserId"]) assert.equal(response[key], write[key])
    assert.equal(response.responseCode, "ACKNOWLEDGED"); assert.equal(response.clientResponseId, write.operationId); assert.equal(response.observedCaseRevision, write.revision)
    assert.equal(response.segmentId, null); assert.equal(response.correctionRequestId, null)
    const audit = audits.find(row => row.entityId === response.id)
    assert.ok(audit); assert.equal(audit.organizationId, response.organizationId); assert.equal(audit.agentId, response.agentId)
    assert.equal(audit.action, "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RECORDED"); assert.equal(audit.entity, "workforce_exception_employee_response")
    assert.equal(audit.metadataKind, "workforce_exception_employee_response"); assert.equal(audit.oldData, null); assert.equal(audit.ipAddress, null); assert.equal(audit.userAgent, null)
    assert.deepEqual(audit.newData, { caseId: write.caseId, workdayId: write.workdayId, observedCaseRevision: write.revision, segmentLinked: false, correctionRequested: false })
    noProtected(JSON.stringify(audit))
  }
  const first = expectedResponses[0]
  await rollbackProof(admin, 'UPDATE workforce_exception_employee_responses SET "responseCode"=\'changed\' WHERE id=$1', [first.responseId], "55000")
  await rollbackProof(admin, 'DELETE FROM workforce_exception_employee_responses WHERE id=$1', [first.responseId], "55000")
  await rollbackProof(admin, 'UPDATE mtm_audit_logs SET action=\'changed\' WHERE "entityId"=$1', [first.responseId], "55000")
  await rollbackProof(admin, 'DELETE FROM mtm_audit_logs WHERE "entityId"=$1', [first.responseId], "55000")
  await rollbackProof(app, 'UPDATE workforce_exception_employee_responses SET "responseCode"=\'changed\' WHERE id=$1', [first.responseId], "42501", first.organizationId)
  await rollbackProof(app, 'DELETE FROM workforce_exception_employee_responses WHERE id=$1', [first.responseId], "42501", first.organizationId)
  await rollbackProof(admin, `INSERT INTO workforce_exception_employee_responses(id,"organizationId","caseId","agentId","workdayId","responseCode","clientResponseId","actorUserId","observedCaseRevision","createdAt") SELECT $2,"organizationId","caseId","agentId","workdayId","responseCode",$3,"actorUserId","observedCaseRevision",now() FROM workforce_exception_employee_responses WHERE id=$1`, [first.responseId, `duplicate_${suffix}`, `duplicate-client-${suffix}`], "23505")
  const foreign = tenants[1]
  await rollbackProof(admin, `INSERT INTO workforce_exception_employee_responses(id,"organizationId","caseId","agentId","workdayId","responseCode","clientResponseId","actorUserId","observedCaseRevision","createdAt") VALUES ($1,$2,$3,$4,$5,'ACKNOWLEDGED',$6,$7,0,now())`, [`foreign_${suffix}`, first.organizationId, first.caseId, foreign.agent.id, first.workdayId, `foreign-client-${suffix}`, first.actorUserId], "23514")
  assert.deepEqual(await counts(), { responses: expectedResponses.length + 1, audit: expectedResponses.length })
  assert.deepEqual(await fixedFacts(tenants), initialFacts)
  receipts.fixedFacts = { unchanged: true, tables: initialFacts }
  receipts.database = { nonownerForcedRls: true, unscopedRows: 0, foreignRows: 0, populatedResponseAndAuditControlsInTwoTenants: true, actualNewResponses: expectedResponses.length, actualNewAudits: audits.length, historicalResponses: 1, exactAuditLinkAndFiveMetadataKeys: true, exactProductionResponseImmutability: true, cycleUniqueRollbackSqlState: "23505", syntheticAuditGuard: true, defaultAclReviewed: false, fullHistoricalReplay: false }
}
function safeFailure(error) {
  const frame = String(error?.stack || "").split("\n").find(line => line.includes(import.meta.url))
  const position = frame?.match(/:(\d+):(\d+)\)?$/)
  return { stage, name: ["AssertionError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(error?.name) ? error.name : "Error",
    sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
    sqlState: typeof error?.meta?.code === "string" && /^[A-Z0-9]{5}$/.test(error.meta.code) ? error.meta.code : null,
    prismaCode: typeof error?.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : null }
}
try {
  for (const path of ["scripts/workforce-employee-exception-browser-evidence.mjs", "scripts/workforce-employee-exception-browser-admission.mjs", "src/__tests__/workforce-employee-exception-browser-admission.test.ts", "scripts/workforce-native-browser-zoom.mjs", "scripts/ci/fixtures/workforce-native-zoom-extension/manifest.json", "scripts/ci/fixtures/workforce-native-zoom-extension/background.js", "scripts/ci/fixtures/workforce-employee-exception-browser.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql", ".github/workflows/workforce-exception-report-browser-evidence.yml", "src/components/workforce/workforce-my-exceptions.tsx", "src/app/(dashboard)/workforce/exceptions/mine/page.tsx", "src/app/api/v1/workforce/exceptions/mine/route.ts", "src/app/api/v1/workforce/exceptions/[id]/response/route.ts", "src/lib/workforce/exception-employee-response-writer.ts", "src/lib/workforce/exception-employee-response-rate-limit.ts", "src/lib/workforce/exception-response-operation.ts", "src/lib/workforce/exception-response-rollout.ts", "src/lib/workforce/exception-workbench.ts", "src/lib/workforce/actor.ts", "src/lib/with-workforce-rls-auth.ts", "src/lib/auth.ts", "src/lib/permissions.ts", "src/lib/workforce/sensitive-response.ts", "prisma/schema.prisma", "prisma/migrations/20260830170000_workforce_exception_case_lifecycle/migration.sql", "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql", "prisma/migrations/20260830200000_workforce_exception_employee_responses/migration.sql", "prisma/migrations/20260928123000_workforce_exception_response_cycle_unique_index/migration.sql", "messages/az.json", "messages/ru.json", "messages/en.json"]) {
    const raw = await readFile(new URL(`../${path}`, import.meta.url))
    receipts.sources.push({ path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") })
  }
  await installProductionRoutines()
  const tenants = await seed(); initialFacts = await fixedFacts(tenants)
  assert.deepEqual(await counts(), { responses: 1, audit: 0 })
  browser = await chromium.launch({ headless: true })
  await loadFailureAndRecovery(tenants[0])
  for (const cell of matrixCells) await uiScenario(tenants[0], cell)
  await denialsAndCycles(tenants)
  await databaseProof(tenants)
  const completedMatrix = receipts.cases.filter(row => matrixCells.some(cell => cell.key === row.name))
  assert.deepEqual(new Set(completedMatrix.map(row => row.name)), new Set(matrixCells.map(cell => cell.key)))
  assert.equal(completedMatrix.length, 12); assert.equal(expectedResponses.length, 14)
  assert.equal(receipts.cases.length, 14)
  assert.equal(receipts.nativeZoomDiagnostics.length, 3)
  assert.ok(receipts.nativeZoomDiagnostics.every(row => row.status === "PASS" && row.factor === 2))
  assert.equal(receipts.nativeCaptureDiagnostics.length, 21)
  assert.ok(receipts.nativeCaptureDiagnostics.every(row => row.status === "PASS"))
  assert.equal(receipts.keyboardFocusDiagnostics.length, 50)
  assert.equal(receipts.networkFaultDiagnostics.length, 2)
  assert.ok(receipts.captureDiagnostics.length >= 42)
  receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"; process.exitCode = 1; receipts.failure = safeFailure(error)
  receipts.failure.diagnostic = "Original failure retained; raw private bodies, tokens, credentials and cookies omitted"
  if (activePage && !activePage.isClosed()) try {
    await safeScreenshot(activePage, "failure-original.png"); receipts.failure.screenshot = "failure-original.png"
  } catch { receipts.failure.screenshot = "NOT_CAPTURED_PRIVATE_OR_UNAVAILABLE"; receipts.failure.originalPixelsOrDomAltered = false }
} finally {
  async function closeResource(resource, operation) {
    try { await operation(); receipts.cleanupDiagnostics.push({ resource, status: "PASS" }) }
    catch (error) { receipts.cleanupDiagnostics.push({ resource, status: "FAIL", ...safeFailure(error) }) }
  }
  for (const [index, owned] of nativeZoomContexts.entries()) await closeResource(`native-profile-${index + 1}`, () => owned.dispose())
  for (const [index, context] of contexts.entries()) await closeResource(`browser-context-${index + 1}`, () => context.close())
  if (browser) await closeResource("browser", () => browser.close())
  await closeResource("app-prisma", () => app.$disconnect()); await closeResource("admin-prisma", () => admin.$disconnect())
  receipts.cleanup = receipts.cleanupDiagnostics.every(row => row.status === "PASS") ? "PASS" : "FAIL"
  if (receipts.cleanup === "FAIL") { receipts.status = "FAIL"; process.exitCode = 1 }
  receipts.completedAt = new Date().toISOString()
  noProtected(JSON.stringify(receipts))
  await writeFile(`${outputDirectory}/employee-exception-receipt.json`, JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: receipts.status, completedCases: receipts.cases.length, cleanup: receipts.cleanup }))
}
