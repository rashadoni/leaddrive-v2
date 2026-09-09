/**
 * Tests for C9 Marketing Attribution slice 1 — 5 pure helpers + types.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  evaluateAttributionModel,
  renormalize,
} from "@/lib/marketing-attribution/attribution-model-evaluator"
import {
  aggregateByCampaign,
  totalWeight,
} from "@/lib/marketing-attribution/touchpoint-aggregator"
import {
  allocateRevenue,
  totalAttributedRevenue,
} from "@/lib/marketing-attribution/revenue-allocator"
import {
  canTransitionModelStatus,
  canTransitionRunStatus,
  isCanonicalAttributionModelType,
  isModelStatus,
  isRunStatus,
  validateModelConfig,
} from "@/lib/marketing-attribution/model-config-validator"
import {
  ATTRIBUTION_MODEL_TYPES,
  MODEL_STATUSES,
  MODEL_STATUS_TRANSITIONS,
  RUN_STATUSES,
  RUN_STATUS_TRANSITIONS,
  TOUCHPOINT_CHANNELS,
  TRIGGER_SOURCES,
  type TouchpointForAttribution,
} from "@/lib/marketing-attribution/types"

const tp = (
  id: string,
  campaign: string,
  isoDate: string,
): TouchpointForAttribution => ({
  touchpointId: id,
  campaignId: campaign,
  occurredAt: new Date(isoDate),
})

/* ─── Transition-map exhaustiveness ────────────────────────────────────── */

describe("C9 — enum + transition map exhaustiveness", () => {
  it("MODEL_STATUS_TRANSITIONS has an entry for every status", () => {
    expect(Object.keys(MODEL_STATUS_TRANSITIONS).sort()).toEqual(
      [...MODEL_STATUSES].sort(),
    )
  })
  it("RUN_STATUS_TRANSITIONS has an entry for every status", () => {
    expect(Object.keys(RUN_STATUS_TRANSITIONS).sort()).toEqual(
      [...RUN_STATUSES].sort(),
    )
  })
  it("every transition target is a known status", () => {
    for (const t of Object.values(MODEL_STATUS_TRANSITIONS).flat()) {
      expect(MODEL_STATUSES).toContain(t)
    }
    for (const t of Object.values(RUN_STATUS_TRANSITIONS).flat()) {
      expect(RUN_STATUSES).toContain(t)
    }
  })
  it("TOUCHPOINT_CHANNELS has all 8 canonical kinds", () => {
    expect(TOUCHPOINT_CHANNELS).toEqual([
      "email",
      "ad",
      "web",
      "social",
      "event",
      "sms",
      "call",
      "other",
    ])
  })
  it("ATTRIBUTION_MODEL_TYPES has all 6 kinds (incl. custom)", () => {
    expect(ATTRIBUTION_MODEL_TYPES).toEqual([
      "first_touch",
      "last_touch",
      "linear",
      "time_decay",
      "u_shaped",
      "custom",
    ])
  })
  it("TRIGGER_SOURCES has 3 kinds", () => {
    expect(TRIGGER_SOURCES).toEqual(["cron", "manual", "api"])
  })
})

/* ─── Model state machine ──────────────────────────────────────────────── */

describe("C9 — model state machine", () => {
  it("isModelStatus type guard", () => {
    expect(isModelStatus("draft")).toBe(true)
    expect(isModelStatus("xxx")).toBe(false)
    expect(isModelStatus(42)).toBe(false)
  })

  it("draft → active|archived only", () => {
    expect(canTransitionModelStatus("draft", "active")).toBe(true)
    expect(canTransitionModelStatus("draft", "archived")).toBe(true)
  })

  it("active → archived only (no return to draft)", () => {
    expect(canTransitionModelStatus("active", "archived")).toBe(true)
    expect(canTransitionModelStatus("active", "draft")).toBe(false)
  })

  it("archived terminal", () => {
    expect(canTransitionModelStatus("archived", "active")).toBe(false)
    expect(canTransitionModelStatus("archived", "draft")).toBe(false)
  })

  it("same-status no-op accepted", () => {
    expect(canTransitionModelStatus("active", "active")).toBe(true)
  })
})

/* ─── Run state machine ────────────────────────────────────────────────── */

