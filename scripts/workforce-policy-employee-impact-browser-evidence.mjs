import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { execFileSync } from "node:child_process"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true")
assert.equal(process.env.WF_POLICY_IMPACT_BROWSER, "1"); assert.notEqual(process.env.NODE_ENV, "production")
const origin = new URL(process.env.WF_POLICY_IMPACT_BASE_URL), loopback = ["localhost", "127.0.0.1", "[::1]"]
assert.equal(origin.protocol, "http:"); assert.ok(loopback.includes(origin.hostname))
assert.equal(origin.pathname, "/"); assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
const ownerUrl = new URL(process.env.ADMIN_DATABASE_URL), appUrl = new URL(process.env.DATABASE_URL)
assert.ok(["postgres:", "postgresql:"].includes(ownerUrl.protocol)); assert.ok(loopback.includes(ownerUrl.hostname))
assert.equal(ownerUrl.username, "postgres"); assert.equal(ownerUrl.pathname, "/workforce_manager_today_browser")
assert.equal(new URL(process.env.EVENT_PLATFORM_TEST_DATABASE_URL).href, ownerUrl.href)
assert.equal(appUrl.protocol, ownerUrl.protocol); assert.equal(appUrl.host, ownerUrl.host)
assert.equal(appUrl.pathname, ownerUrl.pathname); assert.equal(appUrl.username, "wf_manager_today_browser")
for (const sha of [process.env.WF_POLICY_IMPACT_HEAD_SHA, process.env.GITHUB_SHA]) assert.match(sha || "", /^[a-f0-9]{40}$/)
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), process.env.GITHUB_SHA)
execFileSync("git", ["merge-base", "--is-ancestor", process.env.WF_POLICY_IMPACT_HEAD_SHA, "HEAD"])
const owner = makeRlsTestPrisma(ownerUrl.href), suffix = randomUUID(), password = "Fixture!9-" + randomUUID()
const directory = process.env.WF_POLICY_IMPACT_OUTPUT_DIR || "artifacts/workforce-policy-employee-impact"
await mkdir(directory, { recursive: true })
const dayZero = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
const day = n => new Date(dayZero.getTime() + n * 86400000)
function canonical(v) {
  if (!v || typeof v !== "object") return v
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(canonical)
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]))
}
const digest = v => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex")
const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: "PRIVATE_FIXTURE_DEFINITION" }
const futureDefinition = { ...definition, expectedWorkSeconds: 0, longPauseThresholdSeconds: 0 }
const cases = [], sessions = [], http = [], cleanup = [], contexts = [], organizations = [], principals = [], policies = [], agents = []
const releases = [], authTimes = [], requests = []
let browser, activePage, stage = "fixture-seed", failure = null, failed = false
const endpoint = id => `/api/v1/workforce/configuration/policies/${id}/employee-impact`
async function facts() {
  const tables = await owner.$queryRawUnsafe(`SELECT table_name AS name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='organizationId' AND table_name<>'users' ORDER BY table_name`)
  const result = []
  for (const { name } of tables) {
    assert.match(name, /^[a-zA-Z0-9_]+$/)
    const rows = await owner.$queryRawUnsafe(`SELECT to_jsonb(t) AS value FROM public."${name}" t
      WHERE "organizationId" IN ($1,$2) ORDER BY to_jsonb(t)::text LIMIT 501`, ...organizations)
    assert.ok(rows.length <= 500); result.push({ table: name, rows: rows.length, sha256: digest(rows) })
  }
  // Only login metadata may change on users. Preserve every other user field.
  const users = await owner.user.findMany({ where: { organizationId: { in: organizations } }, orderBy: { id: "asc" } })
  result.push({ table: "users-except-explicit-login-metadata", rows: users.length,
    sha256: digest(users.map(row => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !["lastLogin", "loginCount", "updatedAt"].includes(key))))) })
  const organizationRows = await owner.organization.findMany({ where: { id: { in: organizations } }, orderBy: { id: "asc" } })
  result.push({ table: "organizations", rows: organizationRows.length, sha256: digest(organizationRows) })
  return result
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 4)
  for (const index of [0, 1]) {
    const org = await owner.organization.create({ data: { name: "Impact UI fixture", slug: `impact-ui-${index}-${suffix}`,
      plan: "enterprise", modules: { "workforce-hrm": true }, features: ["workforce-hrm", "workforce-granular-access-v1"] } })
    organizations.push(org.id)
    await owner.mtmSetting.create({ data: { organizationId: org.id, key: "timezone", value: "UTC" } })
    const team = await owner.mtmTeam.create({ data: { organizationId: org.id, code: `impact-ui-${index}-${suffix}`, name: "Recorded impact team" } })
    for (const kind of index === 0 ? ["hr", "team", "crm"] : ["foreign"]) {
      const user = await owner.user.create({ data: { organizationId: org.id, email: `${kind}-impact-${suffix}@example.test`, name: "Impact UI principal",
        role: kind === "crm" ? "admin" : "manager", passwordHash, require2fa: false, totpEnabled: false, smsAuthEnabled: false } })
      principals.push({ ...user, kind, slug: org.slug })
      if (kind !== "crm") await owner.workforceAccessGrant.create({ data: { organizationId: org.id, principalUserId: user.id, role: "HR_ADMIN",
        scopeKind: kind === "team" ? "TEAM" : "ORGANIZATION", scopeTeamId: kind === "team" ? team.id : null,
        effectiveFrom: day(-1), operationId: `impact-grant-${kind}-${suffix}`, grantedByUserId: user.id, grantReasonCode: "HOSTED_IMPACT_FIXTURE" } })
    }
    const actor = principals.find(p => p.organizationId === org.id && p.kind !== "crm")
    if (index === 0) {
      for (const [label, teamId] of [["Organization", null], ["Team", team.id]]) {
        const pair = []
        for (const version of [1, 2]) pair.push(await owner.workforcePolicy.create({ data: { organizationId: org.id, teamId, version,
          name: "Recorded impact " + label, status: version === 1 ? "ACTIVE" : "DRAFT", effectiveFrom: day(version === 1 ? -365 : 30),
          definition: version === 1 ? definition : futureDefinition, definitionHash: digest(version === 1 ? definition : futureDefinition),
          createdByUserId: actor.id, activatedByUserId: version === 1 ? actor.id : null, activatedAt: version === 1 ? day(-365) : null } }))
        policies.push(pair)
      }
      for (const [n, role] of ["AGENT", "MANAGER", "ADMIN"].entries()) agents.push(await owner.mtmAgent.create({ data: {
        organizationId: org.id, name: `PRIVATE_IMPACT_EMPLOYEE_${n}`, role, teamId: team.id, status: "ACTIVE" } }))
      await owner.workforceEmployeeTeamMembership.createMany({ data: [
        { organizationId: org.id, agentId: agents[0].id, teamId: team.id, effectiveAt: day(-30), source: "FIXTURE" },
        { organizationId: org.id, agentId: agents[1].id, teamId: null, effectiveAt: day(-30), source: "FIXTURE" },
        { organizationId: org.id, agentId: agents[1].id, teamId: team.id, effectiveAt: day(31), source: "FIXTURE" },
      ] })
      await owner.mtmAgent.create({ data: { organizationId: org.id, name: "PRIVATE_INACTIVE_EMPLOYEE", status: "INACTIVE" } })
    } else {
      await owner.mtmAgent.create({ data: { organizationId: org.id, name: "PRIVATE_FOREIGN_EMPLOYEE", status: "ACTIVE" } })
      await owner.workforcePolicy.create({ data: { organizationId: org.id, name: "Foreign impact policy", version: 1, status: "ACTIVE",
        effectiveFrom: day(-365), activatedAt: day(-365), activatedByUserId: actor.id, createdByUserId: actor.id, definition, definitionHash: digest(definition) } })
    }
  }
}
async function authenticate(context, principal) {
  while (authTimes.length && authTimes[0] <= Date.now() - 61000) authTimes.shift()
  if (authTimes.length >= 8) { await delay(Math.max(0, authTimes[0] + 61000 - Date.now()) + 25); authTimes.shift() }
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120000 }); assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string"); authTimes.push(Date.now())
  const callback = await context.request.post("/api/auth/callback/credentials", { timeout: 120000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: origin.href + "workforce" } })
  assert.equal(callback.status(), 200); const redirect = new URL((await callback.json()).url, origin); assert.equal(redirect.origin, origin.origin)
  assert.equal(redirect.searchParams.get("error"), null)
  const sessionResponse = await context.request.get("/api/auth/session"); assert.equal(sessionResponse.status(), 200)
  const session = await sessionResponse.json(); assert.equal(session.user.id, principal.id); assert.equal(session.user.organizationId, principal.organizationId)
  sessions.push({ csrfStatus: 200, callbackStatus: 200, realPrincipalAndTenant: true })
}
async function open(locale = "en", width = 1440) {
  const context = await browser.newContext({ baseURL: origin.href, viewport: { width, height: 900 }, locale, reducedMotion: "reduce" }); contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.origin, sameSite: "Lax" }])
  await authenticate(context, principals.find(p => p.kind === "hr"))
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(120000)
  page.on("request", r => { const url = new URL(r.url()); if (url.pathname.startsWith("/api/v1/workforce/")) requests.push({ method: r.method(), path: url.pathname }) })
  const copy = JSON.parse(await readFile(`messages/${locale}.json`, "utf8"))
  await page.goto("/workforce/configuration/policy-versions", { waitUntil: "domcontentloaded" }); await page.locator("#workforce-policy-version-query").waitFor()
  return { context, page, locale, width, ui: copy.workforcePolicyVersionComparison, impact: copy.workforcePolicyEmployeeImpact,
    section: page.locator('section[aria-labelledby="workforce-policy-employee-impact-title"]') }
}
async function select(view, pair = policies[0]) {
  const impactReads = requests.filter(row => row.path.endsWith("/employee-impact")).length
  const searched = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/search"))
  await view.page.locator("#workforce-policy-version-query").fill(pair[0].name)
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).click(); assert.equal((await searched).status(), 200)
  await view.page.locator("#workforce-policy-version-from").selectOption(pair[0].id); await view.page.locator("#workforce-policy-version-to").selectOption(pair[1].id)
  const compared = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/compare"))
  await view.page.getByRole("button", { name: view.ui.compare, exact: true }).click(); assert.equal((await compared).status(), 200)
  await view.section.getByRole("button", { name: view.impact.preview, exact: true }).waitFor()
  assert.equal(requests.filter(row => row.path.endsWith("/employee-impact")).length, impactReads)
  view.selectedPair = pair
}
async function readPreview(view, expected = 200, keyboard = false) {
  const fetched = view.page.waitForResponse(r => new URL(r.url()).pathname === endpoint(view.selectedPair[1].id))
  const button = view.section.getByRole("button", { name: view.impact.preview, exact: true })
  if (keyboard) { await nativeFocus(view, button); await view.page.keyboard.press("Enter") } else await button.click()
  const response = await fetched
  assert.equal(response.status(), expected); const headers = response.headers()
  assert.match(headers["cache-control"] || "", /private/); assert.match(headers["cache-control"] || "", /no-store/)
  assert.equal(headers["x-content-type-options"], "nosniff"); assert.ok((headers.vary || "").split(/\s*,\s*/).some(v => v.toLowerCase() === "cookie"))
  http.push({ expectedStatus: expected, actualStatus: response.status(), privateNoStoreNosniffCookieToken: true })
  assert.equal(response.request().method(), "GET"); assert.equal(response.request().postData(), null)
  return response.json()
}

