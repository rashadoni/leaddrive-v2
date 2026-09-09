/**
 * Tier calculator — D8 Phase 6 Block A slice 1.
 *
 * Given a LoyaltyAccount's lifetimePoints + the tenant's tier config
 * (slice-2 will move config into a DB table; slice-1 takes it as a
 * parameter), return the effective tier slug.
 *
 * Rules:
 *   • Tiers are sorted ASCENDING by `minLifetimePoints`.
 *   • The customer's tier is the HIGHEST tier whose `minLifetimePoints
 *     <= lifetimePoints`.
 *   • Empty tier list OR lifetimePoints below every tier's threshold
 *     → `{kind: "none"}` (caller should leave LoyaltyAccount.tier = null).
 *   • Duplicate `minLifetimePoints` values in the tier list — last
 *     entry in the SORTED order wins (tie-broken by code lexicographic
 *     ascending — deterministic).
 *
 * Pure synchronous.
 */
import type { CalculateTierInput, CalculateTierResult, TierDefinition } from "./types"

export function calculateTier(input: CalculateTierInput): CalculateTierResult {
  const { tiers, lifetimePoints } = input

  if (!Number.isInteger(lifetimePoints) || lifetimePoints < 0) {
    return {
      kind: "none",
      reason: `Invalid lifetimePoints ${lifetimePoints}; expected non-negative integer`,
    }
  }
  if (tiers.length === 0) {
    return { kind: "none", reason: "No tiers configured" }
  }

  // Validate every tier upfront — a malformed tier list is a tenant
  // config issue, not a runtime fallback.
  for (const t of tiers) {
    if (!Number.isInteger(t.minLifetimePoints) || t.minLifetimePoints < 0) {
      return {
        kind: "none",
        reason: `Tier "${t.code}" has invalid minLifetimePoints ${t.minLifetimePoints}`,
      }
    }
    if (typeof t.code !== "string" || t.code.length === 0) {
      return {
        kind: "none",
        reason: "Tier missing code",
      }
    }
  }

  // Defensive copy + sort. Primary: minLifetimePoints ASC. Secondary:
  // code ASC (deterministic tie-break).
  const sorted: TierDefinition[] = [...tiers].sort((a, b) => {
    if (a.minLifetimePoints !== b.minLifetimePoints) {
      return a.minLifetimePoints - b.minLifetimePoints
    }
    return a.code.localeCompare(b.code)
  })

  // Walk in reverse — first tier whose threshold ≤ lifetimePoints wins.
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].minLifetimePoints <= lifetimePoints) {
      return { kind: "tier", code: sorted[i].code }
    }
  }

  return {
    kind: "none",
    reason: `lifetimePoints ${lifetimePoints} below minimum tier threshold ${sorted[0].minLifetimePoints}`,
  }
}
