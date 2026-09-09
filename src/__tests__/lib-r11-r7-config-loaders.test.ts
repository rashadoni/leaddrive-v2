/**
 * Tests for R11 pacing config + R7 rating config loaders.
 *
 * Same shape as PR #91 C5 config-loader test suite — defaults
 * fallback, defensive merge, frozen-result guarantees.
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_OVER_PACE_THRESHOLD,
  DEFAULT_UNDER_PACE_THRESHOLD,
  loadPacingThresholds,
} from "@/lib/media/pacing-config-loader"
import {
  DEFAULT_BASE_RATES,
  DEFAULT_DEDUCTIBLE_CREDIT_RATES,
  DEFAULT_RISK_MULTIPLIERS,
  loadInsuranceRatingWeights,
} from "@/lib/insurance/rating-config-loader"

function makePacingClient(row: unknown) {
  return {
    mediaPacingConfig: { findUnique: async () => row as never },
  } as never
}

function makeRatingClient(row: unknown) {
  return {
    insuranceRatingConfig: { findUnique: async () => row as never },
  } as never
}

/* ─── R11 pacing thresholds ──────────────────────────────────────── */

describe("loadPacingThresholds (R11)", () => {
  it("returns defaults when no per-org row exists", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient(null))
    expect(r.overPaceThreshold).toBe(DEFAULT_OVER_PACE_THRESHOLD)
    expect(r.underPaceThreshold).toBe(DEFAULT_UNDER_PACE_THRESHOLD)
    expect(r.perCampaignOverrides).toEqual({})
    expect(Object.isFrozen(r)).toBe(true)
  })

  it("applies valid over-pace override", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: 1.05,
      underPaceThreshold: null,
      perCampaignOverrides: {},
    }))
    expect(r.overPaceThreshold).toBe(1.05)
    // under not overridden — default.
    expect(r.underPaceThreshold).toBe(DEFAULT_UNDER_PACE_THRESHOLD)
  })

  it("rejects over-pace at or below 1.0 (default wins)", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: 0.95, // makes no semantic sense
      underPaceThreshold: null,
      perCampaignOverrides: {},
    }))
    expect(r.overPaceThreshold).toBe(DEFAULT_OVER_PACE_THRESHOLD)
  })

  it("rejects under-pace at or above 1.0 (default wins)", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: null,
      underPaceThreshold: 1.5, // makes no semantic sense
      perCampaignOverrides: {},
    }))
    expect(r.underPaceThreshold).toBe(DEFAULT_UNDER_PACE_THRESHOLD)
  })

  it("rejects under-pace at or below 0 (default wins)", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: null,
      underPaceThreshold: -0.1,
      perCampaignOverrides: {},
    }))
    expect(r.underPaceThreshold).toBe(DEFAULT_UNDER_PACE_THRESHOLD)
  })

  it("surfaces opaque perCampaignOverrides verbatim", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: null,
      underPaceThreshold: null,
      perCampaignOverrides: { campaignA: { foo: "bar" } },
    }))
    expect(r.perCampaignOverrides).toEqual({ campaignA: { foo: "bar" } })
    expect(Object.isFrozen(r.perCampaignOverrides)).toBe(true)
  })

  it("malformed perCampaignOverrides (array) falls back to {}", async () => {
    const r = await loadPacingThresholds("org_x", makePacingClient({
      overPaceThreshold: null,
      underPaceThreshold: null,
      perCampaignOverrides: ["this", "is", "wrong"],
    }))
    expect(r.perCampaignOverrides).toEqual({})
  })

  it("rejects empty orgId", async () => {
    await expect(
      loadPacingThresholds("", makePacingClient(null)),
    ).rejects.toThrow()
  })
})

/* ─── R7 insurance rating weights ────────────────────────────────── */

