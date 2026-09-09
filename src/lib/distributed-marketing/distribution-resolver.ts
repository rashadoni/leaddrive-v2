/**
 * C7 distribution-resolver — slice-1 pure helper.
 *
 * Given a user's access profile + a list of distribution rules for a
 * template, decide if the user can see + use the template.
 *
 * Resolution: ANY rule matching grants access (OR-logic across rules).
 * Within a rule, the type determines what's matched:
 *   • all       — everyone in the org has access (single global grant).
 *   • user      — user.id === rule.targetUserId.
 *   • role      — user.role === rule.targetRole.
 *   • team      — rule.targetTeamRef ∈ user.teamRefs.
 *
 * Pure function: no DB.
 */

import {
  DISTRIBUTION_TYPES,
  type AccessCheckResult,
  type DistributionRule,
  type DistributionType,
  type UserAccessProfile,
} from "./types"

export interface ResolveAccessInput {
  user: UserAccessProfile
  rules: ReadonlyArray<DistributionRule>
}

/**
 * Returns { hasAccess, grantedBy }.
 *
 * Empty rules array → no access (templates without distribution
 * assignments are draft/private).
 */
export function resolveAccess(input: ResolveAccessInput): AccessCheckResult {
  for (const rule of input.rules) {
    if (matchesRule(input.user, rule)) {
      return { hasAccess: true, grantedBy: rule }
    }
  }
  return { hasAccess: false, grantedBy: null }
}

/**
 * Pure helper for slice-2 gallery UI: given a list of templates + their
 * rules + the current user, filter to the visible templates.
 */
export function filterAccessibleTemplates<
  T extends { id: string; rules: ReadonlyArray<DistributionRule> },
>(user: UserAccessProfile, templates: ReadonlyArray<T>): T[] {
  const accessible: T[] = []
  for (const t of templates) {
    const result = resolveAccess({ user, rules: t.rules })
    if (result.hasAccess) accessible.push(t)
  }
  return accessible
}

function matchesRule(
  user: UserAccessProfile,
  rule: DistributionRule,
): boolean {
  switch (rule.distributionType) {
    case "all":
      return true
    case "user":
      return rule.targetUserId !== null && rule.targetUserId === user.userId
    case "role":
      return rule.targetRole !== null && rule.targetRole === user.role
    case "team":
      return (
        rule.targetTeamRef !== null &&
        rule.targetTeamRef !== undefined &&
        user.teamRefs.includes(rule.targetTeamRef)
      )
    default:
      return false
  }
}

// ── Type guards ─────────────────────────────────────────────────

export function isDistributionType(value: unknown): value is DistributionType {
  return (
    typeof value === "string" &&
    DISTRIBUTION_TYPES.includes(value as DistributionType)
  )
}
