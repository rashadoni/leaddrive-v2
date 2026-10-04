import { describe, expect, it } from "vitest"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import {
  ROUTE_FIELD_CONTACT_CHANGE_FIELDS,
  routeFieldContactChangeFields,
  routeFieldContactChangeOffer,
} from "@/lib/mtm/route-field-contact-change"

/**
 * What an agent may propose from the field app. One list feeds the card (what
 * the form offers) and the endpoint (what it accepts) — the app must never
 * offer a field the server then refuses.
 */
type OfferSettings = Parameters<typeof routeFieldContactChangeOffer>[0]
const settings = (overrides: Partial<OfferSettings> = {}): OfferSettings => ({
  contactHiddenFields: [...MTM_SETTING_DEFAULTS.contactHiddenFields],
  contactClasses: [...MTM_SETTING_DEFAULTS.contactClasses],
  contactSpecialties: ["Kardioloq", "Nevroloq"],
  agentContactChangeRequests: true,
  ...overrides,
})

describe("routeFieldContactChangeFields", () => {
  it("is what the app's card shows: class, specialty and the name", () => {
    expect(ROUTE_FIELD_CONTACT_CHANGE_FIELDS).toEqual(["category", "specialtyName", "firstName", "lastName"])
    expect(routeFieldContactChangeFields(settings())).toEqual(["category", "specialtyName", "firstName", "lastName"])
  })

  it("drops a field the organization switched off for its clients", () => {
    expect(routeFieldContactChangeFields(settings({ contactHiddenFields: ["specialtyName", "email"] })))
      .toEqual(["category", "firstName", "lastName"])
  })
})

describe("routeFieldContactChangeOffer", () => {
  it("offers the organization's classes and specialties", () => {
    expect(routeFieldContactChangeOffer(
      settings({ contactClasses: ["A", "B", "C", "VIP"] }),
      { category: "A", specialtyName: "Kardioloq" },
    )).toEqual({
      allowed: true,
      fields: ["category", "specialtyName", "firstName", "lastName"],
      classes: ["A", "B", "C", "VIP"],
      specialties: ["Kardioloq", "Nevroloq"],
    })
  })

  it("keeps what the client already has among the choices", () => {
    const offer = routeFieldContactChangeOffer(
      settings({ contactClasses: ["A", "B", "C", "VIP"] }),
      { category: "D", specialtyName: "Pediatr" },
    )
    expect(offer.classes).toEqual(["A", "B", "C", "D", "VIP"])
    expect(offer.specialties).toEqual(["Kardioloq", "Nevroloq", "Pediatr"])
  })

  it("offers no specialties when the organization does not use the field", () => {
    const offer = routeFieldContactChangeOffer(
      settings({ contactHiddenFields: ["specialtyName"] }),
      { category: null, specialtyName: "Kardioloq" },
    )
    expect(offer.fields).toEqual(["category", "firstName", "lastName"])
    expect(offer.specialties).toEqual([])
  })

  it("follows the matrix switch", () => {
    expect(routeFieldContactChangeOffer(settings({ agentContactChangeRequests: false }), { category: "A", specialtyName: null }).allowed)
      .toBe(false)
  })
})