describe("loadInsuranceRatingWeights (R7)", () => {
  it("returns defaults when no per-org row exists", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient(null))
    expect(r.baseRates).toEqual(DEFAULT_BASE_RATES)
    expect(r.riskMultipliers).toEqual(DEFAULT_RISK_MULTIPLIERS)
    expect(r.deductibleCreditRates).toEqual(DEFAULT_DEDUCTIBLE_CREDIT_RATES)
    expect(r.rateTablesV2).toEqual({})
    expect(Object.isFrozen(r)).toBe(true)
  })

  it("merges per-line baseRate overrides", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: { auto: 0.02, marine: 0.018 },
      riskMultipliers: {},
      deductibleCreditRates: {},
      rateTablesV2: {},
    }))
    expect(r.baseRates.auto).toBe(0.02)
    expect(r.baseRates.marine).toBe(0.018)
    // home/life/etc keep defaults.
    expect(r.baseRates.home).toBe(DEFAULT_BASE_RATES.home)
    expect(r.baseRates.life).toBe(DEFAULT_BASE_RATES.life)
  })

  it("rejects zero baseRate (default wins — zero means no premium)", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: { auto: 0 },
      riskMultipliers: {},
      deductibleCreditRates: {},
      rateTablesV2: {},
    }))
    expect(r.baseRates.auto).toBe(DEFAULT_BASE_RATES.auto)
  })

  it("rejects negative baseRate (default wins)", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: { auto: -0.01 },
      riskMultipliers: {},
      deductibleCreditRates: {},
      rateTablesV2: {},
    }))
    expect(r.baseRates.auto).toBe(DEFAULT_BASE_RATES.auto)
  })

  it("merges per-tier riskMultiplier overrides (excluding declined)", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: {},
      riskMultipliers: { preferred: 0.75, standard: 1.05 },
      deductibleCreditRates: {},
      rateTablesV2: {},
    }))
    expect(r.riskMultipliers.preferred).toBe(0.75)
    expect(r.riskMultipliers.standard).toBe(1.05)
    expect(r.riskMultipliers.substandard).toBe(DEFAULT_RISK_MULTIPLIERS.substandard)
    // TypeScript: declined isn't in the override-able tier list.
  })

  it("merges per-line deductibleCreditRate overrides (allows zero for life/health)", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: {},
      riskMultipliers: {},
      deductibleCreditRates: { life: 0.05, health: 0 }, // 0 allowed here
      rateTablesV2: {},
    }))
    expect(r.deductibleCreditRates.life).toBe(0.05)
    expect(r.deductibleCreditRates.health).toBe(0)
    expect(r.deductibleCreditRates.auto).toBe(DEFAULT_DEDUCTIBLE_CREDIT_RATES.auto)
  })

  it("surfaces opaque rateTablesV2 verbatim (slice-3 actuarial reserve)", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: {},
      riskMultipliers: {},
      deductibleCreditRates: {},
      rateTablesV2: { state_CA: { auto: [[10000, 0.018]] } },
    }))
    expect(r.rateTablesV2).toEqual({ state_CA: { auto: [[10000, 0.018]] } })
    expect(Object.isFrozen(r.rateTablesV2)).toBe(true)
  })

  it("malformed rateTablesV2 (string instead of object) falls back to {}", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: {},
      riskMultipliers: {},
      deductibleCreditRates: {},
      rateTablesV2: "not an object",
    }))
    expect(r.rateTablesV2).toEqual({})
  })

  it("malformed JSONB (string instead of record) → defaults preserved", async () => {
    const r = await loadInsuranceRatingWeights("org_x", makeRatingClient({
      baseRates: "garbage",
      riskMultipliers: 42,
      deductibleCreditRates: null,
      rateTablesV2: {},
    }))
    expect(r.baseRates).toEqual(DEFAULT_BASE_RATES)
    expect(r.riskMultipliers).toEqual(DEFAULT_RISK_MULTIPLIERS)
    expect(r.deductibleCreditRates).toEqual(DEFAULT_DEDUCTIBLE_CREDIT_RATES)
  })

  it("rejects empty orgId", async () => {
    await expect(
      loadInsuranceRatingWeights("", makeRatingClient(null)),
    ).rejects.toThrow()
  })
})
