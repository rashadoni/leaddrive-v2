import { isTenantCapabilityEnabled } from "../tenant-capabilities"
import { readAttendanceFeature } from "../mtm/attendance-feature"
import { assertIdentityScope, IdentityRegistryError } from "./contract"
import type { IdentityMobileTenantPolicy } from "./mobile-session-resolver"

/** Control-plane opt-in only; false/missing never means legacy fallback. */
export const IDENTITY_AUTH_SETTING_KEY = "identityAuthV1"
function explicitOptIn(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2 && Object.hasOwn(record, "version") && Object.hasOwn(record, "enabled")
    && record.version === 1 && record.enabled === true
}

/** Existing commercial/attendance semantics, read in the resolver's RLS snapshot. */
export const readIdentityMobileTenantPolicy: IdentityMobileTenantPolicy = async (tx, organizationId, application) => {
  assertIdentityScope(organizationId, "tenant-policy")
  if (!["TIME", "ROUTE_FIELD"].includes(application)) throw new IdentityRegistryError("IDENTITY_APPLICATION_INVALID")
  const company = await tx.organization.findFirst({ where: { id: organizationId }, select: { id: true, isActive: true, plan: true, addons: true, features: true, modules: true } })
  if (!company || company.id !== organizationId || !company.isActive) return { identityEnabled: false, licensed: false }
  const flag = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: IDENTITY_AUTH_SETTING_KEY } }, select: { value: true } })
  const licensed = application === "TIME"
    ? isTenantCapabilityEnabled("personnel", company) && await readAttendanceFeature(tx, organizationId)
    : isTenantCapabilityEnabled("route-field", company)
  return { identityEnabled: explicitOptIn(flag?.value), licensed }
}
