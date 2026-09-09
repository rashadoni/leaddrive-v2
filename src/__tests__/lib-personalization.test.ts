/**
 * Tests for C4 Personalization slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  canExperienceTransition,
  experienceAllowedNext,
  isExperienceStatus,
  isExperienceTerminal,
} from "@/lib/personalization/state-machine"
import { evaluateTargeting } from "@/lib/personalization/targeting-evaluator"
import { selectVariant } from "@/lib/personalization/variant-selector"
import { aggregateMetrics } from "@/lib/personalization/metrics-aggregator"
import {
  EXPERIENCE_STATUSES,
  EXPERIENCE_TRANSITIONS,
  FIELD_SOURCES,
  PREDICATE_OPS,
  STICKY_MODES,
  type TargetingPredicate,
  type VariantMetricsSnapshot,
  type VariantSnapshot,
  type VisitorContext,
} from "@/lib/personalization/types"

/* ─── State machine ───────────────────────────────────────────────────── */

describe("C4 — experience state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of EXPERIENCE_STATUSES) expect(isExperienceStatus(s)).toBe(true)
  })

  it("draft → active / archived", () => {
    expect(canExperienceTransition("draft", "active").ok).toBe(true)
    expect(canExperienceTransition("draft", "archived").ok).toBe(true)
  })

  it("draft → paused rejected", () => {
    // Can't pause something that was never active.
    expect(canExperienceTransition("draft", "paused").ok).toBe(false)
  })

  it("active → paused / archived", () => {
    expect(canExperienceTransition("active", "paused").ok).toBe(true)
    expect(canExperienceTransition("active", "archived").ok).toBe(true)
  })

  it("paused → active (resume)", () => {
    expect(canExperienceTransition("paused", "active").ok).toBe(true)
  })

  it("archived is terminal", () => {
    expect(isExperienceTerminal("archived")).toBe(true)
    for (const to of ["draft", "active", "paused"] as const) {
      expect(canExperienceTransition("archived", to).ok).toBe(false)
    }
  })

  it("rejects self-transition", () => {
    for (const s of EXPERIENCE_STATUSES) {
      expect(canExperienceTransition(s, s).ok).toBe(false)
    }
  })

  it("experienceAllowedNext matches table", () => {
    for (const s of EXPERIENCE_STATUSES) {
      expect(experienceAllowedNext(s)).toEqual(EXPERIENCE_TRANSITIONS[s])
    }
  })
})

/* ─── Targeting evaluator ─────────────────────────────────────────────── */

