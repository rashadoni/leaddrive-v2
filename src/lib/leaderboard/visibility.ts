/**
 * KPI Arena RBAC — who may see which group's leaderboard.
 *
 * Rule (decided with the user): a manager/admin/superadmin sees EVERY group;
 * a rank-and-file agent sees only their own department's group(s). The route
 * enforces this with a 403 before any aggregation runs, so a sales rep cannot
 * pull the support leaderboard by guessing the query param.
 *
 * Pure + prisma-free so it's trivially unit-testable. MTM field agents
 * authenticate through the mobile app (not this web dashboard), so no web role
 * is granted the MTM group by default — only managers see it.
 */
import type { LeaderboardGroup } from "./types"
import { ALL_GROUPS } from "./types"

const MANAGER_ROLES = new Set(["superadmin", "admin", "manager"])

export function isManager(role: string): boolean {
  return MANAGER_ROLES.has(role)
}

/** Non-manager roles → ONLY their own department's group. The cross-cutting
 *  groups (tasks / projects / mtm) return an org-wide roster, so exposing them
 *  to a rank-and-file rep would leak other departments' performance — that's a
 *  manager-only view. Rule: an agent sees their own department, nothing else.
 *  Anything not listed sees nothing. */
const ROLE_OWN_GROUPS: Record<string, LeaderboardGroup[]> = {
  sales: ["sales"],
  support: ["tickets"],
}

/** "all" for managers; an explicit list for everyone else. */
export function visibleGroups(role: string): LeaderboardGroup[] {
  if (isManager(role)) return [...ALL_GROUPS]
  return ROLE_OWN_GROUPS[role] ?? []
}

export function canViewGroup(role: string, group: LeaderboardGroup): boolean {
  return visibleGroups(role).includes(group)
}
