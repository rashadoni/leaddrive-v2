import { describe, expect, it } from "vitest"
import { mtmNameSimilarity, normalizeMtmPhone, rankMtmCustomerDuplicates } from "@/lib/mtm/customer-request"

describe("MTM customer duplicate matching", () => {
  it("normalizes formatted phone numbers", () => {
    expect(normalizeMtmPhone("+994 (50) 123-45-67")).toBe("501234567")
  })

  it("recognizes similar customer names", () => {
    expect(mtmNameSimilarity("Central Clinic", "Central Klinika")).toBeGreaterThanOrEqual(0.72)
  })

  it("ranks exact code and phone matches before advisory matches", () => {
    const candidates = rankMtmCustomerDuplicates({
      externalCode: "C-001",
      name: "Central Clinic",
      phone: "+994 50 123 45 67",
      latitude: 40.4093,
      longitude: 49.8671,
    }, [
      { id: "near", code: null, name: "Central Klinika", phone: null, address: "Baku", latitude: 40.4095, longitude: 49.8672 },
      { id: "exact", code: "c-001", name: "Other", phone: "0501234567", address: null, latitude: null, longitude: null },
    ])

    expect(candidates[0]).toMatchObject({ id: "exact", exact: true })
    expect(candidates[0].reasons).toEqual(expect.arrayContaining(["EXTERNAL_CODE", "PHONE"]))
    expect(candidates[1]).toMatchObject({ id: "near", exact: false })
    expect(candidates[1].reasons).toEqual(expect.arrayContaining(["LOCATION", "SIMILAR_NAME"]))
  })
})
