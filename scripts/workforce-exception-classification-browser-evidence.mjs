import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Separate hosted synthetic write rehearsal; never a production seed or activation tool.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Hosted Actions required")
assert.equal(process.env.CI, "true", "Explicit CI required")
assert.equal(process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER, "1", "Fixture opt-in required")
assert.notEqual(process.env.NODE_ENV, "production", "Production excluded")
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const origin = new URL(process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER_BASE_URL)
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname), "Loopback application required")
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname), "Loopback fixture database required")
  assert.equal(url.pathname, "/workforce_manager_today_browser")
  assert.equal(url.username, role)
  return url
}
const adminURL = database(process.env.ADMIN_DATABASE_URL, "postgres")
const appURL = database(process.env.DATABASE_URL, "wf_manager_today_browser")
const fenceURL = database(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres")
assert.equal(adminURL.host, appURL.host)
assert.equal(adminURL.protocol, appURL.protocol)
assert.equal(adminURL.search, appURL.search)
assert.equal(fenceURL.href, adminURL.href)
const redisURL = new URL(process.env.REDIS_URL)
assert.equal(redisURL.protocol, "redis:")
assert.ok(loopback.has(redisURL.hostname), "Real disposable loopback Redis required")
assert.match(process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER_HEAD_SHA || "", /^[a-f0-9]{40}$/)
assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/)
const outputDirectory = process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER_OUTPUT_DIR || "artifacts/workforce-exception-classification-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`
const reason = "PRIVATE_CLASSIFICATION_BROWSER_HR_REASON"
const at = new Date("2025-01-01T00:00:00Z")
const now = new Date()
const endpoint = "/api/v1/workforce/exception-decisions"
const queueEndpoint = "/api/v1/workforce/exceptions"
const contexts = [], expectedWrites = [], protectedMarkers = [reason]
let browser, activePage, stage = "fixture-preparing"
const receipts = {
  version: 1, candidateHead: process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA, startedAt: now.toISOString(),
  environment: "hosted Chromium / real Auth.js / loopback Next dev / disposable PostgreSQL16 and Redis",
  status: "RUNNING", cases: [], sources: [], productionRoutines: [], authenticationDiagnostics: [],
  limitations: ["Synthetic isolated tenants and imported historical terminal decisions only", "Development bundle, not production build", "Exact production decision revision and append-only routines; no full migration replay", "Audit whitelist/append-only fixture guard is synthetic, not a production MtmAuditLog migration", "No live HR observation, physical presence, device, pilot, payroll or disciplinary evidence", "No production mutation, grants, activation, secret/access change or external message"],
}
function noProtected(value) {
  for (const marker of protectedMarkers) assert.equal(value.includes(marker), false, "Protected reason or database subject leaked")
}
const authenticationPostTimes = []
async function assertSession(context, principal) {
  const response = await context.request.get("/api/auth/session", { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const session = await response.json()
  assert.equal(session.user.id, principal.id)
  assert.equal(session.user.organizationId, principal.organizationId)
}
async function authenticate(context, principal) {
  const diagnostic = { ordinal: receipts.authenticationDiagnostics.length + 1, csrfStatus: null, callbackStatus: null, pacingWaitMs: 0 }
  receipts.authenticationDiagnostics.push(diagnostic)
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
  diagnostic.csrfStatus = csrf.status(); assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string")
  const windowMs = 61_000
  const prune = () => { while (authenticationPostTimes.length && authenticationPostTimes[0] <= Date.now() - windowMs) authenticationPostTimes.shift() }
  prune()
  if (authenticationPostTimes.length >= 8) {
    diagnostic.pacingWaitMs = Math.max(0, authenticationPostTimes[0] + windowMs - Date.now()) + 25
    assert.ok(diagnostic.pacingWaitMs <= 62_000)
    await new Promise(resolve => setTimeout(resolve, diagnostic.pacingWaitMs)); prune()
  }
  assert.ok(authenticationPostTimes.length < 8)
  authenticationPostTimes.push(Date.now())
  const response = await context.request.post("/api/auth/callback/credentials", {
    timeout: 120_000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: `${origin.href}workforce/exceptions` },
  })
  diagnostic.callbackStatus = response.status(); assert.equal(response.status(), 200)
  const redirect = new URL((await response.json()).url, origin.href)
  assert.equal(redirect.origin, origin.origin); assert.equal(redirect.searchParams.get("error"), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith("authjs.session-token")))
  await assertSession(context, principal)
}
async function contextFor(principal, locale = "en", width = 1280) {
  const context = await browser.newContext({ baseURL: origin.href, locale: "en-US", viewport: { width, height: 900 }, serviceWorkers: "block" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.href }])
  await authenticate(context, principal)
  return context
}
function extract(source, start, end = ";") {
  const from = source.indexOf(start), to = from < 0 ? -1 : source.indexOf(end, from)
  assert.ok(from >= 0 && to >= from, "Exact production statement required")
  return source.slice(from, to + end.length)
}
async function installProductionRoutines() {
  const lifecyclePath = "prisma/migrations/20260830170000_workforce_exception_case_lifecycle/migration.sql"
  const revisionsPath = "prisma/migrations/20260927014000_workforce_exception_case_revisions/migration.sql"
  const lifecycle = await readFile(new URL(`../${lifecyclePath}`, import.meta.url), "utf8")
  const revisions = await readFile(new URL(`../${revisionsPath}`, import.meta.url), "utf8")
  const statements = [
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_case_mutation(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation(", "\n$$;")],
    [revisionsPath, extract(revisions, "CREATE OR REPLACE FUNCTION workforce_next_exception_compatibility_timestamp(", "\n$$;")],
    [revisionsPath, extract(revisions, "CREATE OR REPLACE FUNCTION workforce_assign_exception_decision_revision(", "\n$$;")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_cases_append_only")],
    [lifecyclePath, extract(lifecycle, "CREATE TRIGGER workforce_exception_decisions_append_only")],
    [revisionsPath, extract(revisions, "CREATE TRIGGER workforce_exception_decisions_assign_case_revision")],
  ]
  receipts.productionRoutineInstallation = { status: "PENDING", replacements: [] }
  try {
    await admin.$transaction(async tx => {
      // The unmodified Today fixture already creates these exact named
      // append-only triggers. Replace only those fixture-owned objects inside
      // one disposable transaction; failure restores the original guards.
      const [target] = await tx.$queryRaw`SELECT current_database() AS name, current_user AS role`
      assert.equal(target.name, "workforce_manager_today_browser")
      assert.equal(target.role, "postgres")
      for (const [table, trigger] of [["workforce_exception_cases", "workforce_exception_cases_append_only"], ["workforce_exception_decisions", "workforce_exception_decisions_append_only"]]) {
        const [existing] = await tx.$queryRawUnsafe("SELECT t.tgenabled::text AS enabled, t.tgisinternal AS internal FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2", `public.${table}`, trigger)
        assert.ok(existing && existing.enabled === "O" && existing.internal === false, "Existing fixture append-only guard required")
        // Names are the two fixed identifiers above; no user input enters DDL.
        await tx.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON public."${table}"`)
        receipts.productionRoutineInstallation.replacements.push({ table, trigger })
      }
      for (const [path, statement] of statements) {
        await tx.$executeRawUnsafe(statement)
        receipts.productionRoutines.push({ path, sha256: createHash("sha256").update(statement).digest("hex"), bytes: Buffer.byteLength(statement) })
      }
    })
    receipts.productionRoutineInstallation.status = "COMMITTED"
  } catch (error) {
    receipts.productionRoutineInstallation.status = "ROLLED_BACK"
    throw error
  }
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 4)
  const tenants = []
  for (const key of ["a", "b"]) {
    const organization = await admin.organization.create({ data: {
      name: `Classification fixture ${key}`, slug: `wf-classification-${suffix}-${key}`, plan: "enterprise",
      modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"], settings: {},
    } })
    const principals = {}
    for (const name of ["issuer", "hr", ...(key === "a" ? ["team", "tenant", "denied"] : [])]) {
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `classification-${suffix}-${key}-${name}@example.test`, name: `Fixture ${key} ${name}`,
        passwordHash, role: name === "issuer" ? "admin" : "manager", require2fa: false, totpEnabled: false, smsAuthEnabled: false,
      } })
      principals[name] = { ...user, slug: organization.slug }
    }
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Fixture ${key} team`, code: `CLASS-${suffix}-${key}`, isActive: true } })
    const agent = await admin.mtmAgent.create({ data: { organizationId: organization.id, teamId: team.id, name: `Synthetic classification employee ${key}`, role: "AGENT", status: "ACTIVE" } })
    await admin.workforceEmployeeTeamMembership.create({ data: { organizationId: organization.id, agentId: agent.id, teamId: team.id, effectiveAt: new Date("2024-01-01T00:00:00Z"), source: "BROWSER_FIXTURE_ONLY" } })
    const workday = await admin.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: agent.id, workDate: at, status: "COMPLETED", startedAt: new Date(at.getTime() + 28_800_000), completedAt: new Date(at.getTime() + 61_200_000), totalPausedSeconds: 0 } })
    await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
    let hrGrant
    for (const [name, role, scopeKind] of [["hr", "HR_ADMIN", "ORGANIZATION"], ...(key === "a" ? [["hr", "TEAM_MANAGER", "TEAM"], ["team", "TEAM_MANAGER", "TEAM"], ["tenant", "TENANT_ADMIN", "ORGANIZATION"]] : [])]) {
      const grant = await admin.workforceAccessGrant.create({ data: {
        organizationId: organization.id, principalUserId: principals[name].id, role, scopeKind,
        scopeTeamId: scopeKind === "TEAM" ? team.id : null, scopeSiteId: null, scopeAgentId: null,
        effectiveFrom: new Date(now.getTime() - 86_400_000), operationId: `class-${suffix}-${key}-${name}-${role}`,
        grantedByUserId: principals.issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
      } })
      if (role === "HR_ADMIN") hrGrant = grant
    }
    const cases = {}
    for (const label of key === "a" ? ["ru", "az", "en", "stale", "reopened"] : ["foreign"]) {
      const record = await admin.workforceExceptionCase.create({ data: {
        organizationId: organization.id, agentId: agent.id, workdayId: workday.id, kind: "LATE_START", detectorVersion: "classification-browser-history-v1",
        deduplicationKey: createHash("sha256").update(`${suffix}-${key}-${label}`).digest("hex"), createdAt: at,
      } })
      const entries = ["ACKNOWLEDGE", "RESOLVE_NO_CHANGE", ...(label === "reopened" ? ["CLASSIFY_FALSE_POSITIVE", "APPEAL_FULLY_UPHELD", "REOPEN_FOR_REVIEW"] : [])]
      for (const [index, decisionCode] of entries.entries()) await admin.workforceExceptionDecision.create({ data: {
        organizationId: organization.id, caseId: record.id, caseRevision: index + 1,
        operationId: `class-${suffix}-${key}-${label}-${index}`, decisionCode, reason: "PRIVATE_CLASSIFICATION_HISTORICAL_REASON",
        actorUserId: principals.hr.id, createdAt: new Date(at.getTime() + index * 1_000),
      } })
      await admin.$executeRaw`INSERT INTO wf_classification_browser_allowed_cases("organizationId","caseId","actorUserId") VALUES (${organization.id},${record.id},${principals.hr.id})`
      cases[label] = { ...record, reference: `WF-${record.id.slice(-8)}` }
      protectedMarkers.push(record.id)
    }
    protectedMarkers.push(workday.id, agent.id)
    tenants.push({ key, organization, ...principals, teamResource: team, hrGrant, cases })
  }
  protectedMarkers.push("PRIVATE_CLASSIFICATION_HISTORICAL_REASON")
  await installProductionRoutines()
  return tenants
}
async function queue(context, expectedStatus = 200) {
  const response = await context.request.get(queueEndpoint, { timeout: 120_000 })
  assert.equal(response.status(), expectedStatus)
  assert.match(response.headers()["cache-control"] || "", /no-store/)
  const body = await response.json(); noProtected(JSON.stringify(body))
  if (expectedStatus === 200) { assert.equal(body.success, true); assert.ok(Array.isArray(body.data.cases)); return body.data.cases }
  return body
}
function itemFor(items, record) {
  const item = items.find(item => item.displayReference === record.reference)
  assert.ok(item, "Exact known case reference required")
  return item
}
function actionFor(item, decisionCode) {
  const action = item.outcomeContext?.actions.find(action => action.decisionCode === decisionCode)
  assert.ok(action && typeof action.actionToken === "string")
  return action
}
async function post(context, data, status) {
  const response = await context.request.post(endpoint, { data, timeout: 120_000 })
  assert.equal(response.status(), status)
  assert.match(response.headers()["cache-control"] || "", /no-store/)
  const body = await response.json(); noProtected(JSON.stringify(body))
  return body
}
async function decisionCounts() {
  return { decisions: await admin.workforceExceptionDecision.count(), audit: await admin.mtmAuditLog.count() }
}
async function fixedFacts(tenants) {
  const tables = ["workforce_exception_cases", "mtm_agents", "mtm_agent_workdays", "workforce_employee_team_memberships", "workforce_access_grants", "mtm_hrm_requests", "workforce_time_corrections", "workforce_exception_employee_responses"]
  const result = []
  for (const table of tables) {
    const rows = await admin.$queryRawUnsafe(`SELECT row_to_json(t) AS value FROM public."${table}" t WHERE "organizationId" IN ($1,$2) ORDER BY id LIMIT 101`, ...tenants.map(t => t.organization.id))
    assert.ok(rows.length <= 100)
    result.push({ table, rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") })
  }
  return result
}
async function uiScenario(tenant, locale, width, classificationCode, appealCode) {
  stage = `ui-${locale}-authenticate`
  const ui = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).workforceExceptionQueue
  const context = await contextFor(tenant.hr, locale, width)
  const page = await context.newPage(); activePage = page
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000)
  const response = page.waitForResponse(r => new URL(r.url()).pathname === queueEndpoint && r.request().method() === "GET", { timeout: 120_000 })
  await page.goto("/workforce/exceptions", { waitUntil: "domcontentloaded" })
  assert.equal((await response).status(), 200)
  const record = tenant.cases[locale]
  for (const code of [classificationCode, appealCode]) {
    stage = `ui-${locale}-${code}`
    const items = await queue(context), item = itemFor(items, record), action = actionFor(item, code)
    assert.equal(item.stage, "RESOLVED")
    const row = page.getByRole("row").filter({ hasText: record.reference }).filter({ has: page.getByTestId("workforce-exception-actions") })
    await row.getByRole("button", { name: ui.actions[code], exact: true }).click()
    const panel = page.getByTestId("workforce-exception-action-panel")
    const textarea = panel.locator('textarea[name="reason"]')
    await textarea.waitFor({ state: "visible" })
    assert.equal(await textarea.getAttribute("required"), "")
    let posts = 0
    const count = request => { if (new URL(request.url()).pathname === endpoint && request.method() === "POST") posts++ }
    page.on("request", count)
    await panel.getByRole("button", { name: ui.recordAction, exact: true }).click()
    assert.equal(posts, 0, "Empty reason cannot submit")
    await textarea.fill(reason)
    const committed = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === "POST", { timeout: 120_000 })
    const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === queueEndpoint && r.request().method() === "GET", { timeout: 120_000 })
    await panel.getByRole("button", { name: ui.recordAction, exact: true }).click()
    const writeResponse = await committed
    assert.equal(writeResponse.status(), 201)
    const body = await writeResponse.json(); noProtected(JSON.stringify(body)); assert.equal(body.data.decisionCode, code)
    const payload = writeResponse.request().postDataJSON()
    assert.deepEqual(Object.keys(payload).sort(), ["actionToken", "operationId", "reason"])
    assert.equal(payload.reason, reason)
    assert.equal((await refreshed).status(), 200)
    page.off("request", count)
    expectedWrites.push({ organizationId: tenant.organization.id, caseId: record.id, actorUserId: tenant.hr.id, code, operationId: payload.operationId })
    await page.getByRole("status").filter({ hasText: ui.actions[code] }).waitFor({ state: "visible" })
    if (locale === "en" && code === classificationCode) {
      const before = await decisionCounts()
      const replay = await post(context, payload, 200); assert.equal(replay.idempotent, true)
      await post(context, { ...payload, reason: `${reason}_CHANGED` }, 409)
      await post(context, { ...payload, operationId: randomUUID() }, 409)
      assert.deepEqual(await decisionCounts(), before)
      receipts.cases.push({ name: "exact-replay-and-conflicting-reason-and-stale-revision", status: "PASS", auditDeltaOnRetry: 0, decisionDeltaOnRetry: 0 })
    }
    // Queue does not expose protected reason even after it is durably recorded.
    noProtected(JSON.stringify(await queue(context)))
    assert.equal(action.decisionCode, code)
  }
  const final = itemFor(await queue(context), record)
  assert.equal(final.outcomeContext.classification, classificationCode === "CLASSIFY_FALSE_POSITIVE" ? "FALSE_POSITIVE" : "CONFIRMED_EXCEPTION")
  assert.equal(final.outcomeContext.appeal, appealCode.replace("APPEAL_", ""))
  assert.deepEqual(final.outcomeContext.actions, [])
  await page.screenshot({ path: `${outputDirectory}/classification-${locale}-${width}.png`, fullPage: true })
  await assertSession(context, tenant.hr)
  receipts.cases.push({ name: `real-ui-${locale}-${width}`, status: "PASS", classificationCode, appealCode, protectedReasonRequired: true, directCallerCaseOrCodeAbsent: true })
  return context
}
async function denials(tenants, hrContext) {
  const [a,b] = tenants
  const token = actionFor(itemFor(await queue(hrContext), a.cases.stale), "CLASSIFY_FALSE_POSITIVE").actionToken
  const data = { actionToken: token, operationId: randomUUID(), reason }
  for (const [name, principal, queueStatus] of [["team-manager",a.team,200],["tenant-admin",a.tenant,403],["ungranted",a.denied,403],["foreign-hr",b.hr,200]]) {
    stage = `denied-${name}`
    const context = await contextFor(principal)
    const items = await queue(context, queueStatus)
    if (queueStatus === 200) {
      if (name === "team-manager") { assert.ok(items.length > 0); assert.ok(items.every(item => item.outcomeContext.actions.length === 0)) }
      if (name === "foreign-hr") { assert.ok(items.length > 0); assert.equal(items.some(item => item.displayReference === a.cases.stale.reference), false) }
    }
    const before = await decisionCounts(); await post(context, data, 404)
    assert.deepEqual(await decisionCounts(), before)
    receipts.cases.push({ name: `denied-${name}`, status: "PASS", writeStatus: 404, recordedDelta: 0 })
    await context.close()
  }
  stage = "reopened-historical-classification-excluded"
  const reopened = itemFor(await queue(hrContext), a.cases.reopened)
  assert.equal(reopened.stage, "HR_REVIEW")
  assert.deepEqual(reopened.outcomeContext, { classification: null, appeal: null, actions: [] })
  receipts.cases.push({ name: "reopen-invalidates-final-classification", status: "PASS" })
  stage = "revoked-hr-preserves-manager-only"
  await admin.workforceAccessGrantRevocation.create({ data: {
    organizationId:a.organization.id,grantId:a.hrGrant.id,operationId:`class-${suffix}-revoke`,revokedByUserId:a.issuer.id,revocationReasonCode:"BROWSER_FIXTURE_ONLY",revokedAt:new Date(),
  } })
  const before = await decisionCounts(); await post(hrContext,data,404)
  assert.deepEqual(await decisionCounts(),before)
  const remaining = await queue(hrContext)
  assert.ok(remaining.length > 0); assert.ok(remaining.every(item => item.outcomeContext.actions.length === 0))
  receipts.cases.push({ name:"live-hr-revocation-with-team-manager-still-effective",status:"PASS",writeStatus:404,recordedDelta:0 })
}
async function databaseProof(tenants) {
  stage = "database-rls-audit-and-append-only"
  const [role] = await app.$queryRawUnsafe("SELECT current_user AS name,r.rolsuper,r.rolbypassrls,r.rolinherit,current_setting('app.rls_bypass',true) AS bypass FROM pg_roles r WHERE rolname=current_user")
  assert.equal(role.name,"wf_manager_today_browser"); assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolinherit,false);assert.notEqual(role.bypass,"on")
  const tables = ["workforce_exception_cases","workforce_exception_decisions","mtm_audit_logs"]
  for (const table of tables) {
    const [meta] = await app.$queryRawUnsafe("SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass",`public.${table}`)
    assert.equal(meta.enabled,true);assert.equal(meta.forced,true);assert.notEqual(meta.owner,role.name)
    const [empty] = await app.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}"`);assert.equal(Number(empty.count),0)
    for (const tenant of tenants) await app.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${tenant.organization.id}, true)`
      const foreign=tenants.find(other=>other.key!==tenant.key)
      const [excluded]=await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`,foreign.organization.id)
      assert.equal(Number(excluded.count),0)
      if(table!=="mtm_audit_logs" || tenant.key==="a") {
        const [own]=await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`,tenant.organization.id)
        assert.ok(Number(own.count)>0)
      }
    })
  }
  const audits=await admin.mtmAuditLog.findMany({orderBy:{id:"asc"}})
  assert.equal(audits.length,expectedWrites.length)
  for(const write of expectedWrites) {
    const decision=await admin.workforceExceptionDecision.findFirst({where:{organizationId:write.organizationId,operationId:write.operationId}})
    assert.ok(decision);assert.equal(decision.caseId,write.caseId);assert.equal(decision.actorUserId,write.actorUserId);assert.equal(decision.decisionCode,write.code);assert.equal(decision.reason,reason)
    const audit=audits.find(row=>row.entityId===decision.id)
    assert.ok(audit);assert.equal(audit.agentId,null);assert.equal(audit.ipAddress,null);assert.equal(audit.userAgent,null)
    assert.deepEqual(audit.newData,{caseId:write.caseId,operationId:write.operationId,decisionCode:write.code,caseRevision:decision.caseRevision,policyMode:"REVIEWED_V1"})
    assert.equal(JSON.stringify(audit.newData).includes(reason),false)
  }
  for(const [statement,expected] of [[`UPDATE workforce_exception_decisions SET reason='changed' WHERE "operationId"=$1`,"55000"],[`DELETE FROM workforce_exception_decisions WHERE "operationId"=$1`,"55000"],[`UPDATE mtm_audit_logs SET action='changed' WHERE "entityId"=$1`,"55000"]]) {
    const decision=await admin.workforceExceptionDecision.findFirst({where:{operationId:expectedWrites[0].operationId}})
    let code
    try {await admin.$executeRawUnsafe(statement,statement.includes("mtm_audit_logs")?decision.id:expectedWrites[0].operationId)}catch(error){code=error.meta?.code}
    assert.equal(code,expected)
  }
  receipts.database={nonownerForcedRls:true,populatedTwoTenantDecisionControls:true,unscopedRows:0,foreignRows:0,actualNewDecisionCount:expectedWrites.length,actualAuditCount:audits.length,exactActorReasonAndAuditLink:true,exactProductionDecisionImmutability:true,syntheticAuditGuard:true}
}
try {
  for(const path of ["scripts/workforce-exception-classification-browser-evidence.mjs","scripts/ci/fixtures/workforce-exception-classification-browser.sql","scripts/ci/fixtures/workforce-manager-today-browser.sql",".github/workflows/workforce-exception-report-browser-evidence.yml","src/components/workforce/workforce-exception-queue.tsx","src/app/api/v1/workforce/exceptions/route.ts","src/app/api/v1/workforce/exception-decisions/route.ts","src/lib/workforce/exception-outcome-classification.ts","src/lib/workforce/exception-decision-service.ts","src/lib/workforce/exception-case-writer.ts","src/lib/workforce/exception-policy-draft.ts","messages/en.json","messages/ru.json","messages/az.json"]) {
    const raw=await readFile(new URL(`../${path}`,import.meta.url));receipts.sources.push({path,bytes:raw.length,sha256:createHash("sha256").update(raw).digest("hex")})
  }
  const tenants=await seed(),before=await fixedFacts(tenants)
  browser=await chromium.launch({headless:true})
  let hrContext
  for(const [locale,width,classification,appeal] of [["ru",320,"CLASSIFY_FALSE_POSITIVE","APPEAL_FULLY_UPHELD"],["az",768,"CLASSIFY_CONFIRMED_EXCEPTION","APPEAL_PARTIALLY_UPHELD"],["en",1440,"CLASSIFY_CONFIRMED_EXCEPTION","APPEAL_REJECTED"]]) hrContext=await uiScenario(tenants[0],locale,width,classification,appeal)
  assert.deepEqual(await fixedFacts(tenants),before,"Classification may append decisions/audit, but cannot change original business facts, grants or corrections")
  receipts.fixedFacts={phase:"after-six-ui-appends-before-intentional-fixture-revocation",unchanged:true,tables:before}
  await denials(tenants,hrContext)
  await databaseProof(tenants)
  assert.equal(expectedWrites.length,6);assert.equal(receipts.cases.length,10)
  receipts.status="PASS"
}catch(error){
  receipts.status="FAIL";process.exitCode=1
  const sourceFrame=String(error?.stack||"").split("\n").find(line=>line.includes(import.meta.url))
  const position=sourceFrame?.match(/:(\d+):(\d+)\)?$/)
  const sqlState = typeof error?.meta?.code === "string" && /^[A-Z0-9]{5}$/.test(error.meta.code) ? error.meta.code : null
  const prismaCode = typeof error?.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : null
  receipts.failure={stage,name:["AssertionError","TimeoutError","PrismaClientKnownRequestError","PrismaClientValidationError"].includes(error?.name)?error.name:"Error",sourcePosition:position?{line:Number(position[1]),column:Number(position[2])}:null,sqlState,prismaCode,diagnostic:"Original failure retained; protected raw bodies, tokens, reason, credentials and cookies omitted"}
  if(activePage&&!activePage.isClosed())try{
    await activePage.locator('textarea[name="reason"]').evaluateAll(elements=>{for(const element of elements)element.value=""})
    await activePage.screenshot({path:`${outputDirectory}/failure-original.png`,fullPage:true});receipts.failure.screenshot="failure-original.png";receipts.failure.syntheticReasonRedacted=true
  }catch{receipts.failure.screenshot="NOT_CAPTURED"}
}finally{
  const closed=await Promise.allSettled([...contexts.map(context=>context.close()),...(browser?[browser.close()]:[]),app.$disconnect(),admin.$disconnect()])
  receipts.cleanup=closed.every(result=>result.status==="fulfilled")?"PASS":"FAIL"
  if(receipts.cleanup==="FAIL"){receipts.status="FAIL";process.exitCode=1}
  receipts.completedAt=new Date().toISOString()
  await writeFile(`${outputDirectory}/exception-classification-receipt.json`,JSON.stringify(receipts,null,2)+"\n",{flag:"wx"})
  console.log(JSON.stringify({status:receipts.status,completedCases:receipts.cases.length,cleanup:receipts.cleanup}))
}
