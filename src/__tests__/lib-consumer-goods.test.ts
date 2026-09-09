/**
 * Tests for R4 Consumer Goods Cloud slice 1 — uplift + tactic rollup + planogram scorer.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_SCORE_WEIGHTS,
  scorePlanogram,
} from "@/lib/consumer-goods/planogram-scorer"
import {
  calculateUplift,
  rollupTacticSpends,
} from "@/lib/consumer-goods/uplift-calculator"
import type {
  AuditObservations,
  PlanogramSpec,
} from "@/lib/consumer-goods/types"

/* ─── calculateUplift ─────────────────────────────────────────────────── */

describe("R4 — calculateUplift", () => {
  it("positive uplift + profitable ROI", () => {
    const r = calculateUplift({
      baselineSalesAmount: 10_000,
      actualSalesAmount: 15_000,
      totalSpendAmount: 2_000,
    })
    expect(r.incrementalSales).toBe(5_000)
    expect(r.upliftPct).toBeCloseTo(0.5, 6)
    // ROI = (5000 - 2000) / 2000 = 1.5
    expect(r.roi).toBeCloseTo(1.5, 6)
    expect(r.spendEfficiency).toBeCloseTo(2.5, 6)
    expect(r.profitable).toBe(true)
  })

  it("negative uplift (actual < baseline)", () => {
    const r = calculateUplift({
      baselineSalesAmount: 10_000,
      actualSalesAmount: 7_000,
      totalSpendAmount: 1_000,
    })
    expect(r.incrementalSales).toBe(-3_000)
    expect(r.upliftPct).toBeCloseTo(-0.3, 6)
    expect(r.roi).toBeCloseTo((-3000 - 1000) / 1000, 6) // -4
    expect(r.profitable).toBe(false)
  })

  it("zero baseline → upliftPct null (no comparable)", () => {
    const r = calculateUplift({
      baselineSalesAmount: 0,
      actualSalesAmount: 5_000,
      totalSpendAmount: 1_000,
    })
    expect(r.incrementalSales).toBe(5_000)
    expect(r.upliftPct).toBeNull()
    expect(r.roi).toBeCloseTo(4, 6)
  })

  it("zero spend → roi + spendEfficiency null, profitable iff incremental > 0", () => {
    const r = calculateUplift({
      baselineSalesAmount: 5_000,
      actualSalesAmount: 6_000,
      totalSpendAmount: 0,
    })
    expect(r.roi).toBeNull()
    expect(r.spendEfficiency).toBeNull()
    expect(r.profitable).toBe(true) // incremental 1000 > 0
  })

  it("all-zero inputs → incremental 0, all flags null/false", () => {
    const r = calculateUplift({
      baselineSalesAmount: 0,
      actualSalesAmount: 0,
      totalSpendAmount: 0,
    })
    expect(r.incrementalSales).toBe(0)
    expect(r.upliftPct).toBeNull()
    expect(r.roi).toBeNull()
    expect(r.profitable).toBe(false)
  })

  it("rejects negative inputs", () => {
    expect(() =>
      calculateUplift({ baselineSalesAmount: -1, actualSalesAmount: 0, totalSpendAmount: 0 })
    ).toThrow(/baselineSalesAmount must be >= 0/)
    expect(() =>
      calculateUplift({ baselineSalesAmount: 0, actualSalesAmount: -1, totalSpendAmount: 0 })
    ).toThrow(/actualSalesAmount must be >= 0/)
    expect(() =>
      calculateUplift({ baselineSalesAmount: 0, actualSalesAmount: 0, totalSpendAmount: -1 })
    ).toThrow(/totalSpendAmount must be >= 0/)
  })

  it("rejects non-finite inputs (NaN, Infinity)", () => {
    expect(() =>
      calculateUplift({ baselineSalesAmount: NaN, actualSalesAmount: 0, totalSpendAmount: 0 })
    ).toThrow(/finite/)
    expect(() =>
      calculateUplift({ baselineSalesAmount: 0, actualSalesAmount: Infinity, totalSpendAmount: 0 })
    ).toThrow(/finite/)
  })

  it("negative uplift + zero spend → roi null + not profitable", () => {
    const r = calculateUplift({
      baselineSalesAmount: 5_000,
      actualSalesAmount: 4_000,
      totalSpendAmount: 0,
    })
    expect(r.incrementalSales).toBe(-1_000)
    expect(r.upliftPct).toBeCloseTo(-0.2, 6)
    expect(r.roi).toBeNull()
    expect(r.spendEfficiency).toBeNull()
    expect(r.profitable).toBe(false)
  })

  it("profitable threshold uses incremental > spend (not >= )", () => {
    const r = calculateUplift({
      baselineSalesAmount: 0,
      actualSalesAmount: 1_000,
      totalSpendAmount: 1_000,
    })
    expect(r.profitable).toBe(false) // breakeven is not profit
  })
})

/* ─── rollupTacticSpends ──────────────────────────────────────────────── */

