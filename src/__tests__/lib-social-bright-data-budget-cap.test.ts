import { describe, expect, it } from "vitest"
import {
  BRIGHT_DATA_BUDGET_CAP_VERSION,
  brightDataPriceSnapshotFromEnv,
  planBrightDataBudgetCap,
} from "@/lib/social/bright-data-budget-cap"

const priceSnapshot = {
  id: "bright-data-web-scraper-payg-2026-07-13",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://brightdata.com/cp/billing/overview",
}

describe("Bright Data pre-dispatch budget cap", () => {
  it("loads a complete versioned account rate without exposing environment values", () => {
    expect(brightDataPriceSnapshotFromEnv({
      BRIGHT_DATA_PRICE_SNAPSHOT_ID: priceSnapshot.id,
      BRIGHT_DATA_PRICE_EFFECTIVE_AT: priceSnapshot.effectiveAt,
      BRIGHT_DATA_USD_PER_1000_RECORDS: "1.5",
      BRIGHT_DATA_PRICE_SOURCE_URL: priceSnapshot.sourceUrl,
    })).toEqual({ status: "READY", snapshot: priceSnapshot })
  })

  it("fails closed for missing, partial, zero or malformed price configuration", () => {
    expect(brightDataPriceSnapshotFromEnv({})).toEqual({
      status: "BLOCKED",
      reason: "bright_data_price_snapshot_unconfigured",
    })
    expect(brightDataPriceSnapshotFromEnv({
      BRIGHT_DATA_PRICE_SNAPSHOT_ID: "partial",
    })).toEqual({ status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" })
    expect(brightDataPriceSnapshotFromEnv({
      BRIGHT_DATA_PRICE_SNAPSHOT_ID: priceSnapshot.id,
      BRIGHT_DATA_PRICE_EFFECTIVE_AT: priceSnapshot.effectiveAt,
      BRIGHT_DATA_USD_PER_1000_RECORDS: "0",
      BRIGHT_DATA_PRICE_SOURCE_URL: priceSnapshot.sourceUrl,
    })).toEqual({ status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" })
  })

  it("reproduces the observed 10-record account exposure under a two-cent cap", () => {
    expect(planBrightDataBudgetCap({
      hardCapUsd: 0.02,
      inputCount: 1,
      requestedLimitPerInput: 10,
      priceSnapshot,
    })).toEqual({
      status: "READY",
      schemaVersion: BRIGHT_DATA_BUDGET_CAP_VERSION,
      priceSnapshotId: priceSnapshot.id,
      hardCapUsd: 0.02,
      inputCount: 1,
      requestedLimitPerInput: 10,
      limitPerInput: 10,
      requestedMaxRecords: 10,
      maxBillableRecords: 13,
      reservedRecords: 10,
      reservedChargeUsd: 0.015,
      headroomUsd: 0.005,
      clamped: false,
    })
  })

  it("clamps every input so aggregate record exposure stays below the cap", () => {
    expect(planBrightDataBudgetCap({
      hardCapUsd: 0.02,
      inputCount: 3,
      requestedLimitPerInput: 10,
      priceSnapshot,
    })).toMatchObject({
      status: "READY",
      limitPerInput: 4,
      requestedMaxRecords: 30,
      maxBillableRecords: 13,
      reservedRecords: 12,
      reservedChargeUsd: 0.018,
      headroomUsd: 0.002,
      clamped: true,
    })
  })

  it("blocks before dispatch when the cap cannot fund one record per input", () => {
    expect(planBrightDataBudgetCap({
      hardCapUsd: 0.002,
      inputCount: 2,
      requestedLimitPerInput: 1,
      priceSnapshot,
    })).toEqual({ status: "BLOCKED", reason: "bright_data_hard_cap_too_low" })
  })

  it("fails closed for a missing or invalid snapshot and rejects invalid limits", () => {
    expect(planBrightDataBudgetCap({
      hardCapUsd: 1,
      inputCount: 1,
      requestedLimitPerInput: 1,
    })).toEqual({ status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" })
    expect(planBrightDataBudgetCap({
      hardCapUsd: 1,
      inputCount: 1,
      requestedLimitPerInput: 1,
      priceSnapshot: { ...priceSnapshot, usdPerThousandRecords: 0 },
    })).toEqual({ status: "BLOCKED", reason: "bright_data_price_snapshot_invalid" })
    expect(() => planBrightDataBudgetCap({
      hardCapUsd: 0,
      inputCount: 1,
      requestedLimitPerInput: 1,
      priceSnapshot,
    })).toThrow("hardCapUsd must be a positive number")
    expect(() => planBrightDataBudgetCap({
      hardCapUsd: 1,
      inputCount: 0,
      requestedLimitPerInput: 1,
      priceSnapshot,
    })).toThrow("inputCount must be a positive integer")
  })
})