async function displayed(view, body, pair = policies[0], expected = { directoryEmployees: 3, selectedDraft: 2, teamOverride: 1, missingMembership: 1 }) {
  assert.equal(body.success, true); const preview = body.data.preview
  assert.equal(preview.draft.id, pair[1].id); assert.equal(preview.draft.version, pair[1].version)
  assert.equal(preview.draft.definitionHash, pair[1].definitionHash); assert.equal(preview.draft.effectiveFrom, day(30).toISOString().slice(0, 10))
  assert.equal(preview.canonicalActivationRequired, true); assert.equal(preview.guaranteedAtActivation, false)
  assert.equal(preview.employeeIdentityReturned, false); assert.equal(preview.timezone, "UTC")
  for (const [key, value] of Object.entries(expected)) assert.equal(preview.counts[key], value)
  assert.equal(preview.groups.reduce((sum, group) => sum + group.count, 0), preview.counts.selectedDraft)
  const serialized = JSON.stringify(body)
  for (const agent of agents) assert.equal(serialized.includes(agent.id), false)
  assert.equal(serialized.includes("PRIVATE_IMPACT_EMPLOYEE"), false); assert.equal(serialized.includes("PRIVATE_FIXTURE_DEFINITION"), false)
  await view.section.getByText(view.impact.boundary, { exact: true }).waitFor()
  await view.section.getByText(view.impact.membership, { exact: true }).waitFor()
  assert.equal(await view.section.locator("dl dt").count(), 11)
  for (const [index, key] of Object.keys(preview.counts).entries()) {
    assert.equal(await view.section.locator("dl dt").nth(index).innerText(), view.impact.counts[key])
    assert.equal(await view.section.locator("dl dd").nth(index).innerText(), new Intl.NumberFormat(view.locale).format(preview.counts[key]))
  }
  const summary = view.section.locator("summary")
  if (view.locale === "en" && view.width === 320) { await nativeFocus(view, summary); await view.page.keyboard.press("Enter") }
  else await summary.press("Enter")
  assert.equal(await view.section.locator("details").getAttribute("open"), "")
  assert.equal(await view.section.locator("tbody tr").count(), preview.groups.length * 5)
  const text = await view.section.innerText()
  for (const agent of agents) { assert.equal(text.includes(agent.id), false); assert.equal(text.includes(agent.name), false) }
  assert.equal(text.includes(pair[1].definitionHash), false); assert.equal(text.includes("PRIVATE_FIXTURE_DEFINITION"), false)
  return preview
}
async function geometry(view) {
  const result = await view.section.evaluate(element => {
    const rect = element.getBoundingClientRect(), buttons = [...element.querySelectorAll("button,summary")]
    return { insideWidth: rect.left >= -1 && rect.right <= innerWidth + 1,
      pageHasNoHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      controls44px: buttons.every(button => button.getBoundingClientRect().height >= 43),
      localScrollRegions: [...element.querySelectorAll('[role="region"]')].map(region => ({
        keyboardFocusable: region.tabIndex === 0, contained: region.scrollWidth >= region.clientWidth,
        horizontalScrollNeeded: region.scrollWidth > region.clientWidth,
        overflowX: getComputedStyle(region).overflowX })) }
  })
  assert.equal(result.insideWidth, true); assert.equal(result.pageHasNoHorizontalOverflow, true); assert.equal(result.controls44px, true)
  assert.ok(result.localScrollRegions.every(region => region.keyboardFocusable && region.contained && region.overflowX === "auto"))
  if (view.width === 320) assert.ok(result.localScrollRegions.every(region => region.horizontalScrollNeeded))
  return result
}
async function nativeFocus(view, target) {
  await target.scrollIntoViewIfNeeded(); await view.page.keyboard.press("Escape")
  for (let n = 0; n < 100; n++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      assert.equal(await target.evaluate(element => element.matches(":focus-visible")), true); return
    }
    await view.page.keyboard.press("Tab")
  }
  assert.fail("Bounded native tab target was not reached")
}

