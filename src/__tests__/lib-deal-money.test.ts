import { describe, it, expect } from "vitest"
import {
  bucketByCurrency,
  leadBucket,
  formatBucket,
  formatExtras,
  weightedForCurrency,
  formatAmount,
  type MoneyRow,
} from "@/lib/deal-money"

/**
 * The board on app.leaddrivecrm.org/deals that prompted this: cards reading
 * "12,000 USD", "300,000 USD", "88,888 USD" and "8,000 AZN" sitting in columns
 * whose headers added all four together and stamped one symbol on the sum.
 */
const MIXED: MoneyRow[] = [
  { valueAmount: 12_000, currency: "USD" },
  { valueAmount: 300_000, currency: "USD" },
  { valueAmount: 8_000, currency: "AZN" },
]

describe("bucketByCurrency", () => {
  it("keeps each currency in its own bucket instead of summing across them", () => {
    expect(bucketByCurrency(MIXED)).toEqual([
      { currency: "USD", value: 312_000, count: 2 },
      { currency: "AZN", value: 8_000, count: 1 },
    ])
  })

  it("never produces a total that is the sum of two currencies", () => {
    const total = bucketByCurrency(MIXED).reduce((s, b) => s + b.value, 0)
    // 320 000 is the old wrong number; it may exist as an arithmetic accident
    // here, but no single bucket may ever carry it.
    expect(bucketByCurrency(MIXED).some((b) => b.value === 320_000)).toBe(false)
    expect(total).toBe(320_000)
  })

  it("falls back for rows with no currency, and normalizes case", () => {
    const rows: MoneyRow[] = [
      { valueAmount: 100, currency: null },
      { valueAmount: 50, currency: "azn" },
      { valueAmount: 25 },
    ]
    expect(bucketByCurrency(rows, "AZN")).toEqual([{ currency: "AZN", value: 175, count: 3 }])
  })

  it("orders by value, then count, then code — stable across renders", () => {
    const rows: MoneyRow[] = [
      { valueAmount: 100, currency: "EUR" },
      { valueAmount: 100, currency: "USD" },
      { valueAmount: 100, currency: "AZN" },
      { valueAmount: 100, currency: "AZN" },
    ]
    expect(bucketByCurrency(rows).map((b) => b.currency)).toEqual(["AZN", "EUR", "USD"])
  })

  it("treats a non-finite amount as zero rather than poisoning the bucket", () => {
    const rows = [{ valueAmount: Number.NaN, currency: "AZN" }, { valueAmount: 10, currency: "AZN" }]
    expect(bucketByCurrency(rows)).toEqual([{ currency: "AZN", value: 10, count: 2 }])
  })
})

describe("leadBucket", () => {
  it("leads with the biggest currency and hands back the rest", () => {
    const { primary, extras } = leadBucket(bucketByCurrency(MIXED))
    expect(primary).toEqual({ currency: "USD", value: 312_000, count: 2 })
    expect(extras).toEqual([{ currency: "AZN", value: 8_000, count: 1 }])
  })

  it("gives an empty board a zero to render instead of null", () => {
    const { primary, extras } = leadBucket([], "AZN")
    expect(primary).toEqual({ currency: "AZN", value: 0, count: 0 })
    expect(extras).toEqual([])
  })
})

describe("formatting", () => {
  it("takes the symbol from the bucket, not from the default currency", () => {
    expect(formatBucket({ currency: "AZN", value: 1_735_782, count: 19 })).toBe(`${(1735782).toLocaleString()} ₼`)
    expect(formatBucket({ currency: "USD", value: 312_000, count: 2 })).toBe(`${(312000).toLocaleString()} $`)
  })

  it("says nothing extra when the board holds a single currency", () => {
    // The whole point of the marker is that a clean board must look unchanged.
    expect(formatExtras([])).toBeNull()
  })

  it("names every other currency with its own count", () => {
    expect(formatExtras([{ currency: "AZN", value: 8_000, count: 1 }])).toBe(`+ ${(8000).toLocaleString()} ₼ · 1`)
  })
})

describe("weightedForCurrency", () => {
  it("weights only the rows of the asked-for currency", () => {
    const rows = [
      { valueAmount: 100_000, currency: "USD", probability: 50 },
      { valueAmount: 10_000, currency: "AZN", probability: 90 },
      { valueAmount: 100_000, currency: "USD", probability: 0 },
    ]
    expect(weightedForCurrency(rows, "USD")).toBe(50_000)
    expect(weightedForCurrency(rows, "AZN")).toBe(9_000)
  })

  it("assigns a currency-less row to the same fallback bucketing uses", () => {
    const rows = [{ valueAmount: 1_000, currency: null, probability: 50 }]
    expect(bucketByCurrency(rows, "AZN")[0].currency).toBe("AZN")
    expect(weightedForCurrency(rows, "AZN", "AZN")).toBe(500)
  })
})

describe("formatAmount — one deal, not a total", () => {
  it("keeps the cents a single card is showing", () => {
    // `valueAmount` — Decimal(18,4). Округление до целого в карточке говорит
    // пользователю неверное число про конкретную сделку, а не про сумму.
    expect(formatAmount(1_500.5, "AZN")).toBe(`${(1500.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`)
  })

  it("does not put .00 on a round amount", () => {
    expect(formatAmount(12_000, "USD")).toBe(`${(12000).toLocaleString()} $`)
  })

  it("falls back to the default symbol only when the deal has no currency", () => {
    expect(formatAmount(10, null)).toContain("10")
  })
})
