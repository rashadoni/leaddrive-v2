/**
 * Tests for H3 Einstein Prediction Builder slice 1 —
 * feature extraction + logistic-regression trainer + scorer + engine.
 * Pure functional: no DB, no LLM, deterministic synthetic data.
 */
import { describe, it, expect } from "vitest"
import {
  buildFeatureVector,
  featureNamesFor,
  labelFor,
} from "@/lib/ml/prediction/features"
import { trainLogisticRegression } from "@/lib/ml/prediction/trainer"
import { bandFromScore, scoreFeatures } from "@/lib/ml/prediction/scorer"
import {
  parseFieldSpecs,
  scoreRecord,
  trainPredictionModel,
} from "@/lib/ml/prediction/engine"
import type { FieldSpec, PredictionArtifact } from "@/lib/ml/prediction/types"

/* ─── featureNamesFor ─────────────────────────────────────────────────── */

describe("H3 — featureNamesFor", () => {
  it("emits one column per numeric field", () => {
    const names = featureNamesFor([{ field: "amount", kind: "numeric" }])
    expect(names).toEqual(["amount"])
  })

  it("emits N+1 columns per categorical field (one-hot + __other__)", () => {
    const names = featureNamesFor([
      { field: "source", kind: "categorical", oneHotValues: ["web", "referral"] },
    ])
    expect(names).toEqual(["source=web", "source=referral", "source=__other__"])
  })

  it("preserves spec order across mixed kinds", () => {
    const names = featureNamesFor([
      { field: "amount", kind: "numeric" },
      { field: "source", kind: "categorical", oneHotValues: ["web"] },
      { field: "score", kind: "numeric" },
    ])
    expect(names).toEqual(["amount", "source=web", "source=__other__", "score"])
  })
})

/* ─── buildFeatureVector ──────────────────────────────────────────────── */

describe("H3 — buildFeatureVector", () => {
  it("coerces numeric strings", () => {
    const v = buildFeatureVector({ amount: "12000" }, [{ field: "amount", kind: "numeric" }])
    expect(v).toEqual([12000])
  })

  it("collapses NaN/Infinity to 0", () => {
    const v = buildFeatureVector(
      { a: NaN, b: Infinity, c: -Infinity, d: null },
      [
        { field: "a", kind: "numeric" },
        { field: "b", kind: "numeric" },
        { field: "c", kind: "numeric" },
        { field: "d", kind: "numeric" },
      ]
    )
    expect(v).toEqual([0, 0, 0, 0])
  })

  it("one-hot encodes a known categorical value", () => {
    const spec: FieldSpec = { field: "src", kind: "categorical", oneHotValues: ["web", "ref"] }
    const v = buildFeatureVector({ src: "ref" }, [spec])
    expect(v).toEqual([0, 1, 0]) // web=0, ref=1, __other__=0
  })

  it("routes unknown categorical values into __other__ bucket", () => {
    const spec: FieldSpec = { field: "src", kind: "categorical", oneHotValues: ["web", "ref"] }
    const v = buildFeatureVector({ src: "tiktok" }, [spec])
    expect(v).toEqual([0, 0, 1])
  })

  it("missing categorical value falls into __other__", () => {
    const spec: FieldSpec = { field: "src", kind: "categorical", oneHotValues: ["web"] }
    const v = buildFeatureVector({}, [spec])
    expect(v).toEqual([0, 1])
  })
})

/* ─── labelFor ────────────────────────────────────────────────────────── */

describe("H3 — labelFor", () => {
  it("returns 1 when target field value is in positiveValues set", () => {
    expect(labelFor({ stage: "won" }, "stage", ["won", "closed_won"])).toBe(1)
    expect(labelFor({ stage: "closed_won" }, "stage", ["won", "closed_won"])).toBe(1)
  })

  it("returns 0 otherwise", () => {
    expect(labelFor({ stage: "lost" }, "stage", ["won"])).toBe(0)
    expect(labelFor({ stage: null }, "stage", ["won"])).toBe(0)
    expect(labelFor({}, "stage", ["won"])).toBe(0)
  })
})

/* ─── trainLogisticRegression ─────────────────────────────────────────── */