describe("C9 — run state machine", () => {
  it("pending → running | failed", () => {
    expect(canTransitionRunStatus("pending", "running")).toBe(true)
    expect(canTransitionRunStatus("pending", "failed")).toBe(true)
    expect(canTransitionRunStatus("pending", "succeeded")).toBe(false)
  })
  it("running → succeeded | failed (not back to pending)", () => {
    expect(canTransitionRunStatus("running", "succeeded")).toBe(true)
    expect(canTransitionRunStatus("running", "failed")).toBe(true)
    expect(canTransitionRunStatus("running", "pending")).toBe(false)
  })
  it("succeeded + failed terminal", () => {
    expect(canTransitionRunStatus("succeeded", "running")).toBe(false)
    expect(canTransitionRunStatus("failed", "running")).toBe(false)
  })
  it("isRunStatus type guard", () => {
    expect(isRunStatus("pending")).toBe(true)
    expect(isRunStatus("nope")).toBe(false)
  })
  it("isCanonicalAttributionModelType type guard", () => {
    expect(isCanonicalAttributionModelType("u_shaped")).toBe(true)
    expect(isCanonicalAttributionModelType("nope")).toBe(false)
    expect(isCanonicalAttributionModelType(7)).toBe(false)
  })
})

/* ─── Config validator ─────────────────────────────────────────────────── */

describe("C9 — model-config-validator: no-knob models", () => {
  it("first_touch accepts empty config", () => {
    expect(validateModelConfig("first_touch", {}).ok).toBe(true)
  })
  it("last_touch accepts empty config", () => {
    expect(validateModelConfig("last_touch", {}).ok).toBe(true)
  })
  it("linear accepts empty config", () => {
    expect(validateModelConfig("linear", {}).ok).toBe(true)
  })
  it("rejects non-object config", () => {
    const result = validateModelConfig("linear", null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("type_mismatch")
  })
  it("rejects array config (not plain object)", () => {
    const result = validateModelConfig(
      "linear",
      [] as unknown as Record<string, unknown>,
    )
    expect(result.ok).toBe(false)
  })
})

describe("C9 — model-config-validator: time_decay", () => {
  it("accepts valid halfLifeDays", () => {
    expect(
      validateModelConfig("time_decay", { halfLifeDays: 7 }).ok,
    ).toBe(true)
  })
  it("rejects missing halfLifeDays", () => {
    const result = validateModelConfig("time_decay", {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_field")
  })
  it("rejects negative halfLifeDays", () => {
    const result = validateModelConfig("time_decay", { halfLifeDays: -1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_field_value")
  })
  it("rejects zero halfLifeDays", () => {
    const result = validateModelConfig("time_decay", { halfLifeDays: 0 })
    expect(result.ok).toBe(false)
  })
  it("rejects non-numeric halfLifeDays", () => {
    const result = validateModelConfig("time_decay", {
      halfLifeDays: "seven",
    })
    expect(result.ok).toBe(false)
  })
  it("rejects Infinity halfLifeDays", () => {
    const result = validateModelConfig("time_decay", {
      halfLifeDays: Infinity,
    })
    expect(result.ok).toBe(false)
  })
})

describe("C9 — model-config-validator: u_shaped", () => {
  it("accepts canonical 40/40/20", () => {
    expect(
      validateModelConfig("u_shaped", {
        firstWeight: 0.4,
        lastWeight: 0.4,
        middleWeight: 0.2,
      }).ok,
    ).toBe(true)
  })
  it("accepts 0.5/0.5/0 (allowed corner)", () => {
    expect(
      validateModelConfig("u_shaped", {
        firstWeight: 0.5,
        lastWeight: 0.5,
        middleWeight: 0,
      }).ok,
    ).toBe(true)
  })
  it("rejects missing firstWeight", () => {
    const result = validateModelConfig("u_shaped", {
      lastWeight: 0.5,
      middleWeight: 0.5,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("missing_field")
      expect(result.field).toBe("firstWeight")
    }
  })
  it("rejects weights that don't sum to 1.0", () => {
    const result = validateModelConfig("u_shaped", {
      firstWeight: 0.3,
      lastWeight: 0.3,
      middleWeight: 0.3,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("weights_do_not_sum")
  })
  it("rejects negative weight", () => {
    const result = validateModelConfig("u_shaped", {
      firstWeight: -0.1,
      lastWeight: 0.6,
      middleWeight: 0.5,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_field_value")
  })
  it("rejects weight > 1.0", () => {
    const result = validateModelConfig("u_shaped", {
      firstWeight: 1.5,
      lastWeight: 0,
      middleWeight: -0.5,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_field_value")
  })
  it("tolerates tiny float drift within tolerance", () => {
    // 0.1 + 0.2 ≠ 0.3 in IEEE but is within 1e-6 tolerance.
    const result = validateModelConfig("u_shaped", {
      firstWeight: 0.1,
      lastWeight: 0.2,
      middleWeight: 0.7,
    })
    expect(result.ok).toBe(true)
  })
})

describe("C9 — model-config-validator: custom", () => {
  it("accepts valid curve", () => {
    expect(
      validateModelConfig("custom", {
        curve: [
          { position: 0, weight: 0.4 },
          { position: 0.5, weight: 0.2 },
          { position: 1, weight: 0.4 },
        ],
      }).ok,
    ).toBe(true)
  })
  it("rejects empty curve array", () => {
    const result = validateModelConfig("custom", { curve: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("custom_curve_empty")
  })
  it("rejects missing curve", () => {
    const result = validateModelConfig("custom", {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_field")
  })
  it("rejects position outside [0,1]", () => {
    const result = validateModelConfig("custom", {
      curve: [{ position: 1.5, weight: 0.5 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("custom_curve_invalid")
  })
  it("rejects non-positive weight", () => {
    const result = validateModelConfig("custom", {
      curve: [{ position: 0.5, weight: 0 }],
    })
    expect(result.ok).toBe(false)
  })
})

describe("C9 — model-config-validator: unknown type", () => {
  it("rejects bogus modelType", () => {
    const result = validateModelConfig(
      "bogus" as unknown as Parameters<typeof validateModelConfig>[0],
      {},
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("unknown_model_type")
  })
})

/* ─── Attribution model evaluator ──────────────────────────────────────── */

describe("C9 — evaluator: empty input", () => {
  it("returns empty array for empty touchpoint list", () => {
    expect(
      evaluateAttributionModel({ touchpoints: [], modelType: "linear" }),
    ).toEqual([])
  })
})

describe("C9 — evaluator: first_touch", () => {
  it("100% to earliest touchpoint", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "first_touch",
    })
    expect(out.map((w) => w.weight)).toEqual([1, 0, 0])
    expect(out[0].touchpointId).toBe("a")
  })

  it("single touchpoint = 100%", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01")],
      modelType: "first_touch",
    })
    expect(out[0].weight).toBe(1)
  })

  it("re-sorts unordered input", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("b", "c2", "2026-05-03"),
        tp("a", "c1", "2026-05-01"),
        tp("c", "c3", "2026-05-02"),
      ],
      modelType: "first_touch",
    })
    // After sorting, "a" (2026-05-01) is earliest → 100%.
    const aEntry = out.find((w) => w.touchpointId === "a")
    expect(aEntry?.weight).toBe(1)
  })
})

describe("C9 — evaluator: last_touch", () => {
  it("100% to latest touchpoint", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "last_touch",
    })
    expect(out.map((w) => w.weight)).toEqual([0, 0, 1])
    expect(out[2].touchpointId).toBe("c")
  })

  it("single touchpoint = 100%", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01")],
      modelType: "last_touch",
    })
    expect(out[0].weight).toBe(1)
  })
})

describe("C9 — evaluator: linear", () => {
  it("equal split across N touchpoints", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
        tp("d", "c4", "2026-05-04"),
      ],
      modelType: "linear",
    })
    expect(out.every((w) => w.weight === 0.25)).toBe(true)
    expect(totalWeight(out)).toBeCloseTo(1, 6)
  })

  it("single touchpoint = 1.0", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01")],
      modelType: "linear",
    })
    expect(out[0].weight).toBe(1)
  })
})

