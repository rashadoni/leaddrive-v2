/**
 * M4-5 — Territory scope helper for the Region → Team → Agent hierarchy.
 *
 * Determines which agent IDs a given caller is allowed to see based on
 * their role. Designed as a pure async function (Prisma injected) so it
 * can be unit-tested without a live database.
 *
 * Role → visibility:
 *   ADMIN      — all agents in the org          (agentIds: null = no filter)
 *   MANAGER    — all agents in their region     (all teams in region)
 *   SUPERVISOR — all agents in their team
 *   AGENT      — only themselves                (agentIds: [agentId])
 *
 * Graceful fallbacks for unassigned agents (teamId: null):
 *   MANAGER without a teamId → direct reports plus self
 *   SUPERVISOR without a teamId → self-only visibility
 *   MANAGER whose team has no regionId  → team-only visibility
 *
 * IMPORTANT: every DB query in this function MUST include organizationId
 * in the WHERE clause to prevent cross-tenant data leaks.
 */
import type { PrismaClient } from "@prisma/client"

export type MtmAgentRoleString = "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT"

export const VALID_MTM_AGENT_ROLES: readonly MtmAgentRoleString[] = [
  "ADMIN", "MANAGER", "SUPERVISOR", "AGENT",
]

/** Runtime type-guard — safe to use before casting DB strings to MtmAgentRoleString. */
export function isValidMtmAgentRole(role: unknown): role is MtmAgentRoleString {
  return typeof role === "string" && (VALID_MTM_AGENT_ROLES as readonly string[]).includes(role)
}

/** Roles that are permitted to mutate org-structure (regions, teams). */
export const MTM_ADMIN_ROLES: readonly MtmAgentRoleString[] = ["ADMIN", "MANAGER"]

/**
 * Returns true when `role` is a string that grants org-structure mutation
 * rights (ADMIN or MANAGER). Safe to call with raw JWT/DB strings.
 */
export function isMtmAdminRole(role: unknown): boolean {
  return typeof role === "string" && (MTM_ADMIN_ROLES as readonly string[]).includes(role)
}

export interface AgentScopeResult {
  /**
   * Exact set of agent IDs the caller is allowed to see.
   * null = no restriction (ADMIN sees all agents in org — caller applies
   * the organizationId filter themselves without an agentIds IN clause).
   */
  agentIds: string[] | null
}

export async function resolveAgentScope(
  prisma: Pick<PrismaClient, "mtmAgent" | "mtmTeam">,
  params: {
    agentId: string
    organizationId: string
    role: MtmAgentRoleString
  },
): Promise<AgentScopeResult> {
  const { agentId, organizationId, role } = params

  // ─── ADMIN ──────────────────────────────────────────────────────────────
  // No filter: the caller sees every agent in the org. Returning null lets
  // the API route skip the `agentId IN (...)` clause entirely, avoiding a
  // potentially huge IN list for large orgs.
  if (role === "ADMIN") {
    return { agentIds: null }
  }

  // ─── AGENT ──────────────────────────────────────────────────────────────
  // Self-only: no DB queries needed.
  if (role === "AGENT") {
    return { agentIds: [agentId] }
  }

  // ─── SUPERVISOR / MANAGER ───────────────────────────────────────────────
  // Both need to resolve their team first. Org-scope the lookup so a
  // compromised token with a cross-tenant agentId doesn't leak.
  const caller = await prisma.mtmAgent.findUnique({
    where: { id: agentId, organizationId },
    select: { id: true, teamId: true },
  })

  // A manager can still own direct reports before the organization finishes
  // configuring teams/regions. Keep that fallback tenant-scoped and include
  // the manager so manager views remain useful during staged onboarding.
  if (caller && !caller.teamId && role === "MANAGER") {
    const directReports = await prisma.mtmAgent.findMany({
      where: { managerId: agentId, organizationId },
      select: { id: true },
    })
    return { agentIds: [agentId, ...directReports.map(report => report.id)] }
  }

  // Missing caller, or an unassigned supervisor: fail closed to self-only.
  if (!caller?.teamId) {
    return { agentIds: [agentId] }
  }

  const { teamId } = caller

  // ─── SUPERVISOR ─────────────────────────────────────────────────────────
  // All agents in the same team (including the supervisor themselves).
  if (role === "SUPERVISOR") {
    const members = await prisma.mtmAgent.findMany({
      where: { teamId, organizationId },
      select: { id: true },
    })
    const ids = members.map(m => m.id)
    // Always ensure the supervisor is included even if the team query returns
    // an empty list (e.g. supervisor was just reassigned and DB hasn't caught up).
    if (!ids.includes(agentId)) ids.push(agentId)
    return { agentIds: ids }
  }

  // ─── MANAGER ────────────────────────────────────────────────────────────
  // Step 1: resolve the manager's team to get its regionId.
  const managerTeam = await prisma.mtmTeam.findFirst({
    where: { id: teamId, organizationId },
    select: { id: true, regionId: true },
  })

  if (!managerTeam?.regionId) {
    // Team has no region → scope to the manager's single team (same as supervisor).
    const members = await prisma.mtmAgent.findMany({
      where: { teamId, organizationId },
      select: { id: true },
    })
    const ids = members.map(m => m.id)
    if (!ids.includes(agentId)) ids.push(agentId)
    return { agentIds: ids }
  }

  // Step 2: all teams in the same region.
  const regionTeams = await prisma.mtmTeam.findMany({
    where: { regionId: managerTeam.regionId, organizationId },
    select: { id: true },
  })
  const teamIds = regionTeams.map(t => t.id)

  // Step 3: all agents across those teams.
  const members = await prisma.mtmAgent.findMany({
    where: { teamId: { in: teamIds }, organizationId },
    select: { id: true },
  })
  const ids = members.map(m => m.id)
  if (!ids.includes(agentId)) ids.push(agentId)
  return { agentIds: ids }
}