describe("R4 — rollupTacticSpends", () => {
  const tactics = [
    { id: "t1", kind: "discount" as const, allocatedBudgetAmount: 5_000 },
    { id: "t2", kind: "display" as const, allocatedBudgetAmount: 2_000 },
    { id: "t3", kind: "sample" as const, allocatedBudgetAmount: 0 },
  ]

  it("rolls up spends + attributedSales per tactic", () => {
    const r = rollupTacticSpends(tactics, [
      { tacticId: "t1", amount: 1_500, attributedSalesAmount: 8_000 },
      { tacticId: "t1", amount: 500, attributedSalesAmount: 2_000 },
      { tacticId: "t2", amount: 1_000, attributedSalesAmount: 5_000 },
    ])
    const t1 = r.find(x => x.tacticId === "t1")!
    expect(t1.totalSpend).toBe(2_000)
    expect(t1.attributedSales).toBe(10_000)
    expect(t1.pacingPct).toBe(0.4) // 2000/5000
    expect(t1.tacticRoi).toBeCloseTo((10000 - 2000) / 2000, 6) // 4
    const t2 = r.find(x => x.tacticId === "t2")!
    expect(t2.pacingPct).toBe(0.5)
  })

  it("emits a row for every tactic, even when no spends exist", () => {
    const r = rollupTacticSpends(tactics, [])
    expect(r).toHaveLength(3)
    for (const row of r) {
      expect(row.totalSpend).toBe(0)
      expect(row.tacticRoi).toBeNull()
    }
  })

  it("tactic with zero allocated budget → pacingPct null (no div-by-zero)", () => {
    const r = rollupTacticSpends(tactics, [
      { tacticId: "t3", amount: 100 }, // t3 has 0 allocated
    ])
    const t3 = r.find(x => x.tacticId === "t3")!
    expect(t3.totalSpend).toBe(100)
    expect(t3.pacingPct).toBeNull()
  })

  it("ignores spends with negative amount or unknown tacticId", () => {
    const r = rollupTacticSpends(tactics, [
      { tacticId: "t1", amount: 100 },
      { tacticId: "t1", amount: -50 }, // ignored
      { tacticId: "unknown", amount: 999 }, // ignored
    ])
    const t1 = r.find(x => x.tacticId === "t1")!
    expect(t1.totalSpend).toBe(100)
  })

  it("all tactics with zero allocated budget → all pacingPct null", () => {
    const zeroBudgetTactics = [
      { id: "tz1", kind: "display" as const, allocatedBudgetAmount: 0 },
      { id: "tz2", kind: "sample" as const, allocatedBudgetAmount: 0 },
    ]
    const r = rollupTacticSpends(zeroBudgetTactics, [
      { tacticId: "tz1", amount: 100 },
      { tacticId: "tz2", amount: 0 },
    ])
    expect(r.every(x => x.pacingPct === null)).toBe(true)
  })

  it("ignores non-finite attributedSales but counts the spend", () => {
    const r = rollupTacticSpends(tactics, [
      { tacticId: "t1", amount: 100, attributedSalesAmount: NaN },
      { tacticId: "t1", amount: 100, attributedSalesAmount: 500 },
    ])
    const t1 = r.find(x => x.tacticId === "t1")!
    expect(t1.totalSpend).toBe(200)
    expect(t1.attributedSales).toBe(500) // only one valid number
  })
})

/* ─── scorePlanogram ──────────────────────────────────────────────────── */

const baselineSpec: PlanogramSpec = {
  facingsByProduct: { sku_a: 4, sku_b: 2 },
  requiredProducts: ["sku_a", "sku_b"],
}

