import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Disposable hosted browser proof only; this is never a production seed tool.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Hosted Actions required")
assert.equal(process.env.CI, "true", "Explicit CI required")
assert.equal(process.env.WF_POLICY_VERSION_BROWSER, "1", "Fixture opt-in required")
assert.notEqual(process.env.NODE_ENV, "production", "Production is excluded")
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const origin = new URL(process.env.WF_POLICY_VERSION_BROWSER_BASE_URL)
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname), "Loopback application required")
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname), "Loopback fixture database required")
  assert.equal(url.pathname, "/workforce_manager_today_browser", "Dedicated policy fixture database required")
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
assert.match(process.env.WF_POLICY_VERSION_BROWSER_HEAD_SHA || "", /^[a-f0-9]{40}$/, "Candidate HEAD must be exact full SHA")
assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/, "Checked CI SHA must be exact full SHA")
const outputDirectory = process.env.WF_POLICY_VERSION_BROWSER_OUTPUT_DIR || "artifacts/workforce-policy-version-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const searchEndpoint = "/api/v1/workforce/configuration/policies/search"
const comparisonEndpoint = "/api/v1/workforce/configuration/policies/compare"
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`
const date = new Date().toISOString().slice(0, 10)
const workDate = new Date(`${date}T00:00:00.000Z`)
const earlier = days => new Date(workDate.getTime() - days * 86_400_000)
const future = days => new Date(workDate.getTime() + days * 86_400_000)
function currentDate() {
  assert.equal(new Date().toISOString().slice(0, 10), date, "Real UTC date crossed midnight; preserve failure without reseeding")
}
const receipts = {
  version: 1,
  candidateHead: process.env.WF_POLICY_VERSION_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA,
  harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
  startedAt: new Date().toISOString(),
  date,
  sourceBindings: await Promise.all([
    "scripts/workforce-policy-version-browser-evidence.mjs", ".github/workflows/workforce-policy-version-browser-evidence.yml",
    "scripts/ci/fixtures/workforce-manager-today-browser.sql", "scripts/ci/fixtures/workforce-policy-version-browser.sql",
    "src/components/workforce/workforce-policy-version-comparison.tsx", "src/app/(dashboard)/workforce/configuration/page.tsx",
    "src/app/(dashboard)/workforce/configuration/policy-versions/page.tsx", "src/lib/workforce/policy-version-comparison.ts",
    "src/lib/with-workforce-rls-auth.ts", "src/lib/workforce/policy-definition.ts",
    "src/app/api/v1/workforce/configuration/policies/search/route.ts", "src/app/api/v1/workforce/configuration/policies/compare/route.ts",
    "messages/en.json", "messages/ru.json", "messages/az.json", "prisma/schema.prisma",
    "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql",
    "prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql",
    "prisma/migrations/20260829140000_workforce_system_provisioning_defaults/migration.sql",
  ].map(async path => { const raw = await readFile(new URL("../" + path, import.meta.url)); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } })),
  environment: "hosted Chromium / loopback Next dev / disposable PostgreSQL16",
  authentication: "real CSRF, credentials provider and session; no auth mocks",
  authenticationDiagnostics: [],
  cases: [],
  status: "RUNNING",
  limitations: ["Development bundle, not production build", "Synthetic disposable data only", "Historical owner-imported policy definitions, not canonical publication/activation/rollback writers", "No human AT/native zoom/whole-page keyboard/Android/physical/load/pilot acceptance", "Geometry/text checks do not prove pixel occlusion or whole-page accessibility", "Two recorded versions only; no effective-impact, digital signature/approval or production feature/grant activation"],
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
  "workforce_exception_cases", "workforce_exception_decisions", "workforce_policies",
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
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).workforcePolicyVersionComparison
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

const fields = ["expectedWorkSeconds", "lateGraceSeconds", "undertimeToleranceSeconds", "overtimeThresholdSeconds", "longPauseThresholdSeconds"]
const beforeDefinition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 300, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaqueRule: { mode: "historical-a" } }
const afterDefinition = { expectedWorkSeconds: 25200, lateGraceSeconds: 0, undertimeToleranceSeconds: 600, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: 0, opaqueRule: { mode: "historical-b" } }
// Fixed ASCII fixture keys only; independent of production hash/comparison code.
function fixtureCanonical(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(fixtureCanonical)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, fixtureCanonical(value[key])]))
}
function fixtureHash(value) { return createHash("sha256").update(JSON.stringify(fixtureCanonical(value))).digest("hex") }
async function seed() {
  currentDate()
  const passwordHash = await bcrypt.hash(password, 4)
  const organizations = []
  for (const key of ["a", "b"]) organizations.push(await admin.organization.create({ data: {
    name: `Policy browser fixture ${key}`, slug: `wf-policy-${suffix}-${key}`, plan: "enterprise",
    modules: { "workforce-hrm": true }, features: key === "a" ? ["workforce-hrm", "workforce-granular-access-v1"] : ["workforce-hrm"], settings: {},
  } }))
  const tenants = []
  for (const [index, organization] of organizations.entries()) {
    const people = []
    const keys = index === 0 ? [["issuer", "admin"], ["reader", "manager"], ["team-only", "manager"]] : [["legacy-admin", "admin"], ["foreign-reader", "manager"]]
    for (const [key, role] of keys) {
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `policy-${suffix}-${index}-${key}@example.test`, name: `Policy fixture ${key}`,
        passwordHash, role, require2fa: false, totpEnabled: false, smsAuthEnabled: false, preferredLanguage: "en",
      } })
      people.push({ ...user, key, slug: organization.slug })
    }
    const issuer = people[0], reader = people[1]
    const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Policy team ${index + 1}`, code: `POLICY-${suffix}-${index}`, isActive: true } })
    for (const principal of people.slice(1)) await admin.workforceAccessGrant.create({ data: {
      organizationId: organization.id, principalUserId: principal.id, role: "HR_ADMIN", scopeKind: principal.key === "team-only" ? "TEAM" : "ORGANIZATION",
      scopeTeamId: principal.key === "team-only" ? team.id : null, scopeSiteId: null, scopeAgentId: null,
      effectiveFrom: earlier(2), effectiveUntil: null, operationId: `policy-${suffix}-${index}-${principal.key}`,
      grantedByUserId: issuer.id, grantReasonCode: "BROWSER_FIXTURE_ONLY",
    } })
    async function policy(name, version, status, definition, teamId = null, badHash = false, window = null) {
      return admin.workforcePolicy.create({ data: {
        organizationId: organization.id, teamId, version, status, name,
        effectiveFrom: window?.from ?? (status === "ACTIVE" ? future(30) : earlier(365)),
        effectiveTo: window?.to ?? (status === "RETIRED" ? earlier(30) : null),
        definition, definitionHash: badHash ? "0".repeat(64) : fixtureHash(definition), provenance: "TENANT_ADMIN", createdByUserId: issuer.id,
        createdAt: earlier(3), activatedByUserId: status === "DRAFT" ? null : issuer.id,
        activatedAt: status === "DRAFT" ? null : earlier(3), retiredAt: status === "RETIRED" ? earlier(2) : null,
      } })
    }
    const before = await policy("Recorded Organization Before", 1, "ACTIVE", beforeDefinition, null, false, { from: earlier(365), to: future(29) })
    const after = await policy("Recorded Organization After", 2, "ACTIVE", afterDefinition)
    const teamBefore = await policy("Recorded Team Before", 1, "RETIRED", beforeDefinition, team.id)
    const teamAfter = await policy("Recorded Team After", 2, "ACTIVE", afterDefinition, team.id)
    const corrupted = index === 0 ? await policy("Invalid Integrity Draft", 3, "DRAFT", afterDefinition, null, true) : null
    const catalog = []
    if (index === 0) for (let n = 1; n <= 21; n++) catalog.push(await policy(`Catalog ${String(n).padStart(2, "0")}`, 99 + n, "DRAFT", beforeDefinition))
    tenants.push({ organization, issuer, reader, team, people, before, after, teamBefore, teamAfter, corrupted, catalog })
  }
  return { primary: tenants[0], foreign: tenants[1] }
}
async function verifyPublishedWindows(fixture) {
  for (const tenant of [fixture.primary, fixture.foreign]) {
    assert.equal(tenant.before.status, "ACTIVE"); assert.equal(tenant.after.status, "ACTIVE")
    assert.equal(tenant.before.effectiveTo.getTime() + 86_400_000, tenant.after.effectiveFrom.getTime())
    assert.ok(tenant.after.effectiveFrom > workDate)
  }
  // Separate isolated owner probes; no canonical writer or app write grant.
  const rejected = []
  for (const [kind, source] of [["ORGANIZATION", fixture.primary.before], ["TEAM", fixture.primary.teamAfter]]) {
    let postgresCode = null
    try {
      await admin.$transaction(tx => tx.$executeRaw`
        INSERT INTO public.workforce_policies
        SELECT (jsonb_populate_record(NULL::public.workforce_policies,
          to_jsonb(p) || jsonb_build_object('id', ${randomUUID()}::text, 'version', 2147483640))).*
        FROM public.workforce_policies p WHERE id=${source.id} AND "organizationId"=${fixture.primary.organization.id}
      `)
    } catch (error) { if (error?.code !== "P2010") throw error; postgresCode = error.meta?.code }
    assert.equal(postgresCode, "23P01", "Only PostgreSQL exclusion violation proves overlap rejection")
    assert.equal(await admin.workforcePolicy.count({ where: { organizationId: fixture.primary.organization.id, version: 2147483640 } }), 0)
    rejected.push({ kind, postgresCode, rolledBack: true })
  }
  return { twoAdjacentPublishedOrganizationVersions: true, futureVersionNotCurrentlyEffective: true, isolatedOwnerOverlapRejections: rejected, canonicalWriterAcceptance: "NOT RUN" }
}
async function sensitive(response, status) {
  assert.equal(response.status(), status)
  const headers = await response.headers()
  assert.match(headers["cache-control"] || "", /private/)
  assert.match(headers["cache-control"] || "", /no-store/)
  assert.equal(headers["x-content-type-options"], "nosniff")
  return response.json()
}
function responseFor(response, endpoint) {
  const url = new URL(response.url())
  return url.origin === origin.origin && url.pathname === endpoint && response.request().method() === "GET"
}
async function open(principal, locale, width) {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, locale, reducedMotion: "reduce" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.origin, sameSite: "Lax" }])
  await authenticate(context, principal)
  const page = await context.newPage(); activePage = page
  const writes = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/workforce/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push({ path: url.pathname, method: request.method() })
  })
  await page.goto("/workforce/configuration/policy-versions", { waitUntil: "domcontentloaded" })
  const ui = await copy(locale)
  await page.getByRole("heading", { level: 1, name: ui.title, exact: true }).waitFor({ timeout: 120_000 })
  await page.getByLabel(ui.searchLabel, { exact: true }).waitFor({ timeout: 120_000 })
  assert.notEqual(new URL(page.url()).pathname, "/login")
  return { context, page, ui, locale, writes }
}
async function namedSearch(view, q, expected) {
  activePage = view.page
  stage = "named-search"
  await view.page.getByLabel(view.ui.searchLabel, { exact: true }).fill(q)
  const pending = view.page.waitForResponse(response => responseFor(response, searchEndpoint) && new URL(response.url()).searchParams.get("q") === q, { timeout: 120_000 })
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).click()
  const body = await sensitive(await pending, 200)
  assert.equal(body.success, true); assert.equal(body.data.query, q); assert.equal(body.data.limit, 20)
  assert.equal(body.data.hasMore, expected.length > 20)
  const sorted = [...expected].sort((a, b) => b.version - a.version || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 20)
  assert.deepEqual(body.data.policies.map(row => row.id), sorted.map(row => row.id))
  for (const row of body.data.policies) assert.deepEqual(Object.keys(row).sort(), ["id", "name", "status", "team", "teamId", "version"])
  // Wait for React commit even though the network response completed first.
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).waitFor()
  const result = view.page.getByText(expected.length ? view.ui.searchResults.replace("{query}", q).replace("{count}", String(sorted.length)) : view.ui.empty.replace("{query}", q), { exact: true })
  await result.waitFor()
  return body.data
}
async function tabTo(page, locator) {
  for (let count = 1; count <= 180; count++) {
    await page.keyboard.press("Tab")
    if (await locator.evaluate(element => document.activeElement === element)) return count
  }
  assert.fail("Native keyboard target was not reached within 180 tabs")
}
function expectedComparison(body, before, after, reverse = false) {
  assert.equal(body.success, true)
  const c = body.data.comparison
  assert.deepEqual(Object.keys(body.data), ["comparison"])
  assert.equal(c.basis, "RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL")
  assert.equal(c.from.id, before.id); assert.equal(c.to.id, after.id)
  assert.equal(c.from.definitionHash, before.definitionHash); assert.equal(c.to.definitionHash, after.definitionHash)
  assert.equal(c.scope.kind, before.teamId === null ? "ORGANIZATION" : "TEAM"); assert.equal(c.scope.teamId, before.teamId)
  assert.equal(c.changedCalculationFields, 3); assert.equal(c.opaqueDefinitionChanged, true)
  assert.equal(c.opaqueDefinitionInterpretation, "ADDITIONAL_HASH_VERIFIED_KEYS_NOT_DISPLAYED_OR_INTERPRETED")
  const a = reverse ? afterDefinition : beforeDefinition, b = reverse ? beforeDefinition : afterDefinition
  assert.deepEqual(c.fields, fields.map(field => ({ field, before: a[field], after: b[field], changed: a[field] !== b[field], deltaSeconds: a[field] === null || b[field] === null ? null : b[field] - a[field] })))
  for (const record of [c.from, c.to]) assert.deepEqual(Object.keys(record).sort(), ["definitionHash", "effectiveFrom", "effectiveTo", "id", "name", "status", "version"])
  assert.equal(JSON.stringify(c).includes("historical-a"), false); assert.equal(JSON.stringify(c).includes("historical-b"), false)
  return c
}
async function compare(view, before, after, reverse = false, native = false) {
  activePage = view.page
  stage = "named-pair-selection"
  await view.page.getByLabel(view.ui.from, { exact: true }).selectOption(before.id)
  await view.page.getByLabel(view.ui.to, { exact: true }).selectOption(after.id)
  const apply = view.page.getByRole("button", { name: view.ui.compare, exact: true })
  assert.equal(await apply.isEnabled(), true)
  let applyTabs = null
  if (native) { applyTabs = await tabTo(view.page, apply); assert.equal(await apply.evaluate(e => e.matches(":focus-visible")), true) }
  const pending = view.page.waitForResponse(response => responseFor(response, comparisonEndpoint) && new URL(response.url()).searchParams.get("from") === before.id && new URL(response.url()).searchParams.get("to") === after.id, { timeout: 120_000 })
  stage = "pair-comparison-response"
  if (native) await view.page.keyboard.press("Enter"); else await apply.click()
  const c = expectedComparison(await sensitive(await pending, 200), before, after, reverse)
  const region = view.page.getByRole("region", { name: view.ui.tableLabel, exact: true })
  await region.waitFor(); assert.equal(await region.count(), 1)
  const table = region.getByRole("table", { name: view.ui.tableLabel, exact: true })
  const rows = table.locator("tbody > tr")
  assert.equal(await rows.count(), 5)
  for (let i = 0; i < 5; i++) {
    const field = c.fields[i], row = rows.nth(i)
    assert.equal(await row.getByRole("rowheader").innerText(), view.ui.fields[field.field])
    const texts = await row.getByRole("cell").allTextContents()
    const expected = await view.page.evaluate(({ values, locale, pattern, notSet, notComparable }) => values.map((v, index) => v === null ? index === 2 ? notComparable : notSet : pattern.replace("{value}", new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v))), { values: [field.before, field.after, field.deltaSeconds], locale: view.locale, pattern: view.ui.seconds, notSet: view.ui.notSet, notComparable: view.ui.notComparable })
    assert.deepEqual(texts, expected)
  }
  await view.page.getByText(view.ui.integrityHint, { exact: true }).waitFor()
  await view.page.getByText(view.ui.opaqueChanged, { exact: true }).waitFor()
  await region.scrollIntoViewIfNeeded()
  const geometry = await region.evaluate(element => {
    const r = element.getBoundingClientRect()
    return { visible: r.width > 0 && r.height > 0, insideViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, documentNoHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth }
  })
  assert.deepEqual(geometry, { visible: true, insideViewport: true, documentNoHorizontalOverflow: true })
  let tableTabs = null
  if (native) { tableTabs = await tabTo(view.page, region); assert.equal(await region.evaluate(e => e.matches(":focus-visible")), true) }
  await view.page.screenshot({ path: `${outputDirectory}/comparison-${view.locale}-${reverse ? "reverse" : "forward"}.png` })
  assert.deepEqual(view.writes, [])
  return { exactFiveNumericAndLocalizedRows: true, nullZeroDistinct: true, signedDelta: reverse ? "reverse" : "forward", opaqueNotInterpreted: true, hashIntegrityNotApproval: true, applyTabs, tableTabs, geometry }
}
async function errorRead(context, endpoint, parameters, status, code, options = {}) {
  const response = await context.request.get(endpoint + "?" + new URLSearchParams(parameters), { timeout: 120_000, ...options })
  const body = await sensitive(response, status)
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]); assert.equal(body.code, code)
  return { responseStatus: status, safeFixedShape: true, privateNoStoreNosniff: true }
}
async function verifyRls(fixture, phase) {
  const [settings] = await app.$queryRawUnsafe("SELECT current_setting('app.org_id',true) AS tenant,current_setting('app.rls_bypass',true) AS bypass")
  assert.ok(settings.tenant == null || settings.tenant === ""); assert.notEqual(settings.bypass, "on")
  const [role] = await app.$queryRawUnsafe("SELECT current_user AS name, current_database() AS database, r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit FROM pg_roles r WHERE rolname=current_user")
  assert.equal(role.name, "wf_manager_today_browser"); assert.equal(role.database, "workforce_manager_today_browser")
  for (const key of ["rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication", "rolinherit"]) assert.equal(role[key], false)
  const counts = []
  for (const table of ["users", "mtm_teams", "workforce_access_grants", "workforce_policies"]) {
    const [metadata] = await app.$queryRawUnsafe("SELECT c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=$1", table)
    assert.equal(metadata.enabled, true); assert.equal(metadata.forced, true); assert.notEqual(metadata.owner, role.name)
    const [unscoped] = await app.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}"`); assert.equal(Number(unscoped.count), 0)
    for (const [ordinal, tenant] of [fixture.primary, fixture.foreign].entries()) {
      const [owner] = await admin.$queryRawUnsafe(`SELECT count(*) AS count FROM public."${table}" WHERE "organizationId"=$1`, tenant.organization.id)
      assert.ok(Number(owner.count) > 0)
      const result = await app.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${tenant.organization.id}, true)`
        const [row] = await tx.$queryRawUnsafe(`SELECT count(*) AS own, count(*) FILTER(WHERE "organizationId"<>$1) AS foreign FROM public."${table}"`, tenant.organization.id)
        return { own: Number(row.own), foreign: Number(row.foreign) }
      })
      assert.deepEqual(result, { own: Number(owner.count), foreign: 0 })
      counts.push({ table, tenantOrdinal: ordinal + 1, ownerPositiveRows: Number(owner.count), scopedOwnRows: result.own, foreignRows: 0, unscopedRows: 0, forcedRls: true, appOwnsTable: false })
    }
  }
  const [privileges] = await app.$queryRawUnsafe("SELECT has_table_privilege(current_user,'public.workforce_policies','SELECT') AS read,has_table_privilege(current_user,'public.workforce_policies','INSERT') AS insert,has_table_privilege(current_user,'public.workforce_policies','UPDATE') AS update,has_table_privilege(current_user,'public.workforce_policies','DELETE') AS delete")
  assert.deepEqual(privileges, { read: true, insert: false, update: false, delete: false })
  return { phase, counts, policyPrivileges: privileges, tenantContextAbsent: true, bypassAbsent: true, emptyOtherFactTablesAreNotPositiveRlsProof: true }
}
async function denied(principal, locale, code) {
  const view = await open(principal, locale, 320)
  const q = "Recorded Organization"
  await view.page.getByLabel(view.ui.searchLabel, { exact: true }).fill(q)
  const pending = view.page.waitForResponse(response => responseFor(response, searchEndpoint), { timeout: 120_000 })
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).click()
  const body = await sensitive(await pending, 403)
  assert.equal(body.code, code); assert.deepEqual(Object.keys(body).sort(), ["code", "error"])
  await view.page.getByText(view.ui.denied, { exact: true }).waitFor()
  assert.equal(await view.page.getByRole("table").count(), 0)
  assert.equal(await view.page.locator("select").count(), 0)
  assert.deepEqual(view.writes, [])
  await view.page.getByText(view.ui.denied, { exact: true }).scrollIntoViewIfNeeded()
  await view.page.screenshot({ path: `${outputDirectory}/denied-${principal.key}.png` })
  await assertSession(view.context, principal)
  receipts.cases.push({ name: principal.key + "-denied", status: "PASS", responseStatus: 403, privateNoStoreNosniff: true, noChoicesOrComparisonRendered: true, realSessionPreserved: true })
}
try {
  stage = "seed"
  const fixture = await seed(), ids = [fixture.primary.organization.id, fixture.foreign.organization.id]
  stage = "selected-published-window-constraints"
  receipts.selectedPublishedWindows = await verifyPublishedWindows(fixture)
  const before = await facts(ids)
  receipts.rlsBefore = await verifyRls(fixture, "BEFORE")
  browser = await chromium.launch({ headless: true })
  let reader
  for (const [locale, width] of [["ru", 320], ["az", 768], ["en", 1440]]) {
    stage = "localized-organization-" + locale
    const view = await open(fixture.primary.reader, locale, width)
    await namedSearch(view, "Recorded Organization", [fixture.primary.before, fixture.primary.after])
    const proof = await compare(view, fixture.primary.before, fixture.primary.after, false, locale === "ru")
    // ACTIVE is published but deliberately future-effective: no effective-policy claim.
    assert.ok((await view.page.locator("select").first().innerText()).includes(view.ui.statuses.ACTIVE))
    receipts.cases.push({ name: "organization-" + locale, status: "PASS", viewport: { width, height: 900 }, futurePublishedNotCurrentEffective: true, ...proof })
    if (locale === "en") {
      stage = "granular-reader-configuration-entry"
      await view.page.goto("/workforce/configuration", { waitUntil: "domcontentloaded" })
      const configurationCopy = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")).workforceConfigurationPage
      const entry = view.page.getByRole("link", { name: configurationCopy.comparePolicyVersions, exact: true })
      await entry.waitFor({ timeout: 120_000 }); assert.equal(await entry.count(), 1)
      const entryTabs = await tabTo(view.page, entry)
      assert.equal(await entry.evaluate(e => e.matches(":focus-visible")), true)
      await view.page.keyboard.press("Enter")
      await view.page.getByLabel(view.ui.searchLabel, { exact: true }).waitFor({ timeout: 120_000 })
      assert.equal(new URL(view.page.url()).pathname, "/workforce/configuration/policy-versions")
      receipts.granularReaderEntry = { status: "PASS", newEntryAvailableWithoutLegacyAdminRole: true, nativeEntryTabs: entryTabs, allExistingConfigurationSectionsPreservedSourceOnly: true }
      reader = view
    }
  }
  stage = "same-team-reverse"
  await namedSearch(reader, "Recorded Team", [fixture.primary.teamBefore, fixture.primary.teamAfter])
  receipts.cases.push({ name: "same-team-reverse", status: "PASS", ...await compare(reader, fixture.primary.teamAfter, fixture.primary.teamBefore, true) })
  stage = "invalid-pairs"
  const invalid = []
  invalid.push(await errorRead(reader.context, comparisonEndpoint, { from: fixture.primary.before.id, to: fixture.primary.before.id }, 400, "WORKFORCE_POLICY_COMPARISON_INPUT_INVALID"))
  invalid.push(await errorRead(reader.context, comparisonEndpoint, { from: fixture.primary.before.id, to: fixture.primary.teamAfter.id }, 409, "WORKFORCE_POLICY_COMPARISON_SCOPE_MISMATCH"))
  invalid.push(await errorRead(reader.context, comparisonEndpoint, { from: fixture.primary.before.id, to: "missing-fixture-only" }, 404, "WORKFORCE_POLICY_COMPARISON_NOT_FOUND"))
  receipts.cases.push({ name: "invalid-pairs", status: "PASS", checks: invalid })
  stage = "integrity-rejection"
  receipts.cases.push({ name: "integrity-rejection", status: "PASS", ...await errorRead(reader.context, comparisonEndpoint, { from: fixture.primary.before.id, to: fixture.primary.corrupted.id }, 409, "WORKFORCE_POLICY_COMPARISON_INTEGRITY_INVALID") })
  stage = "catalog-lookahead-and-retention"
  await namedSearch(reader, "Catalog", fixture.primary.catalog)
  await reader.page.getByText(reader.ui.refine, { exact: true }).waitFor()
  const selections = await reader.page.locator("select").evaluateAll(elements => elements.map(element => element.value))
  assert.deepEqual(selections, [fixture.primary.teamAfter.id, fixture.primary.teamBefore.id])
  await namedSearch(reader, "Catalog 01", [fixture.primary.catalog[0]])
  assert.equal(await reader.page.getByText(reader.ui.refine, { exact: true }).count(), 0)
  await namedSearch(reader, "No Such Fixture Policy", [])
  assert.deepEqual(await reader.page.locator("select").evaluateAll(elements => elements.map(element => element.value)), selections)
  receipts.cases.push({ name: "catalog-lookahead-and-retention", status: "PASS", seededMatches: 21, visibleChoices: 20, hasMore: true, narrowMatch: 1, emptyMatches: 0, selectionsRetainedInSameSession: true })
  stage = "explicit-legacy-read"
  const legacy = await open(fixture.foreign.issuer, "en", 1440)
  await namedSearch(legacy, "Recorded Organization", [fixture.foreign.before, fixture.foreign.after])
  receipts.cases.push({ name: "explicit-legacy-read", status: "PASS", ...await compare(legacy, fixture.foreign.before, fixture.foreign.after), explicitLegacyFeatureOff: true, noGranularGrantOnLegacyAdmin: true })
  stage = "team-grant-denial"
  await denied(fixture.primary.people[2], "ru", "WORKFORCE_GRANULAR_ACCESS_REQUIRED")
  stage = "crm-admin-no-fallback-denial"
  await denied(fixture.primary.issuer, "en", "WORKFORCE_GRANULAR_ACCESS_REQUIRED")
  activePage = reader.page
  stage = "foreign-boundaries"
  const forged = await reader.context.request.get(searchEndpoint + "?q=Recorded%20Organization", { headers: { "x-organization-id": fixture.foreign.organization.id, "x-tenant-slug": fixture.foreign.organization.slug } })
  const forgedBody = await sensitive(forged, 200)
  assert.deepEqual(new Set(forgedBody.data.policies.map(row => row.id)), new Set([fixture.primary.before.id, fixture.primary.after.id]))
  await errorRead(reader.context, comparisonEndpoint, { from: fixture.foreign.before.id, to: fixture.foreign.after.id }, 404, "WORKFORCE_POLICY_COMPARISON_NOT_FOUND")
  await errorRead(reader.context, searchEndpoint, { q: "Recorded", organizationId: fixture.foreign.organization.id }, 400, "WORKFORCE_POLICY_SEARCH_INPUT_INVALID")
  await assertSession(reader.context, fixture.primary.reader)
  receipts.cases.push({ name: "foreign-boundaries", status: "PASS", forgedHeadersRemainSessionBound: true, foreignIdsNotFound: true, unknownTenantQueryRejected: true, noHeaderDerived403Claim: true })
  stage = "real-logout-reauthentication"
  await namedSearch(reader, "Recorded Organization", [fixture.primary.before, fixture.primary.after])
  await compare(reader, fixture.primary.before, fixture.primary.after)
  const csrf = await reader.context.request.get("/api/auth/csrf"), { csrfToken } = await csrf.json()
  assert.equal(csrf.status(), 200); assert.equal(typeof csrfToken, "string")
  authenticationPostTimes.push(Date.now())
  const logout = await reader.context.request.post("/api/auth/signout", { headers: { "X-Auth-Return-Redirect": "1" }, form: { csrfToken, callbackUrl: `${baseURL}/login` } })
  assert.equal(logout.status(), 200)
  const absent = await reader.context.request.get("/api/auth/session"); assert.equal(absent.status(), 200); assert.equal(await absent.json(), null)
  // The actual UI fetch reaches the unchanged session-less proxy branch.
  // A plain APIRequestContext GET follows its login redirect; the policy
  // route's private headers cannot be proved by either proxy-short-circuit.
  const unauthenticatedPending = reader.page.waitForResponse(response => responseFor(response, searchEndpoint), { timeout: 120_000 })
  await reader.page.getByRole("button", { name: reader.ui.search, exact: true }).click()
  const unauthenticated = await unauthenticatedPending
  assert.equal(unauthenticated.status(), 401)
  const unauthenticatedHeaders = await unauthenticated.headers()
  assert.equal(unauthenticatedHeaders["x-content-type-options"], "nosniff")
  const unauthenticatedBody = await unauthenticated.json()
  assert.deepEqual(Object.keys(unauthenticatedBody).sort(), ["code", "error"])
  assert.equal(unauthenticatedBody.code, "session_expired")
  assert.equal(typeof unauthenticatedBody.error, "string")
  await reader.page.getByText(reader.ui.signIn, { exact: true }).waitFor()
  assert.equal(await reader.page.getByRole("table").count(), 0)
  assert.equal(await reader.page.locator("select").count(), 0)
  // Navigation reflects the actual server logout; no auth/session response mock.
  await reader.page.reload({ waitUntil: "domcontentloaded" })
  assert.equal(await reader.page.getByRole("table").count(), 0)
  await authenticate(reader.context, fixture.primary.reader)
  await reader.page.goto("/workforce/configuration/policy-versions", { waitUntil: "domcontentloaded" })
  await reader.page.getByLabel(reader.ui.searchLabel, { exact: true }).waitFor({ timeout: 120_000 })
  assert.deepEqual(await reader.page.locator("select").evaluateAll(elements => elements.map(element => element.value)), ["", ""])
  assert.equal(await reader.page.getByRole("table").count(), 0)
  await namedSearch(reader, "Recorded Organization", [fixture.primary.before, fixture.primary.after])
  await compare(reader, fixture.primary.before, fixture.primary.after)
  receipts.cases.push({ name: "real-logout-reauthentication", status: "PASS", actualSignoutAndSameActorCredentialCallback: true, actualUiFetchProxy401: true, staleComparisonAndChoicesClearedBeforeNavigation: true, proxyNoStoreObserved: /no-store/.test(unauthenticatedHeaders["cache-control"] || ""), unauthenticatedPrivateRouteHeaderAcceptance: "NOT RUN: unchanged proxy returns before the policy route", navigationAndReauthClearSelectionsAndResults: true, latePendingRequestAcceptanceRemainsMockedUnitScope: true })
  stage = "after-fingerprints-and-rls"
  const after = await facts(ids); assert.deepEqual(after, before)
  receipts.factImmutability = { status: "PASS", tenantCount: 2, tables: before.map((row, index) => ({ ...row, afterSha256: after[index].sha256, unchanged: true })), userAuthenticationMetadataExcluded: true, emptyTablesNotPositiveRlsProof: true }
  receipts.rlsAfter = await verifyRls(fixture, "AFTER")
  for (const view of [reader, legacy]) assert.deepEqual(view.writes, [])
  assert.equal(receipts.cases.length, 12); currentDate(); receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"
  const frame = String(error?.stack || "").split("\n").find(line => line.includes(import.meta.url)), position = frame?.match(/:(\d+):(\d+)\)?$/)
  const safePrimitive = value => typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null ? value : { type: Array.isArray(value) ? "array" : typeof value }
  receipts.failure = { stage, name: ["AssertionError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientValidationError"].includes(error?.name) ? error.name : "Error", sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null, ...(error?.name === "AssertionError" ? { actual: safePrimitive(error.actual), expected: safePrimitive(error.expected) } : {}), diagnostic: "Original failure retained; no raw errors, IDs, definition payload, stack, token, password or cookies uploaded" }
  if (activePage && !activePage.isClosed()) {
    try { await activePage.screenshot({ path: `${outputDirectory}/failure-original.png` }); receipts.failure.screenshot = "failure-original.png" } catch { receipts.failure.screenshot = "NOT_CAPTURED" }
  }
  process.exitCode = 1
} finally {
  const contextsClosed = await Promise.allSettled(contexts.map(context => context.close()))
  const browserClosed = browser ? await Promise.allSettled([browser.close()]) : []
  const databasesClosed = await Promise.allSettled([app.$disconnect(), admin.$disconnect()])
  const results = [...contextsClosed, ...browserClosed, ...databasesClosed], labels = [...contexts.map((_, index) => `context-${index + 1}`), ...(browser ? ["browser"] : []), "application-database", "fixture-database"]
  receipts.cleanupActions = results.map((result, index) => ({ action: labels[index], status: result.status === "fulfilled" ? "PASS" : "FAIL", ...(result.status === "rejected" ? { name: "Error" } : {}) }))
  receipts.cleanup = results.every(result => result.status === "fulfilled") ? "PASS" : "FAIL"
  if (receipts.cleanup === "FAIL") { receipts.status = "FAIL"; process.exitCode = 1 }
  receipts.completedAt = new Date().toISOString()
  await writeFile(`${outputDirectory}/policy-version-receipt.json`, JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: receipts.status, completedCases: receipts.cases.length, date, cleanup: receipts.cleanup }))
}