describe("H3 — trainLogisticRegression", () => {
  it("throws on too-small training set", () => {
    expect(() =>
      trainLogisticRegression({
        featureNames: ["x"],
        samples: [{ features: [1], label: 1 }],
      })
    ).toThrow(/at least 10/i)
  })

  it("throws on empty feature spec", () => {
    expect(() =>
      trainLogisticRegression({
        featureNames: [],
        samples: Array.from({ length: 10 }, () => ({ features: [] as number[], label: 0 as const })),
      })
    ).toThrow(/Feature spec is empty/)
  })

  it("throws on single-class training set", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({
      features: [i],
      label: 1 as const,
    }))
    expect(() => trainLogisticRegression({ featureNames: ["x"], samples })).toThrow(
      /one class/i
    )
  })

  it("throws on dimension mismatch", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({
      features: [i, i + 1],
      label: (i % 2) as 0 | 1,
    }))
    expect(() =>
      trainLogisticRegression({ featureNames: ["x"], samples })
    ).toThrow(/does not match spec dimension/)
  })

  it("converges on linearly-separable data and achieves >= 0.9 accuracy", () => {
    // y = 1 iff x > 0. Trivial separator — logistic regression should crush it.
    const samples = [
      { features: [-3], label: 0 as const },
      { features: [-2.5], label: 0 as const },
      { features: [-2], label: 0 as const },
      { features: [-1.5], label: 0 as const },
      { features: [-1], label: 0 as const },
      { features: [-0.5], label: 0 as const },
      { features: [0.5], label: 1 as const },
      { features: [1], label: 1 as const },
      { features: [1.5], label: 1 as const },
      { features: [2], label: 1 as const },
      { features: [2.5], label: 1 as const },
      { features: [3], label: 1 as const },
    ]
    const artifact = trainLogisticRegression({ featureNames: ["x"], samples })
    expect(artifact.accuracy).toBeGreaterThanOrEqual(0.9)
    // Positive weight on x (positive class lives at positive x).
    expect(artifact.weights[0]).toBeGreaterThan(0)
  })

  it("deterministic — same input → identical artifact", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      features: [i - 10, (i - 10) ** 2],
      label: (i >= 10 ? 1 : 0) as 0 | 1,
    }))
    const a = trainLogisticRegression({ featureNames: ["x", "x2"], samples })
    const b = trainLogisticRegression({ featureNames: ["x", "x2"], samples })
    expect(a.weights).toEqual(b.weights)
    expect(a.bias).toEqual(b.bias)
    expect(a.accuracy).toEqual(b.accuracy)
  })

  it("stronger L2 shrinks weights toward zero", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      features: [i - 10],
      label: (i >= 10 ? 1 : 0) as 0 | 1,
    }))
    const weakL2 = trainLogisticRegression({
      featureNames: ["x"],
      samples,
      options: { l2: 0.001 },
    })
    const strongL2 = trainLogisticRegression({
      featureNames: ["x"],
      samples,
      options: { l2: 10 },
    })
    expect(Math.abs(strongL2.weights[0])).toBeLessThan(Math.abs(weakL2.weights[0]))
  })

  it("artifact preserves featureNames in order", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({
      features: [i, i * 0.5],
      label: (i % 2) as 0 | 1,
    }))
    const a = trainLogisticRegression({ featureNames: ["alpha", "beta"], samples })
    expect(a.featureNames).toEqual(["alpha", "beta"])
  })

  it("reports sampleCount + positiveCount", () => {
    const samples = [
      ...Array.from({ length: 7 }, () => ({ features: [0], label: 0 as const })),
      ...Array.from({ length: 5 }, () => ({ features: [1], label: 1 as const })),
    ]
    const a = trainLogisticRegression({ featureNames: ["x"], samples })
    expect(a.sampleCount).toBe(12)
    expect(a.positiveCount).toBe(5)
  })
})

/* ─── scoreFeatures + bandFromScore ───────────────────────────────────── */

describe("H3 — scoreFeatures", () => {
  it("returns 0.5 at bias=0 + zero features", () => {
    const a: PredictionArtifact = {
      algorithm: "logreg-v1",
      featureNames: ["x"],
      means: [0],
      stds: [1],
      weights: [0],
      bias: 0,
      sampleCount: 10,
      positiveCount: 5,
      accuracy: 0.5,
      trainedAt: new Date().toISOString(),
    }
    expect(scoreFeatures(a, [0])).toBeCloseTo(0.5, 5)
  })

  it("monotonic — increasing linear combo increases probability", () => {
    const a: PredictionArtifact = {
      algorithm: "logreg-v1",
      featureNames: ["x"],
      means: [0],
      stds: [1],
      weights: [1],
      bias: 0,
      sampleCount: 10,
      positiveCount: 5,
      accuracy: 0.5,
      trainedAt: new Date().toISOString(),
    }
    const low = scoreFeatures(a, [-5])
    const mid = scoreFeatures(a, [0])
    const high = scoreFeatures(a, [5])
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
  })

  it("throws on dim mismatch", () => {
    const a: PredictionArtifact = {
      algorithm: "logreg-v1",
      featureNames: ["x"],
      means: [0],
      stds: [1],
      weights: [1],
      bias: 0,
      sampleCount: 10,
      positiveCount: 5,
      accuracy: 0.5,
      trainedAt: new Date().toISOString(),
    }
    expect(() => scoreFeatures(a, [1, 2])).toThrow(/does not match artifact weights/)
  })

  it("throws on unknown algorithm", () => {
    const a = {
      algorithm: "logreg-v999",
      featureNames: ["x"],
      means: [0],
      stds: [1],
      weights: [1],
      bias: 0,
      sampleCount: 10,
      positiveCount: 5,
      accuracy: 0.5,
      trainedAt: new Date().toISOString(),
    } as unknown as PredictionArtifact
    expect(() => scoreFeatures(a, [1])).toThrow(/Unsupported algorithm/)
  })
})

