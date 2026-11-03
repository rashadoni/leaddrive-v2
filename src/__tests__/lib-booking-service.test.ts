/**
 * What a salon's service says beyond «when»: what it costs, which group it
 * belongs to, and when the client is due back. Every screen reads these three
 * through the same helpers, so the services list, the booking form and the
 * meeting card cannot disagree.
 */
import { describe, expect, it } from "vitest"
import { groupByCategory, nextVisitAt, servicePriceLabel } from "@/lib/booking/service"

describe("a service's price", () => {
  it("prints the amount with the currency saved next to it", () => {
    // Decimal(14,2) arrives as a string, and a form hands over a number.
    expect(servicePriceLabel({ price: "25.50", priceCurrency: "AZN" }, "en")).toBe("25.5 ₼")
    expect(servicePriceLabel({ price: 40, priceCurrency: "AZN" }, "en")).toBe("40 ₼")
    expect(servicePriceLabel({ price: "1200.00", priceCurrency: "USD" }, "en")).toBe("1,200 $")
  })

  it("never guesses the currency: a number with no code goes out bare", () => {
    // `DEFAULT_CURRENCY` is "USD" in the browser bundle whatever the server
    // reads, so a fallback here would price a manat salon in dollars.
    expect(servicePriceLabel({ price: 30 }, "en")).toBe("30")
    expect(servicePriceLabel({ price: 30, priceCurrency: "  " }, "en")).toBe("30")
  })

  it("says nothing when the service has no price", () => {
    expect(servicePriceLabel({ price: null, priceCurrency: "AZN" })).toBeNull()
    expect(servicePriceLabel({ price: "", priceCurrency: "AZN" })).toBeNull()
    expect(servicePriceLabel({})).toBeNull()
    expect(servicePriceLabel(null)).toBeNull()
    expect(servicePriceLabel(undefined)).toBeNull()
    expect(servicePriceLabel({ price: "about twenty", priceCurrency: "AZN" })).toBeNull()
  })

  it("treats zero as a price, because «free» is something a salon says on purpose", () => {
    expect(servicePriceLabel({ price: 0, priceCurrency: "AZN" }, "en")).toBe("0 ₼")
  })
})

describe("services by group", () => {
  it("keeps one plain list for a salon that never filed its services", () => {
    const rows = [{ title: "Saç kəsimi" }, { title: "Manikür" }]
    expect(groupByCategory(rows)).toEqual([{ category: null, items: rows }])
  })

  it("groups by the name as typed, trimmed, and puts the unfiled ones last", () => {
    const cut = { title: "Saç kəsimi", category: "Saç" }
    const colour = { title: "Boyama", category: " Saç " }
    const nails = { title: "Manikür", category: "Dırnaq" }
    const loose = { title: "Konsultasiya", category: "   " }

    const groups = groupByCategory([cut, nails, colour, loose], "en")

    expect(groups.map((group) => group.category)).toEqual(["Dırnaq", "Saç", null])
    // Inside a group the services keep the order they came in.
    expect(groups[1].items).toEqual([cut, colour])
    expect(groups[2].items).toEqual([loose])
  })
})

describe("when the client is due back", () => {
  const start = "2026-11-03T09:00:00.000Z"

  it("counts the service's own cycle in days", () => {
    expect(nextVisitAt(start, 28)?.toISOString()).toBe("2026-12-01T09:00:00.000Z")
    expect(nextVisitAt(new Date(start), 1)?.toISOString()).toBe("2026-11-04T09:00:00.000Z")
  })

  it("has no answer without a cycle — and zero is the editor's «does not come back»", () => {
    expect(nextVisitAt(start, 0)).toBeNull()
    expect(nextVisitAt(start, null)).toBeNull()
    expect(nextVisitAt(start, undefined)).toBeNull()
    expect(nextVisitAt(start, -7)).toBeNull()
    expect(nextVisitAt("not a date", 28)).toBeNull()
  })
})