describe("C9 — evaluator: time_decay", () => {
  it("conversion-time touchpoint gets max weight, older decays", () => {
    const conversionAt = new Date("2026-05-08")
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("old", "c1", "2026-05-01"), // 7 days before
        tp("mid", "c2", "2026-05-04"), // 4 days before
        tp("new", "c3", "2026-05-08"), // at conversion
      ],
      modelType: "time_decay",
      config: { modelType: "time_decay", halfLifeDays: 7 },
      conversionAt,
    })
    // Newest must have highest weight.
    expect(out[2].weight).toBeGreaterThan(out[1].weight)
    expect(out[1].weight).toBeGreaterThan(out[0].weight)
    // Sum to 1.0 after renormalization.
    expect(totalWeight(out)).toBeCloseTo(1, 6)
  })

  it("uses latest touchpoint as conversion ref if none supplied", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("old", "c1", "2026-05-01"),
        tp("new", "c2", "2026-05-08"),
      ],
      modelType: "time_decay",
      config: { modelType: "time_decay", halfLifeDays: 7 },
    })
    expect(out[1].weight).toBeGreaterThan(out[0].weight)
  })

  it("uses default halfLife if config missing", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-08"),
      ],
      modelType: "time_decay",
    })
    expect(totalWeight(out)).toBeCloseTo(1, 6)
  })

  it("at exactly halfLifeDays old, weight ≈ 0.5 × newest's raw", () => {
    const conversionAt = new Date("2026-05-08")
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("old", "c1", "2026-05-01"), // 7 days = 1 half-life
        tp("new", "c2", "2026-05-08"),
      ],
      modelType: "time_decay",
      config: { modelType: "time_decay", halfLifeDays: 7 },
      conversionAt,
    })
    // Raw weights: old=0.5, new=1.0 → normalized old=1/3, new=2/3.
    expect(out[0].weight).toBeCloseTo(1 / 3, 5)
    expect(out[1].weight).toBeCloseTo(2 / 3, 5)
  })
})

