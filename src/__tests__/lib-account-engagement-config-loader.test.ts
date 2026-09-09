/**
 * Tests for C5 per-tenant config loader.
 *
 * Pure helpers fed via an injectable mock client — no DB.
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_BAND_COMPONENT,
  DEFAULT_GRADE_THRESHOLDS,
  DEFAULT_ICP_COMPONENT_BY_TIER,
  DEFAULT_LOOKBACK_DAYS,
  loadAccountGradeWeights,
  loadIntentSignalWeights,
} from "@/lib/account-engagement/config-loader"

function makeGradeClient(row: unknown) {
  return {
    accountGradeConfig: {
      findUnique: async () => row as never,
    },
    intentSignalConfig: { findUnique: async () => null } as never,
  } as never
}

function makeIntentClient(row: unknown) {
  return {
    accountGradeConfig: { findUnique: async () => null } as never,
    intentSignalConfig: {
      findUnique: async () => row as never,
    },
  } as never
}

/* ─── loadAccountGradeWeights ──────────────────────────────────── */

describe("loadAccountGradeWeights", () => {
  it("returns defaults when no per-org row exists", async () => {
    const w = await loadAccountGradeWeights("org_x", makeGradeClient(null))
    expect(w.icpComponentByTier).toEqual(DEFAULT_ICP_COMPONENT_BY_TIER)
    expect(w.bandComponent).toEqual(DEFAULT_BAND_COMPONENT)
    expect(w.gradeThresholds).toEqual(DEFAULT_GRADE_THRESHOLDS)
    expect(w.targetIndustries).toEqual([])
    expect(w.disqualifiedIndustries).toEqual([])
  })

  it("merges per-key overrides on top of defaults", async () => {
    const row = {
      icpComponentByTier: { tier_1: 50 }, // override only one key
      bandComponent: {},
      targetIndustries: ["healthcare", "fintech"],
      disqualifiedIndustries: ["adult_entertainment"],
      gradeThresholds: { A: 90 }, // override A threshold; B/C/D keep defaults
    }
    const w = await loadAccountGradeWeights("org_x", makeGradeClient(row))
    // tier_1 was overridden.
    expect(w.icpComponentByTier.tier_1).toBe(50)
    // Other tiers keep defaults.
    expect(w.icpComponentByTier.tier_2).toBe(DEFAULT_ICP_COMPONENT_BY_TIER.tier_2)
    expect(w.icpComponentByTier.unscored).toBe(0)
    // bandComponent has empty overrides — all defaults.
    expect(w.bandComponent).toEqual(DEFAULT_BAND_COMPONENT)
    // Industry lists pass through verbatim.
    expect(w.targetIndustries).toEqual(["healthcare", "fintech"])
    expect(w.disqualifiedIndustries).toEqual(["adult_entertainment"])
    // gradeThresholds A overridden, others default.
    expect(w.gradeThresholds.A).toBe(90)
    expect(w.gradeThresholds.B).toBe(DEFAULT_GRADE_THRESHOLDS.B)
  })

  it("rejects malformed JSONB shapes (defaults win, no throw)", async () => {
    // Admin puts garbage in the override blob — loader silently
    // falls back to defaults rather than crashing the score pipeline.
    const row = {
      icpComponentByTier: "not an object",
      bandComponent: { strategic: "nope" }, // value type wrong
      targetIndustries: [],
      disqualifiedIndustries: [],
      gradeThresholds: null,
    }
    const w = await loadAccountGradeWeights("org_x", makeGradeClient(row))
    expect(w.icpComponentByTier).toEqual(DEFAULT_ICP_COMPONENT_BY_TIER)
    expect(w.bandComponent).toEqual(DEFAULT_BAND_COMPONENT)
    expect(w.gradeThresholds).toEqual(DEFAULT_GRADE_THRESHOLDS)
  })

  it("rejects negative weight values (defaults win for those keys)", async () => {
    const row = {
      icpComponentByTier: { tier_1: -10, tier_2: 25 },
      bandComponent: {},
      targetIndustries: [],
      disqualifiedIndustries: [],
      gradeThresholds: {},
    }
    const w = await loadAccountGradeWeights("org_x", makeGradeClient(row))
    // tier_1 negative rejected → default.
    expect(w.icpComponentByTier.tier_1).toBe(DEFAULT_ICP_COMPONENT_BY_TIER.tier_1)
    // tier_2 positive accepted → 25.
    expect(w.icpComponentByTier.tier_2).toBe(25)
  })

  it("returns a frozen object (caller can't mutate)", async () => {
    const w = await loadAccountGradeWeights("org_x", makeGradeClient(null))
    expect(Object.isFrozen(w)).toBe(true)
    expect(Object.isFrozen(w.icpComponentByTier)).toBe(true)
    expect(Object.isFrozen(w.gradeThresholds)).toBe(true)
  })

  it("rejects empty orgId", async () => {
    await expect(
      loadAccountGradeWeights("", makeGradeClient(null)),
    ).rejects.toThrow()
  })
})

