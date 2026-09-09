import { describe, it, expect } from "vitest"
import {
  calculateItemTotal,
  calculateInvoiceTotals,
  calculateBalance,
  getPaymentTermsDays,
  calculateDueDate,
} from "@/lib/invoice-calculations"

describe("calculateItemTotal", () => {
  it("calculates basic quantity * unitPrice", () => {
    expect(calculateItemTotal({ quantity: 5, unitPrice: 20, discount: 0 })).toBe(100)
  })

  it("applies percentage discount", () => {
    // 10 * 50 = 500, 10% off = 450
    expect(calculateItemTotal({ quantity: 10, unitPrice: 50, discount: 10 })).toBe(450)
  })

  it("returns 0 for zero quantity", () => {
    expect(calculateItemTotal({ quantity: 0, unitPrice: 100, discount: 0 })).toBe(0)
  })

  it("rounds to 2 decimal places", () => {
    // 3 * 7.33 = 21.99, 15% off = 21.99 * 0.85 = 18.6915 → 18.69
    expect(calculateItemTotal({ quantity: 3, unitPrice: 7.33, discount: 15 })).toBe(18.69)
  })
})

describe("calculateInvoiceTotals", () => {
  const sampleItems = [
    { quantity: 2, unitPrice: 100, discount: 0 },
    { quantity: 1, unitPrice: 50, discount: 10 },
  ]

  it("calculates with percentage discount and VAT", () => {
    // subtotal = 200 + 45 = 245
    // 10% discount = 24.5, afterDiscount = 220.5
    // 18% tax = 39.69, total = 260.19
    const result = calculateInvoiceTotals(sampleItems, "percentage", 10, 0.18, true)
    expect(result.subtotal).toBe(245)
    expect(result.discountAmount).toBe(24.5)
    expect(result.taxAmount).toBe(39.69)
    expect(result.totalAmount).toBe(260.19)
  })

  it("calculates with fixed discount", () => {
    // subtotal = 245, fixed discount = 20, afterDiscount = 225
    // no VAT → tax = 0, total = 225
    const result = calculateInvoiceTotals(sampleItems, "fixed", 20, 0.18, false)
    expect(result.subtotal).toBe(245)
    expect(result.discountAmount).toBe(20)
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(225)
  })

  it("returns zero tax when includeVat is false", () => {
    const result = calculateInvoiceTotals(sampleItems, "percentage", 0, 0.2, false)
    expect(result.taxAmount).toBe(0)
  })

  it("handles empty items array", () => {
    const result = calculateInvoiceTotals([], "percentage", 10, 0.18, true)
    expect(result.subtotal).toBe(0)
    expect(result.discountAmount).toBe(0)
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(0)
  })

  it("rounds all fields to 2 decimals", () => {
    // 3 * 7.33 = 21.99, no item discount → subtotal = 21.99
    // 7% discount = 1.5393 → 1.54, afterDiscount = 20.4507
    // 18% tax = 3.681126 → 3.68, total = 24.1307 → 24.13
    const items = [{ quantity: 3, unitPrice: 7.33, discount: 0 }]
    const result = calculateInvoiceTotals(items, "percentage", 7, 0.18, true)
    expect(result.subtotal).toBe(21.99)
    expect(result.discountAmount).toBe(1.54)
    expect(result.taxAmount).toBe(3.68)
    expect(result.totalAmount).toBe(24.13)
  })
})

describe("calculateBalance", () => {
  it("calculates remaining balance", () => {
    expect(calculateBalance(500, 200)).toBe(300)
  })

  it("returns negative for overpayment", () => {
    expect(calculateBalance(100, 150)).toBe(-50)
  })

  it("returns zero when fully paid", () => {
    expect(calculateBalance(250, 250)).toBe(0)
  })
})

describe("getPaymentTermsDays", () => {
  it("returns 0 for due_on_receipt", () => {
    expect(getPaymentTermsDays("due_on_receipt")).toBe(0)
  })

  it("returns 15 for net15", () => {
    expect(getPaymentTermsDays("net15")).toBe(15)
  })

  it("returns 30 for net30", () => {
    expect(getPaymentTermsDays("net30")).toBe(30)
  })

  it("returns 45 for net45", () => {
    expect(getPaymentTermsDays("net45")).toBe(45)
  })

  it("returns 60 for net60", () => {
    expect(getPaymentTermsDays("net60")).toBe(60)
  })

  it("returns customDays for custom term", () => {
    expect(getPaymentTermsDays("custom", 90)).toBe(90)
  })

  it("falls back to 30 for custom without days", () => {
    expect(getPaymentTermsDays("custom")).toBe(30)
    expect(getPaymentTermsDays("custom", null)).toBe(30)
  })

  it("defaults to 30 for unknown terms", () => {
    expect(getPaymentTermsDays("something_else")).toBe(30)
  })
})

describe("calculateDueDate", () => {
  it("adds 30 days for net30", () => {
    const issue = new Date("2026-01-01")
    const due = calculateDueDate(issue, "net30")
    expect(due.toISOString().slice(0, 10)).toBe("2026-01-31")
  })

  it("returns same date for due_on_receipt", () => {
    const issue = new Date("2026-06-15")
    const due = calculateDueDate(issue, "due_on_receipt")
    expect(due.toISOString().slice(0, 10)).toBe("2026-06-15")
  })
})
