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
    sha256: digest(users.map(({ lastLogin: _a, loginCount: _b, updatedAt: _c, ...row }) => row)) })
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
  return { context, page, locale, ui: copy.workforcePolicyVersionComparison, impact: copy.workforcePolicyEmployeeImpact,
    section: page.locator('section[aria-labelledby="workforce-policy-employee-impact-title"]') }
}
async function select(view, pair = policies[0]) {
  const searched = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/search"))
  await view.page.locator("#workforce-policy-version-query").fill(pair[0].name)
  await view.page.getByRole("button", { name: view.ui.search, exact: true }).click(); assert.equal((await searched).status(), 200)
  await view.page.locator("#workforce-policy-version-from").selectOption(pair[0].id); await view.page.locator("#workforce-policy-version-to").selectOption(pair[1].id)
  const compared = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/policies/compare"))
  await view.page.getByRole("button", { name: view.ui.compare, exact: true }).click(); assert.equal((await compared).status(), 200)
  await view.section.getByRole("button", { name: view.impact.preview, exact: true }).waitFor()
}
async function readPreview(view, expected = 200) {
  const fetched = view.page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/employee-impact"))
  await view.section.getByRole("button", { name: view.impact.preview, exact: true }).click(); const response = await fetched
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
  const summary = view.section.locator("summary"); await summary.press("Enter")
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
        overflowX: getComputedStyle(region).overflowX })) }
  })
  assert.equal(result.insideWidth, true); assert.equal(result.pageHasNoHorizontalOverflow, true); assert.equal(result.controls44px, true)
  assert.ok(result.localScrollRegions.every(region => region.keyboardFocusable && region.contained && region.overflowX === "auto"))
  return result
}
async function nativeFocus(view, target) {
  for (let n = 0; n < 100; n++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      assert.equal(await target.evaluate(element => element.matches(":focus-visible")), true); return
    }
    await view.page.keyboard.press("Tab")
  }
  assert.fail("Bounded native tab target was not reached")
}
