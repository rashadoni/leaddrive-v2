import { describe, expect, it } from "vitest"

import { phoneOrderPdf, type OrderPdfLine } from "@/lib/pharmacy-orders/order-pdf"

const pages = (bytes: Uint8Array) => (new TextDecoder("latin1").decode(bytes).match(/\/Type \/Page\b/gu) ?? []).length

const order = (lines: OrderPdfLine[]) => phoneOrderPdf({ company: "ZEYTUN PHARMACEUTICALS", label: "TS-1099",
  takenAt: new Date("2026-10-30T08:00:00Z"), pharmacy: "Zəfər aptek", status: { kind: "received" }, lines, total: "9876543.21" })

const line = (i: number): OrderPdfLine => ({ name: "Амоксиклав 875 мг/125 мг № 14 (Таблетки покрытые пленочной оболочкой) (Lek) (Словения)",
  found: i % 7 !== 3, quantity: i + 1, unit: "qutu", price: "1234.56", total: "123456.78" })

describe("the phone order PDF", () => {
  it("fits a short order on one page and lets a long one run on, whole lines only", () => {
    expect(pages(order([line(0), line(1)]))).toBe(1)
    const long = order(Array.from({ length: 60 }, (_, i) => line(i)))
    expect(pages(long)).toBeGreaterThan(2)
    expect(new TextDecoder("latin1").decode(long).startsWith("%PDF")).toBe(true)
  })
})
