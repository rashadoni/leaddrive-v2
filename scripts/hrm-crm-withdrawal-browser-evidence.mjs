import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// Explicit hosted disposable fixture fence. This is not a production operator.
assert.equal(process.env.GITHUB_ACTIONS, "true")
assert.equal(process.env.CI, "true")
assert.equal(process.env.HRM_UI_BROWSER, "1")
assert.notEqual(process.env.NODE_ENV, "production")
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const origin = new URL(process.env.HRM_UI_BASE_URL)
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname))
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname))
  assert.equal(url.pathname, "/hrm_tenant_capability_ui")
  assert.equal(url.username, role)
  return url
}
const adminURL = database(process.env.ADMIN_DATABASE_URL, "postgres")
const appURL = database(process.env.DATABASE_URL, "hrm_tenant_ui")
assert.equal(adminURL.host, appURL.host)
assert.equal(database(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres").href, adminURL.href)
const head = process.env.HRM_UI_HEAD_SHA
assert.match(head || "", /^[0-9a-f]{40}$/)
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head)
const output = process.env.HRM_UI_OUTPUT_DIR || "artifacts/hrm-tenant-capability-ui"
await mkdir(output, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.href)
const app = makeRlsTestPrisma(appURL.href)
const messages = Object.fromEntries(await Promise.all(["en", "ru", "az"].map(async locale => [locale, JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"))])))
const password = `Disposable!9-${randomUUID()}`
const suffix = randomUUID().replaceAll("-", "").slice(0, 10)
const receipt = {
  version: 1,
  status: "RUNNING",
  headSha: head,
  workflowSha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  startedAt: new Date().toISOString(),
  environment: "hosted Chromium, real credentials authentication, Next dev, isolated PostgreSQL16",
  productionMutation: false,
  sourceBindings: [],
  cases: [],
  limitations: [
    "Synthetic disposable organizations only; no production observation or activation",
    "Prisma db push plus fixture RLS/default uniqueness, not every production migration/trigger",
    "Development browser bundle; separate cold production build is a distinct gate",
    "No human accessibility, physical device, operational pilot or load acceptance",
  ],
}
for (const path of [
  ".github/workflows/hrm-tenant-capability-ui.yml", "scripts/hrm-crm-withdrawal-browser-evidence.mjs", "src/lib/crm-product-availability.ts", "src/proxy.ts",
  "scripts/ci/fixtures/hrm-tenant-capability-ui.sql", "prisma/schema.prisma",
  "src/app/admin/tenants/[id]/edit/page.tsx", "src/app/admin/tenants/[id]/workforce-capability-control.tsx",
  "src/app/admin/tenants/[id]/tenant-capabilities-panel.tsx", "src/app/api/v1/admin/tenants/[id]/route.ts",
  "src/app/api/v1/admin/tenants/[id]/capabilities/route.ts", "src/lib/tenant-capabilities.ts",
  "src/lib/workforce/default-configuration-provisioning.ts", "src/lib/modules.ts",
  "messages/en.json", "messages/ru.json", "messages/az.json",
]) {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url))
  receipt.sourceBindings.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
}
let stage = "seeding"
let browser
let activePage
const contexts = []
const workforceKey = "workforce-hrm"
const tenantPath = id => `/api/v1/admin/tenants/${id}`
const capabilityPath = id => `${tenantPath(id)}/capabilities`
function record(name, details = {}) { receipt.cases.push({ name, status: "PASS", ...details }) }
async function poll(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  do { if (await check()) return; await delay(100) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
async function authenticate(context, user, slug) {
  const csrfResponse = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
  assert.equal(csrfResponse.status(), 200)
  const { csrfToken } = await csrfResponse.json()
  assert.equal(typeof csrfToken, "string")
  const response = await context.request.post("/api/auth/callback/credentials", {
    timeout: 120_000,
    headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: user.email, password, organizationSlug: slug, callbackUrl: `${origin.origin}/admin` },
  })
  assert.equal(response.status(), 200)
  const redirect = new URL((await response.json()).url, origin)
  assert.equal(redirect.origin, origin.origin)
  assert.equal(redirect.searchParams.get("error"), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith("authjs.session-token")))
  const sessionResponse = await context.request.get("/api/auth/session", { timeout: 120_000 })
  assert.equal(sessionResponse.status(), 200)
  const session = await sessionResponse.json()
  assert.equal(session.user.id, user.id)
  assert.equal(session.user.role, user.role)
  assert.equal(session.user.organizationId, user.organizationId)
}
async function setLocale(context, locale) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: origin.origin }])
}