describe("C4 — targeting-evaluator", () => {
  const baseVisitor: VisitorContext = {
    visitorId: "v_123",
    attributes: { pageviews: 5, country: "US" },
    profile: { totalSpent: 1500, primaryCurrency: "USD" },
    segmentMembership: ["vip", "newsletter"],
  }

  it("empty rules → matches everyone", () => {
    const r = evaluateTargeting({ rules: {}, visitor: baseVisitor })
    expect(r.matched).toBe(true)
  })

  it("allOf: every predicate must match", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [
          { source: "visitor", field: "country", op: "eq", value: "US" },
          { source: "profile", field: "totalSpent", op: "gte", value: 1000 },
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(true)
  })

  it("allOf short-circuits on first miss", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [
          { source: "visitor", field: "country", op: "eq", value: "DE" }, // miss
          { source: "profile", field: "totalSpent", op: "gte", value: 1000 }, // would match
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
    expect(r.trace).toHaveLength(1) // short-circuited
  })

  it("anyOf: at least one match", () => {
    const r = evaluateTargeting({
      rules: {
        anyOf: [
          { source: "visitor", field: "country", op: "eq", value: "DE" }, // miss
          { source: "profile", field: "totalSpent", op: "gte", value: 1000 }, // hit
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(true)
  })

  it("anyOf with no hits → no match", () => {
    const r = evaluateTargeting({
      rules: {
        anyOf: [
          { source: "visitor", field: "country", op: "eq", value: "DE" },
          { source: "profile", field: "totalSpent", op: "lt", value: 100 },
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
  })

  it("noneOf: no predicate may match", () => {
    const r = evaluateTargeting({
      rules: {
        noneOf: [
          { source: "visitor", field: "country", op: "eq", value: "DE" },
          { source: "profile", field: "totalSpent", op: "lt", value: 100 },
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(true)
  })

  it("noneOf with a hit → no match", () => {
    const r = evaluateTargeting({
      rules: {
        noneOf: [{ source: "visitor", field: "country", op: "eq", value: "US" }],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
  })

  it("combines allOf + anyOf + noneOf", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "country", op: "eq", value: "US" }],
        anyOf: [
          { source: "profile", field: "totalSpent", op: "gte", value: 5000 }, // miss
          { source: "profile", field: "totalSpent", op: "gte", value: 1000 }, // hit
        ],
        noneOf: [{ source: "segment", field: "vip-excluded", op: "eq", value: true }],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(true)
  })

  it("segment source: boolean membership", () => {
    const r1 = evaluateTargeting({
      rules: { allOf: [{ source: "segment", field: "vip", op: "eq", value: true }] },
      visitor: baseVisitor,
    })
    expect(r1.matched).toBe(true)

    const r2 = evaluateTargeting({
      rules: { allOf: [{ source: "segment", field: "non-existent", op: "eq", value: true }] },
      visitor: baseVisitor,
    })
    expect(r2.matched).toBe(false)
  })

  it("in / not_in operators", () => {
    const r1 = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "country", op: "in", value: ["US", "CA", "GB"] }],
      },
      visitor: baseVisitor,
    })
    expect(r1.matched).toBe(true)

    const r2 = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "country", op: "not_in", value: ["DE", "FR"] }],
      },
      visitor: baseVisitor,
    })
    expect(r2.matched).toBe(true)
  })

  it("gt/gte/lt/lte numeric comparisons", () => {
    const cases: { op: TargetingPredicate["op"]; value: number; expected: boolean }[] = [
      { op: "gt", value: 1000, expected: true }, // 1500 > 1000
      { op: "gte", value: 1500, expected: true }, // 1500 >= 1500
      { op: "lt", value: 2000, expected: true }, // 1500 < 2000
      { op: "lte", value: 1500, expected: true }, // 1500 <= 1500
    ]
    for (const { op, value, expected } of cases) {
      const r = evaluateTargeting({
        rules: { allOf: [{ source: "profile", field: "totalSpent", op, value }] },
        visitor: baseVisitor,
      })
      expect(r.matched).toBe(expected)
    }
  })

  it("contains: string-contains", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [
          { source: "profile", field: "primaryCurrency", op: "contains", value: "SD" },
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(true)
  })

  it("isnull / not_null", () => {
    const r1 = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "missingField", op: "isnull" }],
      },
      visitor: baseVisitor,
    })
    expect(r1.matched).toBe(true)

    const r2 = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "country", op: "not_null" }],
      },
      visitor: baseVisitor,
    })
    expect(r2.matched).toBe(true)
  })

  it("missing field defaults to no-match", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "missingField", op: "eq", value: "anything" }],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
  })

  it("rejects prototype-chain field reads (defense-in-depth)", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [{ source: "visitor", field: "__proto__", op: "not_null" }],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
  })

  it("rejects missing visitorId", () => {
    const r = evaluateTargeting({
      rules: {},
      visitor: { ...baseVisitor, visitorId: "" },
    })
    expect(r.matched).toBe(false)
  })

  it("unknown op produces no-match (defensive)", () => {
    const r = evaluateTargeting({
      rules: {
        allOf: [
          { source: "visitor", field: "country", op: "modulo" as never, value: "US" },
        ],
      },
      visitor: baseVisitor,
    })
    expect(r.matched).toBe(false)
  })
})

/* ─── Variant selector ────────────────────────────────────────────────── */

