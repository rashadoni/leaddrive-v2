import { describe, expect, it } from "vitest"

import { CALLBACK_ARRIVED_WITHIN_MS, callbackMarker, callbackOpening, callbackReaches, waitlistCallbackSettings } from "@/lib/voice-agent/pharmacy/zeytun-waitlist-callback"

// Owner's queue task 10 (2026-11-07): the line calls a pharmacy back about products it waited for.
describe("waitlist callback", () => {
  // Owner 2026-11-21: the agent says «мы сами вам перезвоним», so it must be true for this caller.
  it("reaches a caller only when on, on a dialable number, and only the test number while one is set", () => {
    const test = "+994552223344", pharmacy = "+994501112233"
    expect(callbackReaches({ enabled: false, testPhoneE164: null }, pharmacy)).toBe(false)
    expect(callbackReaches({ enabled: true, testPhoneE164: test }, pharmacy)).toBe(false)
    expect(callbackReaches({ enabled: true, testPhoneE164: test }, test)).toBe(true)
    expect(callbackReaches({ enabled: true, testPhoneE164: null }, pharmacy)).toBe(true)
    expect(callbackReaches({ enabled: true, testPhoneE164: null }, "anonymous")).toBe(false)
  })

  it("still calls on Monday 09:00 about a product back on Friday after hours", () => {
    const friday = Date.parse("2026-11-20T14:01:00Z"), monday = Date.parse("2026-11-23T05:00:00Z") // 18:01 and 09:00 Baku
    expect(monday - friday).toBeLessThanOrEqual(CALLBACK_ARRIVED_WITHIN_MS)
  })

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
