/**
 * Variant selector — C4 slice 1.
 *
 * Picks one variant from the candidate set using weighted-random.
 * Sticky-assignment: when `stickyKey` is provided, the picker uses a
 * deterministic hash of stickyKey so the same visitor always receives
 * the same variant (until variant set changes).
 *
 * Algorithm:
 *   1. Filter to active + non-zero-weight variants.
 *   2. Compute cumulative weight buckets.
 *   3. Roll a number in [0, totalWeight) via rng (or hash of stickyKey).
 *   4. Find the bucket the roll falls in.
 *   5. Return that variant + `wasSticky` flag.
 *
 * Pure synchronous. RNG is dependency-injected for test determinism.
 */
import {
  type SelectVariantInput,
  type SelectVariantResult,
  type VariantSnapshot,
} from "./types"

/**
 * Deterministic 32-bit hash of a string. Used to convert stickyKey
 * into a stable [0, 1) value for sticky selection. Uses Java's
 * `String.hashCode`-style FNV-1a-flavored mixing — sufficient for
 * variant bucketing (not cryptographic).
 */
function hashStringToUnit(s: string): number {
  let h = 2166136261 >>> 0 // FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // Convert to [0, 1).
  return h / 0x100000000
}

export function selectVariant(input: SelectVariantInput): SelectVariantResult {
  if (!Array.isArray(input.variants)) {
    return { ok: false, error: "variants must be an array" }
  }
  if (input.variants.length === 0) {
    return { ok: false, error: "variants must be non-empty" }
  }

  // Filter to active + non-zero weight.
  const candidates: VariantSnapshot[] = []
  let totalWeight = 0
  for (let i = 0; i < input.variants.length; i++) {
    const v = input.variants[i]
    if (typeof v !== "object" || v === null) {
      return { ok: false, error: `variants[${i}] must be an object` }
    }
    if (typeof v.weight !== "number" || !Number.isInteger(v.weight) || v.weight < 0) {
      return { ok: false, error: `variants[${i}].weight must be a non-negative integer` }
    }
    if (!v.isActive) continue
    if (v.weight === 0) continue
    candidates.push(v)
    totalWeight += v.weight
  }

  if (candidates.length === 0) {
    return { ok: false, error: "no active variants with non-zero weight" }
  }
  if (totalWeight === 0) {
    // Shouldn't reach (we skip weight=0 above) but defensive.
    return { ok: false, error: "total weight is zero" }
  }

  // Resolve RNG. Sticky path takes precedence over caller-supplied rng
  // (slice-2 may want to force-randomise a sticky visitor via rng
  // override; for slice 1 we keep sticky deterministic).
  let unit: number
  let wasSticky = false
  if (input.stickyKey !== null && input.stickyKey !== undefined && input.stickyKey.length > 0) {
    unit = hashStringToUnit(input.stickyKey)
    wasSticky = true
  } else if (typeof input.rng === "function") {
    unit = input.rng()
    if (typeof unit !== "number" || !Number.isFinite(unit) || unit < 0 || unit >= 1) {
      return { ok: false, error: "rng must return a finite number in [0, 1)" }
    }
  } else {
    unit = Math.random()
  }

  // Walk cumulative weights — first bucket containing `roll` wins.
  const roll = unit * totalWeight
  let cumulative = 0
  for (const v of candidates) {
    cumulative += v.weight
    if (roll < cumulative) {
      return { ok: true, variant: v, wasSticky }
    }
  }
  // Floating-point edge: roll ≈ totalWeight. Fall back to last.
  return { ok: true, variant: candidates[candidates.length - 1], wasSticky }
}
