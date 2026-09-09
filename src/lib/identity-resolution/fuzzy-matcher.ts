/**
 * Fuzzy identity matcher — G2 Phase 6 Block B slice 1.
 *
 * Given two normalized identities (from G1's `normalizeIdentity`),
 * produce a 0..1 composite similarity score with per-key breakdown.
 *
 * Per-key rules:
 *   • Email: split on `@`. SAME-DOMAIN required for any non-zero
 *     score (different domains = different person — `foo@a.com` and
 *     `foo@b.com` are NOT the same identity even with identical
 *     local-parts). Within same-domain, Levenshtein similarity on
 *     the local-part.
 *   • Phone: digit-string Levenshtein after stripping the `+`.
 *     E.164 normalized inputs make this directly comparable.
 *   • Name: Levenshtein similarity on the full normalized name.
 *
 * Composite score:
 *   score = Σ(key_score × key_weight) / Σ(weights_of_present_keys)
 *
 * Weights are normalized by the keys that are ACTUALLY comparable
 * on both sides (key present + non-null on both). A pair with only
 * email available + same domain + similarity 0.9 produces a composite
 * 0.9 (not 0.9 × 0.6 / 1.0). A pair with email + phone both comparable
 * weights average them.
 *
 * Returns score = 0 when no keys are comparable on both sides — caller
 * shouldn't emit a queue row in that case.
 *
 * Pure synchronous.
 */
import {
  FUZZY_DEFAULT_WEIGHTS,
  type CanonicalPair,
  type FuzzyIdentity,
  type FuzzyMatchOptions,
  type FuzzyMatchResult,
  type FuzzyWeights,
} from "./types"
import { levenshteinSimilarity } from "./levenshtein"

/**
 * Per-key similarity helpers return `null` (NOT NaN) when the key is
 * absent on either side. JSON-safety: NaN doesn't round-trip through
 * `JSON.stringify` (becomes `"null"`); explicit `null` is JSONB-clean
 * and preserves the typed "key absent" semantic. See
 * FuzzyMatchBreakdown JSDoc for the rationale.
 */
function emailSimilarity(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null
  // Split on the LAST `@` (defensive — local-parts can contain `@`
  // in quoted form per RFC 5321, but the G1 normalizer rejects those
  // via its `^[^\s@]+@[^\s@]+\.[^\s@]+$` regex. Belt-and-suspenders:
  // last-index split here too).
  const aAt = a.lastIndexOf("@")
  const bAt = b.lastIndexOf("@")
  if (aAt === -1 || bAt === -1) return null
  const aDomain = a.slice(aAt + 1)
  const bDomain = b.slice(bAt + 1)
  if (aDomain !== bDomain) return 0 // different domain → 0
  return levenshteinSimilarity(a.slice(0, aAt), b.slice(0, bAt))
}

function phoneSimilarity(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null
  // Strip the leading `+` and compare digit strings. E.164 normalization
  // already stripped non-digit punctuation, so a.slice(1) is digits-only.
  const aDigits = a.startsWith("+") ? a.slice(1) : a
  const bDigits = b.startsWith("+") ? b.slice(1) : b
  return levenshteinSimilarity(aDigits, bDigits)
}

function nameSimilarity(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null
  return levenshteinSimilarity(a, b)
}

export function fuzzyMatch(
  a: FuzzyIdentity,
  b: FuzzyIdentity,
  options?: FuzzyMatchOptions
): FuzzyMatchResult {
  const weights: FuzzyWeights = options?.weights ?? FUZZY_DEFAULT_WEIGHTS

  const emailScore = emailSimilarity(a.emailNormalized, b.emailNormalized)
  const phoneScore = phoneSimilarity(a.phoneNormalized, b.phoneNormalized)
  const nameScore = nameSimilarity(a.nameNormalized, b.nameNormalized)

  // A key contributes to the composite only when comparable on BOTH
  // sides (its similarity is a finite number, not `null`).
  const emailWeight = emailScore === null ? 0 : weights.email
  const phoneWeight = phoneScore === null ? 0 : weights.phone
  const nameWeight = nameScore === null ? 0 : weights.name

  const totalWeight = emailWeight + phoneWeight + nameWeight
  let score: number
  if (totalWeight === 0) {
    score = 0
  } else {
    // Replace null entries with 0 for the dot-product — they have
    // weight 0 anyway, so the contribution is 0 regardless.
    const e = emailScore ?? 0
    const p = phoneScore ?? 0
    const n = nameScore ?? 0
    score = (e * emailWeight + p * phoneWeight + n * nameWeight) / totalWeight
  }

  return {
    score,
    breakdown: {
      email: emailScore,
      phone: phoneScore,
      name: nameScore,
      emailWeight,
      phoneWeight,
      nameWeight,
    },
  }
}

/* ─── Canonical-pair derivation ───────────────────────────────────────── */

/**
 * Given two profile IDs, return the canonical (primary, secondary)
 * ordering. Lexicographically-smaller id is primary. Two concurrent
 * matchers on the same pair both compute the same ordering and
 * race-collide on the partial UNIQUE `(org, primary, secondary)
 * WHERE status='pending'` instead of emitting duplicate queue rows.
 */
export function canonicalPair(idA: string, idB: string): CanonicalPair {
  if (idA === idB) {
    // Self-merge is meaningless; caller should never invoke. Return a
    // stable degenerate value so a misuse surfaces as a P2002
    // (distinct-check violation) rather than silent data corruption.
    return { primaryProfileId: idA, secondaryProfileId: idB }
  }
  if (idA < idB) {
    return { primaryProfileId: idA, secondaryProfileId: idB }
  }
  return { primaryProfileId: idB, secondaryProfileId: idA }
}
