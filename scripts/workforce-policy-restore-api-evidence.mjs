import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import { request } from "playwright"
import { PrismaClient } from "@prisma/client"

assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true"); assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1")
assert.notEqual(process.env.NODE_ENV, "production")
const origin = new URL(process.env.WF_POLICY_RESTORE_BASE_URL)
assert.equal(origin.protocol, "http:"); assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname))
assert.equal(origin.pathname, "/"); assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
function database(value, role) {
  const url = new URL(value); assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.equal(url.username, role)
  assert.equal(url.pathname, "/workforce_manager_today_browser"); return url
}
const ownerURL = database(process.env.ADMIN_DATABASE_URL, "postgres"), appURL = database(process.env.DATABASE_URL, "wf_policy_restore")
assert.equal(ownerURL.host, appURL.host); assert.equal(database(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres").href, ownerURL.href)
assert.match(process.env.WF_POLICY_RESTORE_HEAD_SHA || "", /^[a-f0-9]{40}$/); assert.match(process.env.GITHUB_SHA || "", /^[a-f0-9]{40}$/)
const owner = new PrismaClient({ datasourceUrl: ownerURL.href }), contexts = [], orgs = [], people = [], sourceIds = []
const directory = process.env.WF_POLICY_RESTORE_OUTPUT_DIR || "artifacts/workforce-policy-restore"
await mkdir(directory, { recursive: true })
const suffix = randomUUID(), password = `Fixture!9-${randomUUID()}`
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
const day = offset => new Date(today.getTime() + offset * 86400000), key = offset => day(offset).toISOString().slice(0, 10)
function canonical(value) { if (value == null || typeof value !== "object") return value; if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)])) }
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0,
  longPauseThresholdSeconds: null, opaque: { retained: [null, 0, { deferred: true }] } }, definitionHash = hash(definition)
const cases = [], authentication = [], cleanup = []
let stage = "seed", failed = false, fixture, beforeFacts
const op = label => `restore-api-${label}-${suffix}`
const body = label => ({ operationId: op(label), expectedSourceVersion: 1, expectedSourceDefinitionHash: definitionHash, name: "Restored API draft", effectiveFrom: key(30) })
const endpoint = id => `/api/v1/workforce/configuration/policies/${id}/restore-draft`
const privateHeaders = response => { assert.equal(response.headers()["cache-control"], "private, no-store"); assert.equal(response.headers().vary, "Cookie"); assert.equal(response.headers()["x-content-type-options"], "nosniff") }
async function post(context, id, data, status, query = "") {
  const response = await context.post(endpoint(id) + query, { data, headers: { "x-organization-id": orgs[1], "x-user-id": "untrusted" }, timeout: 120000 })
  assert.equal(response.status(), status); privateHeaders(response)
  return response.json()
}
async function counts() { return { policies: await owner.workforcePolicy.count({ where: { organizationId: { in: orgs } } }),
  audits: await owner.mtmAuditLog.count({ where: { organizationId: { in: orgs } } }) } }
async function facts() { return { sources: await owner.workforcePolicy.findMany({ where: { id: { in: sourceIds } }, orderBy: { id: "asc" } }),
  teams: await owner.mtmTeam.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }),
  grants: await owner.workforceAccessGrant.findMany({ where: { organizationId: { in: orgs } }, orderBy: { id: "asc" } }) } }
