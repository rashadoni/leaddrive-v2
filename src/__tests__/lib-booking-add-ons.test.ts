import { describe, it, expect } from "vitest"
import { addOnId, addOnTotals, parseAddOns, selectedAddOns } from "@/lib/booking/add-ons"

/**
 * The treatment a salon sells with the cut. Both halves of an add-on matter:
 * the money it costs and the minutes it takes — a visit that charges for the
 * extra without holding the chair double-books the master.
 */
const service = { price: "40", durationMinutes: 45 }
const treatment = { id: "a1", name: "Saç baxımı", price: "15", durationMinutes: 15 }
const styling = { id: "a2", name: "Saç düzümü", price: "10", durationMinutes: 0 }

describe("the extras a service offers", () => {
  it("reads a column written by an older release, by hand, or not at all", () => {
    expect(parseAddOns(undefined)).toEqual([])
    expect(parseAddOns({ a1: { name: "x" } })).toEqual([])
    // Nameless, idless and duplicated rows are not offers a customer can tick.
    expect(parseAddOns([{ id: "a1" }, { name: "no id" }, treatment, { ...treatment, name: "again" }]))
      .toEqual([treatment])
  })

  it("never lets a broken row cost money or time", () => {
    expect(parseAddOns([{ id: "a1", name: "Baxım", price: "-5", durationMinutes: -10 }]))
      .toEqual([{ id: "a1", name: "Baxım", price: null, durationMinutes: 0 }])
    expect(parseAddOns([{ id: "a1", name: "Baxım", price: "15,50", durationMinutes: "15" }]))
      .toEqual([{ id: "a1", name: "Baxım", price: "15.5", durationMinutes: 15 }])
  })

  it("takes only the ones the service actually offers", () => {
    expect(selectedAddOns([treatment, styling], ["a2", "forged"])).toEqual([styling])
    // Offered order, not the order they arrived in.
    expect(selectedAddOns([treatment, styling], ["a2", "a1"])).toEqual([treatment, styling])
  })

  it("gives a new extra a handle no other one in the service holds", () => {
    const id = addOnId([treatment, styling])
    expect(id).not.toBe("a1")
    expect(id).not.toBe("a2")
    expect(id.length).toBeGreaterThan(1)
  })
})

describe("what the visit comes to", () => {
  it("adds both the money and the minutes", () => {
    expect(addOnTotals(service, [treatment])).toEqual({ price: "55", durationMinutes: 60 })
    expect(addOnTotals(service, [treatment, styling])).toEqual({ price: "65", durationMinutes: 60 })
  })

  it("leaves the service alone when nothing is taken", () => {
    expect(addOnTotals(service, [])).toEqual({ price: "40", durationMinutes: 45 })
  })

  it("holds the chair for an extra that takes time but costs nothing", () => {
    const free = { id: "a3", name: "Konsultasiya", price: null, durationMinutes: 10 }
    expect(addOnTotals(service, [free])).toEqual({ price: "40", durationMinutes: 55 })
  })

  it("says no price while neither the service nor the extras have one", () => {
    expect(addOnTotals({ price: null, durationMinutes: 45 }, [{ id: "a3", name: "x", price: null, durationMinutes: 5 }]))
      .toEqual({ price: null, durationMinutes: 50 })
  })

  it("starts counting from the extras when only they are priced", () => {
    expect(addOnTotals({ price: null, durationMinutes: 45 }, [treatment])).toEqual({ price: "15", durationMinutes: 60 })
  })

  it("keeps money exact where a float would not", () => {
    const tenth = { id: "a4", name: "x", price: "0.1", durationMinutes: 0 }
    const twentieth = { id: "a5", name: "y", price: "0.2", durationMinutes: 0 }
    expect(addOnTotals({ price: null, durationMinutes: 30 }, [tenth, twentieth]).price).toBe("0.3")
  })
})