describe("C9 — evaluator: u_shaped", () => {
  it("3+ touchpoints: first + last + middle distributed", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
        tp("d", "c4", "2026-05-04"),
      ],
      modelType: "u_shaped",
      config: {
        modelType: "u_shaped",
        firstWeight: 0.4,
        lastWeight: 0.4,
        middleWeight: 0.2,
      },
    })
    expect(out[0].weight).toBeCloseTo(0.4, 6)
    expect(out[3].weight).toBeCloseTo(0.4, 6)
    // 0.2 split between 2 middle touchpoints = 0.1 each.
    expect(out[1].weight).toBeCloseTo(0.1, 6)
    expect(out[2].weight).toBeCloseTo(0.1, 6)
    expect(totalWeight(out)).toBeCloseTo(1, 6)
  })

  it("single touchpoint = 100%", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01")],
      modelType: "u_shaped",
    })
    expect(out[0].weight).toBe(1)
  })

  it("two touchpoints: first + last renormalized", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
      ],
      modelType: "u_shaped",
      config: {
        modelType: "u_shaped",
        firstWeight: 0.4,
        lastWeight: 0.4,
        middleWeight: 0.2,
      },
    })
    // 0.4/0.4 → 0.5/0.5 after renormalizing.
    expect(out[0].weight).toBeCloseTo(0.5, 6)
    expect(out[1].weight).toBeCloseTo(0.5, 6)
  })

  it("uses default 40/40/20 when config absent", () => {
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "u_shaped",
    })
    expect(out[0].weight).toBeCloseTo(0.4, 6)
    expect(out[2].weight).toBeCloseTo(0.4, 6)
    expect(out[1].weight).toBeCloseTo(0.2, 6)
  })
})

describe("C9 — evaluator: custom curve (#13)", () => {
  const customCfg = (curve: { position: number; weight: number }[]) =>
    ({ modelType: "custom" as const, curve })

  it("interpolates a rising curve across touchpoint positions, renormalized", () => {
    // 3 touchpoints sit at positions 0, 0.5, 1. Curve rises 1→3 linearly, so
    // raw weights = [1, 2, 3] → renormalized to /6.
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "custom",
      config: customCfg([
        { position: 0, weight: 1 },
        { position: 1, weight: 3 },
      ]),
    })
    expect(out[0].weight).toBeCloseTo(1 / 6, 6)
    expect(out[1].weight).toBeCloseTo(2 / 6, 6)
    expect(out[2].weight).toBeCloseTo(3 / 6, 6)
    expect(out.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 6)
  })

  it("clamps to endpoint weights outside the curve's position range", () => {
    // Curve only defined on [0.3, 0.7]. Positions 0, 0.5, 1 → 2, 3, 4 (left
    // clamp 2, midpoint interp 3, right clamp 4) → renormalized /9.
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "custom",
      config: customCfg([
        { position: 0.3, weight: 2 },
        { position: 0.7, weight: 4 },
      ]),
    })
    expect(out[0].weight).toBeCloseTo(2 / 9, 6)
    expect(out[1].weight).toBeCloseTo(3 / 9, 6)
    expect(out[2].weight).toBeCloseTo(4 / 9, 6)
  })

  it("single touchpoint gets all the credit", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01")],
      modelType: "custom",
      config: customCfg([{ position: 0, weight: 0.2 }, { position: 1, weight: 5 }]),
    })
    expect(out).toHaveLength(1)
    expect(out[0].weight).toBe(1)
  })

  it("falls back to linear when the curve is absent (defensive)", () => {
    const out = evaluateAttributionModel({
      touchpoints: [tp("a", "c1", "2026-05-01"), tp("b", "c2", "2026-05-02")],
      modelType: "custom",
    })
    expect(out.every((w) => w.weight === 0.5)).toBe(true)
  })

  it("handles duplicate curve positions without crashing (weights stay valid)", () => {
    // The validator allows coincident positions; interpolateCurve must not
    // produce NaN/negative weights and the output must still renormalize to 1.
    const out = evaluateAttributionModel({
      touchpoints: [
        tp("a", "c1", "2026-05-01"),
        tp("b", "c2", "2026-05-02"),
        tp("c", "c3", "2026-05-03"),
      ],
      modelType: "custom",
      config: customCfg([
        { position: 0, weight: 1 },
        { position: 0.5, weight: 2 },
        { position: 0.5, weight: 8 },
        { position: 1, weight: 1 },
      ]),
    })
    expect(out.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 6)
    expect(out.every((w) => Number.isFinite(w.weight) && w.weight >= 0)).toBe(true)
  })
})

