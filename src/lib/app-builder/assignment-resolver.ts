/**
 * Assignment resolver — N2 Phase 6 Block D slice 1.
 *
 * Given a candidate set of active assignments + the acting user's
 * identity (id, role, profileId), pick the page that applies. Walks
 * SCOPE_PRECEDENCE (user > profile > role > default) and returns
 * the first matching active assignment. Returns null if no match.
 *
 * The helper is DB-free — caller pre-fetches active assignments for
 * the (org, objectType) tuple and passes them as a candidate set.
 *
 * Edge cases:
 *   • Inactive assignments are filtered out before matching.
 *   • Multiple user/profile/role assignments at the same precedence
 *     tier → REJECTED (caller's enforcement bug; helper surfaces).
 *   • Multiple default assignments → REJECTED (same reason).
 *   • User has no role / profileId → those tiers skipped.
 *   • Default missing → null match returned (caller falls back to
 *     hard-coded default layout).
 *
 * Pure synchronous.
 */
import {
  SCOPE_PRECEDENCE,
  type AssignmentRow,
  type AssignmentScopeType,
  type ResolveAssignmentInput,
  type ResolveAssignmentResult,
} from "./types"

function findScopeValue(
  scopeType: AssignmentScopeType,
  user: ResolveAssignmentInput["user"]
): string | null {
  switch (scopeType) {
    case "user":
      return user.id
    case "profile":
      return user.profileId
    case "role":
      return user.role
    case "default":
      return null // default scope has no scopeId
  }
}

export function resolveAssignment(
  input: ResolveAssignmentInput
): ResolveAssignmentResult {
  if (!input.user || typeof input.user.id !== "string" || input.user.id.length === 0) {
    return { ok: false, error: "user.id is required" }
  }
  if (!Array.isArray(input.assignments)) {
    return { ok: false, error: "assignments must be an array" }
  }

  // 1. Filter to active assignments.
  const active = input.assignments.filter((a) => a.isActive)

  // 2. Walk precedence tiers.
  for (const scopeType of SCOPE_PRECEDENCE) {
    const expectedScopeId = findScopeValue(scopeType, input.user)
    // user/profile/role tiers require the scopeId to be set on the user;
    // skip the tier if not.
    if (scopeType !== "default" && expectedScopeId === null) continue

    const matches = active.filter(
      (a) => a.scopeType === scopeType && a.scopeId === expectedScopeId
    )

    if (matches.length === 0) continue
    if (matches.length > 1) {
      return {
        ok: false,
        error: `multiple active assignments at scope "${scopeType}" with scopeId "${String(expectedScopeId)}" — caller must dedupe before render`,
      }
    }
    return {
      ok: true,
      matchedAssignment: matches[0],
      matchedScope: scopeType,
    }
  }

  // 3. Nothing matched.
  return { ok: true, matchedAssignment: null, matchedScope: null }
}

/**
 * Advisory-only set check — surfaces "this would shadow an existing
 * user/profile/role assignment" or "this is a duplicate of an
 * existing active default" without preventing concurrent writes.
 *
 * ⚠ NOT a race-safe uniqueness barrier. Slice-1 application enforces
 * uniqueness via this helper, but two parallel writes that both pass
 * lint and both INSERT will produce two active rows for the same
 * scope. Slice-2 caller MUST one of:
 *   • Wrap insert in a `SELECT ... FOR UPDATE` transaction that
 *     re-runs this lint after acquiring the row lock, OR
 *   • Add a partial unique index via raw SQL — Prisma `@@unique`
 *     can't express `WHERE isActive=TRUE`, so this lives outside
 *     the schema (see migration comments).
 *
 * Architect-pass-1 close-out tightened this wording from
 * "sanity-check" to "advisory only".
 *
 * Returns the list of validation issues; empty array = clean.
 */
export function lintAssignmentSet(assignments: readonly AssignmentRow[]): string[] {
  const issues: string[] = []
  const active = assignments.filter((a) => a.isActive)

  // Check default-scope uniqueness.
  const defaults = active.filter((a) => a.scopeType === "default")
  if (defaults.length > 1) {
    issues.push(
      `${defaults.length} active default assignments — exactly one expected`
    )
  }

  // Check per-(scopeType, scopeId) uniqueness for non-default.
  const seen = new Map<string, number>()
  for (const a of active) {
    if (a.scopeType === "default") continue
    const key = `${a.scopeType}:${a.scopeId ?? ""}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push(`${count} active assignments at "${key}" — exactly one expected`)
    }
  }

  // Coherence: scopeType='default' requires scopeId=null.
  for (const a of active) {
    if (a.scopeType === "default" && a.scopeId !== null) {
      issues.push(`assignment ${a.id} has scopeType=default but scopeId is not null`)
    }
    if (a.scopeType !== "default" && (a.scopeId === null || a.scopeId === "")) {
      issues.push(`assignment ${a.id} has scopeType="${a.scopeType}" but scopeId is empty`)
    }
  }

  return issues
}
