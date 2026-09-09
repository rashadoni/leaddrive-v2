/**
 * Tests for G2 Identity Resolution slice 1 — Levenshtein + fuzzy-
 * matcher + canonicalPair + merge-resolver pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import {
  levenshteinDistance,
  levenshteinSimilarity,
} from "@/lib/identity-resolution/levenshtein"
import {
  canonicalPair,
  fuzzyMatch,
} from "@/lib/identity-resolution/fuzzy-matcher"
import { resolveMergeDecision } from "@/lib/identity-resolution/merge-resolver"
import {
  DEFAULT_MERGE_THRESHOLDS,
  FUZZY_DEFAULT_WEIGHTS,
  type FuzzyIdentity,
} from "@/lib/identity-resolution/types"

/* ─── Levenshtein ─────────────────────────────────────────────────────── */

describe("G2 — levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("", "")).toBe(0)
    expect(levenshteinDistance("foo", "foo")).toBe(0)
  })

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3)
    expect(levenshteinDistance("hello", "")).toBe(5)
  })

  it("computes single-edit distances", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1) // substitution
    expect(levenshteinDistance("cat", "cats")).toBe(1) // insertion
    expect(levenshteinDistance("cats", "cat")).toBe(1) // deletion
  })

  it("computes multi-edit distance correctly", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3) // classic Wikipedia example
    expect(levenshteinDistance("saturday", "sunday")).toBe(3)
  })

  it("is symmetric — order doesn't matter", () => {
    expect(levenshteinDistance("apple", "aple")).toBe(
      levenshteinDistance("aple", "apple")
    )
    expect(levenshteinDistance("longstring", "x")).toBe(
      levenshteinDistance("x", "longstring")
    )
  })

  it("case-sensitive comparison (caller normalizes upstream)", () => {
    // Helper does NOT lowercase — G1 normalizer already does.
    expect(levenshteinDistance("Hello", "hello")).toBe(1)
  })
})

describe("G2 — levenshteinSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(levenshteinSimilarity("foo", "foo")).toBe(1)
    expect(levenshteinSimilarity("", "")).toBe(1) // both empty
  })

  it("returns 0 for one empty + one non-empty", () => {
    expect(levenshteinSimilarity("", "abc")).toBe(0)
    expect(levenshteinSimilarity("hello", "")).toBe(0)
  })

  it("scales 0..1 by distance/maxLen", () => {
    // "cat" vs "bat": distance 1, maxLen 3 → 1 - 1/3 ≈ 0.667
    expect(levenshteinSimilarity("cat", "bat")).toBeCloseTo(0.667, 2)
    // "kitten" vs "sitting": distance 3, maxLen 7 → 1 - 3/7 ≈ 0.571
    expect(levenshteinSimilarity("kitten", "sitting")).toBeCloseTo(0.571, 2)
  })

  it("is symmetric — order doesn't matter", () => {
    expect(levenshteinSimilarity("apple", "aple")).toBe(
      levenshteinSimilarity("aple", "apple")
    )
  })

  it("typo-tolerant: 1-char typo in 6-char string scores ≥ 0.83", () => {
    expect(levenshteinSimilarity("johndoe", "jondoe")).toBeGreaterThanOrEqual(0.85)
    expect(levenshteinSimilarity("smith", "smyth")).toBe(0.8) // 1/5
  })
})

/* ─── fuzzyMatch ──────────────────────────────────────────────────────── */

function mkIdentity(
  email: string | null,
  phone: string | null,
  name: string | null = null
): FuzzyIdentity {
  return { emailNormalized: email, phoneNormalized: phone, nameNormalized: name }
}

