/**
 * Teams of the boards — Bordio's «Teams & Users» (owner, 2026-11-13: «нужно
 * добавить раздел teams and users с тем же функционалом»).
 *
 * A team is people: its page shows its members' tasks from every board the
 * viewer may see. A person is in one team, as its leader («Rəhbər») or a
 * member («Üzv»). The role says who leads the team — it gives no rights of its
 * own: what a person may do stays with the organization's role and with the
 * task's own people (task-ownership.ts). Teams are made and changed by the
 * organization's admin; everyone who works on the boards sees them.
 */
export const TEAM_ROLES = ["leader", "member"] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

export interface TeamMemberDTO { userId: string; name: string; avatar: string | null; role: TeamRole }
export interface TeamDTO { id: string; name: string; members: TeamMemberDTO[] }

export function isTeamAdmin(role: string): boolean {
  return role === "admin" || role === "superadmin"
}

/** The leader first, then by name — the order every screen shows a team in. */
export function sortTeamMembers<T extends { name: string; role: string }>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "leader" ? -1 : 1))
}
