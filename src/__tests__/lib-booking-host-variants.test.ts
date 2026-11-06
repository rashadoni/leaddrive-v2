import { describe, it, expect } from "vitest"
import {
  hasHostVariants,
  hostService,
  normalizeHostVariants,
  parseHostVariants,
  servicePriceSpan,
} from "@/lib/booking/host-variants"

/**
 * A salon with two masters on one haircut: the senior takes an hour and
 * charges forty, the junior forty minutes and twenty-five. Everything here is
 * about what the customer is told and what the booking is written down as —
 * never about the shape of the call.
 */
const service = { price: "40", durationMinutes: 60 }
const senior = "user-senior"
const junior = "user-junior"
const both = [senior, junior]

describe("what one master charges for a service", () => {
  it("gives the service's own price and length to a master who does not differ", () => {
    expect(hostService({ ...service, hostVariants: {} }, senior)).toEqual({ price: "40", durationMinutes: 60 })
    expect(hostService({ ...service, hostVariants: null }, junior)).toEqual({ price: "40", durationMinutes: 60 })
  })

  it("gives each master their own where they have one", () => {
    const page = { ...service, hostVariants: { [junior]: { price: "25", durationMinutes: 40 } } }
    expect(hostService(page, junior)).toEqual({ price: "25", durationMinutes: 40 })
    expect(hostService(page, senior)).toEqual({ price: "40", durationMinutes: 60 })
  })

  it("takes one half of the answer without the other", () => {
    const page = { ...service, hostVariants: { [junior]: { price: null, durationMinutes: 40 } } }
    expect(hostService(page, junior)).toEqual({ price: "40", durationMinutes: 40 })
  })

  it("reads a column written by hand, by an older release or not at all", () => {
    expect(parseHostVariants(undefined)).toEqual({})
    expect(parseHostVariants("40")).toEqual({})
    expect(parseHostVariants([{ price: "40" }])).toEqual({})
    // Values nobody could have meant are dropped, and the service's own answer
    // stands: a service must never price itself at zero because of bad data.
    expect(parseHostVariants({ [junior]: { price: "-5", durationMinutes: 4 } })).toEqual({})
    expect(parseHostVariants({ [junior]: { price: "25,50", durationMinutes: "40" } })).toEqual({ [junior]: { price: "25.5", durationMinutes: 40 } })
  })
})

describe("what is worth storing", () => {
  it("keeps only masters who still take this service", () => {
    const stored = normalizeHostVariants({ [junior]: { price: "25" }, "left-the-salon": { price: "10" } }, both, service)
    expect(Object.keys(stored)).toEqual([junior])
  })

  it("drops an answer that only repeats the service", () => {
    expect(normalizeHostVariants({ [senior]: { price: "40", durationMinutes: 60 } }, both, service)).toEqual({})
    // «40.00» and «40» are the same price typed differently.
    expect(normalizeHostVariants({ [senior]: { price: "40.00" } }, both, service)).toEqual({})
  })

  it("keeps the half that really differs", () => {
    expect(normalizeHostVariants({ [junior]: { price: "40", durationMinutes: 40 } }, both, service))
      .toEqual({ [junior]: { price: null, durationMinutes: 40 } })
  })
})

describe("what the price list says before a master is chosen", () => {
  it("says one price while everybody agrees", () => {
    expect(servicePriceSpan({ ...service, hostVariants: {} }, both)).toEqual({ min: "40", max: "40", varies: false })
  })

  it("says the span once they do not", () => {
    const page = { ...service, hostVariants: { [junior]: { price: "25", durationMinutes: null } } }
    expect(servicePriceSpan(page, both)).toEqual({ min: "25", max: "40", varies: true })
    expect(hasHostVariants(page, both)).toBe(true)
  })

  it("counts a master who has no price at all as a difference, not as free", () => {
    const page = { price: null as string | null, durationMinutes: 60, hostVariants: { [junior]: { price: "25", durationMinutes: null } } }
    const span = servicePriceSpan(page, both)
    expect(span.min).toBe("25")
    expect(span.varies).toBe(true)
  })

  it("says nothing when the service has no price anywhere", () => {
    expect(servicePriceSpan({ price: null, durationMinutes: 60, hostVariants: {} }, both)).toEqual({ min: null, max: null, varies: false })
  })

  it("ignores a master who no longer takes the service", () => {
    const page = { ...service, hostVariants: { "left-the-salon": { price: "5", durationMinutes: null } } }
    expect(servicePriceSpan(page, both)).toEqual({ min: "40", max: "40", varies: false })
    expect(hasHostVariants(page, both)).toBe(false)
  })
})
