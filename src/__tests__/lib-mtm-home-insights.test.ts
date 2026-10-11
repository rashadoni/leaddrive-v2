import { describe, expect, it } from "vitest"
import {
  HOME_BASE_OTHER_KEY,
  buildHomeBase,
  buildHomeQuality,
  buildHomeSetup,
  recentVisitFlag,
  type HomeQualityVisit,
} from "@/lib/mtm/home-insights"

/**
 * The lower row of the MTM home screen. Zeytun Pharma's numbers on prod on
 * 11 October 2026: 321 doctors, all still in the default class «B» (92
 * gastroenterologists, 229 therapists), two of them visited this month; two
 * visits this week, both within 53 m of the clinic and with a photo — one of
 * a minute, one of 13 hours 18 minutes.
 */

const CLASS_ORDER = ["VIP", "A", "B", "C", "D"]

describe("the client base", () => {
  it("splits Zeytun's base by specialty while every doctor sits in one class", () => {
    const base = buildHomeBase({
      subject: "contacts",
      byClass: [{ key: "B", total: 321, visited: 2 }],
      secondary: [{ key: "Terapevt", total: 229, visited: 0 }, { key: "Qastroenteroloq", total: 92, visited: 2 }],
      classOrder: CLASS_ORDER,
    })
    expect(base).toEqual({
      subject: "contacts",
      grouping: "specialty",
      total: 321,
      visited: 2,
      // The largest group first.
      groups: [{ key: "Terapevt", total: 229, visited: 0 }, { key: "Qastroenteroloq", total: 92, visited: 2 }],
    })
  })

  it("splits by class, most important first, once the classes tell clients apart", () => {
    const base = buildHomeBase({
      subject: "contacts",
      byClass: [{ key: "C", total: 150, visited: 20 }, { key: "A", total: 80, visited: 41 }, { key: "VIP", total: 12, visited: 9 }, { key: "B", total: 260, visited: 88 }, { key: "D", total: 0, visited: 0 }],
      secondary: [{ key: "Terapevt", total: 502, visited: 158 }],
      classOrder: CLASS_ORDER,
    })
    expect(base?.grouping).toBe("class")
    expect(base?.groups.map((group) => group.key)).toEqual(["VIP", "A", "B", "C"])
    expect({ total: base?.total, visited: base?.visited }).toEqual({ total: 502, visited: 158 })
  })

  it("adds the long tail of specialties up as «other» and calls institutions by type", () => {
    const many = Array.from({ length: 7 }, (_unused, index) => ({ key: `S${index}`, total: 10 - index, visited: 1 }))
    const base = buildHomeBase({ subject: "contacts", byClass: [{ key: "B", total: 49, visited: 7 }], secondary: many, classOrder: CLASS_ORDER })
    expect(base?.groups.map((group) => group.key)).toEqual(["S0", "S1", "S2", "S3", HOME_BASE_OTHER_KEY])
    expect(base?.groups.at(-1)).toEqual({ key: HOME_BASE_OTHER_KEY, total: 15, visited: 3 })

    const shops = buildHomeBase({ subject: "customers", byClass: [{ key: "B", total: 30, visited: 4 }], secondary: [{ key: "PHARMACY", total: 20, visited: 3 }, { key: "STORE", total: 10, visited: 1 }], classOrder: CLASS_ORDER })
    expect(shops?.grouping).toBe("type")
  })

  it("is no card at all for an empty base, and never shows more visited than there are", () => {
    expect(buildHomeBase({ subject: "contacts", byClass: [], secondary: [], classOrder: CLASS_ORDER })).toBeNull()
    expect(buildHomeBase({ subject: "contacts", byClass: [{ key: "B", total: 0, visited: 0 }], secondary: [], classOrder: CLASS_ORDER })).toBeNull()
    const base = buildHomeBase({ subject: "contacts", byClass: [{ key: "A", total: 2, visited: 5 }, { key: "B", total: 1, visited: 0 }], secondary: [], classOrder: CLASS_ORDER })
    expect(base).toMatchObject({ total: 3, visited: 2 })
  })
})