describe("R4 — scorePlanogram", () => {
  it("perfect compliance → total 100 + zero penalties", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 10,
      priceTagsTotal: 10,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.osaScore).toBe(1)
    expect(r.planogramComplianceScore).toBe(1)
    expect(r.priceTagAccuracy).toBe(1)
    expect(r.totalScore).toBe(100)
    expect(r.penalties).toHaveLength(0)
  })

  it("missing required product drops OSA + emits penalty", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4 },
      productsPresent: ["sku_a"], // sku_b missing
      priceTagsCorrect: 10,
      priceTagsTotal: 10,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.osaScore).toBe(0.5)
    expect(r.penalties.some(p => p.code === "missing_required_product")).toBe(true)
  })

  it("over-facing earns no bonus (capped at 1.0 per SKU)", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 100, sku_b: 100 }, // way over
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.planogramComplianceScore).toBe(1)
  })

  it("under-facing drops compliance + emits per-SKU penalty", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 2, sku_b: 1 }, // half on both
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.planogramComplianceScore).toBe(0.5)
    expect(r.penalties.filter(p => p.code === "insufficient_facings")).toHaveLength(2)
  })

  it("share-of-shelf compares actual / expected, capped at 1.0", () => {
    const spec: PlanogramSpec = {
      ...baselineSpec,
      expectedShareOfShelf: 0.4,
    }
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
      totalShelfFacings: 20, // ours = 6/20 = 0.3, expected 0.4, score 0.75
    }
    const r = scorePlanogram({ spec, observations: obs })
    expect(r.shareOfShelfScore).toBeCloseTo(0.75, 6)
    expect(r.penalties.some(p => p.code === "share_of_shelf_below_target")).toBe(true)
  })

  it("share-of-shelf hits 1.0 when actual >= expected (no penalty)", () => {
    const spec: PlanogramSpec = { ...baselineSpec, expectedShareOfShelf: 0.2 }
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
      totalShelfFacings: 20, // ours = 0.3 > 0.2
    }
    const r = scorePlanogram({ spec, observations: obs })
    expect(r.shareOfShelfScore).toBe(1)
    expect(r.penalties.some(p => p.code === "share_of_shelf_below_target")).toBe(false)
  })

  it("share-of-shelf with expected set but totalShelfFacings missing → score 0 + penalty", () => {
    const spec: PlanogramSpec = { ...baselineSpec, expectedShareOfShelf: 0.3 }
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
      // totalShelfFacings omitted
    }
    const r = scorePlanogram({ spec, observations: obs })
    expect(r.shareOfShelfScore).toBe(0)
    expect(r.penalties.some(p => p.code === "share_of_shelf_unmeasured")).toBe(true)
  })

  it("price-tag accuracy null when no tags inspected (omitted from total)", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.priceTagAccuracy).toBeNull()
    // Total should still be 100 since OSA + planogramCompliance are
    // both 1.0 and price-tag is omitted from the weighted average.
    expect(r.totalScore).toBe(100)
  })

  it("partial price-tag accuracy emits penalty + drops total", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 7,
      priceTagsTotal: 10,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.priceTagAccuracy).toBe(0.7)
    expect(r.penalties.some(p => p.code === "price_tag_inaccurate")).toBe(true)
    // Weighted: (40+20+30) = 90 fully met, 10*0.7 = 7 → (90+7)/(40+30+10) = 97/80 = ... wait
    // Default weights: osa=40, sos=20 (null → dropped), pc=30, pta=10.
    // weightSum = 40+30+10 = 80. weighted = 40*1 + 30*1 + 10*0.7 = 77.
    // total = 77/80 * 100 = 96.25
    expect(r.totalScore).toBeCloseTo(96.25, 2)
  })

  it("custom weights override DEFAULT_SCORE_WEIGHTS", () => {
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4 }, // sku_b missing
      productsPresent: ["sku_a"],
      priceTagsCorrect: 10,
      priceTagsTotal: 10,
    }
    // Make OSA dominate: weight 100, others 0.
    const r = scorePlanogram({
      spec: baselineSpec,
      observations: obs,
      weights: { osa: 100, shareOfShelf: 0, planogramCompliance: 0, priceTagAccuracy: 0 },
    })
    // OSA = 0.5 (one of two required missing) → total 50.
    expect(r.totalScore).toBeCloseTo(50, 1)
  })

  it("empty facingsByProduct → planogramCompliance defaults to 1 (nothing to fail)", () => {
    const spec: PlanogramSpec = {
      facingsByProduct: {},
      requiredProducts: [],
    }
    const obs: AuditObservations = {
      facingsByProduct: {},
      productsPresent: [],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
    }
    const r = scorePlanogram({ spec, observations: obs })
    expect(r.planogramComplianceScore).toBe(1)
    expect(r.osaScore).toBe(1)
    expect(r.totalScore).toBe(100) // OSA + planogram both 1; SoS + tags both null
  })

  it("priceTagsCorrect > priceTagsTotal is clamped + emits inconsistency penalty", () => {
    // Defensive scorer guard — route validates this, but a future
    // internal worker could persist an out-of-bound observation.
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4, sku_b: 2 },
      productsPresent: ["sku_a", "sku_b"],
      priceTagsCorrect: 15, // > total
      priceTagsTotal: 10,
    }
    const r = scorePlanogram({ spec: baselineSpec, observations: obs })
    expect(r.priceTagAccuracy).toBe(1) // clamped to total/total
    expect(r.penalties.some(p => p.code === "price_tag_count_inconsistent")).toBe(true)
  })

  it("empty requiredProducts → osa = 1 (nothing to fail)", () => {
    const spec: PlanogramSpec = {
      facingsByProduct: { sku_a: 4 },
      requiredProducts: [],
    }
    const obs: AuditObservations = {
      facingsByProduct: { sku_a: 4 },
      productsPresent: [],
      priceTagsCorrect: 0,
      priceTagsTotal: 0,
    }
    const r = scorePlanogram({ spec, observations: obs })
    expect(r.osaScore).toBe(1)
  })

  it("DEFAULT_SCORE_WEIGHTS sum to 100", () => {
    const sum =
      DEFAULT_SCORE_WEIGHTS.osa +
      DEFAULT_SCORE_WEIGHTS.shareOfShelf +
      DEFAULT_SCORE_WEIGHTS.planogramCompliance +
      DEFAULT_SCORE_WEIGHTS.priceTagAccuracy
    expect(sum).toBe(100)
  })
})