describe("G2 — fuzzyMatch — email", () => {
  it("returns 1.0 score on exact email match (same domain + local)", () => {
    const r = fuzzyMatch(
      mkIdentity("foo@bar.com", null),
      mkIdentity("foo@bar.com", null)
    )
    expect(r.score).toBe(1)
    expect(r.breakdown.email).toBe(1)
  })

  it("returns 0 score on different-domain emails (even with same local)", () => {
    // ⚠️ Critical anti-mistake — foo@a.com and foo@b.com are different identities.
    const r = fuzzyMatch(
      mkIdentity("foo@a.com", null),
      mkIdentity("foo@b.com", null)
    )
    expect(r.score).toBe(0)
    expect(r.breakdown.email).toBe(0)
  })

  it("scores same-domain + similar local-part highly", () => {
    // "john" vs "jon" in same domain → local distance 1, len 4 → similarity 0.75
    const r = fuzzyMatch(
      mkIdentity("john@example.com", null),
      mkIdentity("jon@example.com", null)
    )
    expect(r.breakdown.email).toBe(0.75)
    // Score with only email present = email similarity unchanged.
    expect(r.score).toBe(0.75)
  })

  it("returns null (NOT NaN) for email score when one side is null — JSON-safe contract", () => {
    // Architect P1 closure: `matchBreakdown` persists to JSONB; NaN
    // doesn't round-trip through JSON. Helper emits explicit null so
    // the typed "key absent" semantic survives Prisma write/read.
    const r = fuzzyMatch(
      mkIdentity("foo@bar.com", null),
      mkIdentity(null, "+994501234567")
    )
    expect(r.breakdown.email).toBeNull()
    // Email weight zeroed because email isn't comparable.
    expect(r.breakdown.emailWeight).toBe(0)
  })

  it("JSON-roundtrip of breakdown preserves null (not 'NaN'/'null' string)", () => {
    // Defense-in-depth: a JSON.stringify → JSON.parse of the breakdown
    // must return literal null on absent keys, not a coerced string.
    const r = fuzzyMatch(
      mkIdentity("foo@bar.com", null, null),
      mkIdentity(null, "+994501234567", null)
    )
    const roundtripped = JSON.parse(JSON.stringify(r.breakdown))
    expect(roundtripped.email).toBeNull()
    expect(roundtripped.phone).toBeNull()
    expect(roundtripped.name).toBeNull()
    expect(roundtripped.emailWeight).toBe(0)
    expect(roundtripped.phoneWeight).toBe(0)
    expect(roundtripped.nameWeight).toBe(0)
  })
})

describe("G2 — fuzzyMatch — phone", () => {
  it("returns 1.0 score on identical E.164 phone", () => {
    const r = fuzzyMatch(
      mkIdentity(null, "+994501234567"),
      mkIdentity(null, "+994501234567")
    )
    expect(r.score).toBe(1)
    expect(r.breakdown.phone).toBe(1)
  })

  it("scores 1-digit phone typo as 1 - 1/12 ≈ 0.917 (12 digits after stripping +)", () => {
    const r = fuzzyMatch(
      mkIdentity(null, "+994501234567"),
      mkIdentity(null, "+994501234568") // last digit changed
    )
    expect(r.breakdown.phone).toBeCloseTo(0.917, 2)
  })
})

describe("G2 — fuzzyMatch — name", () => {
  it("scores exact name match as 1.0", () => {
    const r = fuzzyMatch(
      mkIdentity(null, null, "john smith"),
      mkIdentity(null, null, "john smith")
    )
    expect(r.breakdown.name).toBe(1)
  })

  it("scores typo'd name", () => {
    const r = fuzzyMatch(
      mkIdentity(null, null, "john smith"),
      mkIdentity(null, null, "jon smith") // missing h
    )
    // distance 1 / maxLen 10 = 0.1 → similarity 0.9
    expect(r.breakdown.name).toBe(0.9)
  })
})

describe("G2 — fuzzyMatch composite", () => {
  it("composite normalizes weights by KEYS PRESENT on both sides", () => {
    // Only email comparable → composite = email score, not email score × email weight.
    const r = fuzzyMatch(
      mkIdentity("foo@bar.com", null),
      mkIdentity("foo@bar.com", null)
    )
    expect(r.score).toBe(1)
  })

  it("composite is weighted-average across email + phone when both comparable", () => {
    // email: john vs jon @ example.com → 0.75 (× 0.6 weight)
    // phone: identical → 1.0 (× 0.3 weight)
    // No name on either side.
    // composite = (0.75 * 0.6 + 1.0 * 0.3) / (0.6 + 0.3) = (0.45 + 0.3) / 0.9 = 0.8333...
    const r = fuzzyMatch(
      mkIdentity("john@example.com", "+994501234567"),
      mkIdentity("jon@example.com", "+994501234567")
    )
    expect(r.score).toBeCloseTo(0.833, 2)
    expect(r.breakdown.emailWeight).toBe(FUZZY_DEFAULT_WEIGHTS.email)
    expect(r.breakdown.phoneWeight).toBe(FUZZY_DEFAULT_WEIGHTS.phone)
    expect(r.breakdown.nameWeight).toBe(0) // name absent on both → zero
  })

  it("returns score=0 when no keys are comparable", () => {
    // Both sides empty identity.
    const r = fuzzyMatch(
      mkIdentity(null, null, null),
      mkIdentity(null, null, null)
    )
    expect(r.score).toBe(0)
  })

  it("returns score=0 when keys are disjoint (one side email, other side phone)", () => {
    const r = fuzzyMatch(
      mkIdentity("foo@bar.com", null),
      mkIdentity(null, "+994501234567")
    )
    expect(r.score).toBe(0)
  })

  it("honours custom weights override", () => {
    // Override: phone gets 99% of weight, email 1%.
    // Same fixture as the weighted-average test — score should now be
    // dominated by phone=1.0 instead of email=0.75.
    const r = fuzzyMatch(
      mkIdentity("john@example.com", "+994501234567"),
      mkIdentity("jon@example.com", "+994501234567"),
      { weights: { email: 0.01, phone: 0.99, name: 0 } }
    )
    expect(r.score).toBeGreaterThan(0.99) // ≈ (0.75 × 0.01 + 1.0 × 0.99) / 1.0 = 0.9975
  })
})

