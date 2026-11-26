import { describe, expect, it } from "vitest"
import { contractMoney, invoiceRefusal, nextInvoiceAmount, type MoneyInvoice } from "@/lib/clm/contract-money"
import { contractListStats, currencyFiguresText } from "@/lib/contract-lifecycle/list-stats"

/** «Деньги по договору» (src/lib/clm/contract-money.ts), as the mock shows them. */
const now = new Date("2026-11-26T10:00:00Z")
const inv = (status: string, totalAmount: number, paidAmount = 0, extra: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  status, totalAmount, paidAmount, balanceDue: totalAmount - paidAmount, currency: "AZN", dueDate: "2026-12-20T00:00:00Z", ...extra,
})
const contract = { valueAmount: 120_000, currency: "AZN" }

describe("money on a contract", () => {
  const invoices = [
    inv("paid", 40_000, 40_000),
    inv("partially_paid", 25_000, 20_000),
    inv("sent", 15_000, 0, { dueDate: "2026-11-20T00:00:00Z" }), // past due, status not yet «overdue»
    inv("draft", 10_000),
    inv("cancelled", 50_000),
    inv("refunded", 7_000, 7_000),
    inv("sent", 900, 0, { currency: "USD" }),
  ]
  const money = contractMoney(contract, invoices, now)

  it("is the mock's own figures: invoiced, paid, debt with what is overdue, left to invoice", () => {
    expect(money).toMatchObject({
      currency: "AZN", value: 120_000,
      invoiced: 80_000, invoicedCount: 3, drafts: 10_000, draftCount: 1,
      paid: 60_000, debt: 20_000, overdue: 15_000,
      remaining: 30_000, overInvoiced: 0,
    })
  })
  it("never adds another currency to the value — it is a line of its own", () => {
    expect(money.other).toEqual([{ currency: "USD", invoiced: 900, invoicedCount: 1, drafts: 0, draftCount: 0, paid: 0, debt: 900, overdue: 0 }])
  })
  it("says how far invoices go beyond the value, and counts nothing left", () => {
    expect(contractMoney({ valueAmount: 50_000, currency: "AZN" }, [inv("sent", 40_000), inv("draft", 15_000)], now))
      .toMatchObject({ remaining: 0, overInvoiced: 5_000 })
  })
  it("without a value: nothing left to count, nothing beyond it", () => {
    expect(contractMoney({ valueAmount: null, currency: "AZN" }, [inv("sent", 1_000)], now)).toMatchObject({ value: null, remaining: null, overInvoiced: 0, invoiced: 1_000 })
  })
  it("sums in cents: 0.1 + 0.2 is 0.3", () => {
    expect(contractMoney({ valueAmount: 1, currency: "AZN" }, [inv("sent", 0.1), inv("sent", 0.2)], now)).toMatchObject({ invoiced: 0.3, remaining: 0.7 })
  })
})

describe("the next invoice without a price protocol", () => {
  it("is for what is left after invoices and drafts in the contract's currency", () => {
    expect(nextInvoiceAmount(contract, [inv("paid", 40_000), inv("draft", 10_000), inv("cancelled", 70_000), inv("sent", 500, 0, { currency: "USD" })]))
      .toEqual({ ok: true, amount: 70_000 })
  })
  it("is refused once the value is fully invoiced", () => {
    expect(nextInvoiceAmount(contract, [inv("sent", 100_000), inv("draft", 20_000)])).toEqual({ ok: false, code: "FULLY_INVOICED" })
  })
  it("is filled in by hand when the contract has no value, as before", () => {
    expect(nextInvoiceAmount({ valueAmount: null, currency: "AZN" }, [inv("sent", 5)])).toEqual({ ok: true, amount: null })
  })
  it("is not made on a contract that never took effect", () => {
    for (const status of ["draft", "pending_approval", "rejected", "cancelled"]) expect(invoiceRefusal(status)).toBe("CONTRACT_NOT_IN_FORCE")
    for (const status of ["approved", "active", "renewing", "expired", "terminated", "renewed"]) expect(invoiceRefusal(status)).toBeNull()
  })
})

describe("the contracts list", () => {
  it("sums each currency apart, AZN first, and never labels USD «₼»", () => {
    const stats = contractListStats([
      { status: "active", valueAmount: 1_200_000, currency: "AZN", startDate: "2026-01-01", endDate: "2026-12-31" },
      { status: "renewing", valueAmount: 40_000, currency: "AZN" },
      { status: "active", valueAmount: 35_000, currency: "USD" },
      { status: "draft", valueAmount: 999_999, currency: "EUR" },
    ])
    expect(stats.byCurrency.map((c) => [c.currency, c.count, c.total, c.avg])).toEqual([["AZN", 2, 1_240_000, 620_000], ["USD", 1, 35_000, 35_000]])
    expect(currencyFiguresText(stats.byCurrency, "total")).toBe(`${(1_240_000).toLocaleString()} ₼ · ${(35_000).toLocaleString()} USD`)
    expect(currencyFiguresText([], "avg")).toBe("0 ₼")
  })
})
