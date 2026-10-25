/** Hosted-only actual Auth.js cookie acceptance. No production or provider access. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
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
const userId = suffix => `identity-crm-browser-${suffix}`
const email = suffix => `${suffix}@identity-crm.invalid`
const accountKey = suffix => ({ organizationId_userId: { organizationId: company, userId: userId(suffix) } })
const grantKey = suffix => ({ organizationId_userId_application: { organizationId: company, userId: userId(suffix), application: "CRM" } })
const flagKey = { organizationId_key: { organizationId: company, key: "identityAuthV1" } }
const result = { status: "RUNNING", headSha: head, productionMutation: false, actualCookie: false,
  providerMessages: false, phase: "ADMISSION", checks: [], physicalAndroid: "NOT RUN" }
let browser
let outputOwned = false
const contexts = []
const phase = name => { result.phase = name }
const check = name => result.checks.push(name)
try {
  const [role] = await admin.$queryRaw`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='identity_crm_browser'`
  assert.equal(role?.rolsuper, false); assert.equal(role.rolbypassrls, false)
  const [table] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='identity_accounts'::regclass`
  assert.equal(table.relrowsecurity, true); assert.equal(table.relforcerowsecurity, true)
  if (process.argv[2] === "prepare") {
    assert.equal(await admin.organization.count(), 0); assert.equal(await admin.user.count(), 0)
    await admin.organization.create({ data: { id: company, slug: company, name: "Fictional identity browser company", features: ["settings"], modules: { settings: true } } })
    const commonHash = await bcrypt.hash(password, 12), legacyHash = await bcrypt.hash(`${password}-legacy`, 4)
    for (const [i, suffix] of ["ordinary", "setup", "totp"].entries()) {
      await admin.user.create({ data: { id: userId(suffix), organizationId: company, email: email(suffix), name: `Fictional ${suffix}`, role: "admin",
        passwordHash: legacyHash, require2fa: suffix === "setup", totpEnabled: suffix === "totp", smsAuthEnabled: false } })
      await admin.identityAccount.create({ data: { organizationId: company, userId: userId(suffix), passwordHash: commonHash, cutoverAt: new Date() } })
      await admin.identityPhoneClaim.create({ data: { organizationId: company, userId: userId(suffix), normalizedPhone: `+99450777001${i}`, verifiedAt: new Date(), accountVersion: 1 } })
      await admin.identityApplicationGrant.create({ data: { organizationId: company, userId: userId(suffix), application: "CRM", status: "ACTIVE", role: "viewer" } })
    }
    await admin.mtmSetting.create({ data: { organizationId: company, key: "identityAuthV1", value: { version: 1, enabled: true } } })
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
    async function login(suffix, entered = password, organizationSlug = company) {
      while (authTimes.length && authTimes[0] <= Date.now() - 61000) authTimes.shift()
      if (authTimes.length >= 8) {
        await delay(Math.max(0, authTimes[0] + 61000 - Date.now()) + 25)
        authTimes.shift()
      }
      authTimes.push(Date.now())
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
      const response = await current.request.get("/api/v1/users", { timeout: 120000 })
      assert.equal(response.status(), 401)
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
    const roster = await ordinary.current.request.get("/api/v1/users", { timeout: 120000 })
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
    await admin.identityApplicationGrant.update({ where: grantKey("ordinary"), data: { status: "REVOKED", role: null, version: 2 } })
    await denied(ordinary.current)
    const revoked = await login("ordinary"); assert.equal(revoked.error, "CredentialsSignin")
    await admin.identityApplicationGrant.update({ where: grantKey("ordinary"), data: { status: "ACTIVE", role: "viewer", version: 3 } })
    await denied(ordinary.current) // Reactivation never revives an older cookie.
    check("sibling_mobile_grant_does_not_revoke_crm_but_crm_revoke_reactivate_requires_new_login")
    phase("COMMON_CREDENTIAL_EPOCH_AND_ROLLOUT_OFF")
    const renewed = await login("ordinary"); assert.equal(renewed.error, null)
    await admin.identityAccount.update({ where: accountKey("ordinary"), data: { credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
    await denied(renewed.current)
    const fresh = await login("ordinary"); assert.equal(fresh.error, null)
    await admin.mtmSetting.update({ where: flagKey, data: { value: false } })
    await denied(fresh.current)
    assert.equal((await login("ordinary")).error, "CredentialsSignin")
    await admin.mtmSetting.update({ where: flagKey, data: { value: { version: 1, enabled: true } } })
    check("shared_credential_epoch_and_opt_out_revoke_real_cookie_without_legacy_fallback")
    phase("CRM_MFA_SETUP_AND_TOTP_PRESERVED")
    for (const suffix of ["setup", "totp"]) {
      const admitted = await login(suffix); assert.equal(admitted.error, null)
      const state = await session(admitted.current)
      assert.equal(state.user[suffix === "setup" ? "needsSetup2fa" : "needs2fa"], true)
      const response = await admitted.current.request.get("/api/v1/users", { timeout: 120000 })
      assert.equal(response.status(), 403)
    }
    check("shared_password_does_not_satisfy_existing_crm_mfa_setup_or_totp")
    result.status = "PASS"; result.phase = "COMPLETE"
    process.stdout.write(`IDENTITY_CRM_BROWSER_PASS checks=${result.checks.length}\n`)
  }
} catch (error) {
  result.status = "FAIL"
  // No raw SQL, credentials, cookie values, login response URLs or stack dump.
  result.failureCode = error?.code === "ERR_ASSERTION" ? "ASSERTION" : "RUNTIME"
  process.stderr.write(`IDENTITY_CRM_BROWSER_FAIL phase=${result.phase} code=${result.failureCode}\n`)
  process.exitCode = 1
} finally {
  for (const current of contexts) await current.close().catch(() => {})
  await browser?.close().catch(() => {})
  await admin.$disconnect()
  if (process.argv[2] === "verify" && outputOwned) {
    await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 })
  }
}
