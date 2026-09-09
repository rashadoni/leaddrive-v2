/**
 * S6 CPQ — pure helper tests (`src/lib/cpq/totals.ts`).
 *
 * Verifies line / subtotal / quote-total computation, discount
 * precedence (absolute wins over percentage), 4dp quantization,
 * and the negative-result clamp.
 */
import { describe, it, expect } from "vitest"
import { Decimal } from "@prisma/client/runtime/library"
import {
  computeLineTotal,
  computeSubtotal,
  computeQuoteTotal,
  rollUpQuote,
} from "@/lib/cpq/totals"

function toStr(d: Decimal): string {
  return d.toString()
}

describe("computeLineTotal", () => {
  it("base case: qty × unitPrice with no discount", () => {
    expect(toStr(computeLineTotal({ quantity: 3, unitPrice: 100 }))).toBe("300")
  })

  it("absolute line discount subtracts cleanly", () => {
    expect(
      toStr(computeLineTotal({ quantity: 2, unitPrice: 100, lineDiscountAmount: 50 })),
    ).toBe("150")
  })

  it("percentage line discount: 10% off 200 = 180", () => {
    expect(
      toStr(computeLineTotal({ quantity: 2, unitPrice: 100, lineDiscountPct: 10 })),
    ).toBe("180")
  })

  it("decimal quantity (2.5 hours × $200) = 500, then 25% off = 375", () => {
    expect(
      toStr(
        computeLineTotal({ quantity: "2.5", unitPrice: 200, lineDiscountPct: 25 }),
      ),
    ).toBe("375")
  })

  it("absolute discount wins over percentage when both supplied", () => {
    // gross=200; abs=50 wins over pct=25% (which would be 50 — same result here).
    // Use values that disambiguate:
    // gross=200; abs=10, pct=25%. Abs wins → 200-10=190.
    expect(
      toStr(
        computeLineTotal({
          quantity: 1,
          unitPrice: 200,
          lineDiscountAmount: 10,
          lineDiscountPct: 25,
        }),
      ),
    ).toBe("190")
  })

  it("discount > gross → clamped to 0 (no negative line total)", () => {
    expect(
      toStr(computeLineTotal({ quantity: 1, unitPrice: 100, lineDiscountAmount: 500 })),
    ).toBe("0")
  })

  it("quantizes to 4 decimal places (half-up)", () => {
    // 1 × 0.12345 = 0.12345 → rounds to 0.1235 (half-up at 5).
    const r = computeLineTotal({ quantity: 1, unitPrice: "0.12345" })
    expect(toStr(r)).toBe("0.1235")
  })

  it("accepts Decimal input directly", () => {
    const qty = new Decimal("3.5")
    const price = new Decimal("100")
    expect(toStr(computeLineTotal({ quantity: qty, unitPrice: price }))).toBe("350")
  })

  it("avoids IEEE-754 drift on the canonical 0.1 + 0.2 case", () => {
    // 3 × 0.1 with no discount must be exactly 0.3, not 0.30000000000000004.
    expect(toStr(computeLineTotal({ quantity: 3, unitPrice: "0.1" }))).toBe("0.3")
  })

  it("0% discount works the same as no discount", () => {
    expect(
      toStr(computeLineTotal({ quantity: 2, unitPrice: 100, lineDiscountPct: 0 })),
    ).toBe("200")
  })

  it("explicit null discount fields behave like no discount", () => {
    expect(
      toStr(
        computeLineTotal({
          quantity: 2,
          unitPrice: 100,
          lineDiscountAmount: null,
          lineDiscountPct: null,
        }),
      ),
    ).toBe("200")
  })
})

describe("computeSubtotal", () => {
  it("empty array → 0", () => {
    expect(toStr(computeSubtotal([]))).toBe("0")
  })

  it("sums pre-computed lineTotal fields", () => {
    expect(
      toStr(
        computeSubtotal([
          { lineTotal: 100 },
          { lineTotal: "250.5" },
          { lineTotal: 49.5 },
        ]),
      ),
    ).toBe("400")
  })

  it("re-computes when given raw line-item specs", () => {
    const r = computeSubtotal([
      { quantity: 2, unitPrice: 100 }, // 200
      { quantity: 1, unitPrice: 100, lineDiscountAmount: 25 }, // 75
    ])
    expect(toStr(r)).toBe("275")
  })

  it("quantizes the rolled-up sum", () => {
    expect(
      toStr(computeSubtotal([{ lineTotal: "0.111111" }, { lineTotal: "0.222222" }])),
    ).toBe("0.3333")
  })
})

describe("computeQuoteTotal", () => {
  it("no quote-level discount → totalAmount === subtotal", () => {
    expect(toStr(computeQuoteTotal({ subtotal: 1000 }))).toBe("1000")
  })

  it("absolute quote-level discount", () => {
    expect(toStr(computeQuoteTotal({ subtotal: 1000, discountAmount: 150 }))).toBe(
      "850",
    )
  })

  it("percentage quote-level discount: 5% off 1000 = 950", () => {
    expect(toStr(computeQuoteTotal({ subtotal: 1000, discountPct: 5 }))).toBe(
      "950",
    )
  })

  it("absolute discount wins over percentage at quote level", () => {
    // subtotal=1000; abs=100, pct=20% (would be 200). Abs wins → 900.
    expect(
      toStr(computeQuoteTotal({ subtotal: 1000, discountAmount: 100, discountPct: 20 })),
    ).toBe("900")
  })

  it("discount > subtotal → clamped to 0", () => {
    expect(
      toStr(computeQuoteTotal({ subtotal: 100, discountAmount: 500 })),
    ).toBe("0")
  })

  it("quantizes to 4dp", () => {
    expect(
      toStr(
        computeQuoteTotal({ subtotal: "100.12345", discountAmount: 0 }),
      ),
    ).toBe("100.1235")
  })
})

describe("rollUpQuote (end-to-end)", () => {
  it("matches the worked example from the slice-1 explainer", () => {
    // From the user-facing explainer:
    //   1. Pro plan        qty=12  unitPrice=100  lineDiscount=0     → 1200
    //   2. Setup           qty=2.5 unitPrice=200  lineDiscount=50    → 450
    //   3. Premium support qty=1   unitPrice=300  lineDiscount=0     → 300
    //   Subtotal: 1950
    //   Quote discount 5%: -97.50 → Total 1852.50
    const { lineTotals, subtotal, totalAmount } = rollUpQuote(
      [
        { quantity: 12, unitPrice: 100 },
        { quantity: "2.5", unitPrice: 200, lineDiscountAmount: 50 },
        { quantity: 1, unitPrice: 300 },
      ],
      { discountPct: 5 },
    )
    expect(lineTotals.map(toStr)).toEqual(["1200", "450", "300"])
    expect(toStr(subtotal)).toBe("1950")
    expect(toStr(totalAmount)).toBe("1852.5")
  })

  it("empty quote rolls to zero across all three outputs", () => {
    const { lineTotals, subtotal, totalAmount } = rollUpQuote([])
    expect(lineTotals).toEqual([])
    expect(toStr(subtotal)).toBe("0")
    expect(toStr(totalAmount)).toBe("0")
  })

  it("decimal subtotal + decimal quote discount combine cleanly", () => {
    const { subtotal, totalAmount } = rollUpQuote(
      [{ quantity: "0.5", unitPrice: 100 }],
      { discountAmount: "10.50" },
    )
    expect(toStr(subtotal)).toBe("50")
    expect(toStr(totalAmount)).toBe("39.5")
  })
})
