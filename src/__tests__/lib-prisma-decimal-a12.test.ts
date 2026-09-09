/**
 * Tests for A12 Revenue Intelligence normalizers in prisma-decimal.ts.
 *
 * Verifies that Decimal-typed columns serialize as JSON numbers (not strings)
 * after passing through the boundary normalizer. Uses plain objects to simulate
 * Prisma.Decimal objects via the same duck-typing the production code relies on.
 *
 * Covers all 4 normalizers added in the A12 Float→Decimal migration:
 *   normalizeDealRow            — Deal.valueAmount
 *   normalizeForecastSnapshotRow — ForecastSnapshot amounts (×3)
 *   normalizeTransitionRow      — PipelineStageTransition amounts (×2, fromAmount nullable)
 *   normalizeForecastAccuracyRow — ForecastAccuracyReport amounts (×7)
 */
import { describe, it, expect } from "vitest"
import {
  decimalToNumber,
  decimalToNumberNullable,
  normalizeDealRow,
  normalizeForecastSnapshotRow,
  normalizeTransitionRow,
  normalizeForecastAccuracyRow,
} from "@/lib/prisma-decimal"

/** Simulate a Prisma.Decimal (decimal.js object) with toNumber(). */
function makeDecimal(value: number): { toNumber(): number } {
  return { toNumber: () => value }
}

describe("decimalToNumber", () => {
  it("converts Decimal-like object to number", () => {
    expect(decimalToNumber(makeDecimal(123.45))).toBe(123.45)
  })
  it("returns 0 for null", () => {
    expect(decimalToNumber(null)).toBe(0)
  })
  it("returns 0 for undefined", () => {
    expect(decimalToNumber(undefined)).toBe(0)
  })
  it("passes plain number through unchanged", () => {
    expect(decimalToNumber(99.99)).toBe(99.99)
  })
})

describe("decimalToNumberNullable", () => {
  it("converts Decimal-like object to number", () => {
    expect(decimalToNumberNullable(makeDecimal(50))).toBe(50)
  })
  it("returns null for null", () => {
    expect(decimalToNumberNullable(null)).toBeNull()
  })
  it("returns null for undefined", () => {
    expect(decimalToNumberNullable(undefined)).toBeNull()
  })
})

describe("normalizeDealRow", () => {
  it("converts Decimal valueAmount to number", () => {
    const row = {
      id: "deal_1",
      name: "Acme",
      valueAmount: makeDecimal(5000),
      currency: "USD",
      stage: "LEAD",
    }
    const result = normalizeDealRow(row)
    expect(typeof result.valueAmount).toBe("number")
    expect(result.valueAmount).toBe(5000)
  })

  it("preserves all other fields unchanged", () => {
    const row = { valueAmount: makeDecimal(100), id: "x", extra: "kept" }
    const result = normalizeDealRow(row)
    expect(result.id).toBe("x")
    expect(result.extra).toBe("kept")
  })

  it("serializes as JSON number (not string)", () => {
    const row = { valueAmount: makeDecimal(1234.56) }
    const json = JSON.parse(JSON.stringify(normalizeDealRow(row)))
    expect(typeof json.valueAmount).toBe("number")
    expect(json.valueAmount).toBe(1234.56)
  })

  it("handles zero valueAmount", () => {
    const row = { valueAmount: makeDecimal(0) }
    expect(normalizeDealRow(row).valueAmount).toBe(0)
  })
})

