import { NextResponse } from "next/server"
import type { MobileAuthResult } from "@/lib/mobile-auth"

/** Server-authoritative capabilities for the MTM mobile surface. */
export type MtmMobileCapability =
  | "FIELD_EXECUTE"
  | "FIELD_TRACK"
  | "SELF_LOCATION_SHARE"
  | "TEAM_READ"
  | "TEAM_DECIDE"

/**
 * Granular, additive permission vocabulary for split mobile manifests.
 * `MtmMobileCapability` remains intact for old APKs, while the capability
 * snapshot removes an entire tenant domain before either permission mapping is
 * exposed.
 */
export type MobileFieldPermission =
  | "WORKTIME_SELF_READ"
  | "WORKTIME_SELF_MUTATE"
  | "WORKTIME_TEAM_READ"
  | "WORKTIME_REQUEST_DECIDE"
  | "WORKTIME_POLICY_ADMIN"
  | "ROUTE_SELF_READ"
  | "ROUTE_SELF_PLAN"
  | "ROUTE_SELF_PUBLISH"
  | "ROUTE_EXECUTE"
  | "ROUTE_TEAM_READ"
  | "ROUTE_TEAM_PLAN"
  | "ROUTE_CHANGE_DECIDE"

/** Kept as an additive compatibility alias for the split bootstrap response. */
export type FieldMobilePermission = MobileFieldPermission

export interface FieldMobileModuleAccess {
  routeField: boolean
  workforceHrm: boolean
  canPlanOwnRoutes?: boolean
  canSelfPublishRoutes?: boolean
}

const FIELD_ROLES = new Set(["AGENT"])
const TEAM_ROLES = new Set(["ADMIN", "MANAGER", "SUPERVISOR"])

export function mobileCapabilities(role: string | null | undefined): readonly MtmMobileCapability[] {
  if (typeof role !== "string") return []
  if (FIELD_ROLES.has(role)) return ["FIELD_EXECUTE", "FIELD_TRACK"]
  if (TEAM_ROLES.has(role)) return ["TEAM_READ", "TEAM_DECIDE", "SELF_LOCATION_SHARE"]
  return []
}

export function hasMobileCapability(role: string | null | undefined, capability: MtmMobileCapability): boolean {
  return mobileCapabilities(role).includes(capability)
}

/**
 * Server-authoritative permissions for the split Route & Field / Workforce
 * manifest. Tenant capabilities remove their entire domain before the role
 * mapping is returned; role scope is still enforced by each canonical server
 * state machine and route permission resolver.
 */
export function mobileFieldPermissions(
  role: string | null | undefined,
  access: FieldMobileModuleAccess,
): readonly FieldMobilePermission[] {
  if (typeof role !== "string") return []

  const permissions: FieldMobilePermission[] = []
  if (FIELD_ROLES.has(role)) {
    if (access.routeField) {
      permissions.push("ROUTE_SELF_READ", "ROUTE_EXECUTE")
      if (access.canPlanOwnRoutes) permissions.push("ROUTE_SELF_PLAN")
      if (access.canSelfPublishRoutes) permissions.push("ROUTE_SELF_PUBLISH")
    }
    if (access.workforceHrm) {
      permissions.push("WORKTIME_SELF_READ", "WORKTIME_SELF_MUTATE")
    }
  }
  if (TEAM_ROLES.has(role)) {
    if (access.routeField) {
      permissions.push("ROUTE_TEAM_READ", "ROUTE_TEAM_PLAN", "ROUTE_CHANGE_DECIDE")
    }
    if (access.workforceHrm) {
      permissions.push("WORKTIME_TEAM_READ", "WORKTIME_REQUEST_DECIDE")
      if (role === "ADMIN") permissions.push("WORKTIME_POLICY_ADMIN")
    }
  }
  return permissions
}

/**
 * Canonical legacy-role projection used by the sync-v2/mobile capability
 * state machine. It deliberately does not infer tenant access or per-agent
 * route publication; callers that render the split manifest use
 * `mobileFieldPermissions` with the fresh entitlement snapshot instead.
 */
export function mobilePermissions(role: string | null | undefined): readonly MobileFieldPermission[] {
  if (typeof role !== "string") return []
  if (FIELD_ROLES.has(role)) {
    return [
      "WORKTIME_SELF_READ",
      "WORKTIME_SELF_MUTATE",
      "ROUTE_SELF_PLAN",
      "ROUTE_EXECUTE",
    ]
  }
  if (TEAM_ROLES.has(role)) {
    const permissions: MobileFieldPermission[] = [
      "WORKTIME_SELF_READ",
      "WORKTIME_SELF_MUTATE",
      "WORKTIME_TEAM_READ",
      "WORKTIME_REQUEST_DECIDE",
      "ROUTE_SELF_PLAN",
      "ROUTE_EXECUTE",
      "ROUTE_TEAM_PLAN",
      "ROUTE_CHANGE_DECIDE",
    ]
    if (role === "ADMIN") permissions.push("WORKTIME_POLICY_ADMIN")
    return permissions
  }
  return []
}

export function hasMobilePermission(role: string | null | undefined, permission: MobileFieldPermission): boolean {
  return mobilePermissions(role).includes(permission)
}

/** Keep authorization at the API boundary; unknown roles fail closed. */
export function requireMobileCapability(
  auth: Pick<MobileAuthResult, "role">,
  capability: MtmMobileCapability,
): NextResponse | null {
  if (hasMobileCapability(auth.role, capability)) return null
  return NextResponse.json(
    { error: "Forbidden", code: "MTM_MOBILE_CAPABILITY_REQUIRED", capability },
    { status: 403 },
  )
}

/** Keep granular authorization at the API boundary; unknown roles fail closed. */
export function requireMobilePermission(
  auth: Pick<MobileAuthResult, "role">,
  permission: MobileFieldPermission,
): NextResponse | null {
  if (hasMobilePermission(auth.role, permission)) return null
  return NextResponse.json(
    { error: "Forbidden", code: "MTM_MOBILE_PERMISSION_REQUIRED", permission },
    { status: 403 },
  )
}