async function authenticate(principal) {
  const context = await request.newContext({ baseURL: origin.href, maxRedirects: 0 }); contexts.push(context)
  const csrf = await context.get("/api/auth/csrf", { timeout: 120000 }); assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string")
  // Exactly five real callbacks, below the unchanged ten/minute limiter.
  assert.ok(authentication.length < 5)
  const callback = await context.post("/api/auth/callback/credentials", { timeout: 120000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: origin.href + "workforce" } })
  assert.equal(callback.status(), 200); const redirect = new URL((await callback.json()).url, origin)
  assert.equal(redirect.origin, origin.origin); assert.equal(redirect.searchParams.get("error"), null)
  const sessionResponse = await context.get("/api/auth/session"); assert.equal(sessionResponse.status(), 200)
  const session = await sessionResponse.json(); assert.equal(session.user.id, principal.id); assert.equal(session.user.organizationId, principal.organizationId)
  authentication.push({ csrfStatus: 200, callbackStatus: 200, actualSessionPrincipalAndTenant: true })
  return context
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 4)
  for (const index of [0, 1]) {
    const org = await owner.organization.create({ data: { name: "Restore API disposable fixture", slug: `restore-api-${index}-${suffix}`, plan: "enterprise",
      modules: { "workforce-hrm": true }, features: index === 0 ? ["workforce-hrm", "workforce-granular-access-v1"] : ["workforce-hrm"] } })
    orgs.push(org.id)
    await owner.mtmSetting.create({ data: { organizationId: org.id, key: "timezone", value: "UTC" } })
    const team = await owner.mtmTeam.create({ data: { organizationId: org.id, name: "Restore API team", code: `restore-api-${index}-${suffix}` } })
    const principals = []
    for (const kind of index === 0 ? ["hr", "other-hr", "team-only", "crm-admin"] : ["legacy-admin"]) {
      const user = await owner.user.create({ data: { organizationId: org.id, email: `${kind}-${suffix}@example.test`, name: "Restore fixture principal", passwordHash,
        role: ["crm-admin", "legacy-admin"].includes(kind) ? "admin" : "manager", require2fa: false, totpEnabled: false, smsAuthEnabled: false } })
      people.push(user); principals.push({ ...user, slug: org.slug, kind })
    }
    if (index === 0) for (const principal of principals.filter(row => row.kind !== "crm-admin")) await owner.workforceAccessGrant.create({ data: {
      organizationId: org.id, principalUserId: principal.id, role: "HR_ADMIN", scopeKind: principal.kind === "team-only" ? "TEAM" : "ORGANIZATION",
      scopeTeamId: principal.kind === "team-only" ? team.id : null, effectiveFrom: day(-1), operationId: op(principal.kind), grantedByUserId: principals[3].id,
      grantReasonCode: "HOSTED_RESTORE_FIXTURE" } })
    async function source(label, teamId = null, status = "ACTIVE", corrupt = false) {
      const row = await owner.workforcePolicy.create({ data: { organizationId: org.id, teamId, version: label === "draft" ? 2 : label === "corrupt" ? 3 : 1,
        name: "Recorded API source", status, effectiveFrom: day(-365), effectiveTo: status === "RETIRED" ? day(-30) : null,
        definition, definitionHash: corrupt ? "0".repeat(64) : definitionHash, createdByUserId: principals[0].id,
        ...(status === "DRAFT" ? {} : { activatedByUserId: principals[0].id, activatedAt: day(-365) }), retiredAt: status === "RETIRED" ? day(-30) : null } })
      sourceIds.push(row.id); return row
    }
    const recorded = await source("org"), teamRecorded = await source("team", team.id, "RETIRED")
    const unpublished = index === 0 ? await source("draft", team.id, "DRAFT") : null
    const corrupt = index === 0 ? await source("corrupt", team.id, "RETIRED", true) : null
    if (index === 0) fixture = { principals, recorded, teamRecorded, unpublished, corrupt }
    else fixture.foreign = { principal: principals[0], recorded }
  }
}

