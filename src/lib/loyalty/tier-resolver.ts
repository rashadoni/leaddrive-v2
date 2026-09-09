/**
 * D8 Loyalty — DB-backed tier resolution + tier-multiplier rounding.
 *
 * Slice-1 `calculateTier` takes a `tiers` array parameter (pure, no DB).
 * Phase C wires this resolver between the route layer and the slice-1
 * helper: reads the active `LoyaltyTier` rows for the org, hands them
 * to `calculateTier`, and surfaces the matching multiplier so the
 * earn pipeline can apply it.
 *
 * Per-request caching: the earn pipeline reads the tier list once per
 * request via `withTierCache` — without it the storefront-driven
 * earn-pipeline would issue one extra Postgres roundtrip per credit
 * (architect-flagged hot-path concern in Phase B review).
 *
 * Rounding rule (Math.floor): per user decision the conservative,
 * customer-unfavourable floor is used. A 99-point base earn at 1.5×
 * gold tier yields `Math.floor(99 * 1.5) = 148` (not 149 from round).
 * This protects the program against drift and over-accrual.
 */
import { calculateTier } from "./tier-calculator"
import type { TierDefinition } from "./types"
import { decimalToNumber } from "@/lib/prisma-decimal"

/**
 * Subset of LoyaltyTier we actually need at the call site. Mirrors the
 * Prisma select shape so callers can hand back either `prisma` or
 * `prisma.$transaction(tx => …)`'s `tx`.
 */
export interface ActiveTierRow {
  code: string
  minLifetimePoints: number
  multiplier: number
}

/**
 * Minimal prisma surface this helper needs. Accept either the global
 * client or a transaction handle. The orderBy union accepts both the
 * single-key shape and the array shape so callers can opt into a
 * secondary tie-break (e.g. `[{ minLifetimePoints: "asc" }, { code: "asc" }]`)
 * without a type cast — matches `calculateTier`'s internal lexicographic
 * tie-break.
 */
type TierOrderBy =
  | { minLifetimePoints: "asc" }
  | Array<{ minLifetimePoints: "asc" } | { code: "asc" }>

type LoyaltyTierClient = {
  loyaltyTier: {
    findMany(args: {
      where: { organizationId: string; isActive: true }
      orderBy: TierOrderBy
      select: { code: true; minLifetimePoints: true; multiplier: true }
    }): Promise<ActiveTierRow[]>
  }
}

/**
 * Read the active tier ladder for an org. Pure read, no caching here
 * — wrap in withTierCache for per-request memoization.
 */
export async function loadActiveTiers(
  client: LoyaltyTierClient,
  orgId: string,
): Promise<ActiveTierRow[]> {
  // Secondary sort by `code` ensures deterministic ordering when two
  // tiers share the same minLifetimePoints (admin error case) — matches
  // calculateTier's internal tie-break so the resolver and the helper
  // pick the same winner.
  const rows = await client.loyaltyTier.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: [{ minLifetimePoints: "asc" }, { code: "asc" }],
    select: { code: true, minLifetimePoints: true, multiplier: true },
  })
  // Prisma returns multiplier as Decimal (Decimal(6,4) after D5/D8 migration) —
  // Number.isFinite(Decimal) === false which would break applyTierMultiplier.
  // Convert at the DB boundary via shared helper (src/lib/prisma-decimal.ts).
  return rows.map((r) => ({ ...r, multiplier: decimalToNumber(r.multiplier) }))
}

export interface ResolvedTier {
  /** Tier slug, or null when lifetimePoints below every threshold. */
  tier: string | null
  /** Multiplier for the resolved tier; 1.0 when no tier (no boost). */
  multiplier: number
}

/**
 * Given an active tier list + a lifetimePoints value, resolve the tier
 * and surface its multiplier. Pure logic on top of `calculateTier`.
 */
export function resolveTierFromList(
  tiers: readonly ActiveTierRow[],
  lifetimePoints: number,
): ResolvedTier {
  if (tiers.length === 0) return { tier: null, multiplier: 1.0 }

  const defs: TierDefinition[] = tiers.map((t) => ({
    code: t.code,
    minLifetimePoints: t.minLifetimePoints,
  }))
  const result = calculateTier({ tiers: defs, lifetimePoints })
  if (result.kind !== "tier") return { tier: null, multiplier: 1.0 }

  const match = tiers.find((t) => t.code === result.code)
  return {
    tier: result.code,
    multiplier: match?.multiplier ?? 1.0,
  }
}

/**
 * Apply tier multiplier with the canonical Math.floor rounding rule.
 *
 * `basePoints` must be a positive integer (validated upstream by the
 * points-engine helpers). Returns the rounded-down award.
 *
 * Consumer: Phase D storefront earn pipeline. The manual admin earn
 * endpoint (Phase C) applies points as-given (operator's number IS the
 * final award), so this helper is shipped + tested but has zero
 * production callers until Phase D wires the EarnRule pipeline. Keep
 * the test coverage anyway — it's the bottom of the storefront
 * earn-rate × tier-multiplier chain, and a regression here silently
 * over/under-awards points.
 *
 * Edge cases (silent-zero policy, NOT throw):
 *   - multiplier <= 0 → return 0. DB CHECK enforces `multiplier > 0`;
 *     reaching this branch means raw-SQL corruption. Conservative
 *     posture: zero award rather than throw — no over-accrual on a
 *     malformed config, and the route layer keeps responding 200 OK
 *     with delta=0 so the operator notices the no-op.
 *   - non-finite multiplier (NaN/Infinity) → same: return 0.
 *   - multiplier === 1.0 → return basePoints unchanged (no float math,
 *     avoids the 99×1.0 = 99.0000…1 floating-point trap).
 */
export function applyTierMultiplier(basePoints: number, multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0
  if (multiplier === 1.0) return basePoints
  return Math.floor(basePoints * multiplier)
}

/* ─── Per-request cache ─────────────────────────────────────────────── */

/**
 * Per-org cache key. Caller scopes the cache map to a single request
 * (instantiate once at route entry, pass into all reads).
 */
type TierCache = Map<string, ActiveTierRow[]>

export function newTierCache(): TierCache {
  return new Map()
}

/**
 * Cached read. First call per (cache, orgId) hits the DB; subsequent
 * calls in the same request return the cached array. The earn pipeline
 * needs the tier list TWICE per credit (once to look up multiplier,
 * once after CAS to re-resolve the post-earn tier). With caching that's
 * one roundtrip instead of two.
 */
export async function loadTiersCached(
  cache: TierCache,
  client: LoyaltyTierClient,
  orgId: string,
): Promise<ActiveTierRow[]> {
  const hit = cache.get(orgId)
  if (hit) return hit
  const fresh = await loadActiveTiers(client, orgId)
  cache.set(orgId, fresh)
  return fresh
}

/**
 * Convenience: combine load + resolve into one call. Used from the
 * earn endpoint to compute the post-CAS tier.
 */
export async function resolveTier(
  cache: TierCache,
  client: LoyaltyTierClient,
  orgId: string,
  lifetimePoints: number,
): Promise<ResolvedTier> {
  const tiers = await loadTiersCached(cache, client, orgId)
  return resolveTierFromList(tiers, lifetimePoints)
}

