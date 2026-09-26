/**
 * Who a team message goes to by default, and how a role reads on screen.
 *
 * The broadcast form used to tick every active MTM account — managers,
 * admins and the QA logins included — so a message meant for the field went
 * to the people writing it unless someone remembered to untick them.
 * The default audience is the field: agents and their supervisors
 * (supervisors keep receiving broadcasts — product decision 2026-09-14).
 * Managers, admins and any other role are one tap away via "Select all".
 *
 * The role used to be printed raw and twice ("MANAGER MANAGER"): once as the
 * fallback subtitle when a person had no team, once as the badge. The screen
 * now shows one localized label, and an unknown role reads as "Other" rather
 * than as an enum.
 */
export const OPERATIONS_AUDIENCE_ROLES = ["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"] as const

export type OperationsAudienceRole = (typeof OPERATIONS_AUDIENCE_ROLES)[number]

export function operationsRoleKey(role: string | null | undefined): OperationsAudienceRole | "OTHER" {
  const normalized = String(role ?? "").toUpperCase()
  return (OPERATIONS_AUDIENCE_ROLES as readonly string[]).includes(normalized)
    ? normalized as OperationsAudienceRole
    : "OTHER"
}

export const DEFAULT_BROADCAST_ROLES: ReadonlyArray<OperationsAudienceRole> = ["AGENT", "SUPERVISOR"]

export function defaultBroadcastAudience(agents: ReadonlyArray<{ id: string; role: string | null | undefined }>): string[] {
  return agents
    .filter((agent) => (DEFAULT_BROADCAST_ROLES as ReadonlyArray<string>).includes(operationsRoleKey(agent.role)))
    .map((agent) => agent.id)
}
