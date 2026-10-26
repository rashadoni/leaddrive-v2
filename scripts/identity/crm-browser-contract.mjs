/** Hosted-only actual Auth.js cookie acceptance. No production or provider access. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"
import { makeRlsTestPrisma } from "../_rls.mjs"

assert.equal(process.env.CI, "true"); assert.equal(process.env.GITHUB_ACTIONS, "true")
assert.equal(process.env.GITHUB_REPOSITORY, "rashadoni/leaddrive-v2")
assert.equal(process.env.RUNNER_OS, "Linux"); assert.notEqual(process.env.NODE_ENV, "production")
const head = process.env.IDENTITY_CRM_HEAD_SHA
assert.match(head ?? "", /^[a-f0-9]{40}$/)
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head)
const ownerUrl = new URL(process.env.ADMIN_DATABASE_URL), appUrl = new URL(process.env.DATABASE_URL)
assert.ok(["postgresql:", "postgres:"].includes(ownerUrl.protocol))
assert.equal(ownerUrl.hostname, "127.0.0.1"); assert.equal(ownerUrl.pathname, "/identity_crm_browser_test")
assert.equal(ownerUrl.username, "postgres"); assert.equal(appUrl.username, "identity_crm_browser")
for (const key of ["protocol", "hostname", "port", "pathname", "search"]) assert.equal(appUrl[key], ownerUrl[key])
assert.equal(new URL(process.env.EVENT_PLATFORM_TEST_DATABASE_URL).href, ownerUrl.href)
const origin = new URL(process.env.AUTH_URL)
assert.equal(origin.protocol, "http:"); assert.equal(origin.hostname, "localhost")
assert.equal(origin.pathname, "/"); assert.equal(origin.search + origin.hash + origin.username + origin.password, "")
assert.ok(Number(origin.port) > 1024)
const temp = await realpath(process.env.RUNNER_TEMP), output = resolve(process.env.IDENTITY_CRM_OUTPUT)
const path = relative(temp, output)
assert.ok(path && !path.startsWith("..") && !isAbsolute(path))
const password = process.env.IDENTITY_CRM_FIXTURE_PASSWORD
assert.match(password ?? "", /^[a-f0-9]{48}$/)
const admin = makeRlsTestPrisma(ownerUrl.href)
const company = "identity-crm-browser-company"
const operatorCompany = "identity-commission-fixture"
const userId = suffix => `identity-crm-browser-${suffix}`
const email = suffix => `${suffix}@identity-crm.invalid`
const accountKey = suffix => ({ organizationId_userId: { organizationId: company, userId: userId(suffix) } })
const grantKey = suffix => ({ organizationId_userId_application: { organizationId: company, userId: userId(suffix), application: "CRM" } })
const flagKey = { organizationId_key: { organizationId: company, key: "identityAuthV1" } }
const result = { status: "RUNNING", headSha: head, productionMutation: false, actualCookie: false,
  providerMessages: false, phase: "ADMISSION", checks: [], physicalAndroid: "NOT RUN" }
let browser
let recoveryClient
let outputOwned = false
const contexts = []
const phase = name => { result.phase = name }
const check = name => result.checks.push(name)
try {
  const [role] = await admin.$queryRaw`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='identity_crm_browser'`
  assert.equal(role?.rolsuper, false); assert.equal(role.rolbypassrls, false)
  const [cardPrivileges] = await admin.$queryRaw`SELECT
    has_column_privilege('identity_crm_browser', 'mtm_agents', 'phone', 'UPDATE') AS "canCorrectPhone",
    has_table_privilege('identity_crm_browser', 'mtm_agents', 'DELETE') AS "canDeleteCard"`
  assert.equal(cardPrivileges.canCorrectPhone, true); assert.equal(cardPrivileges.canDeleteCard, false)
  const [table] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='identity_accounts'::regclass`
  assert.equal(table.relrowsecurity, true); assert.equal(table.relforcerowsecurity, true)
  if (process.argv[2] === "prepare") {
    assert.equal(await admin.organization.count(), 0); assert.equal(await admin.user.count(), 0)
    await admin.organization.create({ data: { id: company, slug: company, name: "Fictional identity browser company", features: ["settings"], modules: { settings: true, personnel: true, "route-field": true } } })
    const commonHash = await bcrypt.hash(password, 12), legacyHash = await bcrypt.hash(`${password}-legacy`, 4)
    for (const [i, suffix] of ["ordinary", "setup", "totp", "administrator", "employee", "enrollment", "existing-time"].entries()) {
      await admin.user.create({ data: { id: userId(suffix), organizationId: company, email: email(suffix), name: `Fictional ${suffix}`, role: suffix === "administrator" ? "viewer" : "admin",
        passwordHash: legacyHash, require2fa: suffix === "setup", totpEnabled: suffix === "totp", smsAuthEnabled: false } })
      await admin.identityAccount.create({ data: { organizationId: company, userId: userId(suffix), passwordHash: commonHash, cutoverAt: new Date() } })
      await admin.identityPhoneClaim.create({ data: { organizationId: company, userId: userId(suffix), normalizedPhone: `+99450777001${i}`, verifiedAt: new Date(), accountVersion: 1 } })
      if (!["employee", "enrollment", "existing-time"].includes(suffix)) await admin.identityApplicationGrant.create({ data: { organizationId: company, userId: userId(suffix), application: "CRM", status: "ACTIVE", role: suffix === "administrator" ? "admin" : "viewer" } })
    }
    for (const [application, role] of [["ROUTE_FIELD", "AGENT"]]) {
      const actorId = userId(`employee-${application}`)
      await admin.mtmAgent.create({ data: { id: actorId, organizationId: company, userId: userId("employee"), name: "Fictional employee", role, status: "ACTIVE", attendanceParticipant: application === "TIME" } })
      await admin.identityActorBinding.create({ data: { organizationId: company, userId: userId("employee"), actorId, reviewedByUserId: userId("administrator"), reviewReference: `fixture-${application}`, accountVersion: 1 } })
    }
    await admin.mtmAgent.create({ data: { id: userId("existing-time-card"), organizationId: company, userId: userId("existing-time"),
      name: "Fictional preserved card", role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: false,
      attendanceIncludedFrom: new Date("2026-10-01T00:00:00Z"), position: "Preserved position" } })
    const fieldId = userId("enrollment-field")
    await admin.mtmAgent.create({ data: { id: fieldId, organizationId: company, userId: userId("enrollment"), name: "Fictional enrollment", role: "AGENT", status: "ACTIVE" } })
    await admin.identityActorBinding.create({ data: { organizationId: company, userId: userId("enrollment"), actorId: fieldId, reviewedByUserId: userId("administrator"), reviewReference: "fixture-enrollment-field", accountVersion: 1 } })
    await admin.identityApplicationGrant.create({ data: { organizationId: company, userId: userId("enrollment"), application: "ROUTE_FIELD", role: "AGENT", status: "ACTIVE" } })
    await admin.identityApplicationMembership.create({ data: { organizationId: company, userId: userId("enrollment"), actorId: fieldId, application: "ROUTE_FIELD", status: "ACTIVE" } })
    const pendingUser = userId("onboarding"), pendingActor = userId("onboarding-field")
    await admin.user.create({ data: { id: pendingUser, organizationId: company, email: email("onboarding"), name: "Fictional first login",
      phone: "+994507770020", role: "viewer", passwordHash: legacyHash, isActive: true } })
    await admin.mtmAgent.create({ data: { id: pendingActor, organizationId: company, userId: pendingUser, name: "Fictional first login", phone: "+994507770020", role: "AGENT", status: "ACTIVE", passwordHash: legacyHash } })
    await admin.user.create({ data: { id: userId("time-only"), organizationId: company, email: email("time-only"), name: "Fictional Time only",
      phone: "+994507770021", role: "viewer", passwordHash: legacyHash, isActive: true } })
    for (const [suffix, phone, require2fa] of [["bootstrap", "+994507770022", false], ["bootstrap-mfa", "+994507770023", true]]) {
      await admin.user.create({ data: { id: userId(suffix), organizationId: company, email: email(suffix), name: "Fictional initial administrator",
        phone, role: "admin", passwordHash: legacyHash, isActive: true, require2fa } })
    }
    await admin.mtmSetting.create({ data: { organizationId: company, key: "attendanceEnabled", value: true } })
    await admin.mtmSetting.create({ data: { organizationId: company, key: "identityAuthV1", value: { version: 1, enabled: true } } })
    phase("OPERATOR_COMPANY_OPT_IN_SQL")
    const { inventorySql, enableSql, databaseEnvironment, assertInventory } = await import("./commission-runtime.mjs")
    await admin.organization.create({ data: { id: operatorCompany, slug: operatorCompany, name: "Fictional operator company" } })
    const operatorSql = (query, readonly = true) => execFileSync("psql", ["-X", "-qAt", "--set=ON_ERROR_STOP=1",
      `--set=slug=${operatorCompany}`, `--set=sha=${head}`, "--set=operator=fixture-operator",
      "--set=setting_id=identity-commission-setting", "--set=audit_id=identity-commission-audit"], {
      encoding: "utf8", input: query, env: databaseEnvironment(appUrl.href, ownerUrl.href, readonly), timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
    })
    phase("OPERATOR_ADMINISTRATOR_DIAGNOSTICS")
    const diagnosticAdmin = `${operatorCompany}-admin`
    await admin.user.create({ data: { id: diagnosticAdmin, organizationId: operatorCompany, name: "Fictional diagnostic admin",
      email: "diagnostic@identity-crm.invalid", role: "admin", phone: "", passwordHash: legacyHash } })
    const emptyInventory = JSON.parse(operatorSql(inventorySql)); assertInventory(emptyInventory)
    assert.equal(emptyInventory.administratorReadiness.tenantAdmins, 1)
    assert.equal(emptyInventory.administratorReadiness.emptyPhones, 1)
    assert.equal(emptyInventory.administratorReadiness.otherPhoneOwners, 0)
    assert.equal(JSON.stringify(emptyInventory).includes(diagnosticAdmin), false)
    await admin.user.delete({ where: { id: diagnosticAdmin } })
    phase("OPERATOR_COMPANY_INVENTORY")
    const operatorBefore = JSON.parse(operatorSql(inventorySql)); assertInventory(operatorBefore); assert.equal(operatorBefore.enabled, false)
    await admin.$executeRawUnsafe(`CREATE FUNCTION identity_commission_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'IDENTITY_COMPANY_ENABLED' THEN RAISE EXCEPTION 'SYNTHETIC_COMMISSION_AUDIT_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`)
    await admin.$executeRawUnsafe('CREATE TRIGGER identity_commission_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION identity_commission_fail_audit()')
    try {
      phase("OPERATOR_COMPANY_AUDIT_ROLLBACK")
      assert.throws(() => operatorSql(enableSql, false), error => String(error.stderr).includes("SYNTHETIC_COMMISSION_AUDIT_FAILURE"))
      assert.equal(await admin.mtmSetting.count({ where: { organizationId: operatorCompany } }), 0)
      assert.equal(await admin.mtmAuditLog.count({ where: { organizationId: operatorCompany } }), 0)
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER identity_commission_fail_audit ON mtm_audit_logs')
      await admin.$executeRawUnsafe('DROP FUNCTION identity_commission_fail_audit()')
    }
    phase("OPERATOR_COMPANY_READONLY_REFUSAL")
    assert.throws(() => operatorSql(enableSql, true), error => String(error.stderr).includes("read-only transaction"))
    assert.equal(await admin.mtmSetting.count({ where: { organizationId: operatorCompany } }), 0)
    await admin.mtmSetting.create({ data: { organizationId: operatorCompany, key: "identityAuthV1", value: { version: 1, enabled: false } } })
    phase("OPERATOR_COMPANY_ENABLE_AND_RETRY")
    operatorSql(enableSql, false); operatorSql(enableSql, false)
    const operatorAfter = JSON.parse(operatorSql(inventorySql)); assertInventory(operatorAfter); assert.equal(operatorAfter.enabled, true)
    assert.equal(operatorAfter.canonicalCount, operatorBefore.canonicalCount); assert.equal(operatorAfter.proofCount, operatorBefore.proofCount)
    assert.equal(await admin.mtmAuditLog.count({ where: { organizationId: operatorCompany, action: "IDENTITY_COMPANY_ENABLED" } }), 1)
    const operatorAudit = await admin.mtmAuditLog.findFirstOrThrow({ where: { organizationId: operatorCompany, action: "IDENTITY_COMPANY_ENABLED" } })
    phase("OPERATOR_COMPANY_PRIOR_VALUE_AUDIT")
    assert.deepEqual(operatorAudit.oldData, { version: 1, enabled: false })
    assert.deepEqual(operatorAudit.newData, { enabled: true, sourceSha: head, githubOperator: "fixture-operator" })
    assert.deepEqual((await admin.mtmSetting.findUniqueOrThrow({ where: flagKey })).value, { version: 1, enabled: true })
    phase("OPERATOR_COMPANY_INACTIVE_REFUSAL")
    await admin.organization.update({ where: { id: operatorCompany }, data: { isActive: false } })
    assert.throws(() => operatorSql(enableSql, false))
    assert.equal(await admin.mtmAuditLog.count({ where: { organizationId: operatorCompany } }), 1)
    process.stdout.write("IDENTITY_COMMISSION_SQL_PASS rollback_idempotency_scope_no_conversion\n")
    process.stdout.write("IDENTITY_CRM_BROWSER_FIXTURE_PREPARED\n")
  } else {
    assert.equal(process.argv[2], "verify")
    await mkdir(output, { mode: 0o700 }) // Refuse stale output, never clear another run.
    outputOwned = true
    browser = await chromium.launch({ headless: true })
    async function context() {
      const current = await browser.newContext({ baseURL: origin.href, viewport: { width: 1440, height: 900 } })
      contexts.push(current)
      await current.route("**/*", route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
      return current
    }
    const authTimes = []
    async function reserveAuthPost() {
      while (authTimes.length && authTimes[0] <= Date.now() - 61000) authTimes.shift()
      if (authTimes.length >= 8) {
        await delay(Math.max(0, authTimes[0] + 61000 - Date.now()) + 25)
        authTimes.shift()
      }
      authTimes.push(Date.now())
    }
    async function login(suffix, entered = password, organizationSlug = company) {
      await reserveAuthPost()
      const current = await context()
      const csrf = await current.request.get("/api/auth/csrf", { timeout: 120000 })
      assert.equal(csrf.status(), 200)
      const { csrfToken } = await csrf.json(); assert.equal(typeof csrfToken, "string")
      const callback = await current.request.post("/api/auth/callback/credentials", { timeout: 120000,
        headers: { "X-Auth-Return-Redirect": "1" }, form: { csrfToken, email: email(suffix), password: entered,
          ...(organizationSlug ? { organizationSlug } : {}), callbackUrl: origin.href + "dashboard" } })
      assert.equal(callback.status(), 200)
      const error = new URL((await callback.json()).url, origin).searchParams.get("error")
      return { current, error }
    }
    async function session(current) {
      const response = await current.request.get("/api/auth/session", { timeout: 120000 })
      assert.equal(response.status(), 200)
      const value = await response.json() ?? {}
      assert.equal(value.identityCrm, undefined); assert.equal(value.user?.identityCrm, undefined)
      assert.equal(JSON.stringify(value).includes("credentialEpoch"), false)
      return value
    }
    async function denied(current) {
      assert.equal((await session(current)).user, undefined)
      const response = await current.request.get("/api/v1/users", { timeout: 120000, maxRedirects: 0 })
      if (response.status() === 307) {
        // The real proxy denies anonymous requests by redirecting to login.
        // Do not follow that redirect and mistake its HTML200 for API access.
        const target = new URL(response.headers().location, origin)
        assert.equal(target.origin, origin.origin); assert.equal(target.pathname, "/login")
        assert.equal(target.searchParams.get("callbackUrl"), "/api/v1/users")
      } else {
        assert.equal(response.status(), 401)
        assert.equal((await response.json()).error, "Unauthorized")
      }
    }
    phase("LEGACY_PASSWORD_AND_MISSING_TENANT_REFUSED")
    for (const [entered, tenant] of [[`${password}-legacy`, company], [password, ""], [password, "fictional-other-company"]]) {
      const refused = await login("ordinary", entered, tenant)
      assert.equal(refused.error, "CredentialsSignin"); await denied(refused.current)
    }
    check("canonical_person_cannot_use_old_password_or_implicit_tenant")
    phase("SHARED_PASSWORD_ACTUAL_COOKIE_AND_CRM_ROLE")
    const ordinary = await login("ordinary"); assert.equal(ordinary.error, null)
    assert.deepEqual((await session(ordinary.current)).user.role, "viewer")
    assert.ok((await ordinary.current.cookies()).some(c => /(?:authjs|next-auth)\.session-token/.test(c.name)))
    result.actualCookie = true
    const personState = await admin.user.findUniqueOrThrow({ where: { id: userId("ordinary") }, select: { loginCount: true, role: true } })
    assert.ok(personState.loginCount > 0); assert.equal(personState.role, "admin")
    const roster = await ordinary.current.request.get("/api/v1/users", { timeout: 120000, maxRedirects: 0 })
    assert.equal(roster.status(), 200)
    const rosterBody = await roster.json()
    assert.equal(rosterBody.success, true)
    assert.ok(Array.isArray(rosterBody.data)); assert.ok(rosterBody.data.length > 0)
    for (const person of rosterBody.data) {
      assert.equal(person.totpEnabled, undefined); assert.equal(person.verifiedPhone, undefined)
    }
    // Render the real authenticated session response in Chromium, without
    // screenshots of cookie jars, tokens, CSRF values or password fields.
    const page = await ordinary.current.newPage()
    const response = await page.goto(origin.href + "api/auth/session", { timeout: 120000 })
    assert.equal(response.status(), 200)
    assert.match(await page.locator("body").innerText(), /"role"\s*:\s*"viewer"/)
    await page.screenshot({ path: resolve(output, "authenticated-session.png") })
    check("actual_authjs_cookie_shared_password_private_hint_hidden_and_viewer_permissions_despite_legacy_admin_role")
    phase("SIBLING_APPLICATION_ISOLATION_AND_CRM_REVOCATION")
    await admin.identityApplicationGrant.create({ data: { organizationId: company, userId: userId("ordinary"), application: "TIME", status: "ACTIVE", role: "EMPLOYEE" } })
    await admin.identityAccount.update({ where: accountKey("ordinary"), data: { version: { increment: 1 } } })
    assert.equal((await session(ordinary.current)).user.role, "viewer")
    const originalCookies = await ordinary.current.cookies() // Synthetic fixture only, never exported.
    await admin.identityApplicationGrant.update({ where: grantKey("ordinary"), data: { status: "REVOKED", role: null, version: 2 } })
    await denied(ordinary.current)
    const revoked = await login("ordinary"); assert.equal(revoked.error, "CredentialsSignin")
    await denied(revoked.current)
    await admin.identityApplicationGrant.update({ where: grantKey("ordinary"), data: { status: "ACTIVE", role: "viewer", version: 3 } })
    // Auth.js clears invalid cookies; replay the actual earlier fixture cookie
    // in memory to prove a new grant revision, not just browser deletion.
    await ordinary.current.addCookies(originalCookies)
    await denied(ordinary.current) // Reactivation never revives an older cookie.
    check("sibling_mobile_grant_does_not_revoke_crm_but_crm_revoke_reactivate_requires_new_login")
    phase("COMMON_CREDENTIAL_EPOCH_AND_ROLLOUT_OFF")
    const renewed = await login("ordinary"); assert.equal(renewed.error, null)
    assert.equal((await session(renewed.current)).user.role, "viewer")
    await admin.identityAccount.update({ where: accountKey("ordinary"), data: { credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
    await denied(renewed.current)
    const fresh = await login("ordinary"); assert.equal(fresh.error, null)
    assert.equal((await session(fresh.current)).user.role, "viewer")
    await admin.mtmSetting.update({ where: flagKey, data: { value: false } })
    await denied(fresh.current)
    const optedOut = await login("ordinary"); assert.equal(optedOut.error, "CredentialsSignin")
    await denied(optedOut.current)
    await admin.mtmSetting.update({ where: flagKey, data: { value: { version: 1, enabled: true } } })
    check("shared_credential_epoch_and_opt_out_revoke_real_cookie_without_legacy_fallback")
    phase("CRM_MFA_SETUP_AND_TOTP_PRESERVED")
    for (const suffix of ["setup", "totp"]) {
      const admitted = await login(suffix); assert.equal(admitted.error, null)
      const state = await session(admitted.current)
      assert.equal(state.user[suffix === "setup" ? "needsSetup2fa" : "needs2fa"], true)
      await reserveAuthPost()
      const csrf = await admitted.current.request.get("/api/auth/csrf", { timeout: 120000 })
      assert.equal(csrf.status(), 200)
      const { csrfToken } = await csrf.json()
      const forged = await admitted.current.request.post("/api/auth/session", { timeout: 120000, data: { csrfToken, data: {
        needs2fa: false, needsSetup2fa: false, role: "superadmin",
        identityCrm: { mode: "IDENTITY_CRM_V1", organizationId: company, userId: userId(suffix),
          claimId: "fictional-browser-forged-claim", credentialEpoch: 999, grantVersion: 999 },
      } } })
      assert.equal(forged.status(), 200)
      const after = await session(admitted.current)
      assert.equal(after.user.role, "viewer")
      assert.equal(after.user[suffix === "setup" ? "needsSetup2fa" : "needs2fa"], true)
      const response = await admitted.current.request.get("/api/v1/users", { timeout: 120000, maxRedirects: 0 })
      assert.equal(response.status(), 403)
      const grantAttempt = await admitted.current.request.put(`/api/v1/identity/people/${userId("employee")}/applications`, { timeout: 120000, data: {} })
      assert.equal(grantAttempt.status(), 403)
    }
    check("shared_password_or_actual_session_update_cannot_satisfy_crm_mfa_or_forge_private_grants")
    phase("ACTUAL_COOKIE_ADMINISTRATOR_MODULE_ENROLLMENT")
    const enrollmentUrl = `/api/v1/identity/people/${userId("employee")}/applications`
    const actorUrl = `/api/v1/identity/people/${userId("employee")}/actors`
    const enrollment = { actorId: "unprepared", application: "TIME", role: "EMPLOYEE", status: "ACTIVE",
      expectedAccountVersion: 2, expectedGrantVersion: 0, expectedMembershipVersion: 0, requestId: "cookie-time-enroll" }
    const viewer = await login("ordinary"); assert.equal(viewer.error, null)
    assert.equal((await viewer.current.request.put(enrollmentUrl, { timeout: 120000, data: enrollment })).status(), 403)
    const administrator = await login("administrator"); assert.equal(administrator.error, null)
    assert.equal((await session(administrator.current)).user.role, "admin")
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: userId("administrator") } })).role, "viewer")
    phase("ACTUAL_ADMIN_EXISTING_PERSON_TIME_REGISTRATION")
    const lookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: "+994507770015" } })
    assert.equal(lookup.status(), 200)
    const candidate = (await lookup.json()).data
    assert.equal(candidate.kind, "canonical"); assert.equal(candidate.userId, userId("enrollment")); assert.equal(candidate.timeActorId, null)
    phase("TIME_REGISTRATION_REVIEWED_CANDIDATE")
    const registration = { userId: candidate.userId, expectedClaimId: candidate.claimId, expectedAccountVersion: candidate.accountVersion,
      requestId: "7675ea61-e8fd-4083-b796-53f8de9345bf", position: "Accountant", departmentId: null, newDepartmentName: "Fictional Finance",
      teamId: null, newTeamName: "Fictional Payroll", hireDate: "2026-10-25" }
    const registrationUrl = "/api/v1/identity/time/enroll"
    assert.equal((await viewer.current.request.post(registrationUrl, { timeout: 120000, data: registration })).status(), 403)
    phase("TIME_REGISTRATION_FIXTURE_SNAPSHOT")
    const beforePerson = await admin.user.findUniqueOrThrow({ where: { id: candidate.userId } })
    const beforeAccount = await admin.identityAccount.findUniqueOrThrow({ where: accountKey("enrollment") })
    const beforeField = await admin.mtmAgent.findUniqueOrThrow({ where: { id: userId("enrollment-field") } })
    phase("TIME_REGISTRATION_AUDIT_FAILURE_SETUP")
    await admin.$executeRawUnsafe('CREATE SEQUENCE identity_time_audit_reached')
    await admin.$executeRawUnsafe('GRANT USAGE,SELECT ON SEQUENCE identity_time_audit_reached TO identity_crm_browser')
    await admin.$executeRawUnsafe(`CREATE FUNCTION identity_time_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'MTM_IDENTITY_TIME_ENROLLED' THEN PERFORM nextval('identity_time_audit_reached'); RAISE EXCEPTION 'SYNTHETIC_TIME_AUDIT_FAILURE' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$`)
    await admin.$executeRawUnsafe('CREATE TRIGGER identity_time_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION identity_time_fail_audit()')
    try {
      phase("TIME_REGISTRATION_AUDIT_ROLLBACK")
      assert.equal((await administrator.current.request.post(registrationUrl, { timeout: 120000, data: registration })).status(), 500)
      assert.equal((await admin.$queryRawUnsafe('SELECT is_called FROM identity_time_audit_reached'))[0].is_called, true)
      assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: candidate.userId, role: "EMPLOYEE" } }), 0)
      assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: candidate.userId, application: "TIME" } }), 0)
      assert.equal(await admin.mtmDepartment.count({ where: { organizationId: company, name: registration.newDepartmentName } }), 0)
      assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey("enrollment") })).version, candidate.accountVersion)
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER identity_time_fail_audit ON mtm_audit_logs')
      await admin.$executeRawUnsafe('DROP FUNCTION identity_time_fail_audit()')
      await admin.$executeRawUnsafe('DROP SEQUENCE identity_time_audit_reached')
    }
    phase("TIME_REGISTRATION_REUSE_OWNED_CARD")
    const existingLookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: "+994507770016" } })
    assert.equal(existingLookup.status(), 200)
    const existingCandidate = (await existingLookup.json()).data
    assert.equal(existingCandidate.timeActorId, userId("existing-time-card")); assert.equal(existingCandidate.timeEnrolled, false)
    const existingBefore = await admin.mtmAgent.findUniqueOrThrow({ where: { id: existingCandidate.timeActorId } })
    const existingRegistration = { ...registration, userId: existingCandidate.userId, expectedActorId: existingCandidate.timeActorId,
      expectedAccountVersion: existingCandidate.accountVersion, expectedClaimId: existingCandidate.claimId, requestId: "51de58b9-c15f-4b0f-8a98-edb123288c01" }
    const foreignCard = await administrator.current.request.post(registrationUrl, { timeout: 120000,
      data: { ...existingRegistration, expectedActorId: beforeField.id, requestId: "51de58b9-c15f-4b0f-8a98-edb123288c02" } })
    assert.equal(foreignCard.status(), 409)
    const existingResult = await administrator.current.request.post(registrationUrl, { timeout: 120000, data: existingRegistration })
    assert.equal(existingResult.status(), 201); assert.equal((await existingResult.json()).data.agentId, existingCandidate.timeActorId)
    const existingAfter = await admin.mtmAgent.findUniqueOrThrow({ where: { id: existingCandidate.timeActorId } })
    assert.deepEqual({ ...existingAfter, attendanceParticipant: existingBefore.attendanceParticipant, updatedAt: existingBefore.updatedAt }, existingBefore)
    assert.equal(existingAfter.attendanceParticipant, true)
    assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: existingCandidate.userId } }), 1)
    assert.equal((await admin.$queryRaw`SELECT count(*)::int AS count FROM workforce_employment_events WHERE "organizationId"=${company} AND "agentId"=${existingCandidate.timeActorId}`)[0].count, 0)
    assert.equal((await administrator.current.request.post(registrationUrl, { timeout: 120000, data: existingRegistration })).status(), 201)
    const connectedLookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: "+994507770016" } })
    assert.equal((await connectedLookup.json()).data.timeEnrolled, true)
    check("existing_owned_time_card_connected_without_duplicate_or_hr_history_rewrite")
    phase("TIME_REGISTRATION_COMMIT")
    const registered = await administrator.current.request.post(registrationUrl, { timeout: 120000, data: registration })
    assert.equal(registered.status(), 201)
    phase("TIME_REGISTRATION_PRESERVED_HISTORY")
    const registeredData = (await registered.json()).data
    assert.notEqual(registeredData.agentId, beforeField.id)
    const registeredCard = await admin.mtmAgent.findUniqueOrThrow({ where: { id: registeredData.agentId }, include: { department: true, team: true } })
    assert.equal(registeredCard.position, registration.position); assert.equal(registeredCard.department.name, registration.newDepartmentName)
    assert.equal(registeredCard.team.name, registration.newTeamName)
    assert.equal((await admin.$queryRaw`SELECT count(*)::int AS count FROM workforce_employment_events WHERE "organizationId"=${company} AND "agentId"=${registeredData.agentId} AND kind='HIRE'`)[0].count, 1)
    assert.deepEqual(await admin.user.findUniqueOrThrow({ where: { id: candidate.userId } }), beforePerson)
    assert.deepEqual(await admin.mtmAgent.findUniqueOrThrow({ where: { id: beforeField.id } }), beforeField)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: candidate.userId, application: "CRM" } }), 0)
    const replayRegistration = await administrator.current.request.post(registrationUrl, { timeout: 120000, data: registration })
    assert.equal(replayRegistration.status(), 201); assert.equal((await replayRegistration.json()).data.replayed, true)
    assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: candidate.userId } }), 2)
    const afterAccount = await admin.identityAccount.findUniqueOrThrow({ where: accountKey("enrollment") })
    assert.equal(afterAccount.passwordHash, beforeAccount.passwordHash); assert.equal(afterAccount.credentialEpoch, beforeAccount.credentialEpoch)
    const registrationClient = await context()
    for (const application of ["TIME", "ROUTE_FIELD"]) {
      await reserveAuthPost()
      const response = await registrationClient.request.post("/api/v1/mtm/mobile/auth", { timeout: 120000, data: {
        organizationSlug: company, application, phone: "+994507770015", password,
      } })
      assert.equal(response.status(), 200)
      assert.equal((await response.json()).data.agent.id, application === "TIME" ? registeredData.agentId : beforeField.id)
    }
    check("actual_admin_explicit_time_registration_preserves_person_field_history_common_credential_and_all_job_metadata_with_atomic_audit_rollback_and_safe_replay")
    phase("ACTUAL_COOKIE_ADMINISTRATOR_MODULE_ENROLLMENT")
    const preparation = { actorId: null, application: "TIME", role: "EMPLOYEE", expectedAccountVersion: 1,
      reviewReference: "cookie-person-review", requestId: "cookie-time-create-card" }
    assert.equal((await viewer.current.request.post(actorUrl, { timeout: 120000, data: preparation })).status(), 403)
    // Fail the real INSERT receipt after card creation; the whole operation
    // must roll back so retry cannot leave a second, unaudited history.
    await admin.$executeRawUnsafe("CREATE SEQUENCE cookie_actor_audit_attempts")
    await admin.$executeRawUnsafe("GRANT USAGE ON SEQUENCE cookie_actor_audit_attempts TO identity_crm_browser")
    await admin.$executeRawUnsafe(`ALTER TABLE identity_events ADD CONSTRAINT cookie_actor_audit_failure CHECK ("requestId" <> 'cookie-time-create-card' OR nextval('cookie_actor_audit_attempts') < 0)`)
    try {
      const failed = await administrator.current.request.post(actorUrl, { timeout: 120000, data: preparation })
      assert.equal(failed.status(), 500)
      const [observedAudit] = await admin.$queryRawUnsafe("SELECT is_called FROM cookie_actor_audit_attempts")
      assert.equal(observedAudit.is_called, true) // Failure actually reached the injected receipt constraint.
      assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey("employee") })).version, 1)
      assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: userId("employee") } }), 1)
    } finally {
      await admin.$executeRawUnsafe("ALTER TABLE identity_events DROP CONSTRAINT cookie_actor_audit_failure")
      await admin.$executeRawUnsafe("DROP SEQUENCE cookie_actor_audit_attempts")
    }
    const prepared = await administrator.current.request.post(actorUrl, { timeout: 120000, data: preparation })
    assert.equal(prepared.status(), 200)
    const preparedData = (await prepared.json()).data
    assert.equal(preparedData.accountVersion, 2)
    assert.notEqual(preparedData.actorId, userId("employee-ROUTE_FIELD"))
    enrollment.actorId = preparedData.actorId
    const replay = await administrator.current.request.post(actorUrl, { timeout: 120000, data: preparation })
    assert.equal(replay.status(), 200)
    assert.deepEqual((await replay.json()).data, { ...preparedData, replayed: true })
    const duplicate = await administrator.current.request.post(actorUrl, { timeout: 120000, data: { ...preparation, expectedAccountVersion: 2, requestId: "cookie-time-duplicate" } })
    assert.equal(duplicate.status(), 409)
    assert.equal((await duplicate.json()).error, "IDENTITY_EXISTING_ACTOR_REVIEW_REQUIRED")
    assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: userId("employee") } }), 2)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: userId("employee") } }), 0)
    assert.equal((await administrator.current.request.put(enrollmentUrl, { timeout: 120000, data: { ...enrollment, organizationId: "other-company" } })).status(), 400)
    const enrolled = await administrator.current.request.put(enrollmentUrl, { timeout: 120000, data: enrollment })
    assert.equal(enrolled.status(), 200)
    assert.match(enrolled.headers()["cache-control"], /no-store/)
    assert.deepEqual(await enrolled.json(), { success: true, data: { accountVersion: 3, grantVersion: 1, membershipVersion: 1, replayed: false } })
    const field = await administrator.current.request.put(enrollmentUrl, { timeout: 120000, data: { ...enrollment,
      actorId: userId("employee-ROUTE_FIELD"), application: "ROUTE_FIELD", role: "AGENT", expectedAccountVersion: 3, requestId: "cookie-field-enroll" } })
    assert.equal(field.status(), 200)
    assert.equal(await admin.identityApplicationMembership.count({ where: { organizationId: company, userId: userId("employee"), status: "ACTIVE" } }), 2)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: userId("employee"), application: "CRM" } }), 0)
    phase("ACTUAL_SHARED_PHONE_MOBILE_LOGIN_AND_APPLICATION_REVOCATION")
    const mobile = await context()
    const mobileSessions = {}
    for (const application of ["TIME", "ROUTE_FIELD"]) {
      await reserveAuthPost()
      const response = await mobile.request.post("/api/v1/mtm/mobile/auth", { timeout: 120000, data: {
        application, organizationSlug: company, phone: "+994507770014", password,
      } })
      assert.equal(response.status(), 200)
      const data = (await response.json()).data
      assert.equal(data.application, application)
      assert.equal(data.agent.id, application === "TIME" ? enrollment.actorId : userId("employee-ROUTE_FIELD"))
      const headers = { Authorization: `Bearer ${data.token}` }
      mobileSessions[application] = headers // Ephemeral memory only, never receipt or screenshot.
      assert.equal((await mobile.request.get("/api/v1/users", { timeout: 120000, headers, maxRedirects: 0 })).status(), 401)
      const profile = await mobile.request.get("/api/v1/mtm/mobile/profile", { timeout: 120000, headers, maxRedirects: 0 })
      assert.equal(profile.status(), 200)
      assert.equal((await profile.json()).data.agent.id, data.agent.id)
    }
    const fieldWithTime = await mobile.request.get("/api/v1/mtm/agents", { timeout: 120000, headers: mobileSessions.TIME, maxRedirects: 0 })
    assert.ok([401, 403].includes(fieldWithTime.status()))
    phase("ACTUAL_PUBLIC_COMMON_PASSWORD_RECOVERY")
    const loadIdentity = name => import(pathToFileURL(resolve(temp, "identity-foundation/identity", `${name}.js`)).href)
    const { issueCanonicalRecovery } = await loadIdentity("canonical-recovery")
    const { phoneProofContext } = await loadIdentity("phone-proof-registry")
    const { openPhoneProofDelivery } = await loadIdentity("phone-proof")
    const { identityRuntimeKeys } = await loadIdentity("runtime-keys")
    recoveryClient = makeRlsTestPrisma(appUrl.href)
    const proofKey = identityRuntimeKeys().proof.active
    phase("LIVE_LEGACY_ADMINISTRATOR_SELF_BOOTSTRAP")
    const bootstrapApi = "/api/v1/identity/self-bootstrap"
    const bootstrapPhone = "+994507770022"
    const initialAdmin = await login("bootstrap", `${password}-legacy`)
    assert.equal(initialAdmin.error, null)
    const initialMfa = await login("bootstrap-mfa", `${password}-legacy`)
    assert.equal((await initialMfa.current.request.post(bootstrapApi, { timeout: 120000, data: { action: "review", phone: "+994507770023" } })).status(), 403)
    phase("LIVE_BOOTSTRAP_EMPTY_OPTIONAL_PHONE_AND_OWNERSHIP_BOUNDARIES")
    const reviewBootstrap = () => initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: { action: "review", phone: bootstrapPhone } })
    for (const phone of [null, ""]) {
      await admin.user.update({ where: { id: userId("bootstrap") }, data: { phone } })
      assert.equal((await reviewBootstrap()).status(), 200, "An absent optional phone must allow first verified setup")
    }
    await admin.user.update({ where: { id: userId("bootstrap") }, data: { phone: "+994507770098" } })
    const mismatch = await reviewBootstrap()
    assert.equal(mismatch.status(), 409)
    assert.equal((await mismatch.json()).error, "IDENTITY_SELF_BOOTSTRAP_PHONE_MISMATCH")
    await admin.user.update({ where: { id: userId("bootstrap") }, data: { phone: "" } })
    const bootstrapCard = userId("bootstrap-card")
    await admin.mtmAgent.create({ data: { id: bootstrapCard, organizationId: company, userId: userId("bootstrap"),
      name: "Fictional administrator card", role: "AGENT", status: "ACTIVE", phone: "" } })
    const blankCardReview = await reviewBootstrap()
    assert.equal(blankCardReview.status(), 200)
    assert.ok((await blankCardReview.json()).data.applications.some(a => a.application === "ROUTE_FIELD"))
    await admin.mtmAgent.update({ where: { id: bootstrapCard }, data: { phone: "+994507770098" } })
    assert.equal((await (await reviewBootstrap()).json()).error, "IDENTITY_SELF_BOOTSTRAP_PHONE_MISMATCH")
    await admin.mtmAgent.update({ where: { id: bootstrapCard }, data: { phone: bootstrapPhone, userId: null } })
    const unlinkedConflict = await reviewBootstrap()
    assert.equal(unlinkedConflict.status(), 409)
    assert.match(unlinkedConflict.headers()["cache-control"], /no-store/)
    assert.deepEqual(await unlinkedConflict.json(), { error: "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT", conflicts: [
      { id: bootstrapCard, kind: "field", name: "Fictional administrator card", active: true, ownerName: null },
    ] })
    await admin.mtmAgent.update({ where: { id: bootstrapCard }, data: { userId: userId("bootstrap-mfa") } })
    const linkedConflict = await (await reviewBootstrap()).json()
    assert.equal(linkedConflict.error, "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT")
    const otherAdmin = await admin.user.findUniqueOrThrow({ where: { id: userId("bootstrap-mfa") }, select: { name: true } })
    assert.deepEqual(linkedConflict.conflicts, [
      { id: bootstrapCard, kind: "field", name: "Fictional administrator card", active: true, ownerName: otherAdmin.name },
    ])
    // Inactive cards still reserve identity history and must remain visible in
    // conflict review; their state is not permission to take their phone.
    await admin.mtmAgent.update({ where: { id: bootstrapCard }, data: { status: "INACTIVE" } })
    assert.equal((await (await reviewBootstrap()).json()).conflicts[0].active, false)
    await admin.mtmAgent.delete({ where: { id: bootstrapCard } })
    phase("INACTIVE_DUPLICATE_PHONE_CORRECTION_PRESERVES_HISTORY")
    const retiredCard = userId("inactive-trial")
    await admin.user.update({ where: { id: userId("bootstrap") }, data: { phone: bootstrapPhone } })
    await admin.mtmAgent.create({ data: { id: retiredCard, organizationId: company,
      name: "Fictional inactive trial", role: "AGENT", status: "INACTIVE", phone: bootstrapPhone } })
    const trialCustomer = await admin.mtmCustomer.create({ data: { organizationId: company, name: "Fictional trial customer" } })
    const trialVisit = await admin.mtmVisit.create({ data: { organizationId: company, agentId: retiredCard, customerId: trialCustomer.id } })
    assert.equal((await reviewBootstrap()).status(), 409)
    const retained = await initialAdmin.current.request.delete(`/api/v1/mtm/agents/${retiredCard}`, { timeout: 120000 })
    assert.equal(retained.status(), 409)
    assert.equal((await retained.json()).code, "MTM_AGENT_HAS_HISTORY")
    const corrected = await initialAdmin.current.request.put(`/api/v1/mtm/agents/${retiredCard}`, { timeout: 120000, data: { phone: null } })
    assert.equal(corrected.status(), 200)
    assert.deepEqual(await admin.mtmAgent.findUniqueOrThrow({ where: { id: retiredCard }, select: { phone: true, status: true, userId: true } }),
      { phone: null, status: "INACTIVE", userId: null })
    assert.equal(await admin.mtmVisit.count({ where: { id: trialVisit.id, agentId: retiredCard } }), 1)
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: userId("bootstrap") }, select: { phone: true } })).phone, bootstrapPhone)
    assert.equal((await reviewBootstrap()).status(), 200)
    assert.equal(await admin.mtmAuditLog.count({ where: { organizationId: company, entityId: retiredCard, action: "AGENT_UPDATE" } }), 1)
    check("inactive_legacy_duplicate_phone_correction_unblocks_bootstrap_without_deleting_history_or_changing_administrator")
    await admin.user.update({ where: { id: userId("bootstrap-mfa") }, data: { phone: bootstrapPhone } })
    assert.deepEqual((await (await reviewBootstrap()).json()).conflicts, [
      { id: userId("bootstrap-mfa"), kind: "crm", name: otherAdmin.name, active: true, ownerName: null },
    ])
    await admin.user.update({ where: { id: userId("bootstrap-mfa") }, data: { phone: "+994507770023" } })
    const foreignBootstrapCard = `${bootstrapCard}-foreign`
    await admin.mtmAgent.create({ data: { id: foreignBootstrapCard, organizationId: operatorCompany,
      name: "Foreign tenant private card", role: "AGENT", status: "ACTIVE", phone: bootstrapPhone } })
    const isolatedReview = await reviewBootstrap()
    assert.equal(isolatedReview.status(), 200)
    assert.equal(JSON.stringify(await isolatedReview.json()).includes("Foreign tenant private card"), false)
    const foreignCorrection = await initialAdmin.current.request.put(`/api/v1/mtm/agents/${foreignBootstrapCard}`, { timeout: 120000, data: { phone: null } })
    assert.equal(foreignCorrection.status(), 404)
    assert.equal((await admin.mtmAgent.findUniqueOrThrow({ where: { id: foreignBootstrapCard }, select: { phone: true } })).phone, bootstrapPhone)
    await admin.mtmAgent.delete({ where: { id: foreignBootstrapCard } })
    assert.equal(await admin.identityAccount.count({ where: { organizationId: company, userId: userId("bootstrap") } }), 0)
    assert.equal(await admin.identityPhoneProof.count({ where: { organizationId: company, userId: userId("bootstrap") } }), 0)
    check("empty_optional_phone_allows_first_proof_but_mismatched_and_foreign_or_unlinked_owners_remain_blocked")
    check("private_conflict_review_identifies_crm_and_active_inactive_unlinked_field_cards_without_cross_tenant_disclosure_or_writes")
    const bootstrapReviewResponse = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: { action: "review", phone: bootstrapPhone } })
    assert.equal(bootstrapReviewResponse.status(), 200)
    const bootstrapReview = (await bootstrapReviewResponse.json()).data
    assert.deepEqual(bootstrapReview.applications, [{ application: "CRM", role: "admin" }])
    const bootstrapActor = { organizationId: company, userId: userId("bootstrap"), mode: "LEGACY" }
    const { requestIdentitySelfBootstrap } = await loadIdentity("self-bootstrap")
    const bootstrapRequest = { phone: bootstrapPhone, sourceRevision: bootstrapReview.sourceRevision, requestId: "87f4a730-a185-4771-9532-2f37ab37acdd" }
    // Private synthetic issuance: the actual route never skips its transport.
    const bootstrapProof = await requestIdentitySelfBootstrap(recoveryClient, bootstrapActor, bootstrapRequest, proofKey, async () => head)
    assert.equal((await requestIdentitySelfBootstrap(recoveryClient, bootstrapActor, bootstrapRequest, proofKey, async () => head)).proofId, bootstrapProof.proofId)
    await assert.rejects(requestIdentitySelfBootstrap(recoveryClient, bootstrapActor, { ...bootstrapRequest, phone: "+994507770023" }, proofKey, async () => head), /IDENTITY_REQUEST_REUSED/)
    const bootstrapRow = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: bootstrapProof.proofId } })
    const bootstrapCode = openPhoneProofDelivery(phoneProofContext(bootstrapRow), bootstrapRow, proofKey, new Date())
    const bootstrapConfirm = { action: "confirm", proofId: bootstrapRow.id, code: bootstrapCode }
    assert.equal((await initialMfa.current.request.post(bootstrapApi, { timeout: 120000, data: bootstrapConfirm })).status(), 403)
    const bootstrapConfirmed = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: bootstrapConfirm })
    assert.equal(bootstrapConfirmed.status(), 200)
    let bootstrapSetup = (await bootstrapConfirmed.json()).data.setupToken
    assert.ok(bootstrapSetup.startsWith("lds1."))
    phase("LIVE_BOOTSTRAP_RECONFIRMS_OWN_STAGED_CLAIM")
    await delay(61050) // Real hosted cooldown; no clock/authority rewrite.
    const renewedReviewResponse = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: { action: "review", phone: bootstrapPhone } })
    assert.equal(renewedReviewResponse.status(), 200)
    const renewedReview = (await renewedReviewResponse.json()).data
    const renewedBootstrap = await requestIdentitySelfBootstrap(recoveryClient, bootstrapActor, { phone: bootstrapPhone,
      sourceRevision: renewedReview.sourceRevision, requestId: "e7783287-92a0-487c-8207-e7f59bf531f0" }, proofKey, async () => head)
    const renewedBootstrapRow = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: renewedBootstrap.proofId } })
    const renewedBootstrapConfirmed = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: {
      action: "confirm", proofId: renewedBootstrapRow.id, code: openPhoneProofDelivery(phoneProofContext(renewedBootstrapRow), renewedBootstrapRow, proofKey, new Date()),
    } })
    assert.equal(renewedBootstrapConfirmed.status(), 200)
    const staleBootstrapFinish = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: {
      action: "finish", setupToken: bootstrapSetup, password: `Stale!${password.slice(0, 32)}`,
    } })
    assert.equal(staleBootstrapFinish.status(), 409)
    bootstrapSetup = (await renewedBootstrapConfirmed.json()).data.setupToken
    const bootstrapPassword = `Bootstrap!${password.slice(0, 32)}`
    const bootstrapFinish = { action: "finish", setupToken: bootstrapSetup, password: bootstrapPassword }
    await admin.$executeRawUnsafe(`CREATE FUNCTION identity_bootstrap_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'ACCOUNT_ACTIVATED' THEN RAISE EXCEPTION 'SYNTHETIC_BOOTSTRAP_AUDIT_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`)
    await admin.$executeRawUnsafe('CREATE TRIGGER identity_bootstrap_fail_audit BEFORE INSERT ON identity_events FOR EACH ROW EXECUTE FUNCTION identity_bootstrap_fail_audit()')
    try {
      assert.equal((await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: bootstrapFinish })).status(), 500)
      assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey("bootstrap") })).cutoverAt, null)
      assert.equal(await bcrypt.compare(`${password}-legacy`, (await admin.user.findUniqueOrThrow({ where: { id: userId("bootstrap") } })).passwordHash), true)
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER identity_bootstrap_fail_audit ON identity_events')
      await admin.$executeRawUnsafe('DROP FUNCTION identity_bootstrap_fail_audit()')
    }
    const bootstrapCompleted = await initialAdmin.current.request.post(bootstrapApi, { timeout: 120000, data: bootstrapFinish })
    assert.equal(bootstrapCompleted.status(), 200); assert.equal((await bootstrapCompleted.json()).data.signInRequired, true)
    await denied(initialAdmin.current)
    assert.equal((await login("bootstrap", `${password}-legacy`)).error, "CredentialsSignin")
    const bootstrappedAdmin = await login("bootstrap", bootstrapPassword)
    assert.equal(bootstrappedAdmin.error, null); assert.equal((await session(bootstrappedAdmin.current)).user.role, "admin")
    const bootstrappedApps = await admin.identityApplicationGrant.findMany({ where: { organizationId: company, userId: userId("bootstrap") }, select: { application: true } })
    assert.deepEqual(bootstrappedApps, [{ application: "CRM" }])
    assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: userId("bootstrap") } }), 0)
    check("live_legacy_administrator_self_bootstrap_preserves_mfa_rolls_back_failed_retirement_and_requires_fresh_common_password_login")
    phase("CONNECTED_TIME_CARD_VISIBLE_IN_DIRECTORY")
    const directoryResponse = await bootstrappedAdmin.current.request.get("/api/v1/mtm/attendance/employees", { timeout: 120000 })
    assert.equal(directoryResponse.status(), 200)
    const connectedDirectory = (await directoryResponse.json()).data
    const visibleExisting = connectedDirectory.employees.find(row => row.id === existingCandidate.timeActorId)
    assert.ok(visibleExisting); assert.equal(visibleExisting.position, existingBefore.position)
    assert.equal(visibleExisting.includedFrom, existingBefore.attendanceIncludedFrom.toISOString())
    assert.equal(visibleExisting.history.length, 0)
    check("explicit_time_connection_makes_technical_card_visible_without_rewriting_effective_date")
    phase("ACTUAL_ADMIN_FIRST_LOGIN_REVIEW")
    const invitationUrl = "/api/v1/identity/time/onboarding"
    const candidateResponse = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: "+994507770020" } })
    assert.equal(candidateResponse.status(), 200)
    const firstLoginCandidate = (await candidateResponse.json()).data
    assert.equal(firstLoginCandidate.kind, "legacy"); assert.equal(firstLoginCandidate.userId, userId("onboarding")); assert.equal(firstLoginCandidate.fieldActorId, userId("onboarding-field"))
    const invitation = { phone: "+994507770020", userId: firstLoginCandidate.userId, sourceRevision: firstLoginCandidate.sourceRevision, preserveCrm: false,
      requestId: "e33b915e-39eb-4ea1-9f4d-667498d0d937",
      timeEnrollment: { position: "Fictional analyst", departmentId: null, newDepartmentName: "Fictional Technology", teamId: null, newTeamName: "Fictional Operations", hireDate: "2026-10-25" } }
    assert.equal((await viewer.current.request.post(invitationUrl, { timeout: 120000, data: invitation })).status(), 403)
    for (const stale of [{ ...invitation, sourceRevision: "0".repeat(64) }, { ...invitation, userId: userId("employee") }]) {
      assert.equal((await administrator.current.request.post(invitationUrl, { timeout: 120000, data: stale })).status(), 409)
    }
    assert.equal(await admin.identityAccount.count({ where: { organizationId: company, userId: firstLoginCandidate.userId } }), 0)
    phase("ACTUAL_ADMIN_FIRST_LOGIN_PREPARATION_ROLLBACK")
    await admin.$executeRawUnsafe(`CREATE FUNCTION identity_prepare_time_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'SYNTHETIC_TIME_REVIEW_FAILURE' USING ERRCODE='23514'; END $$`)
    await admin.$executeRawUnsafe('CREATE TRIGGER identity_prepare_time_fail BEFORE INSERT ON identity_onboarding_intents FOR EACH ROW EXECUTE FUNCTION identity_prepare_time_fail()')
    try {
      assert.equal((await administrator.current.request.post(invitationUrl, { timeout: 120000, data: invitation })).status(), 500)
      assert.equal(await admin.identityAccount.count({ where: { organizationId: company, userId: firstLoginCandidate.userId } }), 0)
      assert.equal(await admin.identityActorBinding.count({ where: { organizationId: company, userId: firstLoginCandidate.userId } }), 0)
      assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: firstLoginCandidate.userId } }), 0)
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER identity_prepare_time_fail ON identity_onboarding_intents')
      await admin.$executeRawUnsafe('DROP FUNCTION identity_prepare_time_fail()')
    }
    const invitationResponse = await administrator.current.request.post(invitationUrl, { timeout: 120000, data: invitation })
    assert.equal(invitationResponse.status(), 201)
    let invitationResult = (await invitationResponse.json()).data
    const repeatedReview = await administrator.current.request.post(invitationUrl, { timeout: 120000, data: invitation })
    assert.equal(repeatedReview.status(), 201); assert.equal((await repeatedReview.json()).data.intentId, invitationResult.intentId)
    assert.equal((await administrator.current.request.post(invitationUrl, { timeout: 120000, data: { ...invitation, preserveCrm: true } })).status(), 409)
    const { issueIdentityOnboardingProof } = await loadIdentity("onboarding")
    const firstProof = await issueIdentityOnboardingProof(recoveryClient, company, { phone: invitation.phone, application: "TIME", requestId: "cookie-first-login-code" }, proofKey)
    const firstRow = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: firstProof.proofId } })
    const firstCode = openPhoneProofDelivery(phoneProofContext(firstRow), firstRow, proofKey, new Date())
    const firstClient = await context()
    phase("ACTUAL_PUBLIC_FIRST_LOGIN_CONFIRMATION")
    await reserveAuthPost()
    const firstConfirmed = await firstClient.request.post("/api/v1/mtm/mobile/auth/code/verify", { timeout: 120000, data: {
      organizationSlug: company, phone: invitation.phone, application: "TIME", challengeId: firstRow.id, code: firstCode,
    } })
    assert.equal(firstConfirmed.status(), 200)
    let firstSetup = (await firstConfirmed.json()).data.setupToken
    assert.ok(firstSetup.startsWith("lds2."))
    const firstPassword = `Onboarding!${password.slice(0, 32)}`
    phase("CANCEL_AND_REVIEW_PENDING_TIME_FROM_THE_ADMIN_FORM")
    const pendingLookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: invitation.phone } })
    assert.equal(pendingLookup.status(), 200); assert.equal((await pendingLookup.json()).data.kind, "pending")
    const cancelledIntent = invitationResult.intentId
    const cancelUrl = `/api/v1/identity/onboarding/${cancelledIntent}/cancel`
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await administrator.current.request.post(cancelUrl, { timeout: 120000, data: { requestId: "cancel-time-review-retry" } })).status(), 200)
    }
    await reserveAuthPost()
    assert.equal((await firstClient.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", setupToken: firstSetup, password: firstPassword,
    } })).status(), 401)
    const freshLookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: invitation.phone } })
    assert.equal(freshLookup.status(), 200)
    const reviewedAgain = (await freshLookup.json()).data
    assert.equal(reviewedAgain.kind, "legacy"); assert.notEqual(reviewedAgain.sourceRevision, invitation.sourceRevision)
    const renewedInvitation = await administrator.current.request.post(invitationUrl, { timeout: 120000, data: {
      ...invitation, sourceRevision: reviewedAgain.sourceRevision, requestId: "c02e4e56-708f-4650-90b2-af2da163431d",
    } })
    assert.equal(renewedInvitation.status(), 201)
    invitationResult = (await renewedInvitation.json()).data
    assert.notEqual(invitationResult.intentId, cancelledIntent)
    await delay(Math.max(0, firstRow.createdAt.valueOf() + 61050 - Date.now()))
    const renewedFirstProof = await issueIdentityOnboardingProof(recoveryClient, company, { phone: invitation.phone, application: "TIME", requestId: "cookie-renewed-first-login-code" }, proofKey)
    const renewedFirstRow = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: renewedFirstProof.proofId } })
    await reserveAuthPost()
    const renewedFirstConfirmed = await firstClient.request.post("/api/v1/mtm/mobile/auth/code/verify", { timeout: 120000, data: {
      organizationSlug: company, phone: invitation.phone, application: "TIME", challengeId: renewedFirstRow.id,
      code: openPhoneProofDelivery(phoneProofContext(renewedFirstRow), renewedFirstRow, proofKey, new Date()),
    } })
    assert.equal(renewedFirstConfirmed.status(), 200); firstSetup = (await renewedFirstConfirmed.json()).data.setupToken
    assert.equal(await admin.identityActorBinding.count({ where: { organizationId: company, userId: userId("onboarding") } }), 1)
    assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: cancelledIntent } })).status, "CANCELLED")
    check("pending_time_review_visible_and_cancellable_with_safe_retry_new_review_and_retained_history_binding")
    const firstLegacy = await admin.user.findUniqueOrThrow({ where: { id: userId("onboarding") }, select: { passwordHash: true } })
    phase("ACTUAL_PUBLIC_FIRST_LOGIN_HR_AUDIT_ROLLBACK")
    await admin.$executeRawUnsafe('CREATE SEQUENCE identity_onboarding_time_audit_reached')
    await admin.$executeRawUnsafe('GRANT USAGE,SELECT ON SEQUENCE identity_onboarding_time_audit_reached TO identity_crm_browser')
    await admin.$executeRawUnsafe(`CREATE FUNCTION identity_onboarding_time_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'MTM_IDENTITY_TIME_ENROLLED' THEN PERFORM nextval('identity_onboarding_time_audit_reached'); RAISE EXCEPTION 'SYNTHETIC_FIRST_LOGIN_HR_FAILURE' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$`)
    await admin.$executeRawUnsafe('CREATE TRIGGER identity_onboarding_time_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION identity_onboarding_time_fail_audit()')
    try {
      await reserveAuthPost()
      const failedFirstLogin = await firstClient.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
        organizationSlug: company, application: "TIME", setupToken: firstSetup, password: firstPassword,
      } })
      assert.equal(failedFirstLogin.status(), 401)
      assert.equal((await admin.$queryRawUnsafe('SELECT is_called FROM identity_onboarding_time_audit_reached'))[0].is_called, true)
      assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey("onboarding") })).cutoverAt, null)
      assert.deepEqual(await admin.user.findUniqueOrThrow({ where: { id: userId("onboarding") }, select: { passwordHash: true } }), firstLegacy)
      assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: userId("onboarding"), role: "EMPLOYEE" } }), 0)
      assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: userId("onboarding"), application: "TIME" } }), 0)
      assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: invitationResult.intentId } })).status, "ACTIVE")
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER identity_onboarding_time_fail_audit ON mtm_audit_logs')
      await admin.$executeRawUnsafe('DROP FUNCTION identity_onboarding_time_fail_audit()')
      await admin.$executeRawUnsafe('DROP SEQUENCE identity_onboarding_time_audit_reached')
    }
    phase("FIRST_LOGIN_CANNOT_BYPASS_PENDING_TIME_COMPLETION")
    const { activateReviewedIdentity } = await loadIdentity("activation")
    const issuerAccount = await admin.identityAccount.findUniqueOrThrow({ where: accountKey("administrator") })
    const issuerClaim = await admin.identityPhoneClaim.findUniqueOrThrow({ where: accountKey("administrator") })
    const issuerGrant = await admin.identityApplicationGrant.findUniqueOrThrow({ where: grantKey("administrator") })
    const issuer = { organizationId: company, userId: userId("administrator"), mode: "CANONICAL", claims: {
      mode: "IDENTITY_CRM_V1", organizationId: company, userId: userId("administrator"), claimId: issuerClaim.id,
      credentialEpoch: issuerAccount.credentialEpoch, grantVersion: issuerGrant.version,
    } }
    const stagedAccount = await admin.identityAccount.findUniqueOrThrow({ where: accountKey("onboarding") })
    const frozenInvitation = await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: invitationResult.intentId } })
    await assert.rejects(activateReviewedIdentity(recoveryClient, issuer, { userId: userId("onboarding"),
      expectedAccountVersion: stagedAccount.version, expectedCredentialEpoch: stagedAccount.credentialEpoch, expectedContactRevision: stagedAccount.contactRevision,
      credentialRequestId: `onboarding-password:${createHash("sha256").update(firstSetup).digest("hex")}`,
      reviewReference: frozenInvitation.reviewReference, requestId: "refuse-partial-time-cutover", applications: frozenInvitation.applications,
    }, async () => head), /IDENTITY_ONBOARDING_COMPLETION_REQUIRED/)
    assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey("onboarding") })).cutoverAt, null)
    phase("ACTUAL_PUBLIC_FIRST_LOGIN_CUTOVER")
    await reserveAuthPost()
    const firstSession = await firstClient.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", setupToken: firstSetup, password: firstPassword,
    } })
    assert.equal(firstSession.status(), 200)
    const firstData = (await firstSession.json()).data
    assert.equal(firstData.application, "TIME"); assert.notEqual(firstData.agent.id, userId("onboarding-field"))
    const firstTimeCard = await admin.mtmAgent.findUniqueOrThrow({ where: { id: firstData.agent.id }, include: { department: true, team: true } })
    assert.equal(firstTimeCard.position, invitation.timeEnrollment.position)
    assert.equal(firstTimeCard.department.name, invitation.timeEnrollment.newDepartmentName)
    assert.equal(firstTimeCard.team.name, invitation.timeEnrollment.newTeamName)
    assert.equal((await admin.$queryRaw`SELECT count(*)::int AS count FROM workforce_employment_events WHERE "organizationId"=${company} AND "agentId"=${firstTimeCard.id} AND kind='HIRE'`)[0].count, 1)
    assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: invitationResult.intentId } })).status, "COMPLETED")
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: userId("onboarding") }, select: { passwordHash: true } })).passwordHash, "!identity:canonical-only")
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: company, userId: userId("onboarding"), application: "CRM" } }), 0)
    assert.equal((await firstClient.request.get("/api/v1/mtm/mobile/profile", { timeout: 120000, headers: { Authorization: `Bearer ${firstData.token}` } })).status(), 200)
    await reserveAuthPost()
    assert.equal((await firstClient.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", setupToken: firstSetup, password: "Wrong!FirstLogin482",
    } })).status(), 401)
    await reserveAuthPost()
    const preservedFieldLogin = await firstClient.request.post("/api/v1/mtm/mobile/auth", { timeout: 120000, data: {
      organizationSlug: company, application: "ROUTE_FIELD", phone: invitation.phone, password: firstPassword,
    } })
    assert.equal(preservedFieldLogin.status(), 200)
    assert.equal((await preservedFieldLogin.json()).data.agent.id, userId("onboarding-field"))
    assert.equal(await admin.mtmAgent.count({ where: { organizationId: company, userId: userId("onboarding") } }), 2)
    check("actual_admin_review_public_first_login_activates_common_password_and_separate_time_card_with_hr_fields_preserving_field_actor_without_implicit_crm_or_receipt_authentication")
    phase("ACTUAL_TIME_ONLY_PERSON_WITHOUT_CRM_OR_FIELD_GRANTS")
    const onlyPhone = "+994507770021"
    const onlyLookup = await administrator.current.request.post("/api/v1/identity/time/lookup", { timeout: 120000, data: { phone: onlyPhone } })
    assert.equal(onlyLookup.status(), 200)
    const onlyCandidate = (await onlyLookup.json()).data
    assert.equal(onlyCandidate.kind, "legacy"); assert.equal(onlyCandidate.fieldActorId, null)
    const onlyReview = await administrator.current.request.post(invitationUrl, { timeout: 120000, data: {
      userId: onlyCandidate.userId, phone: onlyPhone, sourceRevision: onlyCandidate.sourceRevision, preserveCrm: false,
      requestId: "ad068da1-5a47-448d-a681-05c3d9347e42", timeEnrollment: { position: "Fictional Time role", teamId: null, departmentId: null, hireDate: null },
    } })
    assert.equal(onlyReview.status(), 201)
    const onlyIntent = (await onlyReview.json()).data.intentId
    assert.deepEqual((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: onlyIntent } })).applications, [])
    const onlyProof = await issueIdentityOnboardingProof(recoveryClient, company, { phone: onlyPhone, application: "TIME", requestId: "cookie-only-time-code" }, proofKey)
    const onlyRow = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: onlyProof.proofId } })
    const onlyClient = await context()
    await reserveAuthPost()
    const onlyConfirmed = await onlyClient.request.post("/api/v1/mtm/mobile/auth/code/verify", { timeout: 120000, data: {
      organizationSlug: company, phone: onlyPhone, application: "TIME", challengeId: onlyRow.id,
      code: openPhoneProofDelivery(phoneProofContext(onlyRow), onlyRow, proofKey, new Date()),
    } })
    assert.equal(onlyConfirmed.status(), 200)
    const onlySetup = (await onlyConfirmed.json()).data.setupToken
    await reserveAuthPost()
    const onlyCompleted = await onlyClient.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", setupToken: onlySetup, password: firstPassword,
    } })
    assert.equal(onlyCompleted.status(), 200); assert.equal((await onlyCompleted.json()).data.application, "TIME")
    const onlyScope = { organizationId: company, userId: userId("time-only") }
    assert.deepEqual((await admin.identityApplicationGrant.findMany({ where: onlyScope, select: { application: true, status: true } })), [{ application: "TIME", status: "ACTIVE" }])
    assert.equal(await admin.mtmAgent.count({ where: onlyScope }), 1)
    assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: onlyIntent } })).status, "COMPLETED")
    check("time_only_existing_person_gets_no_temporary_crm_or_field_grant_and_pending_time_cannot_be_bypassed")
    phase("ACTUAL_PUBLIC_COMMON_PASSWORD_RECOVERY")
    // Private synthetic issuance only. Actual public verification/reset below;
    // no provider configuration, external request or plaintext-code artifact.
    const issued = await issueCanonicalRecovery(recoveryClient, company, {
      phone: "+994507770014", application: "TIME", requestId: "cookie-recovery-issue",
    }, proofKey)
    assert.ok(issued)
    const proof = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    const enteredCode = openPhoneProofDelivery(phoneProofContext(proof), proof, proofKey, new Date())
    const verifyBody = { organizationSlug: company, phone: "+994507770014", application: "TIME", challengeId: proof.id, code: enteredCode }
    await reserveAuthPost()
    const wrongApplication = await mobile.request.post("/api/v1/mtm/mobile/auth/code/verify", { timeout: 120000, data: { ...verifyBody, application: "ROUTE_FIELD" } })
    assert.equal(wrongApplication.status(), 400)
    await reserveAuthPost()
    phase("ACTUAL_PUBLIC_RECOVERY_CONFIRMATION")
    const verified = await mobile.request.post("/api/v1/mtm/mobile/auth/code/verify", { timeout: 120000, data: verifyBody })
    assert.equal(verified.status(), 200)
    const setupToken = (await verified.json()).data.setupToken
    assert.ok(setupToken.startsWith("lds3."))
    const recoveredPassword = `Recovered!${password.slice(0, 32)}`
    await reserveAuthPost()
    phase("ACTUAL_PUBLIC_RECOVERY_PASSWORD_WRITE")
    const reset = await mobile.request.post("/api/v1/mtm/mobile/auth/password", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", setupToken, password: recoveredPassword,
    } })
    assert.equal(reset.status(), 200)
    assert.equal((await reset.json()).data.agent.id, enrollment.actorId)
    phase("ACTUAL_PUBLIC_RECOVERY_SESSION_REVOCATION_AND_RELOGIN")
    for (const application of ["TIME", "ROUTE_FIELD"]) {
      assert.equal((await mobile.request.get("/api/v1/mtm/mobile/profile", { timeout: 120000, headers: mobileSessions[application], maxRedirects: 0 })).status(), 401)
      await reserveAuthPost()
      const relogin = await mobile.request.post("/api/v1/mtm/mobile/auth", { timeout: 120000, data: {
        organizationSlug: company, application, phone: "+994507770014", password: recoveredPassword,
      } })
      assert.equal(relogin.status(), 200)
      const data = (await relogin.json()).data
      assert.equal(data.agent.id, application === "TIME" ? enrollment.actorId : userId("employee-ROUTE_FIELD"))
      mobileSessions[application] = { Authorization: `Bearer ${data.token}` }
    }
    await reserveAuthPost()
    const oldPassword = await mobile.request.post("/api/v1/mtm/mobile/auth", { timeout: 120000, data: {
      organizationSlug: company, application: "TIME", phone: "+994507770014", password,
    } })
    assert.equal(oldPassword.status(), 401)
    check("actual_public_recovery_is_application_bound_changes_common_password_revokes_both_old_sessions_and_preserves_separate_actors_without_provider_messages")
    phase("ACTUAL_INDEPENDENT_TIME_REVOCATION_AFTER_RECOVERY")
    const revokedTime = await administrator.current.request.put(enrollmentUrl, { timeout: 120000, data: { ...enrollment,
      status: "REVOKED", expectedAccountVersion: 5, expectedGrantVersion: 1, expectedMembershipVersion: 1, requestId: "cookie-time-revoke" } })
    assert.equal(revokedTime.status(), 200)
    assert.equal((await mobile.request.get("/api/v1/mtm/mobile/profile", { timeout: 120000, headers: mobileSessions.TIME, maxRedirects: 0 })).status(), 401)
    assert.equal((await mobile.request.get("/api/v1/mtm/mobile/profile", { timeout: 120000, headers: mobileSessions.ROUTE_FIELD, maxRedirects: 0 })).status(), 200)
    check("actual_public_phone_login_shared_password_separate_actor_profiles_time_cannot_enter_field_and_time_revocation_preserves_field")
    await admin.identityApplicationGrant.update({ where: grantKey("administrator"), data: { status: "REVOKED", version: 2 } })
    const revokedEnrollment = await administrator.current.request.put(enrollmentUrl, { timeout: 120000, maxRedirects: 0, data: enrollment })
    assert.ok([401, 403, 307].includes(revokedEnrollment.status()))
    assert.equal(await admin.identityEvent.count({ where: { organizationId: company, userId: userId("employee"), action: "MEMBERSHIP_CHANGED" } }), 3)
    check("actual_cookie_admin_enrolls_separate_time_field_actors_without_crm_access_and_revocation_mfa_viewer_scope_are_enforced")
    result.status = "PASS"; result.phase = "COMPLETE"
    process.stdout.write(`IDENTITY_CRM_BROWSER_PASS checks=${result.checks.length}\n`)
  }
} catch (error) {
  result.status = "FAIL"
  // No raw SQL, credentials, cookie values, login response URLs or stack dump.
  result.failureCode = error?.code === "ERR_ASSERTION" ? "ASSERTION"
    : /^P[0-9]{4}$/.test(error?.code ?? "") ? error.code
      : error?.name === "TimeoutError" ? "BROWSER_TIMEOUT" : "RUNTIME"
  const sourceLocation = String(error?.stack ?? "").match(/crm-browser-contract[.]mjs:(\d+):(\d+)/)
  if (sourceLocation) result.failureLocation = { line: Number(sourceLocation[1]), column: Number(sourceLocation[2]) }
  if (["TypeError", "ReferenceError", "PrismaClientValidationError", "PrismaClientKnownRequestError"].includes(error?.name)) result.failureClass = error.name
  const databaseCode = error?.meta?.code
  if (typeof databaseCode === "string" && /^[0-9]{5}$/.test(databaseCode)) result.databaseCode = databaseCode
  if (error?.code === "ERR_ASSERTION") {
    result.assertionTypes = { actual: typeof error.actual, expected: typeof error.expected }
    if (typeof error.actual === "number" && typeof error.expected === "number") {
      result.assertionStatus = { actual: error.actual, expected: error.expected }
    }
  }
  process.stderr.write(`IDENTITY_CRM_BROWSER_FAIL phase=${result.phase} code=${result.failureCode}${result.failureLocation ? ` line=${result.failureLocation.line}` : ""}\n`)
  process.exitCode = 1
} finally {
  for (const current of contexts) await current.close().catch(() => {})
  await browser?.close().catch(() => {})
  await recoveryClient?.$disconnect()
  await admin.$disconnect()
  if (process.argv[2] === "verify" && outputOwned) {
    await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 })
  }
}