describe("this week's visits, judged", () => {
  const NOW = new Date("2026-10-11T14:54:00.000Z")
  const clinic = { latitude: 40.4093, longitude: 49.8671, geofenceRadius: null }
  // About 50 m north of the pin.
  const near = { lat: 40.40975, lng: 49.8671 }
  // About 5 km away.
  const far = { lat: 40.4543, lng: 49.8671 }
  function visit(overrides: Partial<HomeQualityVisit> = {}): HomeQualityVisit {
    return {
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-10-08T12:01:08.000Z"),
      duration: 20,
      checkInLat: near.lat,
      checkInLng: near.lng,
      checkOutLat: near.lat,
      checkOutLng: near.lng,
      customer: clinic,
      photoCount: 1,
      ...overrides,
    }
  }
  const OPTIONS = { now: NOW, organizationRadius: 100, longMinutes: 120 }

  it("reads Zeytun's two visits: at the clinic and with a photo, one too short and one too long", () => {
    const quality = buildHomeQuality([visit({ duration: 798 }), visit({ duration: 1 })], OPTIONS)
    expect(quality).toEqual({ visits: 2, atPlace: 2, awayFromPlace: 0, placeUnknown: 0, withPhoto: 2, tooLong: 1, tooShort: 1, longMinutes: 120, shortMinutes: 2 })
  })

  it("tells «recorded elsewhere» from «cannot be judged»", () => {
    const quality = buildHomeQuality([
      visit(),
      visit({ checkInLat: far.lat, checkInLng: far.lng, checkOutLat: far.lat, checkOutLng: far.lng }),
      // No pin on the client: nothing to measure against.
      visit({ customer: { latitude: null, longitude: null, geofenceRadius: null } }),
      // No GPS fix at all.
      visit({ checkInLat: null, checkInLng: null, checkOutLat: null, checkOutLng: null, photoCount: 0 }),
    ], OPTIONS)
    expect(quality).toMatchObject({ visits: 4, atPlace: 1, awayFromPlace: 1, placeUnknown: 2, withPhoto: 3 })
  })

  it("counts an open visit as long by the clock, and a short one only once it is finished", () => {
    const quality = buildHomeQuality([
      // Opened three hours ago and still open.
      visit({ status: "CHECKED_IN", checkInAt: new Date("2026-10-11T11:54:00.000Z"), duration: null, checkOutLat: null, checkOutLng: null }),
      // Opened a minute ago: not «too short», just started.
      visit({ status: "CHECKED_IN", checkInAt: new Date("2026-10-11T14:53:00.000Z"), duration: null, checkOutLat: null, checkOutLng: null }),
      // Exactly at the thresholds: neither.
      visit({ duration: 2 }),
      visit({ duration: 120 }),
      // Never measured.
      visit({ duration: null }),
    ], OPTIONS)
    expect(quality).toMatchObject({ visits: 5, tooLong: 1, tooShort: 0 })
  })

  it("keeps the long threshold above the short one whatever the settings say", () => {
    expect(buildHomeQuality([visit({ duration: 3 })], { ...OPTIONS, longMinutes: 0 })).toMatchObject({ longMinutes: 3, shortMinutes: 2, tooLong: 0, tooShort: 0 })
  })

  it("flags the last visits the same way", () => {
    expect(recentVisitFlag({ status: "CHECKED_OUT", duration: 798 }, { longMinutes: 120 })).toBe("long")
    expect(recentVisitFlag({ status: "CHECKED_OUT", duration: 1 }, { longMinutes: 120 })).toBe("short")
    expect(recentVisitFlag({ status: "CHECKED_OUT", duration: 25 }, { longMinutes: 120 })).toBeNull()
    expect(recentVisitFlag({ status: "CHECKED_IN", duration: null }, { longMinutes: 120 })).toBeNull()
  })
})

describe("what is left to set up", () => {
  it("lists Zeytun's three gaps", () => {
    expect(buildHomeSetup({ customersTotal: 72, customersWithoutPin: 69, contactsTotal: 321, contactClassesInUse: 1, fieldContactsEnabled: true, coveragePolicies: 0 })).toEqual([
      { kind: "customersWithoutPin", count: 69, total: 72 },
      { kind: "contactsUnclassified", count: 321, total: 321 },
      { kind: "noVisitNorms", count: 0, total: 0 },
    ])
  })

  it("is empty for an organization that has done it, and for one with nothing in it", () => {
    expect(buildHomeSetup({ customersTotal: 72, customersWithoutPin: 0, contactsTotal: 321, contactClassesInUse: 3, fieldContactsEnabled: true, coveragePolicies: 1 })).toEqual([])
    expect(buildHomeSetup({ customersTotal: 0, customersWithoutPin: 0, contactsTotal: 0, contactClassesInUse: 0, fieldContactsEnabled: true, coveragePolicies: 0 })).toEqual([])
  })

  it("does not ask for client classes from an organization that does not visit doctors", () => {
    const steps = buildHomeSetup({ customersTotal: 40, customersWithoutPin: 0, contactsTotal: 12, contactClassesInUse: 1, fieldContactsEnabled: false, coveragePolicies: 2 })
    expect(steps).toEqual([])
  })
})
