#!/usr/bin/env node
/** Only the fixed disposable service prepared by postgres-contract.mjs is admitted. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { checkCanonicalPasswordLogin } from "./mobile-password-contract.mjs"
import { checkApplicationRevisions } from "./application-revision-contract.mjs"
import { checkLegacyBoundary } from "./legacy-boundary-contract.mjs"
import { checkMembershipTransactions } from "./membership-contract.mjs"
import { checkPhoneProofTransactions } from "./phone-proof-contract.mjs"
import { admitContractTarget } from "./postgres-contract.mjs"

const A = "identity-company-a", B = "identity-company-b"
const actor = { organizationId: A, userId: "identity-user-a" }
const other = { organizationId: B, userId: "identity-user-b" }
const TABLES = ["identity_accounts", "identity_application_grants", "identity_actor_bindings", "identity_application_memberships", "identity_phone_claims", "identity_phone_reservations", "identity_phone_proofs", "identity_phone_proof_outbox", "identity_events"]
const PHONE = "+994550001122"
const receipt = { status: "FAIL", sourceSha: null, productionObserved: false, checks: [] }
let phase = "ADMISSION", admin, writer

async function expectDatabaseError(work, code) {
  let observed
  try {
    await assert.rejects(work, error => {
      observed = error?.meta?.code ?? error?.code
      return error?.meta?.code === code || (code === "23505" && error?.code === "P2002") || (code === "23503" && error?.code === "P2003")
    })
  } catch (error) {
    if (typeof observed === "string" && /^(P[0-9]{4}|[0-9]{5})$/.test(observed)) error.observedDatabaseErrorCode = observed
    throw error
  }
}

async function main() {
  try {
    const url = admitContractTarget(process.env.IDENTITY_CONTRACT_DATABASE_URL, process.env.CI)
    const sha = process.env.IDENTITY_CONTRACT_HEAD_SHA
    assert.match(sha ?? "", /^[a-f0-9]{40}$/)
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sha)
    receipt.sourceSha = sha
    const build = process.env.IDENTITY_FOUNDATION_BUILD
    assert.equal(typeof build, "string")
    const { stageIdentityAccount, readIdentityShadow, planStagedApplicationGrant, reserveStagedIdentityPhone } = await import(pathToFileURL(resolve(build, "registry.js")).href)
    const { makeRlsTestPrisma } = await import("../_rls.mjs")
    admin = makeRlsTestPrisma(url.href)
    phase = "ADMITTED_EXISTING_SYNTHETIC_FIXTURE"
    const orgs = await admin.$queryRawUnsafe("SELECT id FROM organizations ORDER BY id")
    assert.deepEqual(orgs.map(row => row.id), [A, B])
    for (const table of TABLES) {
      const [row] = await admin.$queryRawUnsafe("SELECT to_regclass($1)::text AS existing", `public.${table}`)
      assert.equal(row.existing, null)
    }
    // Adapt only the known minimal fixture, not the production schema.
    await admin.$executeRawUnsafe('ALTER TABLE users ADD CONSTRAINT identity_fixture_users_tenant_key UNIQUE ("organizationId", id)')
    await admin.$executeRawUnsafe('ALTER TABLE mtm_agents ADD CONSTRAINT identity_fixture_agents_tenant_key UNIQUE ("organizationId", id)')
    await admin.$executeRawUnsafe("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'manager'")
    await admin.$executeRawUnsafe('ALTER TABLE users ADD COLUMN "passwordChangedAt" TIMESTAMP(3)')
    await admin.$executeRawUnsafe('ALTER TABLE organizations ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true')
    await admin.$executeRawUnsafe("UPDATE users SET role = 'admin' WHERE id IN ('identity-user-a', 'identity-user-b')")
    await admin.$executeRawUnsafe('INSERT INTO users (id, "organizationId", "isActive", role) VALUES ($1, $2, true, $3)', "identity-user-a3", A, "viewer")
    await admin.$executeRawUnsafe('INSERT INTO users (id, "organizationId", "isActive", role) VALUES ($1, $2, true, $3)', "identity-user-a4", A, "viewer")

    // Adapt the existing minimal disposable fixture for the shared entitlement
    // and attendance readers; none of this alters production legacy tables.
    await admin.$executeRawUnsafe('ALTER TABLE organizations ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP')
    await admin.$executeRawUnsafe("ALTER TABLE organizations ADD COLUMN plan TEXT NOT NULL DEFAULT 'starter', ADD COLUMN addons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN features JSONB NOT NULL DEFAULT '[]', ADD COLUMN modules JSONB NOT NULL DEFAULT '{}'")
    await admin.$executeRawUnsafe('CREATE TABLE mtm_settings (id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations(id),key TEXT NOT NULL,value JSONB NOT NULL,description TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,UNIQUE("organizationId",key))')
    await admin.$executeRawUnsafe('ALTER TABLE mtm_settings ENABLE ROW LEVEL SECURITY')
    await admin.$executeRawUnsafe('ALTER TABLE mtm_settings FORCE ROW LEVEL SECURITY')
    await admin.$executeRawUnsafe(`CREATE POLICY identity_fixture_settings_read ON mtm_settings FOR SELECT USING ("organizationId"=current_setting('app.org_id',true))`)

    phase = "ACTUAL_ADDITIVE_MIGRATION"
    execFileSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", "prisma/migrations/20261103120000_identity_foundation/migration.sql"], {
      env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) },
      stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    })
    for (const table of TABLES) {
      const [row] = await admin.$queryRawUnsafe(`SELECT count(*)::int AS count FROM ${table}`)
      assert.equal(row.count, 0)
    }
    receipt.checks.push("additive_migration_no_backfill_or_implicit_grants")
    await admin.$executeRawUnsafe("CREATE ROLE identity_foundation_writer LOGIN PASSWORD 'identity-foundation-writer-only' NOSUPERUSER NOBYPASSRLS")
    await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO identity_foundation_writer")
    await admin.$executeRawUnsafe("GRANT SELECT ON organizations, users, mtm_agents, mtm_settings TO identity_foundation_writer")
    // SELECT FOR SHARE also applies UPDATE RLS and needs UPDATE privilege.
    // Restrict the fixture privilege to id; no role/password/phone can be changed.
    await admin.$executeRawUnsafe('GRANT UPDATE (id) ON users, organizations, mtm_agents TO identity_foundation_writer')
    await admin.$executeRawUnsafe('CREATE POLICY identity_fixture_user_lock ON users FOR UPDATE TO identity_foundation_writer USING ("organizationId" = current_setting(\'app.org_id\', true)) WITH CHECK ("organizationId" = current_setting(\'app.org_id\', true))')
    await admin.$executeRawUnsafe('CREATE POLICY identity_fixture_company_lock ON organizations FOR UPDATE TO identity_foundation_writer USING (id = current_setting(\'app.org_id\', true)) WITH CHECK (id = current_setting(\'app.org_id\', true))')
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABLES.join(", ")} TO identity_foundation_writer`)
    await admin.$executeRawUnsafe('CREATE POLICY identity_fixture_agent_lock ON mtm_agents FOR UPDATE TO identity_foundation_writer USING ("organizationId" = current_setting(\'app.org_id\', true)) WITH CHECK ("organizationId" = current_setting(\'app.org_id\', true))')
    const writerUrl = new URL(url); writerUrl.username = "identity_foundation_writer"; writerUrl.password = "identity-foundation-writer-only"
    writer = makeRlsTestPrisma(writerUrl.href)

    phase = "AUTHORIZE_AND_STAGE"
    await assert.rejects(stageIdentityAccount(writer, { organizationId: A, userId: "identity-user-a2" }, { userId: actor.userId, requestId: "manager-denied" }), /IDENTITY_ADMIN_REQUIRED/)
    await assert.rejects(stageIdentityAccount(writer, actor, { userId: other.userId, requestId: "foreign-denied" }), /IDENTITY_SUBJECT_UNAVAILABLE/)
    const staged = await stageIdentityAccount(writer, actor, { userId: actor.userId, requestId: "stage-a" })
    assert.deepEqual(staged, { status: "STAGED", accountVersion: 1, replayed: false, authenticationChanged: false })
    const [account] = await admin.$queryRawUnsafe('SELECT "passwordHash", "cutoverAt" FROM identity_accounts WHERE "userId" = $1', actor.userId)
    assert.equal(account.passwordHash, null); assert.equal(account.cutoverAt, null)
    assert.equal((await admin.identityPhoneClaim.count()), 0)
    assert.equal((await admin.identityApplicationGrant.count()), 0)
    receipt.checks.push("admin_only_staging_preserves_legacy_credentials_and_access")

    phase = "REPLAY_AND_CONCURRENT_STAGING"
    const replay = await stageIdentityAccount(writer, actor, { userId: actor.userId, requestId: "stage-a" })
    assert.equal(replay.replayed, true)
    await assert.rejects(stageIdentityAccount(writer, actor, { userId: "identity-user-a2", requestId: "stage-a" }), /IDENTITY_REQUEST_REUSED/)
    const race = await Promise.all([
      stageIdentityAccount(writer, actor, { userId: "identity-user-a2", requestId: "stage-a2" }),
      stageIdentityAccount(writer, actor, { userId: "identity-user-a2", requestId: "stage-a2" }),
    ])
    assert.deepEqual(race.map(row => row.replayed).sort(), [false, true])
    assert.equal(await admin.identityEvent.count({ where: { requestId: "stage-a2" } }), 1)
    await stageIdentityAccount(writer, other, { userId: other.userId, requestId: "stage-b" })
    receipt.checks.push("concurrent_idempotent_staging_and_request_reuse_refusal")

    phase = "AUDIT_FAILURE_ROLLS_BACK_ACCOUNT"
    const failing = { $transaction: (callback, options) => writer.$transaction(tx => callback(new Proxy(tx, { get(target, property) {
      if (property === "identityEvent") return new Proxy(target.identityEvent, { get(delegate, method) {
        if (method === "create") return async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE") }
        const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value
      } })
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value
    } })), options) }
    await assert.rejects(stageIdentityAccount(failing, actor, { userId: "identity-user-a3", requestId: "rollback-a3" }), /SYNTHETIC_AUDIT_FAILURE/)
    assert.equal(await admin.identityAccount.count({ where: { userId: "identity-user-a3" } }), 0)
    assert.equal(await admin.identityEvent.count({ where: { requestId: "rollback-a3" } }), 0)
    receipt.checks.push("failed_audit_rolls_back_identity_and_receipt_atomically")

    phase = "AUTHORITY_REVOCATION_SERIALIZES_WITH_WRITE"
    let enter, release
    const entered = new Promise(resolve => { enter = resolve })
    const barrier = new Promise(resolve => { release = resolve })
    const held = { $transaction: (callback, options) => writer.$transaction(tx => callback(new Proxy(tx, { get(target, property) {
      if (property === "identityEvent") return new Proxy(target.identityEvent, { get(delegate, method) {
        if (method === "create") return async (...args) => { enter(); await barrier; return delegate.create(...args) }
        const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value
      } })
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value
    } })), options) }
    const inFlight = stageIdentityAccount(held, actor, { userId: "identity-user-a4", requestId: "staging-before-revoke" })
    // Attach rejection handling immediately; a failure must not become unhandled.
    const stagedFlight = inFlight.then(value => ({ value }), error => ({ error }))
    await Promise.race([entered, stagedFlight.then(() => { throw new Error("STAGING_DID_NOT_REACH_REVOCATION_BARRIER") })])
    const revoking = admin.$executeRawUnsafe("UPDATE users SET role = 'manager' WHERE id = $1 /* identity-authority-revocation-probe */", actor.userId)
    // Prisma operations are lazy until awaited/then-chained.
    const revocationFlight = revoking.then(value => ({ value }), error => ({ error }))
    let blocked = false
    try {
      const until = Date.now() + 5_000
      while (Date.now() < until) {
        const [row] = await admin.$queryRawUnsafe("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%identity-authority-revocation-probe%') AS blocked")
        if (row.blocked) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    } finally { release() }
    const completedStage = await stagedFlight, completedRevoke = await revocationFlight
    assert.equal(blocked, true)
    assert.equal(completedStage.error, undefined); assert.equal(completedRevoke.error, undefined)
    await assert.rejects(stageIdentityAccount(writer, actor, { userId: "identity-user-a4", requestId: "staging-after-revoke" }), /IDENTITY_ADMIN_REQUIRED/)
    await admin.$executeRawUnsafe("UPDATE users SET role = 'admin' WHERE id = $1", actor.userId)
    receipt.checks.push("admin_revocation_cannot_race_an_authorized_identity_write")

    phase = "INDEPENDENT_APPLICATION_GRANTS"
    const timePlan = { userId: actor.userId, application: "TIME", role: "EMPLOYEE", status: "ACTIVE", expectedAccountVersion: 1, expectedGrantVersion: 0, requestId: "plan-time" }
    const plannedTime = await planStagedApplicationGrant(writer, actor, timePlan)
    assert.equal(plannedTime.mode, "SHADOW"); assert.equal(plannedTime.authenticationChanged, false)
    assert.equal(plannedTime.accountVersion, 2); assert.equal(plannedTime.grantVersion, 1)
    await planStagedApplicationGrant(writer, actor, { ...timePlan, application: "ROUTE_FIELD", role: "AGENT", expectedAccountVersion: 2, requestId: "plan-field" })
    const before = await readIdentityShadow(writer, actor, actor.userId)
    assert.equal(before.applications.find(row => row.application === "CRM").status, "NOT_GRANTED")
    assert.equal(before.applications.find(row => row.application === "TIME").status, "ACTIVE")
    assert.equal(before.applications.find(row => row.application === "ROUTE_FIELD").status, "ACTIVE")
    await planStagedApplicationGrant(writer, actor, { ...timePlan, status: "REVOKED", role: null, expectedAccountVersion: 3, expectedGrantVersion: 1, requestId: "plan-time-revoke" })
    const after = await readIdentityShadow(writer, actor, actor.userId)
    assert.equal(after.authenticationChanged, false)
    assert.equal(after.applications.find(row => row.application === "TIME").status, "REVOKED")
    assert.equal(after.applications.find(row => row.application === "ROUTE_FIELD").status, "ACTIVE")
    assert.equal(after.applications.find(row => row.application === "ROUTE_FIELD").version, 1)
    await expectDatabaseError(() => admin.$executeRawUnsafe('INSERT INTO identity_application_grants ("organizationId", "userId", application, status, "updatedAt") VALUES ($1,$2,$3,$4,now())', A, actor.userId, "OTHER", "ACTIVE"), "23514")
    receipt.checks.push("one_person_two_apps_independent_revocation_without_crm_access")

    phase = "GRANT_PLAN_CAS_REPLAY_ROLE_AND_AUDIT"
    const planReplay = await planStagedApplicationGrant(writer, actor, timePlan)
    assert.equal(planReplay.replayed, true); assert.equal(planReplay.accountVersion, 2)
    await assert.rejects(planStagedApplicationGrant(writer, actor, { ...timePlan, role: "REVIEWER" }), /IDENTITY_REQUEST_REUSED/)
    await assert.rejects(planStagedApplicationGrant(writer, actor, { ...timePlan, requestId: "stale-account-plan" }), /IDENTITY_ACCOUNT_STALE/)
    await assert.rejects(planStagedApplicationGrant(writer, actor, { ...timePlan, expectedAccountVersion: 4, expectedGrantVersion: 1, requestId: "stale-grant-plan" }), /IDENTITY_GRANT_STALE/)
    await assert.rejects(planStagedApplicationGrant(writer, actor, { ...timePlan, userId: "identity-user-a2", application: "CRM", role: "admin", requestId: "forbidden-crm-elevation" }), /IDENTITY_CRM_ROLE_CHANGE_FORBIDDEN/)
    await assert.rejects(planStagedApplicationGrant(failing, actor, { ...timePlan, application: "CRM", role: "admin", expectedAccountVersion: 4, requestId: "grant-audit-failure" }), /SYNTHETIC_AUDIT_FAILURE/)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: A, userId: actor.userId, application: "CRM" } }), 0)
    assert.equal((await admin.identityAccount.findUnique({ where: { organizationId_userId: { organizationId: A, userId: actor.userId } } })).version, 4)
    const grantReceipt = await admin.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: A, requestId: "plan-time-revoke" } } })
    assert.equal(grantReceipt.grantStatus, "REVOKED"); assert.equal(grantReceipt.grantRole, "EMPLOYEE"); assert.equal(grantReceipt.grantVersion, 2)
    receipt.checks.push("grant_plans_bind_versions_roles_idempotency_and_atomic_audit")

    phase = "CONCURRENT_MODULE_CONNECTION_PLANS"
    const plans = [
      { ...timePlan, userId: "identity-user-a4", requestId: "parallel-time" },
      { ...timePlan, userId: "identity-user-a4", application: "ROUTE_FIELD", role: "AGENT", requestId: "parallel-field" },
    ]
    const parallel = await Promise.allSettled(plans.map(plan => planStagedApplicationGrant(writer, actor, plan)))
    assert.equal(parallel.filter(row => row.status === "fulfilled").length, 1)
    assert.equal(parallel.filter(row => row.status === "rejected" && row.reason?.code === "IDENTITY_ACCOUNT_STALE").length, 1)
    const retry = parallel.findIndex(row => row.status === "rejected")
    await planStagedApplicationGrant(writer, actor, { ...plans[retry], expectedAccountVersion: 2, requestId: "parallel-module-retry" })
    assert.equal(await admin.identityAccount.count({ where: { organizationId: A, userId: "identity-user-a4" } }), 1)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: A, userId: "identity-user-a4", status: "ACTIVE" } }), 2)
    receipt.checks.push("concurrent_module_plans_retry_without_duplicate_identity")

    phase = "PHONE_UNIQUENESS_AND_TENANT_FK"
    const claim = { organizationId: A, userId: actor.userId, normalizedPhone: PHONE, accountVersion: 1, verifiedAt: new Date() }
    await admin.identityPhoneClaim.create({ data: { ...claim, accountVersion: 4 } })
    await admin.identityPhoneClaim.create({ data: { ...claim, organizationId: B, userId: other.userId } })
    await expectDatabaseError(() => admin.identityPhoneClaim.create({ data: { ...claim, userId: "identity-user-a2" } }), "23505")
    await expectDatabaseError(() => admin.identityPhoneClaim.create({ data: { ...claim, normalizedPhone: "+994550009998" } }), "23505")
    await expectDatabaseError(() => admin.identityPhoneClaim.create({ data: { ...claim, organizationId: B, userId: "identity-user-a2", normalizedPhone: "+994550009997" } }), "23503")
    await expectDatabaseError(() => admin.$executeRawUnsafe('INSERT INTO identity_phone_claims (id, "organizationId", "userId", "normalizedPhone", "accountVersion", "verifiedAt") VALUES ($1,$2,$3,$4,1,now())', "invalid-national-phone", A, "identity-user-a2", "0550001122"), "23514")
    receipt.checks.push("one_current_phone_per_person_same_phone_allowed_in_other_company")

    phase = "CONCURRENT_PHONE_ASSIGNMENT"
    // Both inserts target one tenant+phone but different people, no read-before-write.
    const racePhone = "+994550008888"
    await stageIdentityAccount(writer, actor, { userId: "identity-user-a3", requestId: "stage-a3" })
    const claims = await Promise.allSettled(["identity-user-a2", "identity-user-a3"].map(userId => admin.identityPhoneClaim.create({ data: { ...claim, userId, normalizedPhone: racePhone } })))
    assert.equal(claims.filter(row => row.status === "fulfilled").length, 1)
    assert.equal(claims.filter(row => row.status === "rejected" && row.reason?.code === "P2002").length, 1)
    receipt.checks.push("concurrent_phone_claim_has_exactly_one_owner")

    phase = "RESERVATION_BOUNDS_AND_NO_LOGIN"
    const now = new Date(), expiresAt = new Date(now.valueOf() + 600_000)
    await admin.identityPhoneReservation.create({ data: { organizationId: A, userId: actor.userId, normalizedPhone: "+994550007777", expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: "reserve-a", createdAt: now, expiresAt } })
    const withReservation = await readIdentityShadow(writer, actor, actor.userId)
    assert.equal(withReservation.authenticationChanged, false)
    assert.ok(!JSON.stringify(withReservation).includes("7777"))
    await expectDatabaseError(() => admin.$executeRawUnsafe('INSERT INTO identity_phone_reservations (id, "organizationId", "userId", "normalizedPhone", "expectedAccountVersion", "expectedCredentialEpoch", "requestId", "createdAt", "expiresAt") VALUES ($1,$2,$3,$4,1,1,$5,$6,$7)', "invalid-reservation-ttl", A, "identity-user-a2", "+994550006666", "reserve-too-long", now, new Date(now.valueOf() + 901_000)), "23514")
    receipt.checks.push("bounded_phone_reservations_are_not_login_claims")

    phase = "CENTRAL_PHONE_RESERVATION_AUTHORIZATION_AND_REPLAY"
    for (const suffix of [5, 6, 7, 8, 9]) {
      await admin.$executeRawUnsafe('INSERT INTO users (id, "organizationId", "isActive", role) VALUES ($1,$2,true,$3)', `identity-user-a${suffix}`, A, "viewer")
      await stageIdentityAccount(writer, actor, { userId: `identity-user-a${suffix}`, requestId: `stage-reservation-a${suffix}` })
    }
    const reservation = { userId: "identity-user-a5", phone: "+994 55 000 33 44", expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: "reserve-central-a5" }
    await assert.rejects(reserveStagedIdentityPhone(writer, { organizationId: A, userId: "identity-user-a2" }, reservation), /IDENTITY_ADMIN_REQUIRED/)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, userId: other.userId }), /IDENTITY_SUBJECT_UNAVAILABLE/)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, expectedAccountVersion: 2 }), /IDENTITY_ACCOUNT_STALE/)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, expectedCredentialEpoch: 2 }), /IDENTITY_CREDENTIAL_STALE/)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, phone: PHONE }), /IDENTITY_PHONE_UNAVAILABLE/)
    const reserved = await reserveStagedIdentityPhone(writer, actor, reservation)
    assert.equal(reserved.status, "RESERVED"); assert.equal(reserved.mode, "SHADOW"); assert.equal(reserved.authenticationChanged, false)
    assert.equal(JSON.stringify(reserved).includes("3344"), false)
    const reservedRow = await admin.identityPhoneReservation.findUnique({ where: { id: reserved.reservationId } })
    assert.equal(reservedRow.expiresAt - reservedRow.createdAt, 600_000)
    const reservedEvent = await admin.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: A, requestId: reservation.requestId } } })
    assert.equal(reservedEvent.reservationId, reserved.reservationId); assert.equal(reservedEvent.reservationExpiresAt.toISOString(), reserved.expiresAt)
    const phoneReplay = await reserveStagedIdentityPhone(writer, actor, { ...reservation, phone: "+994550003344" })
    assert.deepEqual(phoneReplay, { ...reserved, replayed: true })
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, phone: "+994550003345" }), /IDENTITY_REQUEST_REUSED/)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, requestId: "stage-reservation-a5" }), /IDENTITY_REQUEST_REUSED/)
    assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: A, userId: reservation.userId } }), 0)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: A, userId: reservation.userId } }), 0)
    assert.equal((await admin.identityAccount.findUnique({ where: { organizationId_userId: { organizationId: A, userId: reservation.userId } } })).version, 1)
    receipt.checks.push("central_phone_reservation_is_admin_only_version_bound_private_and_not_login")

    phase = "CENTRAL_PHONE_RESERVATION_CONCURRENT_AND_ATOMIC"
    const simultaneous = [6, 7].map(suffix => ({ ...reservation, userId: `identity-user-a${suffix}`, phone: "+994550004455", requestId: `reserve-race-a${suffix}` }))
    const reservations = await Promise.allSettled(simultaneous.map(input => reserveStagedIdentityPhone(writer, actor, input)))
    assert.equal(reservations.filter(row => row.status === "fulfilled").length, 1)
    assert.equal(reservations.filter(row => row.status === "rejected" && row.reason?.code === "IDENTITY_PHONE_RESERVATION_BUSY").length, 1)
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, { ...reservation, phone: "+994550004466", requestId: "second-live-number-for-person" }), /IDENTITY_PHONE_RESERVATION_BUSY/)
    const identical = { ...reservation, userId: "identity-user-a8", phone: "+994550004477", requestId: "reserve-same-race" }
    const duplicates = await Promise.all([reserveStagedIdentityPhone(writer, actor, identical), reserveStagedIdentityPhone(writer, actor, identical)])
    assert.deepEqual(duplicates.map(row => row.replayed).sort(), [false, true]); assert.equal(duplicates[0].reservationId, duplicates[1].reservationId)
    const rollback = { ...reservation, userId: "identity-user-a9", phone: "+994550004488", requestId: "reservation-audit-failure" }
    await assert.rejects(reserveStagedIdentityPhone(failing, actor, rollback), /SYNTHETIC_AUDIT_FAILURE/)
    assert.equal(await admin.identityPhoneReservation.count({ where: { requestId: rollback.requestId } }), 0)
    assert.equal(await admin.identityEvent.count({ where: { requestId: rollback.requestId } }), 0)
    receipt.checks.push("concurrent_reservations_have_one_owner_and_audit_failure_rolls_back")

    phase = "EXPIRED_RESERVATION_IS_NOT_RENEWED_OR_REBOUND"
    // Seed a valid historical receipt; never sleep, alter the host clock or
    // mutate the append-only event. The central service uses actual database time.
    const historical = { ...rollback, requestId: "historical-expired-phone", phone: "+994550004499" }
    const past = new Date(Date.now() - 660_000), expired = new Date(past.valueOf() + 600_000), historicalId = "expired-reservation-a9"
    await admin.identityPhoneReservation.create({ data: { id: historicalId, organizationId: A, userId: historical.userId, normalizedPhone: historical.phone,
      expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: historical.requestId, createdAt: past, expiresAt: expired } })
    const historicalHash = createHash("sha256").update(JSON.stringify([1, "PHONE_RESERVED", A, actor.userId, historical.userId, historical.phone, 1, 1])).digest("hex")
    await admin.identityEvent.create({ data: { id: "historical-phone-receipt-a9", organizationId: A, userId: historical.userId, actorUserId: actor.userId,
      requestId: historical.requestId, requestHash: historicalHash, action: "PHONE_RESERVED", accountVersion: 1, normalizedPhone: historical.phone,
      reservationId: historicalId, reservationExpiresAt: expired, createdAt: past } })
    const expiredReplay = await reserveStagedIdentityPhone(writer, actor, historical)
    assert.equal(expiredReplay.status, "EXPIRED"); assert.equal(expiredReplay.expiresAt, expired.toISOString())
    await assert.rejects(reserveStagedIdentityPhone(failing, actor, { ...historical, requestId: "expired-cleanup-audit-failure" }), /SYNTHETIC_AUDIT_FAILURE/)
    assert.equal(await admin.identityPhoneReservation.count({ where: { id: historicalId } }), 1)
    const replacement = await reserveStagedIdentityPhone(writer, actor, { ...historical, requestId: "fresh-reservation-after-expiry" })
    assert.equal(replacement.status, "RESERVED"); assert.notEqual(replacement.reservationId, historicalId)
    assert.equal(await admin.identityPhoneReservation.count({ where: { id: historicalId } }), 0)
    assert.equal((await reserveStagedIdentityPhone(writer, actor, historical)).status, "EXPIRED")
    assert.equal(await admin.identityEvent.count({ where: { requestId: historical.requestId } }), 1)
    await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: A, userId: reservation.userId } }, data: { credentialEpoch: { increment: 1 } } })
    const staleReplay = await reserveStagedIdentityPhone(writer, actor, reservation)
    assert.equal(staleReplay.status, "STALE"); assert.equal(staleReplay.expiresAt, reserved.expiresAt)
    await admin.identityPhoneReservation.delete({ where: { id: reserved.reservationId } })
    assert.equal((await reserveStagedIdentityPhone(writer, actor, reservation)).status, "SUPERSEDED")
    assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: A, userId: historical.userId } }), 0)
    receipt.checks.push("expired_or_stale_reservation_replay_cannot_extend_ttl_or_claim_a_phone")

    phase = "PHONE_RESERVATION_TENANT_AND_CUTOVER_BOUNDARIES"
    const otherReserved = await reserveStagedIdentityPhone(writer, other, { ...identical, userId: other.userId, requestId: "other-company-same-reserved-phone" })
    assert.equal(otherReserved.status, "RESERVED")
    await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: A, userId: "identity-user-a8" } }, data: { cutoverAt: new Date(), passwordHash: "synthetic-not-a-usable-password", credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
    await assert.rejects(reserveStagedIdentityPhone(writer, actor, identical), /IDENTITY_ALREADY_AUTHORITATIVE/)
    await expectDatabaseError(() => admin.$executeRawUnsafe('INSERT INTO identity_events (id,"organizationId","userId","actorUserId","requestId","requestHash",action,"accountVersion","normalizedPhone","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,now())', "invalid-reservation-receipt", A, historical.userId, actor.userId, "invalid-reserved-event", "a".repeat(64), "PHONE_RESERVED", "+994550005599"), "23514")
    receipt.checks.push("reservation_scope_is_tenant_local_and_refuses_live_authoritative_account")

    phase = "PROOF_STORAGE_AND_PRIVATE_DELIVERY_CONSTRAINTS"
    const { sealPhoneProof, openPhoneProofDelivery, phoneProofAttemptHash } = await import(pathToFileURL(resolve(build, "phone-proof.js")).href)
    await admin.$executeRawUnsafe('INSERT INTO users (id, "organizationId", "isActive", role) VALUES ($1,$2,true,$3)', "identity-user-a10", A, "viewer")
    await stageIdentityAccount(writer, actor, { userId: "identity-user-a10", requestId: "stage-proof-storage-a10" })
    const proofNow = new Date(), proofUntil = new Date(proofNow.valueOf() + 600_000)
    const proofContext = { organizationId: A, userId: "identity-user-a10", reservationId: "historical-proof-reservation", challengeId: "schema-proof-a10",
      normalizedPhone: "+994550006600", accountVersion: 1, credentialEpoch: 1, createdAt: proofNow.toISOString(), expiresAt: proofUntil.toISOString() }
    const proofKey = { id: "synthetic-proof-key", material: new Uint8Array(32).fill(7) }
    const sealed = sealPhoneProof(proofContext, proofKey)
    const proofData = { id: proofContext.challengeId, organizationId: A, userId: proofContext.userId, issuedByUserId: actor.userId,
      reservationId: proofContext.reservationId, normalizedPhone: proofContext.normalizedPhone, accountVersion: 1, credentialEpoch: 1,
      createdAt: proofNow, expiresAt: proofUntil, ...sealed }
    const storedProof = await admin.identityPhoneProof.create({ data: proofData })
    const secret = openPhoneProofDelivery(proofContext, storedProof, proofKey, new Date(proofNow.valueOf() + 1))
    assert.equal(Object.values(storedProof).includes(secret), false)
    assert.equal(Object.hasOwn(storedProof, "code"), false)
    assert.equal(storedProof.status, "PENDING"); assert.equal(storedProof.attempts, 0)
    await expectDatabaseError(() => admin.identityPhoneProof.create({ data: { ...proofData, id: "duplicate-pending-proof" } }), "23505")
    await admin.identityPhoneProof.create({ data: { ...proofData, id: "superseded-schema-proof", status: "SUPERSEDED", deliveryCiphertext: null } })
    await expectDatabaseError(() => admin.identityPhoneProof.create({ data: { ...proofData, id: "foreign-proof-subject", organizationId: B, issuedByUserId: other.userId } }), "23503")
    await expectDatabaseError(() => admin.identityPhoneProof.create({ data: { ...proofData, id: "foreign-proof-issuer", organizationId: B, userId: other.userId } }), "23503")
    phase = "PROOF_STORAGE_COUNTER_LIMIT"
    await expectDatabaseError(() => admin.$executeRawUnsafe('UPDATE identity_phone_proofs SET attempts = 5 WHERE id = $1', storedProof.id), "23514")
    phase = "PROOF_STORAGE_CONFIRMATION_LIMIT"
    await expectDatabaseError(() => admin.$executeRawUnsafe("UPDATE identity_phone_proofs SET status = 'CONFIRMED', \"deliveryCiphertext\" = NULL WHERE id = $1", storedProof.id), "23514")
    const delivery = await admin.identityPhoneProofOutbox.create({ data: { organizationId: A, userId: proofContext.userId, proofId: storedProof.id } })
    assert.equal(delivery.status, "PENDING"); assert.equal(delivery.attempts, 0)
    await expectDatabaseError(() => admin.identityPhoneProofOutbox.create({ data: { organizationId: A, userId: "identity-user-a9", proofId: "superseded-schema-proof" } }), "23503")
    phase = "PROOF_STORAGE_LEASE_LIMIT"
    await expectDatabaseError(() => admin.$executeRawUnsafe("UPDATE identity_phone_proof_outbox SET status = 'LEASED' WHERE \"proofId\" = $1", storedProof.id), "23514")
    await admin.identityEvent.create({ data: { id: "anonymous-proof-rejection", organizationId: A, userId: proofContext.userId, actorUserId: null,
      requestId: "schema-proof-attempt-1", requestHash: phoneProofAttemptHash(proofContext, proofKey, "schema-proof-attempt-1", "111111"),
      action: "PHONE_PROOF_REJECTED", accountVersion: 1, credentialEpoch: 1, proofId: storedProof.id, proofAttempt: 1, proofOutcome: "INVALID_CODE" } })
    phase = "PROOF_STORAGE_ANONYMOUS_ADMIN_REFUSAL"
    await expectDatabaseError(() => admin.$executeRawUnsafe(`INSERT INTO identity_events (id, "organizationId", "userId", "requestId", "requestHash", action, "accountVersion") VALUES ($1,$2,$3,$4,$5,'ACCOUNT_STAGED',1)`,
      "anonymous-admin-action-refused", A, proofContext.userId, "schema-anonymous-stage", "a".repeat(64)), "23514")
    receipt.checks.push("proof_storage_has_tenant_bindings_state_limits_private_ciphertext_and_scoped_anonymous_audit")

    phase = "REVIEWED_ACTOR_BINDING_STORAGE"
    await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id, "organizationId", "userId", role, status, "attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', "binding-agent-a10", A, "identity-user-a10")
    const binding = { organizationId: A, userId: "identity-user-a10", actorId: "binding-agent-a10", reviewedByUserId: actor.userId, reviewReference: "schema-review-a10", accountVersion: 1 }
    await admin.identityActorBinding.create({ data: binding })
    await expectDatabaseError(() => admin.identityActorBinding.create({ data: { ...binding, userId: actor.userId } }), "23505")
    await expectDatabaseError(() => admin.identityActorBinding.create({ data: { ...binding, organizationId: B, userId: other.userId, reviewedByUserId: other.userId } }), "23503")
    await expectDatabaseError(() => admin.identityActorBinding.create({ data: { ...binding, actorId: "identity-agent-a", userId: actor.userId, reviewedByUserId: other.userId } }), "23503")
    await expectDatabaseError(() => admin.$executeRawUnsafe('UPDATE identity_actor_bindings SET "userId" = $1', actor.userId), "23514")
    await expectDatabaseError(() => admin.$executeRawUnsafe('DELETE FROM identity_actor_bindings'), "23514")
    receipt.checks.push("reviewed_actor_binding_is_tenant_scoped_immutable_and_not_transferred_to_another_person")

    phase = "INDEPENDENT_MEMBERSHIP_STORAGE"
    await expectDatabaseError(() => admin.identityApplicationMembership.create({ data: { organizationId: A, userId: actor.userId, actorId: binding.actorId, application: "TIME" } }), "23503")
    for (const [application, role] of [["TIME", "EMPLOYEE"], ["ROUTE_FIELD", "AGENT"]]) {
      await admin.identityApplicationGrant.create({ data: { organizationId: A, userId: binding.userId, application, role, status: "ACTIVE" } })
      await admin.identityApplicationMembership.create({ data: { organizationId: A, userId: binding.userId, actorId: binding.actorId, application, status: "ACTIVE" } })
    }
    assert.equal(await admin.identityApplicationMembership.count({ where: { organizationId: A, userId: binding.userId } }), 2)
    phase = "MEMBERSHIP_STORAGE_APP_AND_VERSION_LIMITS"
    await expectDatabaseError(() => admin.$executeRawUnsafe('INSERT INTO identity_application_memberships ("organizationId","userId",application,"actorId","updatedAt") VALUES ($1,$2,\'CRM\',$3,now())', A, binding.userId, binding.actorId), "23514")
    await expectDatabaseError(() => admin.$executeRawUnsafe('UPDATE identity_application_memberships SET version = 0 WHERE "userId" = $1', binding.userId), "23514")
    phase = "MEMBERSHIP_STORAGE_BINDING_TRUNCATE_REFUSAL"
    await expectDatabaseError(() => admin.$executeRawUnsafe('TRUNCATE identity_actor_bindings CASCADE'), "23514")
    assert.equal(await admin.identityApplicationMembership.count({ where: { organizationId: A, userId: binding.userId } }), 2)
    receipt.checks.push("independent_mobile_memberships_require_tenant_person_binding_and_existing_grant")

    await checkApplicationRevisions({ admin, actor, checks: receipt.checks, phase: value => { phase = value } })

    await checkPhoneProofTransactions({ admin, writer, failing, actor, other, build, checks: receipt.checks, phase: value => { phase = value } })

    await checkMembershipTransactions({ admin, writer, failing, actor, other, build, checks: receipt.checks, phase: value => { phase = value } })

    await checkCanonicalPasswordLogin({ admin, writer, actor, other, build, checks: receipt.checks, phase: value => { phase = value } })

    await checkLegacyBoundary({ admin, writer, actor, other, build, checks: receipt.checks, phase: value => { phase = value } })

    phase = "RLS_AND_IMMUTABILITY"
    for (const table of TABLES) {
      assert.equal((await writer.$queryRawUnsafe(`SELECT * FROM ${table}`)).length, 0)
      await writer.$transaction(async tx => {
        await tx.$queryRawUnsafe("SELECT set_config('app.org_id', $1, true)", A)
        assert.equal((await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE "organizationId" = $1`, B)).length, 0)
      })
    }
    await expectDatabaseError(() => writer.$transaction(async tx => {
      await tx.$queryRawUnsafe("SELECT set_config('app.org_id', $1, true)", A)
      await tx.$executeRawUnsafe('INSERT INTO identity_accounts ("organizationId", "userId", "updatedAt") VALUES ($1,$2,now())', B, "foreign-write")
    }), "42501")
    await expectDatabaseError(() => admin.$executeRawUnsafe("UPDATE identity_events SET action = action"), "23514")
    await expectDatabaseError(() => admin.$executeRawUnsafe("DELETE FROM identity_events"), "23514")
    await expectDatabaseError(() => admin.$executeRawUnsafe("TRUNCATE identity_events"), "23514")
    receipt.checks.push("all_tables_fail_closed_rls_and_append_only_security_history")

    phase = "SHADOW_READ_AND_LEGACY_PRESERVATION"
    const shadow = await readIdentityShadow(writer, actor, actor.userId)
    assert.ok(shadow.issues.includes("LEGACY_PHONE_DISAGREEMENT"))
    assert.ok(!JSON.stringify(shadow).includes("994"))
    const legacy = await admin.$queryRawUnsafe('SELECT phone, "passwordHash" FROM users WHERE id = $1', actor.userId)
    assert.equal(legacy[0].phone, "+994550008888")
    assert.equal(legacy[0].passwordHash, "!personnel:sign-in-by-whatsapp-code")
    receipt.checks.push("shadow_reports_existing_divergence_without_mutating_legacy_login")
    receipt.status = "PASS"
  } catch (error) {
    receipt.failedPhase = phase
    // Fixed error identifiers only; never print Prisma payloads, codes or phones.
    const safeCode = error?.meta?.code ?? error?.code
    const observed = error?.observedDatabaseErrorCode
    if (typeof observed === "string" && /^(P[0-9]{4}|[0-9]{5})$/.test(observed)) receipt.observedDatabaseErrorCode = observed
    if (typeof safeCode === "string" && /^(P[0-9]{4}|[0-9]{5}|ERR_ASSERTION|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)$/.test(safeCode)) receipt.errorCode = safeCode
    process.exitCode = 1
  } finally {
    await writer?.$disconnect().catch(() => {})
    await admin?.$disconnect().catch(() => {})
    const output = `${JSON.stringify(receipt)}\n`
    if (process.env.IDENTITY_FOUNDATION_RECEIPT) await writeFile(process.env.IDENTITY_FOUNDATION_RECEIPT, output, { flag: "wx", mode: 0o600 })
    process.stdout.write(output)
  }
}

main().catch(() => { process.stderr.write("IDENTITY_FOUNDATION_RECEIPT_FAILED\n"); process.exitCode = 1 })
