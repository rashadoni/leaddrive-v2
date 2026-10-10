import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { generateSecret, generateSync } from "otplib"
import { chromium } from "playwright"
import { createNativeZoomContext, proveNative200Zoom, captureNativeViewport, isNativeZoomPage } from "./workforce-native-browser-zoom.mjs"
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
const contexts = [], nativeZoomContexts = [], expectedWrites = [], protectedMarkers = [reason, password]
const matrix = { locales: ["az", "ru", "en"], widths: [320, 768, 1440], standardExpected: 9, nativeExpected: 3 }
const matrixCells = matrix.locales.flatMap(locale => [...matrix.widths.map(width => ({ locale, width, nativeZoom: false, key: locale + "-standard-" + width })), { locale, width: 320, nativeZoom: true, key: locale + "-native-320" }])
let initialDecisionCount
let browser, activePage, stage = "fixture-preparing"
const receipts = {
  version: 1, candidateHead: process.env.WF_EXCEPTION_CLASSIFICATION_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA, startedAt: now.toISOString(),
  environment: "hosted Chromium / real Auth.js / loopback Next dev / disposable PostgreSQL16 and Redis",
  status: "RUNNING", cases: [], sources: [], productionRoutines: [], authenticationDiagnostics: [], writeDiagnostics: [],
  matrix, nativeZoomDiagnostics: [], nativeCaptureDiagnostics: [], keyboardFocusDiagnostics: [], privacyCaptureRefusals: [], nativeZoomVerdict: "NOT RUN",
  limitations: ["Queue table is deliberately horizontally scrollable; table-region checks prove focused visible intersection, not a whole tall table fitting one screen", "Real Tab/Enter and keyboard reason entry; no automatic loading-focus retention/human AT/whole-page WCAG acceptance", "Private reason is never photographed; a failure with a protected form value records NOT_CAPTURED rather than editing the DOM/image", "Synthetic isolated tenants and imported historical terminal decisions only", "Development bundle, not production build", "Exact production decision revision and append-only routines; no full migration replay", "Audit whitelist/append-only fixture guard is synthetic, not a production MtmAuditLog migration", "No live HR observation, physical presence, device, pilot, payroll or disciplinary evidence", "No production mutation, grants, activation, secret/access change or external message"],
}
function noProtected(value) {
  for (const marker of protectedMarkers) assert.equal(value.includes(marker), false, "Protected reason or database subject leaked")
}
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
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: `${origin.href}workforce/exceptions` },
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
  const owned = nativeZoom ? await createNativeZoomContext(origin.href, "exception-classification") : null
  if (owned) nativeZoomContexts.push(owned)
  const context = owned ? owned.context : await browser.newContext({ baseURL: origin.href, locale: "en-US", viewport: { width, height: 900 }, serviceWorkers: "block" })
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
  protectedMarkers.push(passwordHash)
  const tenants = []
  for (const key of ["a", "b"]) {
    const organization = await admin.organization.create({ data: {
      name: `Classification fixture ${key}`, slug: `wf-classification-${suffix}-${key}`, plan: "enterprise",
      modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"], settings: {},
    } })
    const principals = {}
    for (const name of ["issuer", "hr", ...(key === "a" ? ["team", "tenant", "denied", "weak"] : [])]) {
      const totpSecret = name === "weak" ? null : generateSecret()
      if (totpSecret) protectedMarkers.push(totpSecret)
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `classification-${suffix}-${key}-${name}@example.test`, name: `Fixture ${key} ${name}`,
        passwordHash, role: name === "issuer" ? "admin" : "manager", require2fa: name !== "weak", totpEnabled: name !== "weak", totpSecret, smsAuthEnabled: false,
      } })
      principals[name] = { ...user, slug: organization.slug }
    }
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Fixture ${key} team`, code: `CLASS-${suffix}-${key}`, isActive: true } })
    const agent = await admin.mtmAgent.create({ data: { organizationId: organization.id, teamId: team.id, name: `Synthetic classification employee ${key}`, role: "AGENT", status: "ACTIVE" } })
    await admin.workforceEmployeeTeamMembership.create({ data: { organizationId: organization.id, agentId: agent.id, teamId: team.id, effectiveAt: new Date("2024-01-01T00:00:00Z"), source: "BROWSER_FIXTURE_ONLY" } })
    const workday = await admin.mtmAgentWorkday.create({ data: { organizationId: organization.id, agentId: agent.id, workDate: at, status: "COMPLETED", startedAt: new Date(at.getTime() + 28_800_000), completedAt: new Date(at.getTime() + 61_200_000), totalPausedSeconds: 0 } })
    await admin.mtmSetting.create({ data: { organizationId: organization.id, key: "timezone", value: "UTC" } })
    let hrGrant
    for (const [name, role, scopeKind] of [["hr", "HR_ADMIN", "ORGANIZATION"], ...(key === "a" ? [["hr", "TEAM_MANAGER", "TEAM"], ["team", "TEAM_MANAGER", "TEAM"], ["tenant", "TENANT_ADMIN", "ORGANIZATION"], ["weak", "HR_ADMIN", "ORGANIZATION"]] : [])]) {
      const grant = await admin.workforceAccessGrant.create({ data: {
        organizationId: organization.id, principalUserId: principals[name].id, role, scopeKind,
        scopeTeamId: scopeKind === "TEAM" ? team.id : null, scopeSiteId: null, scopeAgentId: null,
        effectiveFrom: new Date(now.getTime() - 86_400_000), operationId: `class-${suffix}-${key}-${name}-${role}`,
        grantedByUserId: principals.issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
      } })
      if (role === "HR_ADMIN" && name === "hr") hrGrant = grant
    }
    const cases = {}
    for (const label of key === "a" ? [...matrixCells.map(cell => cell.key), "stale", "reopened"] : ["foreign"]) {
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
  const body = await response.json().catch(() => null)
  recordWriteDiagnostic(response, body)
  assert.equal(response.status(), status)
  assert.match(response.headers()["cache-control"] || "", /no-store/)
  assert.ok(body && typeof body === "object"); noProtected(JSON.stringify(body))
  return body
}
function recordWriteDiagnostic(response, body, decisionCode = null) {
  const safeCode = typeof body?.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(body.code) ? body.code : null
  receipts.writeDiagnostics.push({ stage, decisionCode, status: response.status(), code: safeCode, jsonObject: Boolean(body && typeof body === "object"), success: body?.success === true })
}
function observeWaiter(waiter) {
  // Observe rejection immediately so failure cleanup cannot crash Node before
  // the original receipt is written. Await the same original promise below:
  // navigation, response and timeout assertions are unchanged.
  void waiter.catch(() => {})
  return waiter
}
function safeFailure(error) {
  return {
    name: ["AssertionError", "TypeError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(error?.name) ? error.name : "Error",
    sqlState: typeof error?.meta?.code === "string" && /^[A-Z0-9]{5}$/.test(error.meta.code) ? error.meta.code : null,
    prismaCode: typeof error?.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : null,
  }
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
async function tabTo(page, locator) {
  await locator.waitFor({ state: "visible" })
  assert.equal(await locator.count(), 1)
  // At most fourteen synthetic queue rows; every hop is a real keypress.
  for (let ordinal = 0; ordinal < 256; ordinal++) {
    if (await locator.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press("Tab")
  }
  assert.fail("Control not reachable through bounded real Tab navigation")
}
async function focusedControl(view, locator, phase, tableRegion = false) {
  const diagnostic = await locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    const viewport = { width: innerWidth, height: innerHeight }
    let left = 0, right = viewport.width, top = 0, bottom = viewport.height
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
        left = Math.max(left, bounds.left + ancestor.clientLeft)
        right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth)
      }
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
        top = Math.max(top, bounds.top + ancestor.clientTop)
        bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight)
      }
    }
    return { focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
      viewport, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, clip: { left, right, top, bottom } }
  })
  receipts.keyboardFocusDiagnostics.push({ locale: view.locale, width: view.width, nativeZoom: Boolean(view.nativeZoom), phase, tableRegion, ...diagnostic })
  assert.equal(diagnostic.focused, true); assert.equal(diagnostic.focusVisible, true)
  assert.ok(Object.values(diagnostic.box).every(Number.isFinite) && Object.values(diagnostic.clip).every(Number.isFinite))
  assert.ok(diagnostic.box.width > 0 && diagnostic.box.height > 0)
  assert.ok(diagnostic.box.left >= diagnostic.clip.left - 1 && diagnostic.box.right <= diagnostic.clip.right + 1)
  if (tableRegion) assert.ok(diagnostic.box.bottom > diagnostic.clip.top && diagnostic.box.top < diagnostic.clip.bottom)
  else assert.ok(diagnostic.box.top >= diagnostic.clip.top - 1 && diagnostic.box.bottom <= diagnostic.clip.bottom + 1)
}
async function assertCapturePrivacy(page) {
  // Reject every nonempty reason, including interrupted partial input. Return
  // only a boolean; never retain that private value in capture diagnostics.
  const reasonEmpty = await page.locator('textarea[name="reason"]').evaluateAll(elements => elements.every(element => element.value === ""))
  assert.equal(reasonEmpty, true, "Nonempty private HR reason forbids capture")
  noProtected(await page.locator("body").innerText())
  const values = await page.locator('input:not([type="hidden"]),textarea').evaluateAll(elements => elements.map(element => element.value).join("\n"))
  noProtected(values)
}
async function provePrivateCaptureRefusal(view, kind) {
  // Exercise the same mandatory capture admission on the actual browser DOM.
  // Never call the screenshot sink with a protected value, even on regression.
  await assert.rejects(() => assertCapturePrivacy(view.page), /Nonempty private HR reason forbids capture/)
  receipts.privacyCaptureRefusals.push({ locale: view.locale, width: view.width, nativeZoom: Boolean(view.nativeZoom), kind, status: "PASS", screenshotSinkInvoked: false, rawReasonRetained: false })
}
async function safeScreenshot(page, name, fullPage = false) {
  // This admission is unconditional and precedes every real screenshot sink.
  await assertCapturePrivacy(page)
  if (isNativeZoomPage(page)) await captureNativeViewport(page, outputDirectory + "/" + name,
    diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
  else await page.screenshot({ path: outputDirectory + "/" + name, fullPage })
}
async function uiScenario(tenant, cell, classificationCode, appealCode) {
  const { locale, width, nativeZoom, key } = cell
  const name = (nativeZoom ? "native-200-" : "standard-100-") + locale + "-" + width
  stage = name + "-authenticate"
  const ui = JSON.parse(await readFile(new URL("../messages/" + locale + ".json", import.meta.url), "utf8")).workforceExceptionQueue
  const context = await contextFor(tenant.hr, locale, width, nativeZoom)
  const page = await context.newPage(); activePage = page
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000)
  const view = { ...(nativeZoom ? nativeZoomContexts.at(-1) : {}), page, locale, width, nativeZoom: null }
  const response = observeWaiter(page.waitForResponse(r => new URL(r.url()).pathname === queueEndpoint && r.request().method() === "GET", { timeout: 120_000 }))
  await page.goto("/workforce/exceptions", { waitUntil: "domcontentloaded" })
  assert.equal((await response).status(), 200)
  const region = page.getByRole("region", { name: ui.casesTitle, exact: true })
  await region.waitFor({ state: "visible" }); assert.equal(await region.getAttribute("tabindex"), "0")
  if (nativeZoom) {
    stage = name + "-prove-native-zoom"
    view.nativeZoom = await proveNative200Zoom(view, outputDirectory, locale,
      diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
    receipts.nativeZoomDiagnostics.push({ locale, status: "PASS", ...view.nativeZoom })
  }
  await tabTo(page, region); await focusedControl(view, region, "table-region", true)
  if (nativeZoom) await safeScreenshot(page, "classification-" + name + "-keyboard-table.png")
  const record = tenant.cases[key]
  for (const code of [classificationCode, appealCode]) {
    stage = name + "-" + code
    const items = await queue(context), item = itemFor(items, record), action = actionFor(item, code)
    assert.equal(item.stage, "RESOLVED")
    const row = page.getByRole("row").filter({ hasText: record.reference }).filter({ has: page.getByTestId("workforce-exception-actions") })
    const offered = row.getByRole("button", { name: ui.actions[code], exact: true })
    await tabTo(page, offered); await focusedControl(view, offered, code + "-offered")
    await page.keyboard.press("Enter")
    const panel = page.getByTestId("workforce-exception-action-panel")
    const textarea = panel.locator('textarea[name="reason"]')
    await textarea.waitFor({ state: "visible" })
    assert.equal(await textarea.getAttribute("required"), "")
    let posts = 0
    const count = request => { if (new URL(request.url()).pathname === endpoint && request.method() === "POST") posts++ }
    page.on("request", count)
    const submit = panel.getByRole("button", { name: ui.recordAction, exact: true })
    await tabTo(page, submit); await focusedControl(view, submit, code + "-empty-submit")
    await page.keyboard.press("Enter")
    assert.equal(posts, 0, "Empty reason cannot submit")
    await tabTo(page, textarea); await focusedControl(view, textarea, code + "-empty-reason")
    await page.keyboard.type(reason.slice(0, 12))
    await provePrivateCaptureRefusal(view, "PARTIAL_REASON")
    await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.press("Backspace")
    assert.equal(await textarea.inputValue(), "")
    const phase = code === classificationCode ? "classification" : "appeal"
    if (nativeZoom) await safeScreenshot(page, "classification-" + name + "-" + phase + "-empty-reason.png")
    await page.keyboard.type(reason)
    assert.equal(await textarea.inputValue(), reason)
    await provePrivateCaptureRefusal(view, "COMPLETE_REASON")
    const committed = observeWaiter(page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === "POST", { timeout: 120_000 }))
    const refreshed = observeWaiter(page.waitForResponse(r => new URL(r.url()).pathname === queueEndpoint && r.request().method() === "GET", { timeout: 120_000 }))
    await tabTo(page, submit); await focusedControl(view, submit, code + "-submit")
    await page.keyboard.press("Enter")
    const writeResponse = await committed
    const body = await writeResponse.json().catch(() => null)
    recordWriteDiagnostic(writeResponse, body, code)
    assert.equal(writeResponse.status(), 201); assert.equal(posts, 1)
    assert.ok(body && typeof body === "object"); noProtected(JSON.stringify(body)); assert.equal(body.data.decisionCode, code)
    const payload = writeResponse.request().postDataJSON()
    assert.deepEqual(Object.keys(payload).sort(), ["actionToken", "operationId", "reason"])
    assert.equal(payload.reason, reason)
    assert.equal((await refreshed).status(), 200)
    page.off("request", count)
    expectedWrites.push({ organizationId: tenant.organization.id, caseId: record.id, actorUserId: tenant.hr.id, code, operationId: payload.operationId })
    await panel.waitFor({ state: "hidden" })
    await page.getByRole("status").filter({ hasText: ui.actions[code] }).waitFor({ state: "visible" })
    if (nativeZoom) await safeScreenshot(page, "classification-" + name + "-" + phase + "-recorded.png")
    if (locale === "en" && width === 1440 && !nativeZoom && code === classificationCode) {
      const before = await decisionCounts()
      const replay = await post(context, payload, 200); assert.equal(replay.idempotent, true)
      await post(context, { ...payload, reason: reason + "_CHANGED" }, 409)
      await post(context, { ...payload, operationId: randomUUID() }, 409)
      assert.deepEqual(await decisionCounts(), before)
      receipts.cases.push({ name: "exact-replay-and-conflicting-reason-and-stale-revision", status: "PASS", auditDeltaOnRetry: 0, decisionDeltaOnRetry: 0 })
    }
    noProtected(JSON.stringify(await queue(context)))
    assert.equal(action.decisionCode, code)
  }
  const final = itemFor(await queue(context), record)
  assert.equal(final.outcomeContext.classification, classificationCode === "CLASSIFY_FALSE_POSITIVE" ? "FALSE_POSITIVE" : "CONFIRMED_EXCEPTION")
  assert.equal(final.outcomeContext.appeal, appealCode.replace("APPEAL_", ""))
  assert.deepEqual(final.outcomeContext.actions, [])
  if (!nativeZoom) await safeScreenshot(page, "classification-" + name + "-complete.png", true)
  await assertSession(context, tenant.hr)
  receipts.cases.push({ name, status: "PASS", locale, width, nativeZoom, classificationCode, appealCode, protectedReasonRequired: true, directCallerCaseOrCodeAbsent: true, keyboardManualEntryAndSubmit: true })
  return context
}
async function denials(tenants, hrContext) {
  const [a,b] = tenants
  stage = "denied-hr-without-mandatory-enrolled-mfa"
  const weakContext = await contextFor(a.weak)
  const weakItem = itemFor(await queue(weakContext), a.cases.stale)
  const weakToken = actionFor(weakItem, "CLASSIFY_FALSE_POSITIVE").actionToken
  const weakBefore = await decisionCounts()
  const weakResult = await post(weakContext, { actionToken: weakToken, operationId: randomUUID(), reason }, 403)
  assert.equal(weakResult.code, "WORKFORCE_ATTENDANCE_MFA_REQUIRED")
  assert.deepEqual(await decisionCounts(), weakBefore)
  receipts.cases.push({ name: "denied-hr-without-mandatory-enrolled-mfa", status: "PASS", writeStatus: 403, code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED", recordedDelta: 0 })
  await weakContext.close()
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
  assert.equal(await admin.workforceExceptionDecision.count(), initialDecisionCount + expectedWrites.length, "Exact new ledger delta; no unexpected unaudited appends")
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
  for(const path of ["scripts/workforce-exception-classification-browser-evidence.mjs","scripts/workforce-native-browser-zoom.mjs","scripts/ci/fixtures/workforce-native-zoom-extension/manifest.json","scripts/ci/fixtures/workforce-native-zoom-extension/background.js","src/__tests__/workforce-exception-report-browser-evidence-guard.test.ts","src/lib/workforce/exception-decision-rate-limit.ts","scripts/ci/fixtures/workforce-exception-classification-browser.sql","scripts/ci/fixtures/workforce-manager-today-browser.sql",".github/workflows/workforce-exception-report-browser-evidence.yml","src/components/workforce/workforce-exception-queue.tsx","src/app/api/v1/workforce/exceptions/route.ts","src/app/api/v1/workforce/exception-decisions/route.ts","src/lib/workforce/exception-outcome-classification.ts","src/lib/workforce/exception-decision-service.ts","src/lib/workforce/exception-case-writer.ts","src/lib/workforce/exception-policy-draft.ts","messages/en.json","messages/ru.json","messages/az.json"]) {
    const raw=await readFile(new URL(`../${path}`,import.meta.url));receipts.sources.push({path,bytes:raw.length,sha256:createHash("sha256").update(raw).digest("hex")})
  }
  const tenants=await seed(),before=await fixedFacts(tenants)
  initialDecisionCount = await admin.workforceExceptionDecision.count()
  browser=await chromium.launch({headless:true})
  let hrContext
  for (const cell of matrixCells) {
    if (hrContext) await hrContext.close()
    const classification = cell.locale === "ru" ? "CLASSIFY_FALSE_POSITIVE" : "CLASSIFY_CONFIRMED_EXCEPTION"
    const appeal = cell.locale === "ru" ? "APPEAL_FULLY_UPHELD" : cell.locale === "az" ? "APPEAL_PARTIALLY_UPHELD" : "APPEAL_REJECTED"
    hrContext = await uiScenario(tenants[0], cell, classification, appeal)
  }
  assert.deepEqual(await fixedFacts(tenants),before,"Classification may append decisions/audit, but cannot change original business facts, grants or corrections")
  receipts.fixedFacts={phase:"after-twenty-four-ui-appends-before-intentional-fixture-revocation",unchanged:true,tables:before}
  await denials(tenants,hrContext)
  await databaseProof(tenants)
  assert.equal(expectedWrites.length,24); assert.equal(receipts.cases.length,20)
  const expectedNames = new Set(matrixCells.map(cell => (cell.nativeZoom ? "native-200-" : "standard-100-") + cell.locale + "-" + cell.width))
  const actualMatrix = receipts.cases.filter(row => row.name.startsWith("standard-100-") || row.name.startsWith("native-200-"))
  assert.equal(actualMatrix.length,12); assert.deepEqual(new Set(actualMatrix.map(row => row.name)),expectedNames)
  assert.ok(actualMatrix.every(row => row.status === "PASS" && row.keyboardManualEntryAndSubmit))
  assert.equal(receipts.nativeZoomDiagnostics.length,3)
  assert.ok(receipts.nativeZoomDiagnostics.every(row => row.status === "PASS" && row.factor === 2))
  assert.equal(receipts.nativeCaptureDiagnostics.length,21)
  assert.ok(receipts.nativeCaptureDiagnostics.every(row => row.status === "PASS"))
  assert.equal(receipts.keyboardFocusDiagnostics.length,108)
  assert.equal(receipts.privacyCaptureRefusals.length,48)
  assert.ok(receipts.privacyCaptureRefusals.every(row => row.status === "PASS" && row.screenshotSinkInvoked === false && row.rawReasonRetained === false))
  receipts.nativeZoomVerdict = "PASS"
  receipts.status="PASS"
}catch(error){
  receipts.status="FAIL";process.exitCode=1
  const sourceFrame=String(error?.stack||"").split("\n").find(line=>line.includes(import.meta.url))
  const position=sourceFrame?.match(/:(\d+):(\d+)\)?$/)
  const sqlState = typeof error?.meta?.code === "string" && /^[A-Z0-9]{5}$/.test(error.meta.code) ? error.meta.code : null
  const prismaCode = typeof error?.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : null
  receipts.failure={stage,name:["AssertionError","TimeoutError","PrismaClientKnownRequestError","PrismaClientValidationError"].includes(error?.name)?error.name:"Error",sourcePosition:position?{line:Number(position[1]),column:Number(position[2])}:null,sqlState,prismaCode,diagnostic:"Original failure retained; protected raw bodies, tokens, reason, credentials and cookies omitted"}
  if(activePage&&!activePage.isClosed())try{
    await safeScreenshot(activePage,"failure-original.png",true); receipts.failure.screenshot="failure-original.png"
  }catch{ receipts.failure.screenshot="NOT_CAPTURED_PRIVATE_OR_UNAVAILABLE"; receipts.failure.originalPixelsOrDomAltered=false }
}finally{
  // Close contexts before their browser. Preserve safe per-resource failure
  // metadata; concurrent parent/context closure previously left only FAIL.
  receipts.cleanupDiagnostics = []
  async function closeResource(resource, operation) {
    try { await operation(); receipts.cleanupDiagnostics.push({ resource, status: "PASS" }) }
    catch (error) { receipts.cleanupDiagnostics.push({ resource, status: "FAIL", ...safeFailure(error) }) }
  }
  for (const [index,owned] of nativeZoomContexts.entries()) await closeResource("native-profile-" + (index+1), () => owned.dispose())
  for (const [index,context] of contexts.entries()) await closeResource(`browser-context-${index+1}`, () => context.close())
  if (browser) await closeResource("browser", () => browser.close())
  await closeResource("app-prisma", () => app.$disconnect())
  await closeResource("admin-prisma", () => admin.$disconnect())
  receipts.cleanup=receipts.cleanupDiagnostics.every(result=>result.status==="PASS")?"PASS":"FAIL"
  if(receipts.cleanup==="FAIL"){receipts.status="FAIL";receipts.nativeZoomVerdict="FAIL CLEANUP";process.exitCode=1}
  receipts.completedAt=new Date().toISOString()
  noProtected(JSON.stringify(receipts))
  await writeFile(`${outputDirectory}/exception-classification-receipt.json`,JSON.stringify(receipts,null,2)+"\n",{flag:"wx"})
  console.log(JSON.stringify({status:receipts.status,completedCases:receipts.cases.length,cleanup:receipts.cleanup}))
}