/* ─── loadIntentSignalWeights ──────────────────────────────────── */

describe("loadIntentSignalWeights", () => {
  it("returns empty overrides + default lookback when no row exists", async () => {
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(null))
    expect(w.signalWeights).toEqual({})
    expect(w.mqlQualifyingByKind).toEqual({})
    expect(w.lookbackDays).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it("surfaces per-SignalKind weight overrides verbatim (free-form keys)", async () => {
    const row = {
      signalWeights: {
        chat_high_intent: 25,
        form_submission: 20,
        custom_event: 15,
      },
      mqlQualifyingByKind: {},
      lookbackDays: null,
    }
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(row))
    expect(w.signalWeights).toEqual({
      chat_high_intent: 25,
      form_submission: 20,
      custom_event: 15,
    })
    expect(w.lookbackDays).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it("surfaces MQL-qualifying boolean overrides per kind", async () => {
    const row = {
      signalWeights: {},
      mqlQualifyingByKind: {
        chat_high_intent: true,
        form_submission: false, // tenant disables form_submission as MQL trigger
      },
      lookbackDays: null,
    }
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(row))
    expect(w.mqlQualifyingByKind).toEqual({
      chat_high_intent: true,
      form_submission: false,
    })
  })

  it("accepts valid lookbackDays in 1..365", async () => {
    const row = {
      signalWeights: {},
      mqlQualifyingByKind: {},
      lookbackDays: 60,
    }
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(row))
    expect(w.lookbackDays).toBe(60)
  })

  it("falls back to default lookback on out-of-range values", async () => {
    // 0 < 1 and 1000 > 365 — both invalid; helper falls back.
    const w1 = await loadIntentSignalWeights("org_x", makeIntentClient({
      signalWeights: {},
      mqlQualifyingByKind: {},
      lookbackDays: 0,
    }))
    expect(w1.lookbackDays).toBe(DEFAULT_LOOKBACK_DAYS)
    const w2 = await loadIntentSignalWeights("org_x", makeIntentClient({
      signalWeights: {},
      mqlQualifyingByKind: {},
      lookbackDays: 1000,
    }))
    expect(w2.lookbackDays).toBe(DEFAULT_LOOKBACK_DAYS)
  })

  it("rejects malformed signalWeights / mqlQualifyingByKind (empty fallback)", async () => {
    const row = {
      signalWeights: "not an object",
      mqlQualifyingByKind: ["array", "instead", "of", "object"],
      lookbackDays: null,
    }
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(row))
    expect(w.signalWeights).toEqual({})
    expect(w.mqlQualifyingByKind).toEqual({})
  })

  it("returns a frozen object", async () => {
    const w = await loadIntentSignalWeights("org_x", makeIntentClient(null))
    expect(Object.isFrozen(w)).toBe(true)
    expect(Object.isFrozen(w.signalWeights)).toBe(true)
    expect(Object.isFrozen(w.mqlQualifyingByKind)).toBe(true)
  })

  it("rejects empty orgId", async () => {
    await expect(
      loadIntentSignalWeights("", makeIntentClient(null)),
    ).rejects.toThrow()
  })
})
