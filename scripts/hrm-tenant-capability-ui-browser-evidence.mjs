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
  ".github/workflows/hrm-tenant-capability-ui.yml", "scripts/hrm-tenant-capability-ui-browser-evidence.mjs",
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
const features = value => typeof value === "string" ? JSON.parse(value) : value
function record(name, details = {}) { receipt.cases.push({ name, status: "PASS", ...details }) }
async function poll(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  do { if (await check()) return; await delay(100) } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}
async function canonical(context, id) {
  const response = await context.request.get(capabilityPath(id), { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const row = (await response.json()).data.capabilities.find(item => item.id === workforceKey)
  assert.ok(row)
  return row
}
async function profileCounts(id) {
  return {
    policies: await admin.workforcePolicy.count({ where: { organizationId: id } }),
    shifts: await admin.workforceShiftTemplate.count({ where: { organizationId: id } }),
    provisioningAudits: await admin.mtmAuditLog.count({ where: { organizationId: id, action: "WORKFORCE_DEFAULT_PROFILE_PROVISIONED" } }),
  }
}
async function organization(id) {
  return admin.organization.findUniqueOrThrow({ where: { id }, select: { name: true, features: true, modules: true, settings: true, addons: true } })
}
async function assertPersisted(id, enabled) {
  const row = await organization(id)
  assert.equal(row.modules[workforceKey], enabled)
  assert.equal(features(row.features).includes(workforceKey), enabled)
  assert.ok(features(row.features).includes("mtm"), "Legacy MTM entitlement must remain")
  assert.equal(row.modules.mtm, true)
  assert.equal(row.modules["fixture-unrelated"], false)
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
async function openEditor(page, id, enabled, locale = "en") {
  activePage = page
  await setLocale(page.context(), locale)
  await page.goto(`/admin/tenants/${id}/edit`, { waitUntil: "domcontentloaded", timeout: 120_000 })
  const control = page.locator('[data-tenant-capability="workforce-hrm"]')
  await control.waitFor({ state: "visible", timeout: 120_000 })
  const translatedLabel = messages[locale].nav.groups.HRM
  const toggle = control.getByRole("switch", { name: translatedLabel === "HRM" ? translatedLabel : `${translatedLabel} (HRM)`, exact: true })
  await poll(async () => await toggle.isEnabled(), "canonical editor control")
  assert.equal(await toggle.getAttribute("aria-checked"), String(enabled))
  assert.ok(await control.getByText(messages[locale].admin.tenants.workforceControlHint, { exact: true }).isVisible())
  return { control, toggle }
}
async function saveMetadata(page, id, enabled, locale = "en") {
  const responsePromise = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === tenantPath(id))
  await page.getByRole("button", { name: messages[locale].admin.tenants.save, exact: true }).click()
  assert.equal((await responsePromise).status(), 200)
  const toggle = page.locator('[data-tenant-capability="workforce-hrm"]').getByRole("switch")
  await poll(async () => await toggle.isEnabled() && await toggle.getAttribute("aria-checked") === String(enabled), "metadata save canonical refresh")
}
async function toggleEditor(page, id, expectedEnabled) {
  const control = page.locator('[data-tenant-capability="workforce-hrm"]')
  const toggle = control.getByRole("switch")
  assert.equal(await toggle.getAttribute("aria-checked"), String(!expectedEnabled))
  const responsePromise = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === capabilityPath(id))
  await toggle.click()
  const response = await responsePromise
  assert.deepEqual(response.request().postDataJSON(), { capabilityId: workforceKey, action: expectedEnabled ? "approve" : "disable" })
  assert.equal(response.status(), 200)
  await poll(async () => await toggle.isEnabled() && await toggle.getAttribute("aria-checked") === String(expectedEnabled), "explicit editor capability write")
  await assertPersisted(id, expectedEnabled)
}

try {
  const passwordHash = await bcrypt.hash(password, 10)
  const a = await admin.organization.create({ data: {
    name: "Disposable HRM explicit disable fixture", slug: `hrm-ui-a-${suffix}`, plan: "enterprise", isActive: true,
    features: ["crm", "mtm", workforceKey, "fixture-unrelated"],
    modules: { crm: true, mtm: true, [workforceKey]: false, "fixture-unrelated": false },
    settings: { fixtureMarker: "preserve-a" }, addons: [],
  } })
  const b = await admin.organization.create({ data: {
    name: "Disposable HRM legacy fixture", slug: `hrm-ui-b-${suffix}`, plan: "enterprise", isActive: true,
    features: ["crm", "mtm"], modules: { crm: true, mtm: true, "fixture-unrelated": false }, settings: { fixtureMarker: "preserve-b" }, addons: [],
  } })
  const superadmin = await admin.user.create({ data: { organizationId: a.id, name: "Synthetic platform operator", email: `hrm-ui-super-${suffix}@example.invalid`, passwordHash, role: "superadmin" } })
  const tenantAdmin = await admin.user.create({ data: { organizationId: b.id, name: "Synthetic tenant administrator", email: `hrm-ui-admin-${suffix}@example.invalid`, passwordHash, role: "admin" } })
  const foreignBefore = await organization(b.id)
  assert.deepEqual(await profileCounts(a.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  assert.deepEqual(await profileCounts(b.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  const role = (await app.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)[0]
  assert.equal(role.name, "hrm_tenant_ui")
  assert.equal(role.rolsuper, false)
  assert.equal(role.rolbypassrls, false)
  assert.equal(await app.user.count(), 0, "No tenant context must fail closed")
  const scopedUsers = await app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${b.id}, true)`
    return tx.user.findMany({ select: { organizationId: true } })
  })
  assert.equal(scopedUsers.length, 1)
  assert.ok(scopedUsers.every(user => user.organizationId === b.id))
  record("actual non-bypass role and forced tenant RLS")

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1365, height: 900 } })
  contexts.push(context)
  await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
  await authenticate(context, superadmin, a.slug)
  assert.equal((await canonical(context, a.id)).enabled, false)
  assert.equal((await canonical(context, a.id)).status, "disabled")
  assert.equal((await canonical(context, b.id)).enabled, true)
  const editor = await context.newPage()
  let capabilityWrites = 0
  context.on("request", request => { if (request.method() === "PATCH" && /\/capabilities$/.test(new URL(request.url()).pathname)) capabilityWrites++ })
  stage = "localized-editor-load"
  for (const locale of ["ru", "az", "en"]) {
    const { control } = await openEditor(editor, a.id, false, locale)
    await control.screenshot({ path: `${output}/editor-disabled-${locale}.png` })
    assert.deepEqual(await profileCounts(a.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  }
  assert.equal(capabilityWrites, 0, "Loading an editor must never activate a capability")
  record("human HRM label in en/ru/az, persisted false beats raw feature and legacy MTM, no load provisioning")

  stage = "disabled-overview-discovery"
  const overview = await context.newPage()
  activePage = overview
  await overview.goto(`/admin/tenants/${a.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 })
  const disabledSection = overview.locator("section").filter({ has: overview.getByRole("heading", { name: "Disabled", exact: true }) })
  await disabledSection.getByText("Workforce HRM", { exact: true }).waitFor({ state: "visible", timeout: 120_000 })
  const enable = disabledSection.getByRole("button", { name: "Enable", exact: true })
  assert.equal(await enable.count(), 1)
  await disabledSection.screenshot({ path: `${output}/overview-disabled-discoverable.png` })
  record("explicitly disabled HRM remains discoverable with Enable in actual tenant overview")

  stage = "provisioning-audit-rollback"
  await admin.$executeRaw`INSERT INTO public.hrm_ui_failure_control ("organizationId") VALUES (${a.id})`
  let approvalResponse = overview.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === capabilityPath(a.id))
  await enable.click()
  assert.equal((await approvalResponse).status(), 500)
  await overview.getByText("Action failed (HTTP 500)", { exact: true }).waitFor({ timeout: 30_000 })
  assert.equal((await canonical(context, a.id)).enabled, false)
  assert.equal((await organization(a.id)).modules[workforceKey], false)
  assert.deepEqual(await profileCounts(a.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  await overview.screenshot({ path: `${output}/expected-injected-audit-failure.png` })
  record("expected injected audit failure HTTP500 rolls back own entitlement, policy, shift and provisioning audit")
  await admin.$executeRaw`DELETE FROM public.hrm_ui_failure_control WHERE "organizationId" = ${a.id}`

  stage = "explicit-overview-approval"
  approvalResponse = overview.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === capabilityPath(a.id))
  await enable.click()
  const approved = await approvalResponse
  assert.equal(approved.status(), 200)
  assert.deepEqual(approved.request().postDataJSON(), { capabilityId: workforceKey, action: "approve" })
  await assertPersisted(a.id, true)
  assert.deepEqual(await profileCounts(a.id), { policies: 1, shifts: 1, provisioningAudits: 1 })
  const profileAudit = await admin.mtmAuditLog.findFirstOrThrow({ where: { organizationId: a.id, action: "WORKFORCE_DEFAULT_PROFILE_PROVISIONED" } })
  assert.equal(profileAudit.newData.initiatedByUserId, superadmin.id)
  record("real explicit Enable grants own HRM entitlement and commits one default profile plus provisioning audit")

  stage = "ordinary-stale-editor-save"
  activePage = editor
  await saveMetadata(editor, a.id, true)
  await assertPersisted(a.id, true)
  assert.deepEqual(await profileCounts(a.id), { policies: 1, shifts: 1, provisioningAudits: 1 })
  record("ordinary Save from pre-approval editor preserves canonical HRM and refreshes switch")
  await toggleEditor(editor, a.id, false)
  await saveMetadata(editor, a.id, false)
  await assertPersisted(a.id, false)
  assert.deepEqual(await profileCounts(a.id), { policies: 1, shifts: 1, provisioningAudits: 1 })
  await openEditor(editor, a.id, false)
  record("editor explicit disable, stale raw features Save and reload stay disabled without deleting profile")

  stage = "raw-features-cannot-grant"
  const rawSave = await context.request.put(tenantPath(a.id), { data: { features: ["crm", "mtm", workforceKey, "fixture-unrelated"] } })
  assert.equal(rawSave.status(), 200)
  await assertPersisted(a.id, false)
  record("raw metadata features cannot grant HRM or erase explicit false")
  await toggleEditor(editor, a.id, true)
  await saveMetadata(editor, a.id, true)
  await assertPersisted(a.id, true)
  assert.deepEqual(await profileCounts(a.id), { policies: 1, shifts: 1, provisioningAudits: 1 })
  record("editor re-enable preserves profile identities and does not duplicate provisioning audit")

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

  stage = "foreign-tenant-preservation-and-legacy"
  assert.deepEqual(await organization(b.id), foreignBefore)
  assert.deepEqual(await profileCounts(b.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  record("all A mutations preserve B organization and HRM configuration")
  await openEditor(editor, b.id, true)
  await saveMetadata(editor, b.id, true)
  assert.equal((await canonical(context, b.id)).enabled, true)
  assert.equal(features((await organization(b.id)).features).includes(workforceKey), false)
  assert.deepEqual(await profileCounts(b.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  record("legacy MTM editor reads effective enabled, ordinary Save does not mint own HRM entitlement or profile")
  assert.equal((await context.request.put(tenantPath(b.id), { data: { features: ["crm"] } })).status(), 200)
  assert.equal((await canonical(context, b.id)).enabled, false)
  assert.equal((await context.request.put(tenantPath(b.id), { data: { features: ["crm", "mtm"] } })).status(), 200)
  assert.equal((await canonical(context, b.id)).enabled, true)
  assert.deepEqual(await profileCounts(b.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  record("intentional legacy MTM group edits retain existing compatibility behavior")
  await toggleEditor(editor, b.id, false)
  await saveMetadata(editor, b.id, false)
  await openEditor(editor, b.id, false)
  assert.equal((await organization(b.id)).modules.mtm, true)
  assert.equal((await canonical(context, b.id)).enabled, false)
  assert.deepEqual(await profileCounts(b.id), { policies: 0, shifts: 0, provisioningAudits: 0 })
  record("explicit HRM disable overrides legacy MTM across Save and reload without changing legacy data")

  stage = "superadmin-guard"
  const denied = await browser.newContext({ baseURL: origin.origin })
  contexts.push(denied)
  await authenticate(denied, tenantAdmin, b.slug)
  const finalA = await organization(a.id)
  const finalB = await organization(b.id)
  for (const id of [a.id, b.id]) {
    assert.equal((await denied.request.get(capabilityPath(id))).status(), 403)
    assert.equal((await denied.request.patch(capabilityPath(id), { data: { capabilityId: workforceKey, action: "approve" } })).status(), 403)
    assert.equal((await denied.request.put(tenantPath(id), { data: { features: [workforceKey] } })).status(), 403)
  }
  assert.deepEqual(await organization(a.id), finalA)
  assert.deepEqual(await organization(b.id), finalB)
  record("authenticated tenant admin cannot read/write own or foreign tenant capabilities/metadata")

  stage = "final-disabled-overview"
  activePage = overview
  const disabledResponse = await context.request.patch(capabilityPath(a.id), { data: { capabilityId: workforceKey, action: "disable" } })
  assert.equal(disabledResponse.status(), 200)
  await overview.reload({ waitUntil: "domcontentloaded", timeout: 120_000 })
  await disabledSection.getByText("Workforce HRM", { exact: true }).waitFor({ state: "visible", timeout: 120_000 })
  assert.equal(await enable.count(), 1)
  await assertPersisted(a.id, false)
  assert.deepEqual(await profileCounts(a.id), { policies: 1, shifts: 1, provisioningAudits: 1 })
  await disabledSection.screenshot({ path: `${output}/overview-disabled-after-reload.png` })
  record("disabled HRM remains in overview after persisted disable/reload; profile retained")
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
