/** Shared catalog/setting integration, only within admitted synthetic PostgreSQL. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkRealTenantPolicy({ admin, writer, build, org, timeToken, fieldToken, keyRing, checks, phase }) {
  const { resolveIdentityMobileSession: authenticate } = await import(pathToFileURL(resolve(build, "mobile-session-resolver.js")).href)
  const { readIdentityMobileTenantPolicy: policy, IDENTITY_AUTH_SETTING_KEY: flagKey } = await import(pathToFileURL(resolve(build, "tenant-policy.js")).href)
  const { ATTENDANCE_FEATURE_SETTING_KEY: timeKey } = await import(pathToFileURL(resolve(build, "../mtm/attendance-feature.js")).href)
  const original = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { modules: true, features: true, addons: true, plan: true } })
  const setting = (organizationId, key, value) => admin.mtmSetting.upsert({ where: { organizationId_key: { organizationId, key } }, create: { organizationId, key, value }, update: { value }, select: { id: true } })
  const modules = value => admin.organization.update({ where: { id: org }, data: { modules: value, features: [], addons: [], plan: "starter" }, select: { id: true } })
  const auth = (token, app = "TIME") => authenticate(writer, token, app, keyRing, policy)
  try {
    phase("REAL_TENANT_ENTITLEMENT_ATTENDANCE_AND_ROLLOUT_POLICY")
    assert.equal(await auth(timeToken), null) // no control-plane opt-in
    await setting(org, flagKey, { version: 1, enabled: true }); await setting(org, timeKey, true)
    await modules({ personnel: true, "route-field": false })
    assert.equal((await auth(timeToken)).role, "EMPLOYEE")
    assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null)
    await setting(org, timeKey, false)
    assert.equal(await auth(timeToken), null)
    await modules({ personnel: true, "route-field": true })
    assert.equal((await auth(fieldToken, "ROUTE_FIELD")).role, "AGENT")
    assert.equal(await auth(timeToken), null)
    await setting(org, timeKey, true)
    await modules({ personnel: false, "route-field": true })
    assert.equal(await auth(timeToken), null)
    assert.notEqual(await auth(fieldToken, "ROUTE_FIELD"), null)
    await setting(org, flagKey, { version: 1, enabled: false })
    assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null)
    await setting(org, flagKey, "true")
    assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null)
    checks.push("real_shared_catalog_and_settings_admit_time_field_independently_without_truthy_rollout_or_hr_in_field")

    phase("REAL_TENANT_POLICY_CANNOT_BORROW_ANOTHER_COMPANY_SETTINGS")
    await setting("identity-company-b", flagKey, { version: 1, enabled: true })
    await setting("identity-company-b", timeKey, true)
    await admin.organization.update({ where: { id: "identity-company-b" }, data: { modules: { personnel: true, "route-field": true } }, select: { id: true } })
    assert.equal(await auth(timeToken), null); assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null)
    checks.push("real_policy_reads_only_the_verified_company_flag_and_entitlements_under_rls")
  } finally {
    await admin.organization.update({ where: { id: org }, data: original, select: { id: true } })
    await setting(org, flagKey, { version: 1, enabled: false })
  }
}
