import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import ts from "typescript"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "./_rls.mjs"

// The retained functional journeys remain executable after extraction. In CRM,
// test the shipped lifecycle contract, never enable archived code via a flag.
const profiles = {
  "uncertain": ["WF_EMPLOYEE_CORRECTION_UNCERTAIN_SUBMIT_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-employee-correction-uncertain-submit-browser-evidence.mjs", "/workforce/requests", "/api/v1/workforce/requests"],
  "recovery": ["WF_EMPLOYEE_CORRECTION_RECOVERY_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-employee-correction-recovery-browser-evidence.mjs", "/workforce/requests", "/api/v1/workforce/requests"],
  "correction": ["WF_EMPLOYEE_CORRECTION_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-employee-correction-browser-evidence.mjs", "/workforce/requests", "/api/v1/workforce/requests"],
  "employee": ["WF_EMPLOYEE_EXCEPTION_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-employee-exception-browser-evidence.mjs", "/workforce/exceptions/mine", "/api/v1/workforce/exceptions/mine"],
  "classification": ["WF_EXCEPTION_CLASSIFICATION_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-exception-classification-browser-evidence.mjs", "/workforce/exceptions", "/api/v1/workforce/exception-decisions"],
  calendar: ["WF_CALENDAR_BROWSER", "workforce_calendar_browser", "wf_calendar_browser", "workforce-calendar-browser-evidence.mjs", "/workforce/calendar", "/api/v1/workforce/configuration/calendar"],
  today: ["WF_MANAGER_TODAY_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-manager-today-browser-evidence.mjs", "/workforce", "/api/v1/workforce/today"],
  exceptions: ["WF_EXCEPTION_REPORT_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-exception-report-browser-evidence.mjs", "/workforce/exceptions/report", "/api/v1/workforce/exception-reports"],
  versions: ["WF_POLICY_VERSION_BROWSER", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-policy-version-browser-evidence.mjs", "/workforce/configuration/policy-versions", "/api/v1/workforce/configuration/policies/compare"],
  impact: ["WF_POLICY_IMPACT", "workforce_manager_today_browser", "wf_manager_today_browser", "workforce-policy-employee-impact-browser-evidence.mjs", "/workforce/configuration/policy-versions", "/api/v1/workforce/configuration/policies/fixture/employee-impact"],
  "restore-api": ["WF_POLICY_RESTORE", "workforce_manager_today_browser", "wf_policy_restore", "workforce-policy-restore-api-evidence.mjs", "/workforce/configuration/policy-versions", "/api/v1/workforce/configuration/policies/fixture/restore-draft"],
  "restore-browser": ["WF_POLICY_RESTORE", "workforce_manager_today_browser", "wf_policy_restore", "workforce-policy-restore-browser-evidence.mjs", "/workforce/configuration/policy-versions", "/api/v1/workforce/configuration/policies/fixture/restore-draft"],
  bulk: ["WF_BULK", "workforce_bulk_browser", "wf_bulk_browser", "workforce-bulk-browser-evidence.mjs", "/workforce/configuration", "/api/v1/workforce/configuration/assignments/bulk/publish"],
}
const name = process.argv[2]
assert.ok(Object.hasOwn(profiles, name), "An explicit known fixture profile is required")
assert.equal(process.env.GITHUB_ACTIONS, "true")
assert.equal(process.env.CI, "true")
assert.equal(process.env.NODE_ENV, "development")
assert.equal(process.env.LEADDRIVE_DISABLE_SERVICE_WORKER, "1")
const [prefix, databaseName, roleName, archivedScript, pagePath, apiPath] = profiles[name]
const policyPath = "src/lib/crm-product-availability.ts"
const policyBytes = await readFile(policyPath, "utf8")
// Compile the actual dependency-free application policy using the installed TS
// compiler. No source edits, fixture overrides or independent copied policy.
const { outputText } = ts.transpileModule(policyBytes, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const policy = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)
if (policy.isCrmCapabilityAvailable("workforce-hrm")) {
  const result = spawnSync(process.execPath, [`scripts/${archivedScript}`], { stdio: "inherit" })
  process.exit(result.status ?? 1)
}
assert.ok(policy.isWithdrawnCrmPath(pagePath))
assert.ok(policy.isWithdrawnCrmPath(apiPath))
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])
const origin = new URL(process.env[`${prefix}_BASE_URL`])
assert.equal(origin.protocol, "http:")
assert.ok(loopback.has(origin.hostname))
assert.equal(origin.pathname, "/")
assert.ok(!(origin.username || origin.password || origin.search || origin.hash), "Bare fixture origin required")
function database(value, role) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(loopback.has(url.hostname))
  assert.equal(url.pathname, `/${databaseName}`)
  assert.equal(url.username, role)
  return url
}
const adminURL = database(process.env.ADMIN_DATABASE_URL, "postgres")
const appURL = database(process.env.DATABASE_URL, roleName)
assert.equal(adminURL.host, appURL.host)
assert.ok(database(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres").href === adminURL.href, "Exact fixture target fence required")
if (process.env.REDIS_URL) {
  const redis = new URL(process.env.REDIS_URL)
  assert.ok(redis.protocol === "redis:" && loopback.has(redis.hostname) && (!redis.pathname || redis.pathname === "/0") && !redis.username && !redis.password && !redis.search && !redis.hash, "Disposable loopback Redis required")
}
const headSha = process.env[`${prefix}_HEAD_SHA`]
assert.match(headSha || "", /^[0-9a-f]{40}$/)
const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
assert.equal(checkoutSha, process.env.GITHUB_SHA)
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"])
const parents = execFileSync("git", ["show", "-s", "--format=%P", "HEAD"], { encoding: "utf8" }).trim().split(" ")
if (checkoutSha !== headSha) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
  assert.equal(event.pull_request?.head?.sha, headSha)
  assert.deepEqual(parents, [event.pull_request.base.sha, headSha], "Exact GitHub candidate parents required")
}
const output = process.env[`${prefix}_OUTPUT_DIR`] || (name === "bulk" ? process.env.WF_BULK_OUTPUT : undefined)
assert.ok(output?.startsWith("artifacts/"))
await mkdir(output, { recursive: true })
const password = `Disposable!9-${randomUUID()}`
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const admin = makeRlsTestPrisma(adminURL.href)
// The existing restore app uses a bounded pool query. The RLS test client
// compares the exact fixture target URL; keep the running app URL unchanged.
const helperAppURL = new URL(appURL.href)
if (name.startsWith("restore-")) {
  assert.equal(helperAppURL.search, "?connection_limit=4")
  helperAppURL.search = ""
}
const app = makeRlsTestPrisma(helperAppURL.href)
const receipt = {
  status: "RUNNING", contract: "CRM_WORKFORCE_WITHDRAWN", profile: name, headSha, checkoutSha,
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  parents,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  productionMutation: false, cases: [], sourceBindings: [],
  archivedJourney: { script: archivedScript, status: "NOT RUN", reason: "Product withdrawn from CRM; original journey retained for extraction" },
  limitations: ["Synthetic disposable database, not production observations", "Next development bundle; production build is a separate gate", "No functional HRM acceptance or roadmap closure"],
}
for (const path of [policyPath, "src/proxy.ts", "scripts/workforce-crm-lifecycle-evidence.mjs", `scripts/${archivedScript}`]) {
  const bytes = await readFile(path)
  receipt.sourceBindings.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") })
}
let browser
let stage = "seed-preserved-history"
const record = name => receipt.cases.push({ name, status: "PASS" })
async function history(ids) {
  const where = { organizationId: { in: ids } }, orderBy = { id: "asc" }
  return {
    policies: await admin.workforcePolicy.findMany({ where, orderBy }),
    shifts: await admin.workforceShiftTemplate.findMany({ where, orderBy }),
    audits: await admin.mtmAuditLog.findMany({ where, orderBy }),
  }
}
try {
  const passwordHash = await bcrypt.hash(password, 10)
  const principals = []
  for (const [index, role] of ["superadmin", "admin"].entries()) {
    const organization = await admin.organization.create({ data: {
      name: `Synthetic withdrawal ${index}`, slug: `wf-withdraw-${suffix}-${index}`,
      isActive: true, plan: "enterprise", features: ["crm", "mtm", "workforce-hrm"],
      modules: { crm: true, mtm: true, "workforce-hrm": true },
    } })
    const user = await admin.user.create({ data: { organizationId: organization.id, name: "Synthetic operator", role, passwordHash, email: `wf-withdraw-${suffix}-${index}@example.invalid` } })
    const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 900, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: 3600 }
    await admin.workforcePolicy.create({ data: { organizationId: organization.id, version: 1, name: "Synthetic retained policy", status: "DRAFT", effectiveFrom: new Date("2026-01-01T00:00:00Z"), definition, definitionHash: createHash("sha256").update(JSON.stringify(definition)).digest("hex"), createdByUserId: user.id } })
    principals.push({ organization, user })
  }
  const ids = principals.map(p => p.organization.id)
  const before = await history(ids)
  assert.equal(before.policies.length, 2)
  const historyHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  receipt.preservation = { beforeHash: historyHash(before), policyCount: before.policies.length, shiftCount: before.shifts.length, auditCount: before.audits.length }
  const organizationsBefore = await admin.organization.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })
  const role = (await app.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)[0]
  assert.equal(role.name, roleName); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false)
  assert.equal(await app.user.count({ where: { organizationId: { in: ids } } }), 0)
  const scoped = await app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ids[0]}, true)`
    return tx.user.findMany({ where: { organizationId: { in: ids } }, select: { organizationId: true } })
  })
  assert.equal(scoped.length, 1); assert.equal(scoped[0].organizationId, ids[0])
  record("existing restricted database role and forced own/foreign user isolation")
  browser = await chromium.launch({ headless: true })
  for (const { organization, user } of principals) {
    stage = `authenticated-withdrawal-${user.role}`
    const context = await browser.newContext({ baseURL: origin.origin, serviceWorkers: "block" })
    await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
    const csrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
    assert.equal(csrf.status(), 200)
    const login = await context.request.post("/api/auth/callback/credentials", { timeout: 120_000, headers: { "X-Auth-Return-Redirect": "1" }, form: { csrfToken: (await csrf.json()).csrfToken, email: user.email, password, organizationSlug: organization.slug, callbackUrl: origin.origin } })
    assert.equal(login.status(), 200)
    assert.equal(new URL((await login.json()).url, origin).searchParams.get("error"), null)
    const session = await context.request.get("/api/auth/session", { timeout: 120_000 })
    assert.equal(session.status(), 200)
    const identity = (await session.json()).user
    assert.equal(identity.id, user.id); assert.equal(identity.organizationId, organization.id); assert.equal(identity.role, user.role)
    const page = await context.newPage()
    const response = await page.goto(pagePath, { waitUntil: "domcontentloaded", timeout: 120_000 })
    assert.equal(response.status(), 404)
    assert.equal(response.headers()["cache-control"], "private, no-store")
    assert.equal(await page.locator("form, main").count(), 0)
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const denied = await context.request.fetch(apiPath, { method })
      assert.equal(denied.status(), 410)
      assert.equal((await denied.json()).code, "CRM_MODULE_UNAVAILABLE")
      assert.equal(denied.headers()["cache-control"], "private, no-store")
    }
    assert.equal((await context.request.get("/api/v1/ping")).status(), 200)
    await context.close()
    record(`${user.role}: retained entitlement cannot open page or any API method; CRM remains reachable`)
  }
  stage = "verify-preservation"
  const after = await history(ids)
  assert.deepEqual(after, before)
  receipt.preservation.afterHash = historyHash(after)
  assert.deepEqual(await admin.organization.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }), organizationsBefore)
  record("both tenants retain exact HRM history and organization entitlements")
  receipt.status = "PASS"
} catch (error) {
  receipt.status = "FAILED"
  receipt.failure = { stage, name: error?.name || "Error", message: String(error?.message || "Failure").replaceAll(password, "[redacted]").replaceAll(appURL.password, "[redacted]").replaceAll(adminURL.password, "[redacted]").slice(0, 1800) }
  process.exitCode = 1
} finally {
  receipt.finishedAt = new Date().toISOString()
  await writeFile(`${output}/crm-withdrawal-${name}.json`, JSON.stringify(receipt, null, 2) + "\n")
  await browser?.close().catch(() => {})
  await Promise.allSettled([admin.$disconnect(), app.$disconnect()])
}
console.log(`CRM withdrawal ${name}: ${receipt.status}; archived functional journey NOT RUN`)