try {
  await seed(); beforeFacts = await facts()
  const hr = await authenticate(fixture.principals[0]), other = await authenticate(fixture.principals[1])
  const teamOnly = await authenticate(fixture.principals[2]), crm = await authenticate(fixture.principals[3]), legacy = await authenticate(fixture.foreign.principal)
  stage = "authorized-fresh"
  const fresh = await post(hr, fixture.recorded.id, body("fresh"), 201)
  assert.equal(fresh.data.restore.basis, "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE"); assert.equal(fresh.data.restore.replayed, false)
  const row = await owner.workforcePolicy.findUniqueOrThrow({ where: { id: fresh.data.restore.creation.policyId } })
  assert.equal(row.organizationId, orgs[0]); assert.equal(row.createdByUserId, fixture.principals[0].id); assert.equal(row.provenance, "TENANT_ADMIN")
  assert.equal(row.systemProfileVersion, null); assert.equal(row.status, "DRAFT"); assert.deepEqual(row.definition, definition); assert.equal(row.definitionHash, definitionHash)
  assert.equal(row.activatedAt, null); assert.equal(row.retiredAt, null); assert.equal(row.restoreOperationId, op("fresh"))
  assert.equal(JSON.stringify(fresh).includes("opaque"), false); cases.push("actual-org-hr-session-full-definition-new-draft-private-response")
  stage = "exact-replay-other-actor"
  let before = await counts()
  const replay = await post(other, fixture.recorded.id, body("fresh"), 200)
  assert.equal(replay.data.restore.replayed, true); assert.deepEqual(replay.data.restore.creation, fresh.data.restore.creation); assert.deepEqual(await counts(), before)
  const audits = await owner.mtmAuditLog.findMany({ where: { organizationId: orgs[0], entityId: op("fresh") } })
  assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, fixture.principals[0].id)
  cases.push("other-authorized-actor-exact-creation-replay-one-original-audit")
  stage = "team-and-legacy"
  const team = await post(hr, fixture.teamRecorded.id, body("team"), 201)
  assert.equal(team.data.restore.creation.teamId, fixture.teamRecorded.teamId)
  const legacyResult = await post(legacy, fixture.foreign.recorded.id, body("legacy"), 201)
  assert.equal((await owner.workforcePolicy.findUniqueOrThrow({ where: { id: legacyResult.data.restore.creation.policyId } })).organizationId, orgs[1])
  cases.push("retired-team-exact-scope-and-legacy-admin-own-tenant")
  stage = "actual-api-concurrency"
  const responses = await Promise.all([hr.post(endpoint(fixture.recorded.id), { data: body("concurrent"), timeout: 120000 }), hr.post(endpoint(fixture.recorded.id), { data: body("concurrent"), timeout: 120000 })])
  assert.deepEqual(responses.map(response => response.status()).sort(), [200, 201]); responses.forEach(privateHeaders)
  const concurrent = await Promise.all(responses.map(response => response.json())); assert.deepEqual(concurrent[0].data.restore.creation, concurrent[1].data.restore.creation)
  assert.equal(await owner.workforcePolicy.count({ where: { organizationId: orgs[0], restoreOperationId: op("concurrent") } }), 1)
  assert.equal(await owner.mtmAuditLog.count({ where: { organizationId: orgs[0], entityId: op("concurrent") } }), 1)
  cases.push("actual-two-post-same-operation-one-create-one-replay")
  stage = "strict-input-and-source"
  before = await counts()
  const conflict = await post(hr, fixture.recorded.id, { ...body("fresh"), name: "Changed request" }, 409)
  assert.equal(conflict.code, "WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT")
  for (const extra of [{ organizationId: orgs[1] }, { definition: {} }, { teamId: fixture.teamRecorded.teamId }, { activate: true }]) {
    assert.equal((await post(hr, fixture.recorded.id, { ...body("invalid"), ...extra }, 400)).code, "WORKFORCE_POLICY_RESTORE_INPUT_INVALID")
  }
  await post(hr, fixture.recorded.id, body("query"), 400, "?organizationId=foreign")
  await post(hr, fixture.foreign.recorded.id, body("foreign"), 404)
  await post(hr, fixture.unpublished.id, { ...body("unpublished"), expectedSourceVersion: 2 }, 404)
  assert.equal((await post(hr, fixture.corrupt.id, { ...body("corrupt"), expectedSourceVersion: 3, expectedSourceDefinitionHash: "0".repeat(64) }, 409)).code, "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID")
  await post(hr, fixture.recorded.id, { ...body("stale"), expectedSourceVersion: 2 }, 409)
  assert.equal((await post(hr, fixture.recorded.id, { ...body("past"), effectiveFrom: key(-1) }, 409)).code, "WORKFORCE_POLICY_RESTORE_NOT_FUTURE")
  assert.deepEqual(await counts(), before); cases.push("strict-body-query-source-integrity-version-date-and-conflict-no-write")
  stage = "granular-denial"
  before = await counts()
  await post(teamOnly, fixture.recorded.id, body("denied-team"), 403)
  await post(crm, fixture.recorded.id, body("denied-crm"), 403)
  assert.deepEqual(await counts(), before); cases.push("actual-team-only-and-crm-admin-without-org-hr-grant-denied")
  stage = "real-api-audit-rollback"
  await owner.$executeRawUnsafe(`CREATE FUNCTION wf_fixture_restore_api_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${op("rollback")}' THEN RAISE EXCEPTION 'Fixture API audit rejected' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`)
  await owner.$executeRawUnsafe("CREATE TRIGGER wf_fixture_restore_api_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION wf_fixture_restore_api_fail_audit()")
  try {
    before = await counts(); const failure = await post(hr, fixture.recorded.id, body("rollback"), 503)
    assert.equal(failure.code, "WORKFORCE_POLICY_RESTORE_UNAVAILABLE"); assert.equal(JSON.stringify(failure).includes("audit rejected"), false); assert.deepEqual(await counts(), before)
  } finally { await owner.$executeRawUnsafe("DROP TRIGGER wf_fixture_restore_api_fail_audit ON mtm_audit_logs"); await owner.$executeRawUnsafe("DROP FUNCTION wf_fixture_restore_api_fail_audit()") }
  await post(hr, fixture.recorded.id, body("rollback"), 201); cases.push("actual-api-audit-failure-rollback-exact-request-retry")
  stage = "unauthenticated-proxy-boundary"
  const unauthenticated = await request.newContext({ baseURL: origin.href, maxRedirects: 0 }); contexts.push(unauthenticated)
  before = await counts(); const denied = await unauthenticated.post(endpoint(fixture.recorded.id), { data: body("unauthenticated"), timeout: 120000 })
  assert.equal(denied.status(), 307); assert.equal(new URL(denied.headers().location, origin).pathname, "/login")
  assert.deepEqual(await counts(), before); cases.push("actual-no-session-proxy-login-redirect-no-writer-not-route401-credit")
  stage = "preserved-source-facts"
  assert.deepEqual(await facts(), beforeFacts); assert.equal(authentication.length, 5)
  cases.push("published-source-team-grant-facts-unchanged-login-metadata-excluded")
} catch { failed = true }
finally {
  for (const context of contexts) { try { await context.dispose() } catch { failed = true } }
  try {
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies DISABLE TRIGGER workforce_policies_published_definition_delete_guard")
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies DISABLE TRIGGER workforce_policies_restore_anchor_guard")
      await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DISABLE TRIGGER wf_fixture_restore_audit_guard")
      await tx.$executeRawUnsafe("ALTER TABLE workforce_access_grants DISABLE TRIGGER workforce_access_grants_append_only")
      await tx.mtmAuditLog.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.workforcePolicy.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.workforceAccessGrant.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.mtmSetting.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.mtmTeam.deleteMany({ where: { organizationId: { in: orgs } } })
      await tx.user.deleteMany({ where: { organizationId: { in: orgs } } }); await tx.organization.deleteMany({ where: { id: { in: orgs } } })
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies ENABLE TRIGGER workforce_policies_published_definition_delete_guard")
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies ENABLE TRIGGER workforce_policies_restore_anchor_guard")
      await tx.$executeRawUnsafe("ALTER TABLE mtm_audit_logs ENABLE TRIGGER wf_fixture_restore_audit_guard")
      await tx.$executeRawUnsafe("ALTER TABLE workforce_access_grants ENABLE TRIGGER workforce_access_grants_append_only")
    })
    assert.equal(await owner.organization.count({ where: { id: { in: orgs } } }), 0)
    const guards = await owner.$queryRaw`SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('workforce_policies_published_definition_delete_guard','workforce_policies_restore_anchor_guard','wf_fixture_restore_audit_guard','workforce_access_grants_append_only')`
    assert.equal(guards.length, 4); assert.ok(guards.every(row => row.tgenabled === "O")); cleanup.push({ action: "owner-scoped-removal-and-four-named-guards-restored", status: "PASS" })
  } catch { failed = true; cleanup.push({ action: "owner-scoped-removal-or-guard-restoration", status: "FAIL" }) }
  try { await owner.$disconnect(); cleanup.push({ action: "owner-disconnect", status: "PASS" }) } catch { failed = true; cleanup.push({ action: "owner-disconnect", status: "FAIL" }) }
  const paths = ["scripts/workforce-policy-restore-api-evidence.mjs", "src/app/api/v1/workforce/configuration/policies/[id]/restore-draft/route.ts",
    "src/lib/workforce/policy-restore-draft.ts", "src/lib/workforce/policy-draft-write.ts", "src/lib/workforce/configuration-management.ts",
    "src/lib/with-workforce-rls-auth.ts", "src/lib/auth.ts", "src/proxy.ts", "src/lib/prisma.ts", "src/lib/rls-context.ts",
    "scripts/ci/fixtures/workforce-policy-restore-writer.sql", "prisma/migrations/20261004073000_workforce_policy_restore_operation_anchor/migration.sql"]
  const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
  await writeFile(directory + "/restore-authorized-api-receipt.json", JSON.stringify({ status: !failed && cases.length === 9 ? "PASS" : "FAIL", requiredCases: 9,
    cases, stage, authentication, candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA, completedAt: new Date().toISOString(), sourceBindings, cleanup,
    boundary: "Actual credentials/CSRF/JWT session/proxy/granular grants/API/canonical restore transactions on disposable hosted Next dev/PostgreSQL. APIRequestContext only: no rendered UI or browser/keyboard/a11y credit. Auth login metadata writes expected and excluded from stable facts. Anonymous proxy307 is distinct from handler401; no private-header credit for its redirect. Fixture audit immutability is not production global immutability." }, null, 2) + "\n", { flag: "wx" })
}
if (failed || cases.length !== 9) throw new Error("Restore API fixture failed; sanitized complete receipt retains stage and completed cases")