describe("H3 — bandFromScore", () => {
  it.each([
    [0.95, "very_likely"],
    [0.8, "very_likely"],
    [0.79, "likely"],
    [0.6, "likely"],
    [0.59, "uncertain"],
    [0.4, "uncertain"],
    [0.39, "unlikely"],
    [0.2, "unlikely"],
    [0.19, "very_unlikely"],
    [0, "very_unlikely"],
  ])("score %s → %s", (score, band) => {
    expect(bandFromScore(score)).toBe(band)
  })

  it("non-finite score → uncertain (defensive)", () => {
    expect(bandFromScore(NaN)).toBe("uncertain")
    expect(bandFromScore(Infinity)).toBe("uncertain")
  })
})

/* ─── engine: trainPredictionModel + scoreRecord ──────────────────────── */

describe("H3 — trainPredictionModel end-to-end", () => {
  it("trains on Deal-shaped records and scores a new record with sensible confidence", () => {
    const specs: FieldSpec[] = [
      { field: "valueAmount", kind: "numeric" },
      { field: "probability", kind: "numeric" },
      { field: "salesChannel", kind: "categorical", oneHotValues: ["direct", "partner", "self_serve"] },
    ]
    // Won deals: high amount, high probability, direct channel.
    // Lost deals: low amount, low probability, self-serve.
    const records = [
      // Wins
      ...Array.from({ length: 15 }, (_, i) => ({
        stage: "won",
        valueAmount: 50000 + i * 1000,
        probability: 80 + (i % 10),
        salesChannel: i % 2 === 0 ? "direct" : "partner",
      })),
      // Losses
      ...Array.from({ length: 15 }, (_, i) => ({
        stage: "lost",
        valueAmount: 1000 + i * 100,
        probability: 5 + (i % 5),
        salesChannel: i % 2 === 0 ? "self_serve" : "partner",
      })),
    ]
    const artifact = trainPredictionModel({
      specs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    expect(artifact.algorithm).toBe("logreg-v1")
    expect(artifact.sampleCount).toBe(30)
    expect(artifact.positiveCount).toBe(15)
    expect(artifact.accuracy).toBeGreaterThanOrEqual(0.85)

    // A new "win-like" record should land in the upper bands.
    const winLike = scoreRecord({
      artifact,
      specs,
      record: { valueAmount: 75000, probability: 90, salesChannel: "direct" },
    })
    expect(winLike.score).toBeGreaterThan(0.5)
    expect(["very_likely", "likely"]).toContain(winLike.band)

    // A new "loss-like" record should land in the lower bands.
    const lossLike = scoreRecord({
      artifact,
      specs,
      record: { valueAmount: 500, probability: 2, salesChannel: "self_serve" },
    })
    expect(lossLike.score).toBeLessThan(0.5)
    expect(["unlikely", "very_unlikely"]).toContain(lossLike.band)
  })
})

describe("H3 — engine attaches standardisation stats", () => {
  it("artifact.means/stds reflect training data", () => {
    const specs: FieldSpec[] = [
      { field: "amount", kind: "numeric" },
      { field: "score", kind: "numeric" },
    ]
    // amount mean ~ 1000, score mean ~ 50 — very different scales.
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "won", amount: 1000 + i, score: 50 + i })),
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "lost", amount: 1000 + i, score: 50 + i })),
    ]
    const artifact = trainPredictionModel({
      specs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    expect(artifact.means).toHaveLength(2)
    expect(artifact.stds).toHaveLength(2)
    expect(artifact.means[0]).toBeCloseTo(1004.5, 1)
    expect(artifact.means[1]).toBeCloseTo(54.5, 1)
    expect(artifact.stds[0]).toBeGreaterThan(0)
    expect(artifact.stds[1]).toBeGreaterThan(0)
  })

  it("constant feature column gets std=1 (no div-by-zero)", () => {
    const specs: FieldSpec[] = [
      { field: "constant", kind: "numeric" },
      { field: "varying", kind: "numeric" },
    ]
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "won", constant: 42, varying: i })),
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "lost", constant: 42, varying: -i })),
    ]
    const artifact = trainPredictionModel({
      specs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    expect(artifact.stds[0]).toBe(1)
    expect(artifact.stds[1]).toBeGreaterThan(0)
  })
})

