import { checkPermission, type Role } from "@/lib/permissions"

export const ENTITLEMENT_PERMISSION_SCOPES = [
  "entitlements.read",
  "entitlements.write",
  "entitlements.activate",
  "entitlements.cancel",
  "entitlements.waive_milestone",
] as const

export type EntitlementPermissionScope = typeof ENTITLEMENT_PERMISSION_SCOPES[number]

export interface EntitlementPermissionSet {
  canRead: boolean
  canWrite: boolean
  canActivate: boolean
  canCancel: boolean
  canWaiveMilestone: boolean
}

const SUPPORT_MANAGER_ROLES = new Set<Role>(["manager", "admin", "superadmin"])
const ADMIN_ROLES = new Set<Role>(["admin", "superadmin"])
const SUPPORT_READ_ROLES = new Set<Role>(["support", "ticketing", "manager", "admin", "superadmin"])

function asRole(role: string | null | undefined): Role | null {
  switch (role) {
    case "superadmin":
    case "admin":
    case "manager":
    case "sales":
    case "support":
    case "ticketing":
    case "viewer":
      return role
    default:
      return null
  }
}

export function canUseEntitlementPermission(
  role: string | null | undefined,
  permission: EntitlementPermissionScope,
): boolean {
  const resolvedRole = asRole(role)
  if (!resolvedRole) return false

  switch (permission) {
    case "entitlements.read":
      return SUPPORT_READ_ROLES.has(resolvedRole) && checkPermission(resolvedRole, "tickets", "read")
    case "entitlements.write":
      return SUPPORT_MANAGER_ROLES.has(resolvedRole)
    case "entitlements.activate":
    case "entitlements.cancel":
      return ADMIN_ROLES.has(resolvedRole)
    case "entitlements.waive_milestone":
      return SUPPORT_MANAGER_ROLES.has(resolvedRole)
  }
}

export function entitlementPermissionsForRole(role: string | null | undefined): EntitlementPermissionSet {
  return {
    canRead: canUseEntitlementPermission(role, "entitlements.read"),
    canWrite: canUseEntitlementPermission(role, "entitlements.write"),
    canActivate: canUseEntitlementPermission(role, "entitlements.activate"),
    canCancel: canUseEntitlementPermission(role, "entitlements.cancel"),
    canWaiveMilestone: canUseEntitlementPermission(role, "entitlements.waive_milestone"),
  }
}

export function entitlementPermissionError(permission: EntitlementPermissionScope): string {
  switch (permission) {
    case "entitlements.read":
      return "You do not have permission to view customer support terms."
    case "entitlements.write":
      return "Only support managers and administrators can create or edit customer support terms."
    case "entitlements.activate":
      return "Only administrators can activate, suspend, resume or expire customer support terms."
    case "entitlements.cancel":
      return "Only administrators can cancel customer support terms."
    case "entitlements.waive_milestone":
      return "Only support managers and administrators can waive support milestones."
  }
}