async function replaceSession(view, principal) {
  const replacement = await browser.newContext({ baseURL: origin.href }); contexts.push(replacement)
  await authenticate(replacement, principal)
  await view.context.clearCookies(); await view.context.addCookies(await replacement.cookies())
  await view.context.addCookies([{ name: "NEXT_LOCALE", value: view.locale, url: origin.origin, sameSite: "Lax" }])
  const session = await view.context.request.get("/api/auth/session"); assert.equal(session.status(), 200)
  const body = await session.json(); assert.equal(body.user.id, principal.id); assert.equal(body.user.organizationId, principal.organizationId)
}
async function waitForTransport(pending) {
  let timer
  try { await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture transport deadline")), 150000) })]) }
  finally { clearTimeout(timer) }
}
try {
  await seed(); const before = await facts()
  browser = await chromium.launch({ headless: true })
  for (const locale of ["en", "ru", "az"]) for (const width of [320, 768, 1440]) {
    stage = `aggregate-${locale}-${width}`
    const view = await open(locale, width); await select(view)
    const native = locale === "en" && width === 320
    const preview = await displayed(view, await readPreview(view, 200, native))
    assert.equal(preview.groups.length, 1); assert.equal(preview.groups[0].count, 2)
    const fields = preview.groups[0].fields
    assert.equal(fields.length, 5); assert.deepEqual(fields[0], { field: "expectedWorkSeconds", before: 28800, after: 0, changed: true, deltaSeconds: -28800 })
    assert.deepEqual(fields[4], { field: "longPauseThresholdSeconds", before: null, after: 0, changed: true, deltaSeconds: null })
    if (native) {
      const region = view.section.getByRole("region", { name: view.impact.tableLabel, exact: true })
      await nativeFocus(view, region); await view.page.keyboard.press("ArrowRight")
    }
    const layout = await geometry(view); assert.deepEqual(await facts(), before)
    await view.section.scrollIntoViewIfNeeded(); await view.page.screenshot({ path: `${directory}/employee-impact-${locale}-${width}.png` })
    cases.push({ name: stage, status: "PASS", locale, width, real200: true, onDemandOnly: true, aggregateAndFiveFieldsExact: true,
      missingHistoryNoMutableFallback: true, currentDirectoryAllRoles: true, employeeIdentityAndPayloadOmitted: true, layout,
      nativePreviewDetailsAndLocalScroll: native })
    await view.context.close()
  }
  stage = "recorded-team-draft-scope"
  const view = await open(); await select(view, policies[1])
  const team = await displayed(view, await readPreview(view), policies[1], { directoryEmployees: 3, selectedDraft: 1, teamOverride: 0, outsideDraftTeam: 2, missingMembership: 1 })
  assert.equal(team.scope.teamId, policies[1][1].teamId); assert.equal(team.groups.length, 1)
  cases.push({ name: stage, status: "PASS", real200: true, exactRecordedTeamOnly: true, outsideTeamCount: 2 })

  stage = "missing-baseline-new-coverage-no-invented-delta"
  const predecessor = policies[0][0]
  try {
    await owner.workforcePolicy.update({ where: { id: predecessor.id }, data: { status: "RETIRED", retiredAt: day(0) } })
    const phase = await facts(); await select(view)
    const projected = await displayed(view, await readPreview(view), policies[0], { directoryEmployees: 3, selectedDraft: 2, newlyCovered: 2, noPolicyBefore: 2, calculationChanged: 0 })
    assert.equal(projected.groups[0].before, null); assert.ok(projected.groups[0].fields.every(row => row.before === null && row.deltaSeconds === null))
    assert.equal(await view.section.getByText(view.impact.noBaseline, { exact: true }).count(), 5)
    assert.deepEqual(await facts(), phase)
    cases.push({ name: stage, status: "PASS", real200: true, explicitMissingBaseline: true, noInventedDelta: true, ownerFixtureMaintenanceOnly: true })
  } finally { await owner.workforcePolicy.update({ where: { id: predecessor.id }, data: { status: predecessor.status, retiredAt: predecessor.retiredAt, updatedAt: predecessor.updatedAt } }) }
  assert.deepEqual(await facts(), before)

  stage = "transport-loss-after-actual-200-safe-retry"
  await select(view)
  let server200 = false, readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject }); ready.catch(() => {})
  await view.page.route("**/employee-impact", async route => {
    try { const response = await route.fetch({ timeout: 120000 }); assert.equal(response.status(), 200); server200 = true; readyResolve(); await route.abort("failed") }
    catch (error) { readyReject(error); try { await route.abort("failed") } catch { /* Preserve the first failure. */ } }
  }, { times: 1 })
  await view.section.getByRole("button", { name: view.impact.preview, exact: true }).click(); await waitForTransport(ready)
  await view.section.getByRole("alert").getByText(view.impact.failed, { exact: true }).waitFor(); assert.equal(await view.section.locator("dl").count(), 0)
  assert.equal(server200, true); await displayed(view, await readPreview(view)); assert.deepEqual(await facts(), before)
  cases.push({ name: stage, status: "PASS", actualServer200: true, controlledTransportLoss: true, genericFailureThenReal200Retry: true, businessFactsUnchanged: true })

  stage = "actual-empty-current-directory"
  try {
    for (const agent of agents) await owner.mtmAgent.update({ where: { id: agent.id }, data: { status: "INACTIVE" } })
    const phase = await facts(); const empty = await displayed(view, await readPreview(view), policies[0], { directoryEmployees: 0, selectedDraft: 0, unchangedSelection: 0 })
    assert.equal(empty.groups.length, 0); assert.ok(Object.values(empty.counts).every(n => n === 0)); assert.equal(await view.section.locator("table").count(), 0)
    assert.deepEqual(await facts(), phase); cases.push({ name: stage, status: "PASS", real200: true, elevenZeroCounts: true, noInventedGroups: true, ownerFixtureMaintenanceOnly: true })
  } finally { for (const agent of agents) await owner.mtmAgent.update({ where: { id: agent.id }, data: { status: agent.status, updatedAt: agent.updatedAt } }) }
  assert.deepEqual(await facts(), before)

  stage = "controlled-invalid-guarantee-receipt-rejected"
  let actual200 = false
  await view.page.route("**/employee-impact", async route => {
    const response = await route.fetch({ timeout: 120000 }); assert.equal(response.status(), 200); actual200 = true
    const body = await response.json(); body.data.preview.guaranteedAtActivation = true
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  await view.section.getByRole("button", { name: view.impact.preview, exact: true }).click()
  await view.section.getByRole("alert").getByText(view.impact.failed, { exact: true }).waitFor()
  assert.equal(actual200, true); assert.equal(await view.section.locator("dl").count(), 0); assert.deepEqual(await facts(), before)
  cases.push({ name: stage, status: "PASS", realServer200BeforeControlledCorruption: true, controlledTransportReceiptCorruption: true, rejectedFalseGuarantee: true })

  for (const kind of ["team", "crm"]) {
    stage = `real-${kind}-cookie-403-clears-parent`
    const denied = await open(); await select(denied); await displayed(denied, await readPreview(denied))
    await replaceSession(denied, principals.find(p => p.kind === kind)); await readPreview(denied, 403)
    await denied.page.getByText(denied.ui.denied, { exact: true }).waitFor()
    assert.equal(await denied.page.locator("#workforce-policy-version-query").count(), 0); assert.equal(await denied.page.locator("select").count(), 0)
    assert.equal(await denied.section.count(), 0); assert.equal(await denied.page.getByRole("table").count(), 0); assert.deepEqual(await facts(), before)
    cases.push({ name: stage, status: "PASS", actualChangedCredentialCookieSession: true, actual403: true, allPrivateParentCleared: true, noBusinessWrite: true })
  }
  stage = "real-tenant-provider-refresh-ignores-held-old-200"
  const changed = await open(); await select(changed)
  let release, resolveReady, rejectReady, heldPreview; const complete = []
  const stop = new Promise(resolve => { release = resolve }), heldReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  releases.push(release); heldReady.catch(() => {})
  await changed.page.route("**/employee-impact", async route => {
    let response
    try { response = await route.fetch({ timeout: 120000 }); assert.equal(response.status(), 200); heldPreview = (await response.json()).data.preview }
    catch (error) { rejectReady(error); try { await route.abort("failed") } catch { /* Preserve original failure. */ } return }
    resolveReady(); await stop
    try { await route.fulfill({ response }); complete.push("DELIVERED") } catch { complete.push("ABORTED_AFTER_SESSION_CHANGE") }
  }, { times: 1 })
  await changed.section.getByRole("button", { name: changed.impact.preview, exact: true }).click(); await waitForTransport(heldReady)
  assert.equal(await changed.section.getByRole("button").isDisabled(), true)
  const foreign = principals.find(p => p.kind === "foreign"); await replaceSession(changed, foreign)
  const sessionRead = changed.page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/session")
  await changed.page.evaluate(() => { const channel = new BroadcastChannel("next-auth"); channel.postMessage({ event: "session", data: { trigger: "getSession" } }); channel.close() })
  const sessionResponse = await sessionRead; assert.equal(sessionResponse.status(), 200); const session = await sessionResponse.json()
  assert.equal(session.user.id, foreign.id); assert.equal(session.user.organizationId, foreign.organizationId)
  await changed.section.getByText(changed.impact.chooseDraft, { exact: true }).waitFor()
  assert.equal(await changed.page.locator("#workforce-policy-version-from").inputValue(), ""); assert.equal(await changed.page.locator("#workforce-policy-version-to").inputValue(), "")
  release(); for (let n = 0; n < 100 && complete.length === 0; n++) await delay(20)
  assert.equal(complete.length, 1); assert.equal(await changed.section.locator("dl").count(), 0)
  assert.equal((await changed.section.innerText()).includes(heldPreview.draft.name), false); assert.deepEqual(await facts(), before)
  cases.push({ name: stage, status: "PASS", actualOldServer200: true, actualNewPrincipalAndTenantSession200: true,
    sessionRefresh: "NATIVE_AUTHJS_BROADCAST_REAL_SESSION_GET", parentSelectionsAndAggregatesCleared: true, oldAggregateNotRendered: true, transportCompletion: complete[0] })
  assert.ok(requests.every(request => request.method === "GET")); assert.equal(cases.length, 17)
  assert.equal(new Date().toISOString().slice(0, 10), dayZero.toISOString().slice(0, 10))
} catch (error) {
  failed = true; const position = /workforce-policy-employee-impact-browser-evidence\.mjs:(\d+):(\d+)/.exec(error?.stack || "")
  failure = { stage, name: ["AssertionError", "TimeoutError"].includes(error?.name) ? error.name : "Error",
    sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
    diagnostic: "Original failure retained as fixed category/position; no raw stack, error, response, SQL, private IDs, credentials, tokens or cookies" }
  if (activePage && !activePage.isClosed()) try { await activePage.screenshot({ path: directory + "/employee-impact-original-failure.png" }) } catch { /* Failure remains FAIL. */ }
} finally {
  for (const release of releases) release()
  for (const context of contexts) try { await context.close() } catch { failed = true }
  if (browser) try { await browser.close() } catch { failed = true }
  try {
    await owner.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
      await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships DISABLE TRIGGER workforce_employee_team_memberships_immutable`
      await tx.$executeRaw`ALTER TABLE workforce_access_grants DISABLE TRIGGER workforce_access_grants_append_only`
      await tx.workforceEmployeeTeamMembership.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.workforceAccessGrant.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.mtmAgent.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.mtmSetting.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.mtmTeam.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.user.deleteMany({ where: { organizationId: { in: organizations } } })
      await tx.organization.deleteMany({ where: { id: { in: organizations } } })
      await tx.$executeRaw`ALTER TABLE workforce_employee_team_memberships ENABLE TRIGGER workforce_employee_team_memberships_immutable`
      await tx.$executeRaw`ALTER TABLE workforce_access_grants ENABLE TRIGGER workforce_access_grants_append_only`
    }, { timeout: 30000 })
    assert.equal(await owner.organization.count({ where: { id: { in: organizations } } }), 0)
    for (const model of ["workforceEmployeeTeamMembership", "workforcePolicy", "workforceAccessGrant", "mtmAgent", "mtmSetting", "mtmTeam", "user"]) {
      assert.equal(await owner[model].count({ where: { organizationId: { in: organizations } } }), 0)
    }
    const guards = await owner.$queryRawUnsafe("SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('workforce_employee_team_memberships_immutable','workforce_access_grants_append_only')")
    assert.equal(guards.length, 2); assert.ok(guards.every(row => row.tgenabled === "O")); cleanup.push({ action: "scoped-row-absence-and-both-named-guards-restored", status: "PASS" })
  } catch { failed = true; cleanup.push({ action: "scoped-row-absence-or-guards", status: "FAIL" }) }
  try { await owner.$disconnect(); cleanup.push({ action: "owner-disconnect", status: "PASS" }) } catch { failed = true }
  const paths = ["scripts/workforce-policy-employee-impact-browser-evidence.mjs", "scripts/_rls.mjs", ".github/workflows/workforce-policy-employee-impact-evidence.yml",
    "scripts/ci/fixtures/workforce-policy-employee-impact.sql", "scripts/ci/fixtures/workforce-manager-today-browser.sql", "scripts/ci/fixtures/workforce-policy-version-browser.sql",
    "src/lib/workforce/policy-employee-impact-preview.ts", "src/lib/workforce/policy-employee-impact-read.ts", "src/lib/workforce/policy-employee-impact-receipt.ts",
    "src/components/workforce/workforce-policy-employee-impact-preview.tsx", "src/components/workforce/workforce-policy-version-comparison.tsx",
    "src/app/api/v1/workforce/configuration/policies/[id]/employee-impact/route.ts", "src/app/api/v1/workforce/configuration/policies/search/route.ts", "src/app/api/v1/workforce/configuration/policies/compare/route.ts",
    "src/lib/workforce/policy-definition.ts", "src/lib/workforce/policy-resolution.ts", "src/lib/workforce/policy-future-window-preview.ts", "src/lib/with-workforce-rls-auth.ts",
    "src/lib/auth.ts", "src/lib/rls-context.ts", "src/lib/prisma.ts", "src/lib/rate-limit.ts", "src/proxy.ts", "src/lib/with-rls.ts", "src/components/providers.tsx",
    "src/components/ui/button.tsx", "src/app/(dashboard)/workforce/configuration/policy-versions/page.tsx", "src/app/(dashboard)/layout.tsx", "src/lib/timezone.ts",
    "src/lib/mtm-settings.ts", "src/lib/mtm/mobile-week.ts", "messages/en.json", "messages/ru.json", "messages/az.json", "prisma/schema.prisma", "package.json", "package-lock.json"]
  const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
  await writeFile(directory + "/employee-impact-browser-receipt.json", JSON.stringify({ status: failed ? "FAIL" : "PASS", stage, failure,
    cases, requiredCases: 17, sessions, http, workforceRequests: { count: requests.length, allGet: requests.every(r => r.method === "GET") }, cleanup, sourceBindings,
    candidateHead: process.env.WF_POLICY_IMPACT_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA, completedAt: new Date().toISOString(),
    boundary: "Disposable hosted Chromium, real credentials/session/authorized aggregate GET. Current ACTIVE directory all roles, recorded membership only, no employee identities/full definition. Explicit what-if is not future employment eligibility or activation guarantee. Controlled transport loss/corruption and native AuthJS notification are fixture drivers distinct from server/auth mocks or end-user tenant switching. Owner setup/status replacements/guard-disabled scoped cleanup are fixture maintenance, not canonical writers. Bounded native controls/geometry are not full WCAG, pixel occlusion, human AT, native zoom, Android, load or production feature/activation/pilot acceptance." }, null, 2) + "\n", { flag: "wx" })
  process.exitCode = failed ? 1 : 0
}
