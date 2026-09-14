/**
 * What the visit-policy settings screen lets a person touch.
 *
 * After #204 the server writes only what the caller's role allows — an
 * organization-wide rule for an administrator, a manager's own teams' rules
 * for a manager, nothing for a supervisor — but the screen still showed Save
 * and Deactivate on every rule, and the answer came back as an English 403
 * toast. The GET already says what the caller may write (`data.access`); this
 * turns that into "may edit this rule, and if not, why". It decides nothing on
 * its own: the server stays the authority and still refuses a forged write.
 */
export type VisitPolicyUiAccess = {
  kind?: "admin" | "manager" | "supervisor"
  canWriteOrganizationWide: boolean
  /** null = every team (administrator). */
  writableTeamIds: string[] | null
}

export type VisitPolicyReadOnlyReason = "supervisor" | "adminOnly" | "otherTeam" | "noTeam"

export function parseVisitPolicyUiAccess(value: unknown): VisitPolicyUiAccess | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const kind = raw.kind === "admin" || raw.kind === "manager" || raw.kind === "supervisor" ? raw.kind : undefined
  const writableTeamIds = raw.writableTeamIds === null
    ? null
    : Array.isArray(raw.writableTeamIds) ? raw.writableTeamIds.filter((id): id is string => typeof id === "string") : []
  return { kind, canWriteOrganizationWide: raw.canWriteOrganizationWide === true, writableTeamIds }
}

export function canWriteVisitPolicyTeam(access: VisitPolicyUiAccess | null, teamId: string | null): boolean {
  // No access block (e.g. the feature is off): fall back to the server's answer.
  if (!access) return true
  if (access.canWriteOrganizationWide) return true
  if (teamId === null) return false
  return access.writableTeamIds === null || access.writableTeamIds.includes(teamId)
}

export function canCreateVisitPolicy(access: VisitPolicyUiAccess | null): boolean {
  if (!access || access.canWriteOrganizationWide) return true
  return access.writableTeamIds === null || access.writableTeamIds.length > 0
}

export function visitPolicyReadOnlyReason(
  access: VisitPolicyUiAccess | null,
  input: { isNew: boolean; savedTeamId: string | null },
): VisitPolicyReadOnlyReason | null {
  if (!access) return null
  if (input.isNew) {
    if (canCreateVisitPolicy(access)) return null
    return access.kind === "supervisor" ? "supervisor" : "noTeam"
  }
  if (canWriteVisitPolicyTeam(access, input.savedTeamId)) return null
  if (access.kind === "supervisor") return "supervisor"
  return input.savedTeamId === null ? "adminOnly" : "otherTeam"
}

/** Team choices for a rule this caller writes; `allowAllTeams` = organization-wide option. */
export function visitPolicyTeamChoices<T extends { id: string }>(
  access: VisitPolicyUiAccess | null,
  teams: T[],
): { teams: T[]; allowAllTeams: boolean } {
  if (!access || access.canWriteOrganizationWide || access.writableTeamIds === null) return { teams, allowAllTeams: true }
  const writable = new Set(access.writableTeamIds)
  return { teams: teams.filter((team) => writable.has(team.id)), allowAllTeams: false }
}
