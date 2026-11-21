import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules, USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"
import { OFFICE_EMPLOYEE_CRM_ROLE } from "@/lib/mtm/attendance-employee-contract"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Who runs Personnel («Kadr uçotu»). Owner, 2026-11-21: HR are not agents, need
 * no employee card, and both see and manage the whole section.
 *
 * An administrator, or a login with the HR grant (`User.mtmAttendanceAll`) whose
 * role may write and whose Personnel tick is on. Always read from the user row
 * inside the request, never from a cookie, so a revoked grant ends at once.
 *
 * What stays with an administrator, because it reaches beyond this section:
 * giving or taking the HR grant, switching the section off, and any login that
 * holds more than an office employee's nothing (see `hrMayChangeLogin`).
 */
export type PersonnelUser = { role: string; hiddenModules?: unknown; mtmAttendanceAll?: boolean | null }

export const isCrmAdminRole = (role: string | null | undefined) => role === "admin" || role === "superadmin"

export function isPersonnelManager(user: PersonnelUser | null | undefined): boolean {
  if (!user) return false
  if (isCrmAdminRole(user.role)) return true
  return user.mtmAttendanceAll === true
    && checkPermission(user.role as Role, "mtm", "write")
    && !effectiveHiddenModules(user.role, user.hiddenModules).includes("personnel")
}

/** Manages Personnel through the grant, so there is no card to read a scope from. */
export function isPersonnelGrantHolder(user: PersonnelUser | null | undefined): boolean {
  return !!user && !isCrmAdminRole(user.role) && isPersonnelManager(user)
}

/**
 * The whole organization, the shape a web administrator resolves to. Only the
 * Personnel boundaries hand this out: Route & Field still asks for a card.
 */
export function personnelManagerActor(): MtmRouteActor {
  return { agentId: null, role: "ADMIN", canPlanOwnRoutes: true, canSelfPublishRoutes: true, scopedAgentIds: null }
}

/** A login made for marking time: the viewer role with every module hidden and nothing granted. */
export function isOfficeLogin(user: PersonnelUser & { settingsSections?: readonly string[] | null }): boolean {
  if (user.role !== OFFICE_EMPLOYEE_CRM_ROLE || user.mtmAttendanceAll === true || (user.settingsSections?.length ?? 0) > 0) return false
  const hidden = effectiveHiddenModules(user.role, user.hiddenModules)
  return USER_HIDEABLE_MODULE_IDS.every(id => hidden.includes(id))
}

/**
 * The phone and email sign a person in, so whoever changes them can sign in as
 * that person. HR may do it for field and office staff with nothing else; a
 * login with CRM modules, or a manager's card, stays with an administrator, or
 * the HR grant would be a way into everything that person can open.
 */
export function hrMayChangeLogin(
  cardRole: string,
  user: (PersonnelUser & { settingsSections?: readonly string[] | null }) | null | undefined,
): boolean {
  if (cardRole !== "EMPLOYEE" && cardRole !== "AGENT") return false
  return !user || isOfficeLogin(user)
}