describe("H3 — scoreRecord feature-spec drift detection", () => {
  it("throws when current spec dim differs from trained artifact", () => {
    const trainedSpecs: FieldSpec[] = [
      { field: "a", kind: "numeric" },
      { field: "b", kind: "numeric" },
    ]
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "won", a: i, b: i })),
      ...Array.from({ length: 10 }, (_, i) => ({ stage: "lost", a: -i, b: -i })),
    ]
    const artifact = trainPredictionModel({
      specs: trainedSpecs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    // User edits spec — drops "b".
    const editedSpecs: FieldSpec[] = [{ field: "a", kind: "numeric" }]
    expect(() => scoreRecord({ artifact, specs: editedSpecs, record: { a: 1 } })).toThrow(
      /Feature spec drifted/
    )
  })

  it("throws when categorical vocabulary changes without retrain", () => {
    const trainedSpecs: FieldSpec[] = [
      { field: "src", kind: "categorical", oneHotValues: ["web", "referral"] },
    ]
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({
        stage: i % 2 === 0 ? "won" : "lost",
        src: i % 2 === 0 ? "web" : "referral",
      })),
      ...Array.from({ length: 10 }, () => ({ stage: "lost", src: "referral" })),
    ]
    const artifact = trainPredictionModel({
      specs: trainedSpecs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    // Same dimension (2 categories + __other__ = 3 cols), different vocab.
    const editedSpecs: FieldSpec[] = [
      { field: "src", kind: "categorical", oneHotValues: ["partner", "self_serve"] },
    ]
    expect(() => scoreRecord({ artifact, specs: editedSpecs, record: { src: "partner" } })).toThrow(
      /Feature spec drifted .*column/
    )
  })
})

describe("H3 — trainer encodes __other__ bucket from training data", () => {
  it("a vocabulary value seen only as 'other' during training trains a weight", () => {
    const specs: FieldSpec[] = [
      { field: "src", kind: "categorical", oneHotValues: ["web", "referral"] },
    ]
    // Mix in "tiktok" + "linkedin" — both fall into __other__ bucket.
    const records = [
      ...Array.from({ length: 8 }, (_, i) => ({
        stage: "won",
        src: ["web", "tiktok", "linkedin", "web"][i % 4],
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        stage: "lost",
        src: ["referral", "tiktok", "linkedin", "referral"][i % 4],
      })),
    ]
    const artifact = trainPredictionModel({
      specs,
      records,
      targetField: "stage",
      positiveValues: ["won"],
    })
    // __other__ is the 3rd feature column ("src=web", "src=referral", "src=__other__").
    expect(artifact.featureNames[2]).toBe("src=__other__")
    // Stronger than `Number.isFinite`: trainer actually adjusted the
    // weight away from the zero initialisation — column was trained.
    expect(Math.abs(artifact.weights[2])).toBeGreaterThan(0)
  })
})

/* ─── parseFieldSpecs (defensive runtime validation) ──────────────────── */

describe("H3 — parseFieldSpecs", () => {
  it("accepts valid numeric + categorical specs", () => {
    const parsed = parseFieldSpecs([
      { field: "amount", kind: "numeric" },
      { field: "src", kind: "categorical", oneHotValues: ["a", "b"] },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].kind).toBe("numeric")
    expect(parsed[1].kind).toBe("categorical")
  })

  it("rejects non-array", () => {
    expect(() => parseFieldSpecs("nope")).toThrow(/array/)
  })

  it("rejects categorical without oneHotValues", () => {
    expect(() => parseFieldSpecs([{ field: "x", kind: "categorical" }])).toThrow(/oneHotValues/)
  })

  it("rejects unknown kind", () => {
    expect(() => parseFieldSpecs([{ field: "x", kind: "embedding" }])).toThrow(/Unknown feature kind/)
  })

  it("rejects missing field name", () => {
    expect(() => parseFieldSpecs([{ kind: "numeric" }])).toThrow(/string `field`/)
  })

  it("rejects duplicate field names", () => {
    expect(() =>
      parseFieldSpecs([
        { field: "amount", kind: "numeric" },
        { field: "amount", kind: "numeric" },
      ])
    ).toThrow(/Duplicate field/)
  })

  it("malformed kind shadows the dedupe error (check order pinned)", () => {
    // If two entries share a field AND the second is malformed, we expect
    // the kind-specific error — not the dedupe error — so the user fixes
    // the actually-broken payload. Regression guard for the engine.ts
    // check-order flip; lock it before slice 2 touches this code.
    expect(() =>
      parseFieldSpecs([
        { field: "x", kind: "numeric" },
        { field: "x", kind: "categorical" /* missing oneHotValues */ },
      ])
    ).toThrow(/missing string\[\] oneHotValues/)
  })
})