async function organization(id) {
  return admin.organization.findUniqueOrThrow({ where: { id }, select: { name: true, features: true, modules: true, settings: true, addons: true } })
}
async function preservedHistory(id) {
  return {
    policies: await admin.workforcePolicy.findMany({ where: { organizationId: id }, orderBy: { id: "asc" } }),
    shifts: await admin.workforceShiftTemplate.findMany({ where: { organizationId: id }, orderBy: { id: "asc" } }),
    audits: await admin.mtmAuditLog.findMany({ where: { organizationId: id }, orderBy: { id: "asc" } }),
  }
}
async function assertCatalogWithdrawn(context, id) {
  const response = await context.request.get(capabilityPath(id), { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const capabilities = (await response.json()).data.capabilities
  for (const key of [workforceKey, "attendance-qr", "attendance-device-trust"]) {
    assert.ok(!capabilities.some(item => item.id === key), `Withdrawn catalog entry: ${key}`)
  }
  assert.ok(capabilities.some(item => item.id === "route-field" && item.enabled), "Field remains enabled")
}
try {
  const passwordHash = await bcrypt.hash(password, 10)
  const a = await admin.organization.create({ data: {
    name: "Disposable retained HRM fixture", slug: `hrm-ui-a-${suffix}`, plan: "enterprise", isActive: true,
    features: ["crm", "mtm", workforceKey, "fixture-unrelated"],
    modules: { crm: true, mtm: true, [workforceKey]: true, "fixture-unrelated": false },
    settings: { fixtureMarker: "preserve-a" }, addons: ["attendance-qr", "attendance-device-trust"],
  } })
  const b = await admin.organization.create({ data: {
    name: "Disposable legacy MTM fixture", slug: `hrm-ui-b-${suffix}`, plan: "enterprise", isActive: true,
    features: ["crm", "mtm"], modules: { crm: true, mtm: true }, settings: { fixtureMarker: "preserve-b" }, addons: [],
  } })
  const superadmin = await admin.user.create({ data: { organizationId: a.id, name: "Synthetic platform operator", email: `hrm-ui-super-${suffix}@example.invalid`, passwordHash, role: "superadmin" } })
  const tenantAdmin = await admin.user.create({ data: { organizationId: b.id, name: "Synthetic tenant administrator", email: `hrm-ui-admin-${suffix}@example.invalid`, passwordHash, role: "admin" } })
  const definition = { fixtureOnly: true, marker: "retain-exact-history" }
  const definitionHash = createHash("sha256").update(JSON.stringify(definition)).digest("hex")
  await admin.workforcePolicy.create({ data: { organizationId: a.id, version: 1, name: "Retained fixture policy", effectiveFrom: new Date("2026-01-01T00:00:00Z"), definition, definitionHash, createdByUserId: superadmin.id } })
  await admin.workforceShiftTemplate.create({ data: { organizationId: a.id, code: "RETAIN", version: 1, name: "Retained fixture shift", timezone: "Asia/Baku", definition, definitionHash, createdByUserId: superadmin.id } })
  await admin.mtmAuditLog.create({ data: { organizationId: a.id, actorUserId: superadmin.id, action: "WORKFORCE_FIXTURE_RETAINED", entity: "workforce", newData: { fixtureOnly: true } } })
  const retainedBefore = await preservedHistory(a.id)
  const foreignHistoryBefore = await preservedHistory(b.id)
  const ownBefore = await organization(a.id)
  let savedOwn = ownBefore
  const foreignBefore = await organization(b.id)
  const role = (await app.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)[0]
  assert.equal(role.name, "hrm_tenant_ui")
  assert.equal(role.rolsuper, false)
  assert.equal(role.rolbypassrls, false)
  assert.equal(await app.user.count(), 0, "No tenant context must fail closed")
  const scopedUsers = await app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${b.id}, true)`
    assert.equal(await tx.workforcePolicy.count(), 0, "Foreign policy must not leak")
    return tx.user.findMany({ select: { organizationId: true } })
  })
  assert.equal(scopedUsers.length, 1)
  assert.ok(scopedUsers.every(user => user.organizationId === b.id))
  record("actual restricted role, forced tenant RLS and foreign HRM history isolation")

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1365, height: 900 } })
  contexts.push(context)
  await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
  await authenticate(context, superadmin, a.slug)
  await assertCatalogWithdrawn(context, a.id)
  await assertCatalogWithdrawn(context, b.id)
  const editor = await context.newPage()
  activePage = editor
  let capabilityWrites = 0
  context.on("request", request => { if (request.method() === "PATCH" && /\/capabilities$/.test(new URL(request.url()).pathname)) capabilityWrites++ })
  stage = "localized-editor-without-hrm-and-save"
  for (const locale of ["ru", "az", "en"]) {
    await setLocale(context, locale)
    await editor.goto(`/admin/tenants/${a.id}/edit`, { waitUntil: "domcontentloaded", timeout: 120_000 })
    const save = editor.getByRole("button", { name: messages[locale].admin.tenants.save, exact: true })
    await poll(async () => await save.isVisible() && await save.isEnabled(), "ordinary Save enabled", 120_000)
    assert.equal(await editor.locator('[data-tenant-capability="workforce-hrm"]').count(), 0)
    await editor.screenshot({ path: `${output}/editor-withdrawn-${locale}.png` })
    const response = editor.waitForResponse(res => res.request().method() === "PUT" && new URL(res.url()).pathname === tenantPath(a.id))
    await save.click()
    assert.equal((await response).status(), 200)
    // Ordinary saves retain the original entitlement for eventual extraction.
    const saved = await organization(a.id)
    const savedFeatures = typeof saved.features === "string" ? JSON.parse(saved.features) : saved.features
    assert.equal(saved.modules[workforceKey], true)
    assert.equal(saved.modules.mtm, true)
    assert.equal(saved.modules["fixture-unrelated"], false)
    assert.ok(savedFeatures.includes(workforceKey) && savedFeatures.includes("mtm"))
    assert.equal(saved.settings.fixtureMarker, ownBefore.settings.fixtureMarker)
    assert.deepEqual(saved.addons, ownBefore.addons)
    savedOwn = saved
    assert.deepEqual(await preservedHistory(a.id), retainedBefore)
  }
  assert.equal(capabilityWrites, 0, "Editor must neither activate nor remove retained entitlement")
  record("en/ru/az editor hides HRM, Save works and retains entitlement/history exactly")

  stage = "admin-overview-no-reactivation"
  await editor.goto(`/admin/tenants/${a.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 })
  await editor.getByRole("heading", { name: a.name, exact: true }).waitFor({ timeout: 120_000 })
  await editor.getByText("Route & Field", { exact: true }).waitFor({ timeout: 120_000 })
  assert.equal(await editor.getByText("Workforce HRM", { exact: true }).count(), 0)
  await editor.screenshot({ path: `${output}/overview-withdrawn.png` })
  for (const id of [a.id, b.id]) {
    for (const capabilityId of [workforceKey, "attendance-qr", "attendance-device-trust"]) {
      for (const action of ["approve", "disable", "reject_request"]) {
        assert.equal((await context.request.patch(capabilityPath(id), { data: { capabilityId, action } })).status(), 404)
      }
    }
  }
  // Even a stale/raw metadata client cannot reactivate the product.
  assert.equal((await context.request.put(tenantPath(a.id), { data: { features: typeof savedOwn.features === "string" ? JSON.parse(savedOwn.features) : savedOwn.features } })).status(), 200)
  await assertCatalogWithdrawn(context, a.id)
  assert.deepEqual(await organization(a.id), savedOwn)
  record("own and legacy tenants cannot reactivate via admin actions or raw retained flags")

  stage = "crm-navigation-and-catalog"
  const catalogResponse = editor.waitForResponse(res => new URL(res.url()).pathname === "/api/v1/apps" && res.request().method() === "GET", { timeout: 120_000 })
  await editor.goto("/marketplace", { waitUntil: "domcontentloaded", timeout: 120_000 })
  assert.equal((await catalogResponse).status(), 200)
  const fieldGroup = editor.locator('[data-testid="sidebar-group-toggle"][data-group="Route & Field"]')
  await fieldGroup.waitFor({ state: "visible", timeout: 120_000 })
  if (await fieldGroup.getAttribute("aria-expanded") === "false") await fieldGroup.click()
  await editor.locator('a[href="/mtm"]').first().waitFor({ state: "visible", timeout: 120_000 })
  assert.equal(await editor.locator('[data-testid="sidebar-group-toggle"][data-group="HRM"]').count(), 0)
  assert.equal(await editor.locator('a[href="/workforce"], a[href^="/workforce/"], a[href^="/marketplace/demo/workforce-hrm"], a[href^="/marketplace/demo/attendance-"]').count(), 0)
  assert.equal(await editor.getByText("Workforce HRM", { exact: true }).count(), 0)
  await editor.screenshot({ path: `${output}/marketplace-navigation-withdrawn.png` })
  record("authenticated CRM navigation and marketplace omit HRM, keep Route & Field")

  stage = "direct-page-api-and-cron-denial"
  for (const path of ["/workforce", "/workforce/timesheet", "/workforce/reports", "/workforce/requests", "/workforce/configuration", "/%77orkforce", "/marketplace/demo/workforce-hrm", "/marketplace/demo/attendance-qr", "/marketplace/demo/attendance-device-trust"]) {
    const response = await context.request.get(path)
    assert.equal(response.status(), 404, path)
    assert.equal(response.headers()["cache-control"], "private, no-store")
  }
  const apiPaths = ["/api/v1/workforce/requests", "/api/v1/mtm/mobile/hrm/bootstrap", "/api/v1/mtm/mobile/attendance/qr/challenge", "/api/v1/mtm/mobile/workday", "/api/v1/mtm/week/workday", "/api/v1/mtm/work-calendar", "/api/v1/mtm/operations/hrm", "/api/v2/mtm/mobile/sync/workforce", "/api/cron/workforce-no-show-review"]
  for (const path of apiPaths) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const response = await context.request.fetch(path, { method })
      assert.equal(response.status(), 410, `${method} ${path}`)
      assert.equal((await response.json()).code, "CRM_MODULE_UNAVAILABLE")
      assert.equal(response.headers()["cache-control"], "private, no-store")
    }
  }
  const anonymous = await browser.newContext({ baseURL: origin.origin })
  contexts.push(anonymous)
  for (const headers of [{}, { "x-api-key": "synthetic-rejected-key" }, { authorization: "Bearer synthetic-rejected-token" }]) {
    assert.equal((await anonymous.request.get("/api/v1/workforce/requests", { headers })).status(), 410)
  }
  assert.equal((await context.request.get("/api/v1/ping")).status(), 200)
  record("direct and encoded pages 404; all HRM API methods 410 before public/key/token bypass; CRM ping survives")
  stage = "real-postgres-optimistic-conflict"
  const rejectedUpdateAudit = { action: "update", entityType: "tenant", entityId: a.id, newValue: { path: ["name"], equals: "This stale write must be rejected" } }
  assert.equal(await admin.auditLog.count({ where: rejectedUpdateAudit }), 0)
  const beforeRace = await organization(a.id)
  let stalePut
  await admin.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM public.organizations WHERE id = ${a.id} FOR UPDATE`
    stalePut = context.request.put(tenantPath(a.id), { data: { name: "This stale write must be rejected", features: ["crm", "mtm"] }, timeout: 60_000 })
    stalePut.catch(() => {}) // Failure cleanup must not emit an unhandled request rejection.
    await poll(async () => {
      const waiting = await admin.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = 'hrm_tenant_ui' AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%organizations%'`
      return waiting[0].count > 0
    }, "metadata PUT waiting on locked organization", 20_000)
    await tx.organization.update({ where: { id: a.id }, data: { updatedAt: new Date(Date.now() + 1_000) } })
  }, { timeout: 30_000 })
  const conflicted = await stalePut
  assert.equal(conflicted.status(), 409)
  assert.equal((await conflicted.json()).code, "TENANT_UPDATE_CONFLICT")
  assert.deepEqual(await organization(a.id), beforeRace)
  await delay(200)
  assert.equal(await admin.auditLog.count({ where: rejectedUpdateAudit }), 0)
  record("actual PostgreSQL row-lock race returns 409, preserves entitlement and does not record false update success")


  stage = "tenant-admin-guard-and-final-preservation"
  const denied = await browser.newContext({ baseURL: origin.origin })
  contexts.push(denied)
  await authenticate(denied, tenantAdmin, b.slug)
  for (const id of [a.id, b.id]) {
    assert.equal((await denied.request.get(capabilityPath(id))).status(), 403)
    assert.equal((await denied.request.patch(capabilityPath(id), { data: { capabilityId: workforceKey, action: "approve" } })).status(), 403)
    assert.equal((await denied.request.put(tenantPath(id), { data: { features: [workforceKey] } })).status(), 403)
  }
  assert.equal((await denied.request.get("/api/v1/workforce/requests")).status(), 410)
  assert.deepEqual(await organization(a.id), savedOwn)
  assert.deepEqual(await organization(b.id), foreignBefore)
  assert.deepEqual(await preservedHistory(a.id), retainedBefore)
  assert.deepEqual(await preservedHistory(b.id), foreignHistoryBefore)
  record("tenant administrator cannot modify own/foreign platform capabilities; all preserved HRM rows and both entitlements unchanged")
  receipt.status = "PASS"
} catch (error) {
  receipt.status = "FAILED"
  receipt.failure = { stage, name: error?.name || "Error", message: String(error?.message || "Unknown failure").replaceAll(password, "[redacted]").replaceAll(appURL.password, "[redacted]").replaceAll(adminURL.password, "[redacted]").slice(0, 1800) }
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  // Do not print exception stacks, database URLs, auth payloads or raw app logs.
  console.error(`HRM tenant capability fixture FAILED at ${stage}; sanitized receipt retained`)
  process.exitCode = 1
} finally {
  receipt.finishedAt = new Date().toISOString()
  await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n")
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await Promise.allSettled([admin.$disconnect(), app.$disconnect()])
}
if (receipt.status === "PASS") console.log(`HRM tenant capability fixture PASS: ${receipt.cases.length} cases, exact head ${head}`)