describe("normalizeForecastSnapshotRow", () => {
  it("converts all three Decimal amount columns to number", () => {
    const row = {
      id: "snap_1",
      committedAmount: makeDecimal(10000),
      bestCaseAmount: makeDecimal(15000),
      forecastAmount: makeDecimal(12500),
    }
    const result = normalizeForecastSnapshotRow(row)
    expect(typeof result.committedAmount).toBe("number")
    expect(typeof result.bestCaseAmount).toBe("number")
    expect(typeof result.forecastAmount).toBe("number")
    expect(result.committedAmount).toBe(10000)
    expect(result.bestCaseAmount).toBe(15000)
    expect(result.forecastAmount).toBe(12500)
    expect(result.id).toBe("snap_1")
  })

  it("serializes all three as JSON numbers", () => {
    const row = {
      committedAmount: makeDecimal(1),
      bestCaseAmount: makeDecimal(2),
      forecastAmount: makeDecimal(3),
    }
    const json = JSON.parse(JSON.stringify(normalizeForecastSnapshotRow(row)))
    expect(typeof json.committedAmount).toBe("number")
    expect(typeof json.bestCaseAmount).toBe("number")
    expect(typeof json.forecastAmount).toBe("number")
  })
})

describe("normalizeTransitionRow", () => {
  it("converts toAmount Decimal to number", () => {
    const row = { fromAmount: null, toAmount: makeDecimal(5000), id: "t1" }
    const result = normalizeTransitionRow(row)
    expect(typeof result.toAmount).toBe("number")
    expect(result.toAmount).toBe(5000)
  })

  it("converts nullable fromAmount Decimal to number", () => {
    const row = { fromAmount: makeDecimal(3000), toAmount: makeDecimal(5000) }
    const result = normalizeTransitionRow(row)
    expect(typeof result.fromAmount).toBe("number")
    expect(result.fromAmount).toBe(3000)
  })

  it("returns null for null fromAmount", () => {
    const row = { fromAmount: null, toAmount: makeDecimal(5000) }
    expect(normalizeTransitionRow(row).fromAmount).toBeNull()
  })

  it("serializes as JSON numbers (not strings)", () => {
    const row = { fromAmount: makeDecimal(100), toAmount: makeDecimal(200) }
    const json = JSON.parse(JSON.stringify(normalizeTransitionRow(row)))
    expect(typeof json.fromAmount).toBe("number")
    expect(typeof json.toAmount).toBe("number")
  })
})

describe("normalizeForecastAccuracyRow", () => {
  const baseRow = {
    id: "far_1",
    actualAmount: makeDecimal(120000),
    forecastedAmount: makeDecimal(100000),
    committedAmount: makeDecimal(90000),
    bestCaseAmount: makeDecimal(130000),
    varianceAbsForecast: makeDecimal(20000),
    varianceAbsCommitted: makeDecimal(30000),
    varianceAbsBestCase: makeDecimal(-10000),
    // These stay Float — not normalized:
    variancePctForecast: 0.2,
    variancePctCommitted: 0.33,
    variancePctBestCase: -0.08,
    accuracyClass: "over_delivered",
  }

  it("converts all 7 Decimal money columns to number", () => {
    const result = normalizeForecastAccuracyRow(baseRow)
    expect(typeof result.actualAmount).toBe("number")
    expect(typeof result.forecastedAmount).toBe("number")
    expect(typeof result.committedAmount).toBe("number")
    expect(typeof result.bestCaseAmount).toBe("number")
    expect(typeof result.varianceAbsForecast).toBe("number")
    expect(typeof result.varianceAbsCommitted).toBe("number")
    expect(typeof result.varianceAbsBestCase).toBe("number")
    expect(result.actualAmount).toBe(120000)
    expect(result.varianceAbsBestCase).toBe(-10000)
  })

  it("preserves non-normalized fields (Float pct columns, accuracyClass)", () => {
    const result = normalizeForecastAccuracyRow(baseRow)
    expect(result.variancePctForecast).toBe(0.2)
    expect(result.variancePctCommitted).toBe(0.33)
    expect(result.accuracyClass).toBe("over_delivered")
    expect(result.id).toBe("far_1")
  })

  it("serializes all 7 as JSON numbers", () => {
    const json = JSON.parse(JSON.stringify(normalizeForecastAccuracyRow(baseRow)))
    expect(typeof json.actualAmount).toBe("number")
    expect(typeof json.varianceAbsForecast).toBe("number")
    expect(typeof json.varianceAbsBestCase).toBe("number")
  })
})
