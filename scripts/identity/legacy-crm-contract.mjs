/** Actual CRM compatibility policy in the fixed disposable RLS fixture. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkLegacyCrm({ admin, writer, actor, other, build, checks, phase }) {
  const module = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const { readLegacyCrmCredentialBoundary: boundary } = await module("legacy-crm-boundary")
  const { readLegacyCredentialBoundary: mobileBoundary } = await module("legacy-credential-boundary")
  const { IDENTITY_AUTH_SETTING_KEY: flagKey } = await module("tenant-policy")
  const org = actor.organizationId, ordinary = "legacy-crm-user", platform = "legacy-crm-platform", beta = "legacy-crm-other-tenant"
  for (const [id, organizationId, role] of [[ordinary, org, "viewer"], [platform, org, "superadmin"], [beta, other.organizationId, "viewer"]]) {
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role) VALUES (${id},${organizationId},true,${role})`
  }
  const read = userId => boundary(writer, org, userId)
  const company = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { isActive: true } })
  phase("LEGACY_CRM_PRESERVES_UNCONVERTED_AND_PLATFORM_EXCEPTION")
  assert.equal(await read(ordinary), "LEGACY"); assert.equal(await read(platform), "LEGACY")
  assert.equal(await boundary(writer, other.organizationId, beta), "LEGACY")
  try {
    await admin.organization.update({ where: { id: org }, data: { isActive: false }, select: { id: true } })
    assert.equal(await read(ordinary), "UNAVAILABLE")
    assert.equal(await read(platform), "LEGACY")
    assert.equal(await mobileBoundary(writer, org, { kind: "USER", userId: platform }), "UNAVAILABLE")
    await admin.$executeRaw`UPDATE users SET role = 'viewer' WHERE id = ${platform}`
    assert.equal(await read(platform), "UNAVAILABLE")
    await admin.$executeRaw`UPDATE users SET role = 'superadmin' WHERE id = ${platform}`
    await admin.$executeRaw`UPDATE users SET "isActive" = false WHERE id = ${platform}`
    assert.equal(await read(platform), "UNAVAILABLE")
    await admin.$executeRaw`UPDATE users SET "isActive" = true, "anonymizedAt" = now() WHERE id = ${platform}`
    assert.equal(await read(platform), "UNAVAILABLE")
    await admin.$executeRaw`UPDATE users SET "anonymizedAt" = NULL WHERE id = ${platform}`
  } finally {
    await admin.organization.update({ where: { id: org }, data: { isActive: company.isActive }, select: { id: true } })
  }
  checks.push("legacy_crm_preserves_fresh_platform_inactive_company_exception_without_weakening_mobile_or_person_lifecycle_guards")

  phase("LEGACY_CRM_CANONICAL_AUTHORITY_NEVER_FALLS_BACK")
  for (const userId of [ordinary, platform]) {
    await admin.identityAccount.create({ data: { organizationId: org, userId } })
    assert.equal(await read(userId), "LEGACY")
    await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId } }, data: {
      cutoverAt: new Date(), passwordHash: "!fixture-crm-canonical", version: { increment: 1 }, credentialEpoch: { increment: 1 },
    } })
    assert.equal(await read(userId), "MIGRATED")
  }
  const flag = { organizationId_key: { organizationId: org, key: flagKey } }
  const saved = await admin.mtmSetting.findUniqueOrThrow({ where: flag, select: { value: true } })
  try {
    for (const value of [false, "true", { version: 1, enabled: true }]) {
      await admin.mtmSetting.update({ where: flag, data: { value }, select: { id: true } })
      assert.equal(await read(ordinary), "MIGRATED"); assert.equal(await read(platform), "MIGRATED")
    }
    await admin.organization.update({ where: { id: org }, data: { isActive: false }, select: { id: true } })
    assert.equal(await read(platform), "MIGRATED")
  } finally {
    await admin.mtmSetting.update({ where: flag, data: { value: saved.value }, select: { id: true } })
    await admin.organization.update({ where: { id: org }, data: { isActive: company.isActive }, select: { id: true } })
  }
  assert.equal(await boundary(writer, other.organizationId, beta), "LEGACY")
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId: { in: [ordinary, platform] } } }), 0)
  checks.push("canonical_crm_authority_blocks_old_credentials_without_rollout_or_implicit_grants_even_for_malformed_platform_conversion")

  phase("LEGACY_CRM_MISSING_FOREIGN_BAD_SCOPE_AND_DATABASE_FAILURE_REFUSE")
  assert.equal(await boundary(writer, other.organizationId, ordinary), "UNAVAILABLE")
  assert.equal(await read("legacy-crm-missing"), "UNAVAILABLE")
  let queries = 0
  const invalid = { $transaction: () => { queries++; throw new Error("fixture-unavailable") } }
  assert.equal(await boundary(invalid, "../invalid", ordinary), "UNAVAILABLE"); assert.equal(queries, 0)
  assert.equal(await boundary(invalid, org, ordinary), "UNAVAILABLE"); assert.equal(queries, 1)
  const wrongIsolation = { $transaction: work => writer.$transaction(work, { isolationLevel: "ReadCommitted" }) }
  assert.equal(await boundary(wrongIsolation, org, ordinary), "UNAVAILABLE")
  const inherited = { $transaction: (work, options) => writer.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`
    return work(tx)
  }, options) }
  assert.equal(await boundary(inherited, other.organizationId, beta), "LEGACY")
  checks.push("legacy_crm_eligibility_uses_verified_readonly_repeatable_tenant_scope_and_never_falls_back_on_invalid_or_missing_state")

  const { identityCrmSeatUserWhere: seatWhere } = await module("crm-seat-policy")
  const { withIdentityMobileReadSnapshot: snapshot } = await module("mobile-session-resolver")
  const counts = async () => (await snapshot(writer, org, async tx => ({
    seats: await tx.user.count({ where: seatWhere(org) }), people: await tx.user.count({ where: { organizationId: org } }),
  }))).value
  const beforeSeats = await counts()
  phase("CRM_SEATS_PRESERVE_LEGACY_SHADOW_AND_EXCLUDE_MOBILE_ONLY_PEOPLE")
  for (const kind of ["legacy", "shadow", "time", "field", "both-mobile", "crm", "disabled-crm", "revoked-crm"]) {
    const userId = `crm-seat-${kind}`
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role) VALUES (${userId},${org},${kind !== "disabled-crm"},'viewer')`
    if (kind === "legacy") continue
    await admin.identityAccount.create({ data: { organizationId: org, userId,
      ...(kind === "shadow" ? {} : { cutoverAt: new Date(), passwordHash: "!fixture-seat-canonical" }) } })
    const applications = kind === "both-mobile" ? ["TIME", "ROUTE_FIELD"] : [kind === "time" || kind === "shadow" ? "TIME" : kind === "field" ? "ROUTE_FIELD" : "CRM"]
    for (const application of applications) await admin.identityApplicationGrant.create({ data: {
      organizationId: org, userId, application, status: kind === "revoked-crm" ? "REVOKED" : "ACTIVE",
      role: kind === "revoked-crm" ? null : application === "TIME" ? "EMPLOYEE" : application === "ROUTE_FIELD" ? "AGENT" : "viewer",
    } })
  }
  assert.deepEqual(await counts(), { seats: beforeSeats.seats + 4, people: beforeSeats.people + 8 })
  checks.push("crm_seats_count_all_legacy_shadow_and_allocated_crm_grants_including_disabled_but_not_canonical_time_field_or_both_mobile_people")
  phase("CRM_SEATS_REVOKE_ONLY_EXPLICIT_CRM_ALLOCATION_AND_RESPECT_TENANT_RLS")
  await admin.identityApplicationGrant.update({ where: { organizationId_userId_application: { organizationId: org, userId: "crm-seat-crm", application: "CRM" } },
    data: { status: "REVOKED", role: null, version: 2 } })
  assert.deepEqual(await counts(), { seats: beforeSeats.seats + 3, people: beforeSeats.people + 8 })
  const foreignSeats = await snapshot(writer, org, tx => tx.user.count({ where: seatWhere(other.organizationId) }))
  assert.equal(foreignSeats.value, 0)
  checks.push("crm_seat_revocation_frees_only_crm_allocation_without_removing_people_and_foreign_tenant_count_is_denied_by_rls")
}