/* ─── canonicalPair ───────────────────────────────────────────────────── */

describe("G2 — canonicalPair", () => {
  it("returns lexicographically-smaller id as primary", () => {
    const r = canonicalPair("zzz", "aaa")
    expect(r.primaryProfileId).toBe("aaa")
    expect(r.secondaryProfileId).toBe("zzz")
  })

  it("is order-independent — same pair always returns same ordering", () => {
    const a = canonicalPair("abc", "xyz")
    const b = canonicalPair("xyz", "abc")
    expect(a).toEqual(b)
  })

  it("returns degenerate pair when ids are identical (caller misuse — DB CHECK catches)", () => {
    const r = canonicalPair("same", "same")
    expect(r.primaryProfileId).toBe("same")
    expect(r.secondaryProfileId).toBe("same")
    // distinct_check at DB level rejects this on write → no silent corruption.
  })
})

/* ─── resolveMergeDecision ────────────────────────────────────────────── */

describe("G2 — resolveMergeDecision", () => {
  it("auto_merge at exactly the autoMerge threshold (>=, not >)", () => {
    const r = resolveMergeDecision({ score: DEFAULT_MERGE_THRESHOLDS.autoMerge })
    expect(r.kind).toBe("auto_merge")
  })

  it("auto_merge well above threshold", () => {
    const r = resolveMergeDecision({ score: 0.99 })
    expect(r.kind).toBe("auto_merge")
  })

  it("manual_review at exactly the manualReview threshold", () => {
    const r = resolveMergeDecision({ score: DEFAULT_MERGE_THRESHOLDS.manualReview })
    expect(r.kind).toBe("manual_review")
  })

  it("manual_review in the gap between manualReview and autoMerge", () => {
    const r = resolveMergeDecision({ score: 0.85 })
    expect(r.kind).toBe("manual_review")
  })

  it("reject below manualReview", () => {
    const r = resolveMergeDecision({ score: 0.5 })
    expect(r.kind).toBe("reject")
  })

  it("rejects score < 0 or > 1 with a config-error reason", () => {
    expect(resolveMergeDecision({ score: -0.1 }).kind).toBe("reject")
    expect(resolveMergeDecision({ score: 1.1 }).kind).toBe("reject")
    expect(resolveMergeDecision({ score: Number.NaN }).kind).toBe("reject")
  })

  it("rejects misconfigured thresholds (autoMerge < manualReview)", () => {
    const r = resolveMergeDecision({
      score: 0.8,
      thresholds: { autoMerge: 0.5, manualReview: 0.9 },
    })
    expect(r.kind).toBe("reject")
    if (r.kind === "reject") expect(r.reason).toMatch(/caller config error/)
  })

  it("rejects non-finite threshold values", () => {
    const r = resolveMergeDecision({
      score: 0.8,
      thresholds: { autoMerge: Number.NaN, manualReview: 0.7 },
    })
    expect(r.kind).toBe("reject")
  })

  it("honours custom thresholds override", () => {
    // Tighter thresholds: auto = 0.99, manual = 0.9.
    const r = resolveMergeDecision({
      score: 0.95,
      thresholds: { autoMerge: 0.99, manualReview: 0.9 },
    })
    // 0.95 < 0.99 → not auto, but >= 0.9 → manual_review.
    expect(r.kind).toBe("manual_review")
  })
})
