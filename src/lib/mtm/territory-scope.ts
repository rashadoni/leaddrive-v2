/**
 * M4-5 — Territory scope helper for the Region → Team → Agent hierarchy.
 *
 * Determines which agent IDs a given caller is allowed to see based on
 * their role. Designed as a pure async function (Prisma injected) so it
 * can be unit-tested without a live database.
 *
 * Role → visibility:
 *   ADMIN      — all agents in the org          (agentIds: null = no filter)
 *   MANAGER    — union of: all agents in their region (all teams in region),
 *                everyone below them in the reporting line (managerId,
 *                transitively, depth-limited and cycle-safe), and self
 *   SUPERVISOR — all agents in their team
 *   AGENT      — only themselves                (agentIds: [agentId])
 *
 * Owner decision 2026-09-14: "my agents" for a manager is the territory AND the
 * reporting line, not one or the other. Before, managerId counted only for a
 * manager without a team, so a manager with a team lost a direct report who sat
 * in another team — and the report fell out of every scoped screen.
 *
 * Graceful fallbacks for unassigned agents (teamId: null):
 *   MANAGER without a teamId → reporting-line subtree plus self
 *   SUPERVISOR without a teamId → self-only visibility
 *   MANAGER whose team has no regionId  → team plus reporting-line subtree
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

/** How many reporting levels below a manager count as "their agents". */
export const MTM_MANAGER_SUBTREE_MAX_DEPTH = 5

type ScopePrisma = Pick<PrismaClient, "mtmAgent" | "mtmTeam">

/**
 * Everyone below `agentId` in the managerId reporting line, breadth-first.
 * Depth-limited and cycle-safe: an agent already seen is never expanded twice,
 * so A→B→A data loops terminate. Every query is tenant-scoped.
 */
export async function resolveManagerSubtreeAgentIds(
  prisma: Pick<PrismaClient, "mtmAgent">,
  params: { agentId: string; organizationId: string; maxDepth?: number },
): Promise<string[]> {
  const maxDepth = params.maxDepth ?? MTM_MANAGER_SUBTREE_MAX_DEPTH
  const seen = new Set<string>([params.agentId])
  const found: string[] = []
  let frontier = [params.agentId]
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const reports = await prisma.mtmAgent.findMany({
      where: { managerId: { in: frontier }, organizationId: params.organizationId },
      select: { id: true },
    })
    const next: string[] = []
    for (const report of reports ?? []) {
      if (seen.has(report.id)) continue
      seen.add(report.id)
      found.push(report.id)
      next.push(report.id)
    }
    frontier = next
  }
  return found
}

/**
 * Teams a MANAGER or SUPERVISOR is responsible for as a territory — the part
 * of the scope that is about teams, without the reporting-line subtree. A
 * manager's direct report in someone else's team does not make that whole
 * team theirs; team-wide configuration (visit policies) uses this set.
 */
export async function resolveTerritoryTeamIds(
  prisma: ScopePrisma,
  params: { agentId: string; organizationId: string; role: MtmAgentRoleString },
): Promise<string[]> {
  const { agentId, organizationId, role } = params
  if (role !== "MANAGER" && role !== "SUPERVISOR") return []
  const caller = await prisma.mtmAgent.findUnique({
    where: { id: agentId, organizationId },
    select: { id: true, teamId: true },
  })
  if (!caller?.teamId) return []
  if (role === "SUPERVISOR") return [caller.teamId]
  const managerTeam = await prisma.mtmTeam.findFirst({
    where: { id: caller.teamId, organizationId },
    select: { id: true, regionId: true },
  })
  if (!managerTeam?.regionId) return [caller.teamId]
  const regionTeams = await prisma.mtmTeam.findMany({
    where: { regionId: managerTeam.regionId, organizationId },
    select: { id: true },
  })
  const ids = regionTeams.map((team) => team.id)
  if (!ids.includes(caller.teamId)) ids.push(caller.teamId)
  return ids
}

function uniqueIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat())]
}

export async function resolveAgentScope(
  prisma: ScopePrisma,
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

  // Missing caller: fail closed to self-only, for both roles.
  if (!caller) {
    return { agentIds: [agentId] }
  }

  // ─── SUPERVISOR ─────────────────────────────────────────────────────────
  // All agents in the same team (including the supervisor themselves).
  // An unassigned supervisor is self-only.
  if (role === "SUPERVISOR") {
    if (!caller.teamId) return { agentIds: [agentId] }
    const members = await prisma.mtmAgent.findMany({
      where: { teamId: caller.teamId, organizationId },
      select: { id: true },
    })
    const ids = members.map(m => m.id)
    // Always ensure the supervisor is included even if the team query returns
    // an empty list (e.g. supervisor was just reassigned and DB hasn't caught up).
    if (!ids.includes(agentId)) ids.push(agentId)
    return { agentIds: ids }
  }

  // ─── MANAGER ────────────────────────────────────────────────────────────
  // Territory part: the region's teams, or just the manager's own team when
  // it has no region, or nothing when the manager has no team yet.
  let territoryIds: string[] = []
  if (caller.teamId) {
    const { teamId } = caller
    const managerTeam = await prisma.mtmTeam.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true, regionId: true },
    })
    if (!managerTeam?.regionId) {
      const members = await prisma.mtmAgent.findMany({
        where: { teamId, organizationId },
        select: { id: true },
      })
      territoryIds = members.map(m => m.id)
    } else {
      const regionTeams = await prisma.mtmTeam.findMany({
        where: { regionId: managerTeam.regionId, organizationId },
        select: { id: true },
      })
      const members = await prisma.mtmAgent.findMany({
        where: { teamId: { in: regionTeams.map(t => t.id) }, organizationId },
        select: { id: true },
      })
      territoryIds = members.map(m => m.id)
    }
  }

  // Reporting-line part: everyone below the manager, whichever team they sit in.
  const subtreeIds = await resolveManagerSubtreeAgentIds(prisma, { agentId, organizationId })
  return { agentIds: uniqueIds(territoryIds, subtreeIds, [agentId]) }
}