describe("C4 — variant-selector", () => {
  function mkV(id: string, slug: string, weight: number, opts: Partial<VariantSnapshot> = {}): VariantSnapshot {
    return {
      id,
      slug,
      weight,
      isControl: opts.isControl ?? false,
      isActive: opts.isActive ?? true,
    }
  }

  it("rejects empty variant list", () => {
    const r = selectVariant({ variants: [], stickyKey: null })
    expect(r.ok).toBe(false)
  })

  it("rejects when all variants inactive", () => {
    const r = selectVariant({
      variants: [mkV("a", "a", 100, { isActive: false })],
      stickyKey: null,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects when all weights zero", () => {
    const r = selectVariant({
      variants: [mkV("a", "a", 0), mkV("b", "b", 0)],
      stickyKey: null,
    })
    expect(r.ok).toBe(false)
  })

  it("sticky: same key always returns same variant", () => {
    const variants = [mkV("a", "a", 50), mkV("b", "b", 50)]
    const r1 = selectVariant({ variants, stickyKey: "visitor_xyz" })
    const r2 = selectVariant({ variants, stickyKey: "visitor_xyz" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.variant.id).toBe(r2.variant.id)
      expect(r1.wasSticky).toBe(true)
    }
  })

  it("non-sticky path uses injected rng", () => {
    const variants = [mkV("a", "a", 50), mkV("b", "b", 50)]
    const r1 = selectVariant({ variants, stickyKey: null, rng: () => 0.2 })
    const r2 = selectVariant({ variants, stickyKey: null, rng: () => 0.8 })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.variant.id).toBe("a") // 0.2 × 100 = 20 < 50
      expect(r2.variant.id).toBe("b") // 0.8 × 100 = 80 > 50
      expect(r1.wasSticky).toBe(false)
    }
  })

  it("skips inactive + zero-weight variants", () => {
    const variants = [
      mkV("a", "a", 0),
      mkV("b", "b", 100, { isActive: false }),
      mkV("c", "c", 100),
    ]
    const r = selectVariant({ variants, stickyKey: null, rng: () => 0.5 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.variant.id).toBe("c")
  })

  it("weighted: heavier variant picked more often", () => {
    const variants = [mkV("a", "a", 90), mkV("b", "b", 10)]
    let aCount = 0
    let bCount = 0
    for (let i = 0; i < 10_000; i++) {
      const r = selectVariant({ variants, stickyKey: null })
      if (r.ok && r.variant.id === "a") aCount += 1
      if (r.ok && r.variant.id === "b") bCount += 1
    }
    // Expect roughly 9:1 ratio — accept 80%+/-5 on a.
    expect(aCount / (aCount + bCount)).toBeGreaterThan(0.85)
  })

  it("rejects bad rng output", () => {
    const variants = [mkV("a", "a", 100)]
    expect(selectVariant({ variants, stickyKey: null, rng: () => 1.5 }).ok).toBe(false)
    expect(selectVariant({ variants, stickyKey: null, rng: () => -0.1 }).ok).toBe(false)
    expect(selectVariant({ variants, stickyKey: null, rng: () => NaN }).ok).toBe(false)
  })

  it("rejects non-integer weight", () => {
    const variants = [{ id: "a", slug: "a", weight: 0.5, isControl: false, isActive: true }]
    const r = selectVariant({ variants, stickyKey: null })
    expect(r.ok).toBe(false)
  })

  it("single-variant always returns that variant", () => {
    const variants = [mkV("only", "only", 100)]
    const r = selectVariant({ variants, stickyKey: "anything" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.variant.id).toBe("only")
  })

  it("sticky hash differs across stickyKeys", () => {
    const variants = [mkV("a", "a", 50), mkV("b", "b", 50)]
    // Find two keys that hash to different variants.
    const results = new Map<string, string>()
    for (let i = 0; i < 20; i++) {
      const r = selectVariant({ variants, stickyKey: `v_${i}` })
      if (r.ok) results.set(`v_${i}`, r.variant.id)
    }
    // Expect both 'a' and 'b' present across the 20 keys.
    const seenVariants = new Set(results.values())
    expect(seenVariants.size).toBe(2)
  })
})

/* ─── Metrics aggregator ──────────────────────────────────────────────── */

describe("C4 — metrics-aggregator", () => {
  function mk(
    variantId: string,
    isControl: boolean,
    impressions: number,
    clicks: number,
    conversions: number
  ): VariantMetricsSnapshot {
    return {
      variantId,
      variantSlug: variantId,
      isControl,
      decisions: impressions,
      impressions,
      clicks,
      conversions,
    }
  }

  it("computes per-variant CTR + conversionRate", () => {
    const r = aggregateMetrics({
      variants: [mk("a", false, 1000, 100, 10)],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.rollup.perVariant[0]
      expect(v.ctr).toBeCloseTo(0.1) // 100/1000
      expect(v.conversionRate).toBeCloseTo(0.01) // 10/1000
      expect(v.liftOverControlPct).toBeNull() // no control declared
    }
  })

  it("computes liftOverControlPct for non-control variants", () => {
    const r = aggregateMetrics({
      variants: [
        mk("control", true, 1000, 100, 10), // 1% conversion
        mk("variant_a", false, 1000, 100, 15), // 1.5% — +50% lift
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const ctrl = r.rollup.perVariant.find((v) => v.isControl)!
      const va = r.rollup.perVariant.find((v) => v.variantId === "variant_a")!
      expect(ctrl.liftOverControlPct).toBeNull() // control vs self
      expect(va.liftOverControlPct).toBeCloseTo(0.5) // +50%
    }
  })

  it("negative lift when variant underperforms control", () => {
    const r = aggregateMetrics({
      variants: [
        mk("control", true, 1000, 100, 20), // 2%
        mk("variant_a", false, 1000, 100, 10), // 1% — -50%
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const va = r.rollup.perVariant.find((v) => v.variantId === "variant_a")!
      expect(va.liftOverControlPct).toBeCloseTo(-0.5)
    }
  })

  it("liftOverControlPct null when control has 0 conversions", () => {
    const r = aggregateMetrics({
      variants: [
        mk("control", true, 1000, 100, 0),
        mk("variant_a", false, 1000, 100, 10),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const va = r.rollup.perVariant.find((v) => v.variantId === "variant_a")!
      expect(va.liftOverControlPct).toBeNull()
    }
  })

  it("computes overall totals", () => {
    const r = aggregateMetrics({
      variants: [
        mk("a", false, 100, 10, 1),
        mk("b", false, 200, 20, 2),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rollup.totals.impressions).toBe(300)
      expect(r.rollup.totals.clicks).toBe(30)
      expect(r.rollup.totals.conversions).toBe(3)
    }
  })

  it("null ratios when impressions=0", () => {
    const r = aggregateMetrics({
      variants: [mk("a", false, 0, 0, 0)],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rollup.perVariant[0].ctr).toBeNull()
      expect(r.rollup.perVariant[0].conversionRate).toBeNull()
    }
  })

  it("rejects two-control config (data integrity)", () => {
    const r = aggregateMetrics({
      variants: [
        mk("c1", true, 100, 10, 1),
        mk("c2", true, 100, 10, 1),
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects clicks > impressions", () => {
    const r = aggregateMetrics({
      variants: [mk("a", false, 100, 150, 0)],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects conversions > impressions", () => {
    const r = aggregateMetrics({
      variants: [mk("a", false, 100, 50, 200)],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative counts", () => {
    const r = aggregateMetrics({
      variants: [{ ...mk("a", false, 100, 10, 1), clicks: -1 }],
    })
    expect(r.ok).toBe(false)
  })

  it("empty input yields empty rollup", () => {
    const r = aggregateMetrics({ variants: [] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rollup.perVariant).toEqual([])
      expect(r.rollup.totals.impressions).toBe(0)
    }
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("C4 — registry drift guards", () => {
  it("EXPERIENCE_STATUSES exactly 4", () => {
    expect(EXPERIENCE_STATUSES).toEqual(["draft", "active", "paused", "archived"])
  })

  it("STICKY_MODES exactly 3", () => {
    expect(STICKY_MODES).toEqual(["visitor", "contact", "none"])
  })

  it("FIELD_SOURCES exactly 3", () => {
    expect(FIELD_SOURCES).toEqual(["visitor", "profile", "segment"])
  })

  it("PREDICATE_OPS exactly 11", () => {
    expect(PREDICATE_OPS).toHaveLength(11)
  })

  it("EXPERIENCE_TRANSITIONS covers every status", () => {
    for (const s of EXPERIENCE_STATUSES) {
      expect(EXPERIENCE_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal experiences = [archived]", () => {
    const terminals = EXPERIENCE_STATUSES.filter(
      (s) => EXPERIENCE_TRANSITIONS[s].length === 0
    )
    expect(terminals).toEqual(["archived"])
  })

  it("FIELD_SOURCES pinned to [visitor, profile, segment]", () => {
    // Architect-pass-1 suggestion: drift-guard so widening
    // FIELD_SOURCES at PR-review time is loud (targeting-evaluator
    // resolveValue switch must update in tandem).
    expect(FIELD_SOURCES).toEqual(["visitor", "profile", "segment"])
  })

  it("PREDICATE_OPS pinned to the exact 11 ops the evaluator handles", () => {
    expect(PREDICATE_OPS).toEqual([
      "eq",
      "neq",
      "in",
      "not_in",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "isnull",
      "not_null",
    ])
  })
})
