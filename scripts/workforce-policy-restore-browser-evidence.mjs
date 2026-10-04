import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true")
assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1"); assert.notEqual(process.env.NODE_ENV, "production")
const origin = new URL(process.env.WF_POLICY_RESTORE_BASE_URL)
assert.equal(origin.protocol, "http:"); assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname))
assert.equal(origin.pathname, "/"); assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
const ownerUrl = new URL(process.env.ADMIN_DATABASE_URL), appUrl = new URL(process.env.DATABASE_URL)
assert.ok(["postgres:", "postgresql:"].includes(ownerUrl.protocol)); assert.ok(["localhost", "127.0.0.1"].includes(ownerUrl.hostname))
assert.equal(ownerUrl.username, "postgres"); assert.equal(ownerUrl.pathname, "/workforce_manager_today_browser")
assert.equal(new URL(process.env.EVENT_PLATFORM_TEST_DATABASE_URL).href, ownerUrl.href)
assert.equal(appUrl.protocol, ownerUrl.protocol); assert.equal(appUrl.host, ownerUrl.host)
assert.equal(appUrl.pathname, ownerUrl.pathname); assert.equal(appUrl.username, "wf_policy_restore")
assert.equal(appUrl.searchParams.get("connection_limit"), "4")
for (const value of [process.env.WF_POLICY_RESTORE_HEAD_SHA, process.env.GITHUB_SHA]) assert.match(value || "", /^[a-f0-9]{40}$/)
const owner = makeRlsTestPrisma(ownerUrl.href), contexts = [], orgs = [], sources = []
const suffix = randomUUID(), password = "Fixture!9-" + randomUUID()
const today = new Date().toISOString().slice(0, 10), date = offset => new Date(new Date(today + "T00:00:00Z").getTime() + offset * 86400000)
const future = date(30).toISOString().slice(0, 10)
const directory = process.env.WF_POLICY_RESTORE_OUTPUT_DIR || "artifacts/workforce-policy-restore"
await mkdir(directory, { recursive: true })
function canonical(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)]))
}
const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0,
  longPauseThresholdSeconds: null, opaque: { copied: [null, 0, { deferred: true }] } }
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
const definitionHash = hash(definition), endpoint = source => `/api/v1/workforce/configuration/policies/${source.id}/restore-draft`
const cases = [], authentication = [], cleanup = [], posts = []
const pendingTransportReleases = []
let browser, pageForFailure, fixture, failed = false, stage = "seed", failure = null
const authTimes = []
const factsTables = ["mtm_teams", "mtm_agents", "mtm_settings", "mtm_work_calendar_days", "workforce_employee_team_memberships",
  "mtm_agent_workdays", "mtm_agent_workday_events", "workforce_access_grants", "workforce_access_grant_revocations",
  "workforce_shift_templates", "workforce_shift_segments", "workforce_shift_assignments", "workforce_shift_default_assignments",
  "workforce_shift_team_default_assignments", "workforce_policy_snapshots", "workforce_shift_snapshots", "workforce_workday_schedule_snapshots",
  "workforce_exception_cases", "workforce_exception_decisions"]
