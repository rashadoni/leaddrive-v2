import { describe, expect, it } from "vitest"
import {
  BRIGHT_DATA_COST_LEDGER_VERSION,
  brightDataLedgerToProviderRunCostFields,
  buildBrightDataCostLedger,
  type BrightDataCostLedgerInput,
} from "@/lib/social/bright-data-cost-ledger"

const priceSnapshot = {
  id: "bright-data-social-comments-2026-07-13",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://docs.brightdata.com/datasets/scrapers/scrapers-library/faqs",
}

function input(overrides: Partial<BrightDataCostLedgerInput> = {}): BrightDataCostLedgerInput {
  return {
    requestedUnits: 10,
    deliveredRecords: 8,
    acceptedUnique: 4,
    reservedChargeUsd: 0.05,
    ...overrides,
  }
}

describe("Bright Data cost ledger", () => {
  it("uses provider-reported USD as authoritative and reconciles reservation", () => {
    const ledger = buildBrightDataCostLedger(input({
      providerCost: { amountUsd: 0.012, units: 8, unitName: "records" },
      priceSnapshot,
    }))

    expect(ledger).toMatchObject({
      schemaVersion: BRIGHT_DATA_COST_LEDGER_VERSION,
      chargeSource: "PROVIDER_AMOUNT",
      actualChargeUsd: 0.012,
      estimatedChargeUsd: null,
      costPerAcceptedUniqueUsd: 0.003,
      reservationReleasedUsd: 0.038,
      reservationOverrunUsd: 0,
      priceSnapshotId: priceSnapshot.id,
    })
    expect(brightDataLedgerToProviderRunCostFields(ledger)).toEqual({
      receivedCount: 8,
      acceptedCount: 4,
      actualChargeUsd: 0.012,
    })
  })

  it("calculates actual cost from provider billing units and a versioned rate", () => {
    const ledger = buildBrightDataCostLedger(input({
      providerCost: { units: 8, unitName: "successful records" },
      priceSnapshot,
    }))

    expect(ledger).toMatchObject({
      chargeSource: "BILLING_UNITS_PRICE_SNAPSHOT",
      billableUnits: 8,
      unitName: "successful_records",
      actualChargeUsd: 0.012,
      costPerAcceptedUniqueUsd: 0.003,
      warnings: [],
    })
  })

  it("keeps delivered-record pricing as an estimate, not actualChargeUsd", () => {
    const ledger = buildBrightDataCostLedger(input({ priceSnapshot }))

    expect(ledger).toMatchObject({
      chargeSource: "DELIVERED_RECORD_ESTIMATE",
      actualChargeUsd: null,
      estimatedChargeUsd: 0.012,
      costPerAcceptedUniqueUsd: null,
      estimatedCostPerAcceptedUniqueUsd: 0.003,
      warnings: ["bright_data_cost_estimated_from_delivered_records"],
    })
    // Estimate-only completion steps the idle reservation DOWN to the record
    // estimate (min of held $0.05 and estimate $0.012) without inventing an
    // authoritative actual, so the shared daily budget stops carrying the full cap.
    expect(brightDataLedgerToProviderRunCostFields(ledger)).toEqual({
      receivedCount: 8,
      acceptedCount: 4,
      reservedChargeUsd: 0.012,
    })
  })

  it("never steps the reservation UP when the delivered-record estimate exceeds the held cap", () => {
    const ledger = buildBrightDataCostLedger(input({
      reservedChargeUsd: 0.01,
      deliveredRecords: 100,
      acceptedUnique: 4,
      priceSnapshot,
    }))
    expect(ledger.chargeSource).toBe("DELIVERED_RECORD_ESTIMATE")
    expect(ledger.estimatedChargeUsd).toBeGreaterThan(0.01)
    // min(held 0.01, estimate 0.15) => keep the smaller held cap; never inflate.
    expect(brightDataLedgerToProviderRunCostFields(ledger)).toEqual({
      receivedCount: 100,
      acceptedCount: 4,
      reservedChargeUsd: 0.01,
    })
  })

  it("leaves the reservation untouched when neither an actual nor an estimate is available", () => {
    const ledger = buildBrightDataCostLedger(input({
      providerCost: { units: 8, unitName: "records" },
    }))
    expect(ledger.chargeSource).toBe("UNAVAILABLE")
    expect(brightDataLedgerToProviderRunCostFields(ledger)).toEqual({
      receivedCount: 8,
      acceptedCount: 4,
    })
  })

  it("returns null cost per accepted unique when no item was accepted", () => {
    const ledger = buildBrightDataCostLedger(input({
      acceptedUnique: 0,
      providerCost: { amountUsd: 0.012 },
    }))

    expect(ledger.costPerAcceptedUniqueUsd).toBeNull()
  })

  it("does not invent a charge when billing units lack a price snapshot", () => {
    const ledger = buildBrightDataCostLedger(input({
      providerCost: { units: 8, unitName: "records" },
    }))

    expect(ledger).toMatchObject({
      chargeSource: "UNAVAILABLE",
      actualChargeUsd: null,
      estimatedChargeUsd: null,
      warnings: ["bright_data_price_snapshot_missing"],
    })
  })

  it("fails closed for invalid counts, rates and unknown billing units", () => {
    expect(() => buildBrightDataCostLedger(input({ acceptedUnique: 9 })))
      .toThrow("acceptedUnique cannot exceed deliveredRecords")
    expect(() => buildBrightDataCostLedger(input({
      providerCost: { units: 8, unitName: "requests" },
      priceSnapshot,
    }))).toThrow("unsupported Bright Data billing unit requests")
    expect(() => buildBrightDataCostLedger(input({
      priceSnapshot: { ...priceSnapshot, usdPerThousandRecords: -1 },
    }))).toThrow("priceSnapshot.usdPerThousandRecords must be a non-negative number")
    expect(() => buildBrightDataCostLedger(input({
      providerCost: {},
      priceSnapshot,
    }))).toThrow("providerCost requires amountUsd or units")
  })
})
