import { describe, expect, it } from "vitest"

import { callbackMarker, callbackOpening, waitlistCallbackSettings } from "@/lib/voice-agent/pharmacy/zeytun-waitlist-callback"

// Owner's queue task 10 (2026-11-07): the line calls a pharmacy back about products it waited for.
describe("waitlist callback", () => {
  it("is off unless switched on, and takes only an Azerbaijani test number", () => {
    expect(waitlistCallbackSettings(null)).toEqual({ enabled: false, testPhoneE164: null })
    expect(waitlistCallbackSettings({ pharmacyPhoneOrders: { waitlistCallback: { enabled: "yes" } } })).toEqual({ enabled: false, testPhoneE164: null })
    expect(waitlistCallbackSettings({ pharmacyPhoneOrders: { waitlistCallback: { enabled: true, testPhoneE164: "+994552223344" } } }))
      .toEqual({ enabled: true, testPhoneE164: "+994552223344" })
    expect(waitlistCallbackSettings({ pharmacyPhoneOrders: { waitlistCallback: { enabled: true, testPhoneE164: "+15550001" } } }))
      .toEqual({ enabled: true, testPhoneE164: null })
  })

  it("reads only its own call's marker", () => {
    const marker = { version: 1, providerCallId: "p1", grantId: "g", orderOrganizationId: "o", pharmacyName: null, pharmacyGuid: null,
      items: [{ externalId: "x", name: "Adefa" }], test: true }
    expect(callbackMarker({ pharmacyWaitlistCallback: marker }, "p1")).toEqual(marker)
    expect(callbackMarker({ pharmacyWaitlistCallback: marker }, "p2")).toBeNull()
    expect(callbackMarker({ pharmacyWaitlistCallback: { ...marker, version: 2 } }, "p1")).toBeNull()
    expect(callbackMarker(null, "p1")).toBeNull()
  })

  it("opens with who calls and what is in stock, with or without the pharmacy's name", () => {
    expect(callbackOpening({ pharmacyName: null, items: [{ externalId: "x", name: "Adefa" }, { externalId: "y", name: "Dekazol" }] }))
      .toBe("Salam! Zeytun Pharmaceuticals-dan zəng edirəm. Siz soruşmuşdunuz: Adefa, Dekazol — artıq anbarımızdadır. Sifariş etmək istərdinizmi?")
  })
})