async function facts() {
  const result = []
  for (const table of factsTables) {
    const rows = await owner.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM public."${table}" t WHERE "organizationId" IN ($1,$2) ORDER BY id LIMIT 101`, ...orgs)
    assert.ok(rows.length <= 100); result.push({ table, count: rows.length, sha256: hash(rows) })
  }
  return { tables: result, sources: await owner.workforcePolicy.findMany({ where: { id: { in: sources.map(row => row.id) } }, orderBy: { id: "asc" } }) }
}
async function counts() {
  return { policies: await owner.workforcePolicy.count({ where: { organizationId: { in: orgs } } }),
    audits: await owner.mtmAuditLog.count({ where: { organizationId: { in: orgs } } }) }
}
async function waitForTransport(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture transport deadline")), 120000) })]) }
  finally { clearTimeout(timer) }
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 4)
  const principals = []
  for (const index of [0, 1]) {
    const org = await owner.organization.create({ data: { name: "Restore UI fixture", slug: `restore-ui-${index}-${suffix}`, plan: "enterprise",
      modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"] } }); orgs.push(org.id)
    await owner.mtmSetting.create({ data: { organizationId: org.id, key: "timezone", value: "UTC" } })
    const team = await owner.mtmTeam.create({ data: { organizationId: org.id, code: `restore-ui-${index}-${suffix}`, name: "Recorded UI team" } })
    for (const kind of index === 0 ? ["hr", "team", "crm"] : ["foreign"]) {
      const user = await owner.user.create({ data: { organizationId: org.id, email: `${kind}-ui-${suffix}@example.test`, name: "UI fixture principal",
        role: kind === "crm" ? "admin" : "manager", passwordHash, require2fa: false, totpEnabled: false, smsAuthEnabled: false } })
      principals.push({ ...user, slug: org.slug, kind })
      if (kind !== "crm") await owner.workforceAccessGrant.create({ data: { organizationId: org.id, principalUserId: user.id,
        role: "HR_ADMIN", scopeKind: kind === "team" ? "TEAM" : "ORGANIZATION", scopeTeamId: kind === "team" ? team.id : null,
        effectiveFrom: date(-1), operationId: `restore-ui-grant-${kind}-${suffix}`, grantedByUserId: user.id, grantReasonCode: "HOSTED_UI_FIXTURE" } })
    }
    const actor = principals.find(row => row.organizationId === org.id && row.kind !== "crm")
    if (index === 0) {
      const pairs = []
      for (const [label, teamId] of [["Organization", null], ["Team", team.id]]) {
        const pair = []
        for (const version of [1, 2]) {
          const row = await owner.workforcePolicy.create({ data: { organizationId: org.id, teamId, version,
            name: "Recorded UI " + label, status: version === 1 || teamId !== null ? "RETIRED" : "ACTIVE",
            effectiveFrom: date(version === 1 ? -730 : -365), effectiveTo: version === 1 ? date(-366) : teamId !== null ? date(-30) : null,
            definition, definitionHash, createdByUserId: actor.id, activatedByUserId: actor.id,
            activatedAt: date(version === 1 ? -730 : -365), retiredAt: version === 1 ? date(-366) : teamId !== null ? date(-30) : null } })
          sources.push(row); pair.push(row)
        }
        pairs.push(pair)
      }
      const agent = await owner.mtmAgent.create({ data: { organizationId: org.id, teamId: team.id, name: "Unchanged snapshot employee" } })
      const workday = await owner.mtmAgentWorkday.create({ data: { organizationId: org.id, agentId: agent.id, workDate: date(-2), startedAt: date(-2) } })
      await owner.workforcePolicySnapshot.create({ data: { organizationId: org.id, policyId: pairs[0][1].id, workdayId: workday.id,
        agentId: agent.id, workDate: date(-2), policyVersion: 2, definition, definitionHash,
        expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null } })
      fixture = { pairs }
    }
  }
  fixture.principals = principals
}
async function authenticate(context, principal) {
  while (authTimes.length && authTimes[0] <= Date.now() - 61000) authTimes.shift()
  if (authTimes.length >= 8) { await delay(Math.max(0, authTimes[0] + 61000 - Date.now()) + 25); authTimes.shift() }
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120000 }); assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string")
  authTimes.push(Date.now())
  const callback = await context.request.post("/api/auth/callback/credentials", { timeout: 120000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: origin.href + "workforce" } })
  assert.equal(callback.status(), 200); assert.equal(new URL((await callback.json()).url, origin).searchParams.get("error"), null)
  const response = await context.request.get("/api/auth/session"); assert.equal(response.status(), 200)
  const session = await response.json(); assert.equal(session.user.id, principal.id); assert.equal(session.user.organizationId, principal.organizationId)
  authentication.push({ csrfStatus: 200, callbackStatus: 200, actualPrincipalAndTenant: true })
}
async function open(locale = "en", width = 1440) {
  const context = await browser.newContext({ baseURL: origin.href, viewport: { width, height: 900 }, locale, reducedMotion: "reduce" }); contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.origin, sameSite: "Lax" }])
  await authenticate(context, fixture.principals.find(row => row.kind === "hr"))
  const page = await context.newPage(); pageForFailure = page; page.setDefaultTimeout(120000)
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/v1/workforce/")) posts.push({ method: "POST", restorePath: new URL(request.url()).pathname.endsWith("/restore-draft") }) })
  const copy = JSON.parse(await readFile(`messages/${locale}.json`, "utf8"))
  const view = { context, page, locale, ui: copy.workforcePolicyVersionComparison, restore: copy.workforcePolicyRestoreDraft,
    section: page.locator('section[aria-labelledby="workforce-policy-restore-title"]') }
  await page.goto("/workforce/configuration/policy-versions", { waitUntil: "domcontentloaded" })
  await page.locator("#workforce-policy-version-query").waitFor()
  return view
}
async function select(view, pair = fixture.pairs[0]) {
  const search = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/search"))
  await view.page.locator("#workforce-policy-version-query").fill(pair[0].name)
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).click(); assert.equal((await search).status(), 200)
  await view.page.locator("#workforce-policy-version-from").selectOption(pair[0].id)
  await view.page.locator("#workforce-policy-version-to").selectOption(pair[1].id)
  const comparison = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/compare"))
  await view.page.getByRole("button", { name: view.ui.compare, exact: true }).click(); assert.equal((await comparison).status(), 200)
  await view.section.locator("#workforce-policy-restore-name").waitFor()
}
async function native(view, locator) {
  await locator.scrollIntoViewIfNeeded(); await view.page.keyboard.press("Escape")
  await view.page.locator("body").click({ position: { x: 2, y: 2 } })
  for (let n = 1; n <= 100; n++) {
    await view.page.keyboard.press("Tab")
    if (await locator.evaluate(e => e === document.activeElement)) { assert.equal(await locator.evaluate(e => e.matches(":focus-visible")), true); return n }
  }
  assert.fail("Native target not reachable within100tabs")
}
async function review(view, label, keyboard = false) {
  await view.section.locator("#workforce-policy-restore-name").fill(label)
  await view.section.locator("#workforce-policy-restore-date").fill(future)
  const button = view.section.getByRole("button", { name: view.restore.review, exact: true })
  if (keyboard) { await native(view, button); await view.page.keyboard.press("Enter") } else await button.click()
  await view.section.getByRole("button", { name: view.restore.create, exact: true }).waitFor()
}
async function dispatch(view, source, keyboard = false) {
  const response = view.page.waitForResponse(r => new URL(r.url()).pathname === endpoint(source) && r.request().method() === "POST")
  const button = view.section.getByRole("button", { name: view.restore.create, exact: true })
  if (keyboard) { await native(view, button); await view.page.keyboard.press("Enter") } else await button.click()
  return response
}
async function created(response, source, status = 201, original = null) {
  assert.equal(response.status(), status)
  const headers = await response.allHeaders(); assert.equal(headers["cache-control"], "private, no-store")
  assert.equal(headers["x-content-type-options"], "nosniff"); assert.ok(headers.vary.split(",").some(x => x.trim().toLowerCase() === "cookie"))
  const body = await response.json(), request = JSON.parse(response.request().postData())
  const receipt = body.data.restore; assert.equal(body.success, true); assert.equal(receipt.replayed, status === 200)
  assert.equal(receipt.basis, "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE"); assert.equal(receipt.sourcePolicyId, source.id)
  assert.equal(receipt.sourceVersion, source.version); assert.equal(receipt.creation.statusAtCreation, "DRAFT")
  const row = await owner.workforcePolicy.findUniqueOrThrow({ where: { id: receipt.creation.policyId } })
  assert.equal(row.organizationId, orgs[0]); assert.equal(row.teamId, source.teamId); assert.equal(row.status, "DRAFT")
  assert.equal(row.name, request.name); assert.equal(row.effectiveFrom.toISOString().slice(0, 10), future)
  assert.deepEqual(row.definition, definition); assert.equal(row.definitionHash, definitionHash)
  assert.equal(row.restoreOperationId, request.operationId); assert.equal(row.activatedAt, null); assert.equal(row.systemProfileVersion, null)
  assert.equal(await owner.workforcePolicy.count({ where: { organizationId: orgs[0], restoreOperationId: request.operationId } }), 1)
  const audits = await owner.mtmAuditLog.findMany({ where: { organizationId: orgs[0], entityId: request.operationId } })
  assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, fixture.principals.find(row => row.kind === "hr").id)
  if (original) assert.deepEqual(receipt.creation, original.creation)
  return { receipt, request, policyId: row.id }
}
async function held(view) {
  for (const id of ["query", "from", "to"]) assert.equal(await view.page.locator("#workforce-policy-version-" + id).isDisabled(), true)
  assert.equal(await view.section.getByText(view.restore.navigation, { exact: true }).isVisible(), true)
}
async function geometry(view, minimumControls = 0) {
  const observation = await view.section.evaluate(element => {
    const r = element.getBoundingClientRect(), controls = [...element.querySelectorAll("button,input")].filter(e => e.getBoundingClientRect().width > 0)
    return { visible: r.width > 0 && r.height > 0, insideWidth: r.left >= 0 && r.right <= innerWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      controlCount: controls.length, mainControls44px: controls.every(e => e.getBoundingClientRect().height >= 44) }
  }); assert.ok(observation.visible && observation.insideWidth && observation.noHorizontalOverflow && observation.mainControls44px)
  assert.ok(observation.controlCount >= minimumControls); return observation
}
async function replaceSession(view, principal) {
  const other = await browser.newContext({ baseURL: origin.href }); contexts.push(other); await authenticate(other, principal)
  const auth = (await other.cookies()).filter(c => /(?:authjs|next-auth)\.session-token/.test(c.name))
  assert.ok(auth.length > 0)
  await view.context.clearCookies({ name: /(?:authjs|next-auth)\.session-token/ }); await view.context.addCookies(auth)
  const response = await view.context.request.get("/api/auth/session"); const session = await response.json()
  assert.equal(session.user.id, principal.id); assert.equal(session.user.organizationId, principal.organizationId)
}

try {
  await seed(); const before = await facts(); browser = await chromium.launch({ headless: true })
  // The prior API step uses a separate stopped process. Still allow its entire
  // real 60s auth window to expire; never change the limiter or spoof source IP.
  await delay(61000)
  for (const locale of ["en", "ru", "az"]) {
    const view = await open(locale)
    for (const width of [320, 768, 1440]) {
      stage = `manual-${locale}-${width}`; await view.page.setViewportSize({ width, height: 900 })
      if (width !== 320) await view.page.reload({ waitUntil: "domcontentloaded" })
      await select(view); const formGeometry = await geometry(view, 3), noWrite = await counts(), postCount = posts.length
      await review(view, "Restored UI " + locale + " " + width, locale === "en" && width === 320)
      assert.deepEqual(await counts(), noWrite); assert.equal(posts.length, postCount)
      const edit = view.section.getByRole("button", { name: view.restore.edit, exact: true })
      if (locale === "en" && width === 320) { await native(view, edit); await view.page.keyboard.press("Enter") } else await edit.click()
      assert.equal(await view.section.locator("#workforce-policy-restore-name").inputValue(), "Restored UI " + locale + " " + width)
      await review(view, "Restored UI " + locale + " " + width)
      const result = await created(await dispatch(view, fixture.pairs[0][1], locale === "en" && width === 320), fixture.pairs[0][1])
      await view.section.getByText(view.restore.created, { exact: true }).waitFor()
      assert.equal(await view.section.getByText(view.restore.historical, { exact: true }).isVisible(), true)
      const text = await view.section.innerText(); for (const secret of [result.policyId, result.request.operationId, definitionHash, fixture.pairs[0][1].id]) assert.equal(text.includes(secret), false)
      await view.page.screenshot({ path: `${directory}/restore-ui-${locale}-${width}.png` })
      cases.push({ name: stage, status: "PASS", locale, width, actual201: true, strictFullJsonNullZeroCopy: true,
        oneDraftOneAudit: true, reviewEditNoWrite: true, originalCreationBoundary: true, formGeometry, receiptGeometry: await geometry(view),
        nativeReviewEditCreate: locale === "en" && width === 320 })
    }
    await view.context.close()
  }
  const view = await open(); await select(view, fixture.pairs[1]); stage = "retired-team-exact-scope"
  await review(view, "Restored retired team"); await created(await dispatch(view, fixture.pairs[1][1]), fixture.pairs[1][1])
  await view.section.getByText(view.restore.created, { exact: true }).waitFor(); cases.push({ name: stage, status: "PASS", actual201: true, teamScopePreserved: true })

  await view.page.reload({ waitUntil: "domcontentloaded" }); await select(view); stage = "lost-real-201-same-body-replay"
  let original, originalBody, firstDelivered, firstFailed; const firstReady = new Promise((resolve, reject) => { firstDelivered = resolve; firstFailed = reject })
  firstReady.catch(() => {})
  await view.page.route("**/restore-draft", async route => {
    try {
      originalBody = route.request().postData(); const response = await route.fetch({ timeout: 120000 }); assert.equal(response.status(), 201)
      original = (await response.json()).data.restore; await route.abort("failed"); firstDelivered()
    } catch (error) { firstFailed(error); try { await route.abort("failed") } catch { /* Original failure retained. */ } }
  }, { times: 1 })
  await review(view, "Restored lost response"); await view.section.getByRole("button", { name: view.restore.create, exact: true }).click()
  await waitForTransport(firstReady); await view.section.getByText(view.restore.unknown, { exact: true }).waitFor(); await held(view)
  const summary = view.section.locator("summary"); await native(view, summary); await view.page.keyboard.press("Enter")
  const acknowledge = view.section.locator("#workforce-policy-restore-abandon")
  const abandon = view.section.getByRole("button", { name: view.restore.abandonConfirm, exact: true })
  assert.equal(await abandon.isDisabled(), true); await native(view, acknowledge); await view.page.keyboard.press("Space")
  assert.equal(await abandon.isEnabled(), true); await view.page.keyboard.press("Space"); assert.equal(await abandon.isDisabled(), true)
  const unchanged = await counts(), replayResponse = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/restore-draft"))
  await native(view, view.section.getByRole("button", { name: view.restore.retry, exact: true })); await view.page.keyboard.press("Enter")
  const replay = await replayResponse; assert.equal(replay.request().postData(), originalBody)
  await created(replay, fixture.pairs[0][1], 200, original); assert.deepEqual(await counts(), unchanged)
  await view.section.getByText(view.restore.replayed, { exact: true }).waitFor()
  cases.push({ name: stage, status: "PASS", actualServer201LostInTransport: true, actual200Replay: true,
    byteIdenticalRequest: true, noAdditionalDraftOrAudit: true, nativeSummaryAcknowledgementRetry: true, abandonmentNotSubmitted: true })

  await view.page.reload({ waitUntil: "domcontentloaded" }); await select(view); stage = "real-audit-insert-rollback-and-retry"
  await owner.$executeRawUnsafe(`CREATE FUNCTION wf_fixture_restore_ui_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."organizationId"='${orgs[0]}' AND NEW.action='WORKFORCE_POLICY_RESTORED_AS_DRAFT' THEN RAISE EXCEPTION 'Fixture UI audit rejected' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`)
  await owner.$executeRawUnsafe("CREATE TRIGGER wf_fixture_restore_ui_fail_audit BEFORE INSERT ON public.mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION wf_fixture_restore_ui_fail_audit()")
  let rollbackBody
  try {
    const noWrite = await counts(); await review(view, "Restored rollback retry")
    const response = await dispatch(view, fixture.pairs[0][1]); assert.equal(response.status(), 503); rollbackBody = response.request().postData()
    assert.deepEqual(await counts(), noWrite); await view.section.getByText(view.restore.unknown, { exact: true }).waitFor(); await held(view)
  } finally { await owner.$executeRawUnsafe("DROP TRIGGER wf_fixture_restore_ui_fail_audit ON public.mtm_audit_logs"); await owner.$executeRawUnsafe("DROP FUNCTION wf_fixture_restore_ui_fail_audit()") }
  const retryResponse = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/restore-draft"))
  await view.section.getByRole("button", { name: view.restore.retry, exact: true }).click(); const retried = await retryResponse
  assert.equal(retried.request().postData(), rollbackBody); await created(retried, fixture.pairs[0][1])
  await view.section.getByText(view.restore.created, { exact: true }).waitFor(); cases.push({ name: stage, status: "PASS", actual503Rollback: true, sameBody201Retry: true })

  for (const kind of ["team", "crm"]) {
    stage = "actual-current-session-" + kind + "-403-clears-parent"; const deniedView = await open()
    await select(deniedView); await review(deniedView, "Denied no write")
    await replaceSession(deniedView, fixture.principals.find(row => row.kind === kind)); const noWrite = await counts()
    const response = await dispatch(deniedView, fixture.pairs[0][1]); assert.equal(response.status(), 403)
    await deniedView.page.getByText(deniedView.ui.denied, { exact: true }).waitFor()
    assert.equal(await deniedView.page.locator("#workforce-policy-version-query").count(), 0)
    assert.equal(await deniedView.page.locator("select").count(), 0); assert.equal(await deniedView.section.count(), 0)
    assert.deepEqual(await counts(), noWrite); cases.push({ name: stage, status: "PASS", realChangedCookieSession: true, actual403: true, noWrite: true, allPrivateParentCleared: true })
  }
  stage = "actual-tenant-session-change-ignores-held-old-creation"
  const changedView = await open(); await select(changedView); await review(changedView, "Old session creation")
  let release, delivered, deliveryFailed, heldCreation; const stop = new Promise(resolve => { release = resolve }), ready = new Promise((resolve, reject) => { delivered = resolve; deliveryFailed = reject })
  pendingTransportReleases.push(() => release()); ready.catch(() => {})
  const fulfill = []
  await changedView.page.route("**/restore-draft", async route => {
    let response
    try { response = await route.fetch({ timeout: 120000 }); assert.equal(response.status(), 201); heldCreation = (await response.json()).data.restore }
    catch (error) { deliveryFailed(error); try { await route.abort("failed") } catch { /* Original failure retained. */ } return }
    delivered(); await stop
    try { await route.fulfill({ response }); fulfill.push("DELIVERED") } catch { fulfill.push("ABORTED_AFTER_SESSION_CHANGE") }
  }, { times: 1 })
  await changedView.section.getByRole("button", { name: changedView.restore.create, exact: true }).click(); await waitForTransport(ready); await held(changedView)
  await replaceSession(changedView, fixture.principals.find(row => row.kind === "foreign"))
  const sessionRead = changedView.page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/session")
  await changedView.page.bringToFront()
  await changedView.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  const currentSession = await (await sessionRead).json(); assert.equal(currentSession.user.organizationId, orgs[1])
  await changedView.section.getByText(changedView.restore.chooseSource, { exact: true }).waitFor()
  assert.equal(await changedView.page.locator("#workforce-policy-version-from").inputValue(), "")
  assert.equal(await changedView.page.locator("#workforce-policy-version-to").inputValue(), "")
  release(); for (let n = 0; n < 100 && fulfill.length === 0; n++) await delay(20)
  assert.equal(fulfill.length, 1); assert.equal((await changedView.section.innerText()).includes(heldCreation.creation.name), false)
  assert.equal(await changedView.section.getByText(changedView.restore.created, { exact: true }).count(), 0)
  assert.equal(await owner.workforcePolicy.count({ where: { id: heldCreation.creation.policyId, organizationId: orgs[0] } }), 1)
  cases.push({ name: stage, status: "PASS", actualOldServer201: true, actualNewTenantSession: true, parentSelectionCleared: true, oldCreationNotRendered: true, transportCompletion: fulfill[0], navigationDoesNotRollback: true })
  assert.deepEqual(await facts(), before); assert.ok(posts.every(row => row.restorePath))
  assert.equal(cases.length, 15); assert.equal(new Date().toISOString().slice(0, 10), today)
} catch (error) {
  failed = true; const position = /workforce-policy-restore-browser-evidence\.mjs:(\d+):(\d+)/.exec(error?.stack || "")
  failure = { stage, name: ["AssertionError", "TimeoutError"].includes(error?.name) ? error.name : "Error",
    sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
    diagnostic: "Fixed category/position only; no raw error, stack, credentials, tokens, cookies or response body" }
  if (pageForFailure && !pageForFailure.isClosed()) try { await pageForFailure.screenshot({ path: directory + "/restore-ui-original-failure.png" }) } catch { /* Failure remains FAIL. */ }
} finally {
  for (const release of pendingTransportReleases) release()
  for (const context of contexts) try { await context.close() } catch { failed = true }
  if (browser) try { await browser.close() } catch { failed = true }
  try {
    await owner.$transaction(async tx => {
      for (const [table, guard] of [["workforce_policies", "workforce_policies_published_definition_delete_guard"], ["workforce_policies", "workforce_policies_restore_anchor_guard"],
        ["mtm_audit_logs", "wf_fixture_restore_audit_guard"], ["workforce_access_grants", "workforce_access_grants_append_only"]]) await tx.$executeRawUnsafe(`ALTER TABLE public.${table} DISABLE TRIGGER ${guard}`)
      await tx.mtmAuditLog.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.workforcePolicySnapshot.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.mtmAgentWorkday.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.mtmAgent.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.workforceAccessGrant.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.mtmSetting.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.mtmTeam.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.user.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.organization.deleteMany({ where: { id: { in: orgs } } })
      for (const [table, guard] of [["workforce_policies", "workforce_policies_published_definition_delete_guard"], ["workforce_policies", "workforce_policies_restore_anchor_guard"],
        ["mtm_audit_logs", "wf_fixture_restore_audit_guard"], ["workforce_access_grants", "workforce_access_grants_append_only"]]) await tx.$executeRawUnsafe(`ALTER TABLE public.${table} ENABLE TRIGGER ${guard}`)
    })
    assert.equal(await owner.organization.count({ where: { id: { in: orgs } } }), 0)
    const guards = await owner.$queryRawUnsafe("SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('workforce_policies_published_definition_delete_guard','workforce_policies_restore_anchor_guard','wf_fixture_restore_audit_guard','workforce_access_grants_append_only')")
    assert.equal(guards.length, 4); assert.ok(guards.every(row => row.tgenabled === "O")); cleanup.push({ action: "scoped-row-removal-and-four-guards-restored", status: "PASS" })
  } catch { failed = true; cleanup.push({ action: "scoped-row-removal-or-guards", status: "FAIL" }) }
  try { await owner.$disconnect(); cleanup.push({ action: "disconnect", status: "PASS" }) } catch { failed = true }
  const paths = ["scripts/workforce-policy-restore-browser-evidence.mjs", "scripts/_rls.mjs", ".github/workflows/workforce-policy-restore-evidence.yml",
    "scripts/ci/workforce-policy-restore-pre-anchor.mjs", "scripts/ci/fixtures/workforce-policy-restore-writer.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql", "scripts/ci/fixtures/workforce-policy-version-browser.sql",
    "src/components/workforce/workforce-policy-restore-draft.tsx", "src/components/workforce/workforce-policy-version-comparison.tsx", "src/components/workforce/workforce-policy-future-window-preview.tsx",
    "src/lib/workforce/policy-restore-receipt.ts", "src/lib/workforce/policy-restore-draft.ts", "src/lib/workforce/policy-draft-write.ts", "src/lib/workforce/policy-version-comparison.ts",
    "src/app/api/v1/workforce/configuration/policies/[id]/restore-draft/route.ts", "src/app/api/v1/workforce/configuration/policies/search/route.ts", "src/app/api/v1/workforce/configuration/policies/compare/route.ts",
    "src/lib/with-workforce-rls-auth.ts", "src/lib/auth.ts", "src/lib/rls-context.ts", "src/lib/prisma.ts", "src/proxy.ts", "src/lib/rate-limit.ts", "src/components/ui/button.tsx", "src/components/ui/input.tsx",
    "src/components/ui/select.tsx", "src/app/(dashboard)/workforce/configuration/policy-versions/page.tsx", "src/components/providers.tsx", "src/app/(dashboard)/layout.tsx",
    "messages/en.json", "messages/ru.json", "messages/az.json", "prisma/schema.prisma", "prisma/migrations/20261004073000_workforce_policy_restore_operation_anchor/migration.sql"]
  const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
  await writeFile(directory + "/restore-rendered-ui-receipt.json", JSON.stringify({ status: failed ? "FAIL" : "PASS", stage, failure, requiredCases: 15, cases, authentication,
    candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA, completedAt: new Date().toISOString(), cleanup, sourceBindings,
    boundary: "Real hosted Chromium/credentials/session/canonical restore writer and PostgreSQL on disposable data. EN/RU/AZ at320/768/1440, bounded native controls/reflow, real201 loss/replay200, audit rollback503/retry201 and session/grant changes. Controlled transport loss is distinct from server failure. Existing policy read-only-role lane unchanged. Geometry is not pixel occlusion/whole-page WCAG/AT/native zoom. No production authenticated write/activation/employee impact/Android/load/pilot credit. Auth metadata and explicitly expected new draft/audit writes are excluded from preserved source/employee facts." }, null, 2) + "\n", { flag: "wx" })
}
assert.equal(failed, false, "Rendered restore UI failed; complete sanitized receipt retained")