describe("C9 — renormalize", () => {
  it("scales raw weights so total = 1.0", () => {
    const out = renormalize(
      [tp("a", "c1", "2026-05-01"), tp("b", "c2", "2026-05-02")],
      [2, 3],
    )
    expect(out[0].weight).toBeCloseTo(0.4, 6)
    expect(out[1].weight).toBeCloseTo(0.6, 6)
  })
  it("zero-total falls back to even split", () => {
    const out = renormalize(
      [tp("a", "c1", "2026-05-01"), tp("b", "c2", "2026-05-02")],
      [0, 0],
    )
    expect(out[0].weight).toBe(0.5)
    expect(out[1].weight).toBe(0.5)
  })
})

/* ─── Touchpoint aggregator ────────────────────────────────────────────── */

describe("C9 — aggregator", () => {
  it("collapses touchpoints by campaignId", () => {
    const out = aggregateByCampaign([
      { touchpointId: "a", campaignId: "c1", weight: 0.4 },
      { touchpointId: "b", campaignId: "c1", weight: 0.3 },
      { touchpointId: "c", campaignId: "c2", weight: 0.3 },
    ])
    expect(out).toHaveLength(2)
    const c1 = out.find((i) => i.campaignId === "c1")!
    expect(c1.weight).toBeCloseTo(0.7, 6)
    expect(c1.touchpointCount).toBe(2)
    const c2 = out.find((i) => i.campaignId === "c2")!
    expect(c2.touchpointCount).toBe(1)
  })

  it("returns empty array for empty input", () => {
    expect(aggregateByCampaign([])).toEqual([])
  })

  it("omits campaigns with 0 net weight", () => {
    const out = aggregateByCampaign([
      { touchpointId: "a", campaignId: "c1", weight: 1 },
      { touchpointId: "b", campaignId: "c2", weight: 0 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].campaignId).toBe("c1")
  })

  it("sorts by weight DESC", () => {
    const out = aggregateByCampaign([
      { touchpointId: "x", campaignId: "small", weight: 0.1 },
      { touchpointId: "y", campaignId: "big", weight: 0.9 },
    ])
    expect(out[0].campaignId).toBe("big")
    expect(out[1].campaignId).toBe("small")
  })

  it("breaks weight ties by campaignId ASC (stable)", () => {
    const out = aggregateByCampaign([
      { touchpointId: "a", campaignId: "zebra", weight: 0.5 },
      { touchpointId: "b", campaignId: "alpha", weight: 0.5 },
    ])
    expect(out[0].campaignId).toBe("alpha")
    expect(out[1].campaignId).toBe("zebra")
  })

  it("totalWeight sums to ~1 on full attribution", () => {
    const aggregated = aggregateByCampaign([
      { touchpointId: "a", campaignId: "c1", weight: 0.4 },
      { touchpointId: "b", campaignId: "c2", weight: 0.6 },
    ])
    expect(totalWeight(aggregated)).toBeCloseTo(1, 6)
  })
})

/* ─── Revenue allocator ────────────────────────────────────────────────── */

describe("C9 — revenue-allocator", () => {
  it("multiplies each weight by dealAmount", () => {
    const out = allocateRevenue({
      dealAmount: 10_000,
      influences: [
        { campaignId: "c1", weight: 0.4, touchpointCount: 2 },
        { campaignId: "c2", weight: 0.6, touchpointCount: 3 },
      ],
    })
    expect(out[0].attributedRevenue).toBeCloseTo(4000, 6)
    expect(out[1].attributedRevenue).toBeCloseTo(6000, 6)
  })

  it("preserves campaignId + touchpointCount", () => {
    const out = allocateRevenue({
      dealAmount: 1000,
      influences: [{ campaignId: "c1", weight: 1, touchpointCount: 5 }],
    })
    expect(out[0].campaignId).toBe("c1")
    expect(out[0].touchpointCount).toBe(5)
    expect(out[0].weight).toBe(1)
  })

  it("clamps negative dealAmount to 0", () => {
    const out = allocateRevenue({
      dealAmount: -500,
      influences: [{ campaignId: "c1", weight: 1, touchpointCount: 1 }],
    })
    expect(out[0].attributedRevenue).toBe(0)
  })

  it("clamps NaN dealAmount to 0", () => {
    const out = allocateRevenue({
      dealAmount: Number.NaN,
      influences: [{ campaignId: "c1", weight: 1, touchpointCount: 1 }],
    })
    expect(out[0].attributedRevenue).toBe(0)
  })

  it("clamps Infinity dealAmount to 0", () => {
    const out = allocateRevenue({
      dealAmount: Infinity,
      influences: [{ campaignId: "c1", weight: 1, touchpointCount: 1 }],
    })
    expect(out[0].attributedRevenue).toBe(0)
  })

  it("empty influences → empty result", () => {
    expect(allocateRevenue({ dealAmount: 1000, influences: [] })).toEqual([])
  })

  it("totalAttributedRevenue ≈ dealAmount when weights sum to 1.0", () => {
    const allocated = allocateRevenue({
      dealAmount: 5000,
      influences: [
        { campaignId: "c1", weight: 0.3, touchpointCount: 1 },
        { campaignId: "c2", weight: 0.7, touchpointCount: 1 },
      ],
    })
    expect(totalAttributedRevenue(allocated)).toBeCloseTo(5000, 6)
  })

  it("zero dealAmount produces zero revenue per campaign", () => {
    const out = allocateRevenue({
      dealAmount: 0,
      influences: [{ campaignId: "c1", weight: 1, touchpointCount: 1 }],
    })
    expect(out[0].attributedRevenue).toBe(0)
  })
})

/* ─── #11 Decimal-exact apportionment ──────────────────────────────────── */

describe("C9 — revenue-allocator: Decimal-exact apportionment (#11)", () => {
  // attributedRevenue lives on a Decimal(18,4) grid; compare on integer
  // grid-units (ten-thousandths) so float-sum representation error never
  // masquerades as a penny leak.
  const GRID = 10_000
  const gu = (x: number) => Math.round(x * GRID)
  const sumUnits = (rows: { attributedRevenue: number }[]) =>
    rows.reduce((s, r) => s + gu(r.attributedRevenue), 0)

  it("3-way split of $100 sums to EXACTLY $100 (no penny lost)", () => {
    const out = allocateRevenue({
      dealAmount: 100,
      influences: [
        { campaignId: "c1", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "c2", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "c3", weight: 1 / 3, touchpointCount: 1 },
      ],
    })
    // Pre-#11 this stored 33.3333 ×3 = 99.9999. Now it sums to 100.0000.
    expect(sumUnits(out)).toBe(gu(100))
    const cents = out.map((r) => r.attributedRevenue).sort((a, b) => a - b)
    expect(cents).toEqual([33.3333, 33.3333, 33.3334])
  })

  it("every output value sits on the 4-decimal grid", () => {
    const out = allocateRevenue({
      dealAmount: 1_234.5678,
      influences: [
        { campaignId: "a", weight: 0.5, touchpointCount: 2 },
        { campaignId: "b", weight: 0.3, touchpointCount: 1 },
        { campaignId: "c", weight: 0.2, touchpointCount: 1 },
      ],
    })
    for (const r of out) {
      expect(Number.isInteger(gu(r.attributedRevenue))).toBe(true)
    }
    expect(sumUnits(out)).toBe(gu(1_234.5678))
  })

  it("hands the leftover unit to the largest remainder, ties by campaignId", () => {
    // $100 / 3 equal weights → each ideal = 333333.33 grid-units, floor 333333,
    // remainder 0.33 each (tie). Leftover = 1 → goes to the lexicographically
    // first campaignId ("c1").
    const out = allocateRevenue({
      dealAmount: 100,
      influences: [
        { campaignId: "c3", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "c1", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "c2", weight: 1 / 3, touchpointCount: 1 },
      ],
    })
    const byId = Object.fromEntries(out.map((r) => [r.campaignId, r.attributedRevenue]))
    expect(byId.c1).toBe(33.3334) // tie-break winner
    expect(byId.c2).toBe(33.3333)
    expect(byId.c3).toBe(33.3333)
  })

  it("is deterministic — identical inputs, identical output", () => {
    const input = {
      dealAmount: 777.77,
      influences: [
        { campaignId: "z", weight: 0.41, touchpointCount: 3 },
        { campaignId: "a", weight: 0.59, touchpointCount: 4 },
      ],
    }
    expect(allocateRevenue(input)).toEqual(allocateRevenue(input))
  })

  it("single campaign at weight 1.0 gets the whole (grid-rounded) amount", () => {
    const out = allocateRevenue({
      dealAmount: 4_999.9999,
      influences: [{ campaignId: "solo", weight: 1, touchpointCount: 7 }],
    })
    expect(out[0].attributedRevenue).toBe(4_999.9999)
  })

  it("zero-weight campaigns receive exactly 0, never a stray leftover unit", () => {
    const out = allocateRevenue({
      dealAmount: 1_000,
      influences: [
        { campaignId: "live", weight: 1, touchpointCount: 2 },
        { campaignId: "dead", weight: 0, touchpointCount: 0 },
      ],
    })
    const byId = Object.fromEntries(out.map((r) => [r.campaignId, r.attributedRevenue]))
    expect(byId.dead).toBe(0)
    expect(byId.live).toBe(1_000)
  })

  // Regression — adversarial #11 fuzz workflow found that the old
  // `leftover = Math.round(Σ frac)` dropped a unit at x.4999… and invented one
  // at x.5. The integer-difference leftover must never drift in either way.
  it("regression: x.4999 boundary (1/3 weights) does NOT drop a grid-unit", () => {
    const out = allocateRevenue({
      dealAmount: 0.00185, // *10000 = 18.5 → target 19 grid-units
      influences: [
        { campaignId: "000", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "001", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "002", weight: 1 / 3, touchpointCount: 1 },
      ],
    })
    expect(sumUnits(out)).toBe(Math.round(0.00185 * GRID)) // exact, was 18
  })

  it("regression: x.5 boundary (1/3 weights) does NOT invent a grid-unit", () => {
    const out = allocateRevenue({
      dealAmount: 0.00565, // *10000 = 56.5 → target 57 grid-units
      influences: [
        { campaignId: "000", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "001", weight: 1 / 3, touchpointCount: 1 },
        { campaignId: "002", weight: 1 / 3, touchpointCount: 1 },
      ],
    })
    const target = Math.round(0.00565 * GRID)
    expect(sumUnits(out)).toBe(target) // exact, was 57 vs target; no over-allocation
    expect(sumUnits(out)).toBeLessThanOrEqual(target)
  })

  it("large $1B-scale deal stays grid-exact (upper precision bound)", () => {
    const out = allocateRevenue({
      dealAmount: 999_999_999.9999, // max-ish storable, *10000 ≈ 1e13 < 2^53
      influences: [
        { campaignId: "a", weight: 0.3333, touchpointCount: 1 },
        { campaignId: "b", weight: 0.3333, touchpointCount: 1 },
        { campaignId: "c", weight: 0.3334, touchpointCount: 1 },
      ],
    })
    expect(sumUnits(out)).toBe(Math.round(999_999_999.9999 * GRID))
  })

  // Note: the negative-leftover claw-back in allocateRevenue defends I5 (no
  // over-allocation) at extreme magnitudes (totalUnits near 2^53, ≈$800B+,
  // unreachable via the 1e9 create cap). It is NOT unit-tested here because the
  // function returns numbers and 0.0001 is not representable in float — above
  // ~$1B the units/GRID round-trip drifts by ±1-2, so gu() can no longer
  // observe exactness through the public API (this IS the documented precision
  // bound). The clamp's correctness was verified at the integer level by the
  // #11 adversarial fuzz workflow + architect reproduction, not a unit test.

  it("fuzz: weights summing to 1.0 always sum to dealAmount on the grid", () => {
    // Seeded PRNG → reproducible failures.
    let seed = 0x9e3779b9
    const rng = () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // Magnitude buckets — exercise the 2^53 headroom and sub-grid amounts.
    const MAGS = [1, 100, 1e4, 1e6, 1e9]
    for (let iter = 0; iter < 8_000; iter++) {
      const n = 1 + Math.floor(rng() * 8)
      // Half equal weights (the boundary case the workflow caught), half random.
      const influences =
        rng() < 0.5
          ? Array.from({ length: n }, (_, i) => ({
              campaignId: `c${i}`,
              weight: 1 / n,
              touchpointCount: 1,
            }))
          : (() => {
              const raw = Array.from({ length: n }, () => rng() + 1e-9)
              const total = raw.reduce((s, x) => s + x, 0)
              return raw.map((x, i) => ({
                campaignId: `c${i}`,
                weight: x / total, // normalize → Σ weight = 1.0
                touchpointCount: 1,
              }))
            })()
      // Mix grid-snapped and deliberately off-grid (5-decimal) amounts.
      const mag = MAGS[Math.floor(rng() * MAGS.length)]
      const offGrid = rng() < 0.5
      const dealAmount = offGrid
        ? Math.round(rng() * mag * 1e5) / 1e5 // 5 decimals → off the 4dp grid
        : Math.round(rng() * mag * GRID) / GRID
      const target = Math.round(dealAmount * GRID)
      const out = allocateRevenue({ dealAmount, influences })
      expect(sumUnits(out)).toBe(target) // I1: EXACT, no drift either way
      expect(sumUnits(out)).toBeLessThanOrEqual(target) // I5: never over-allocate
      for (const r of out) expect(r.attributedRevenue).toBeGreaterThanOrEqual(0)
    }
  })
})

/* ─── End-to-end pipeline sanity ───────────────────────────────────────── */

describe("C9 — end-to-end pipeline (evaluator → aggregator → allocator)", () => {
  it("u_shaped on 3 campaigns × 5 touchpoints flows through correctly", () => {
    const touchpoints = [
      tp("t1", "fb_ads", "2026-05-01"),
      tp("t2", "email", "2026-05-02"),
      tp("t3", "google_ads", "2026-05-03"),
      tp("t4", "email", "2026-05-04"),
      tp("t5", "google_ads", "2026-05-05"),
    ]
    const perTpWeights = evaluateAttributionModel({
      touchpoints,
      modelType: "u_shaped",
      config: {
        modelType: "u_shaped",
        firstWeight: 0.4,
        lastWeight: 0.4,
        middleWeight: 0.2,
      },
    })
    // First (fb_ads) = 0.4, last (google_ads) = 0.4, three middle = 0.2/3.
    expect(perTpWeights[0].weight).toBeCloseTo(0.4, 6)
    expect(perTpWeights[4].weight).toBeCloseTo(0.4, 6)

    const aggregated = aggregateByCampaign(perTpWeights)
    // Campaigns: fb_ads (0.4), email (2 × 0.2/3), google_ads (0.2/3 + 0.4)
    const fbAds = aggregated.find((a) => a.campaignId === "fb_ads")!
    const email = aggregated.find((a) => a.campaignId === "email")!
    const googleAds = aggregated.find((a) => a.campaignId === "google_ads")!
    expect(fbAds.weight).toBeCloseTo(0.4, 6)
    expect(email.weight).toBeCloseTo((2 * 0.2) / 3, 6)
    expect(googleAds.weight).toBeCloseTo(0.2 / 3 + 0.4, 6)
    expect(totalWeight(aggregated)).toBeCloseTo(1, 6)

    const allocated = allocateRevenue({
      dealAmount: 30_000,
      influences: aggregated,
    })
    expect(totalAttributedRevenue(allocated)).toBeCloseTo(30_000, 4)
  })

  it("linear on 4 touchpoints from 2 campaigns → 50/50 by count", () => {
    const touchpoints = [
      tp("a", "c1", "2026-05-01"),
      tp("b", "c2", "2026-05-02"),
      tp("c", "c1", "2026-05-03"),
      tp("d", "c2", "2026-05-04"),
    ]
    const perTp = evaluateAttributionModel({
      touchpoints,
      modelType: "linear",
    })
    const agg = aggregateByCampaign(perTp)
    const c1 = agg.find((a) => a.campaignId === "c1")!
    const c2 = agg.find((a) => a.campaignId === "c2")!
    expect(c1.weight).toBeCloseTo(0.5, 6)
    expect(c2.weight).toBeCloseTo(0.5, 6)
    expect(c1.touchpointCount).toBe(2)
    expect(c2.touchpointCount).toBe(2)
  })

  it("first_touch → only the earliest campaign gets credit", () => {
    const touchpoints = [
      tp("a", "c1", "2026-05-01"),
      tp("b", "c2", "2026-05-02"),
      tp("c", "c3", "2026-05-03"),
    ]
    const perTp = evaluateAttributionModel({
      touchpoints,
      modelType: "first_touch",
    })
    const agg = aggregateByCampaign(perTp)
    expect(agg).toHaveLength(1)
    expect(agg[0].campaignId).toBe("c1")
    expect(agg[0].weight).toBe(1)
  })
})
