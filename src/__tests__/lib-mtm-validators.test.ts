import { describe, it, expect } from "vitest"
import { CustomerUpdateSchema, TaskUpdateSchema, VisitCreateSchema, AlertUpdateSchema } from "@/lib/mtm-validators"

// Regression tests for validators that mobile (MTMobileApp/) depends on.
// Architect round 18 flagged: critical-path mobile bug-fixes (M-02 task.result)
// without regression tests would silently regress on the next refactor.

describe("TaskUpdateSchema", () => {
  it("M-02: keeps `result` field (mobile sends completion notes)", () => {
    // MTMobileApp/src/screens/tasks/TasksScreen.tsx → updateTask({status, result})
    const parsed = TaskUpdateSchema.parse({
      status: "COMPLETED",
      result: "Done — customer satisfied, restocked promo display.",
    })
    expect(parsed.result).toBe("Done — customer satisfied, restocked promo display.")
    expect(parsed.status).toBe("COMPLETED")
  })

  it("allows result to be omitted (status-only update)", () => {
    const parsed = TaskUpdateSchema.parse({ status: "IN_PROGRESS" })
    expect(parsed.status).toBe("IN_PROGRESS")
    expect(parsed.result).toBeUndefined()
  })

  it("allows result to be null (clear notes)", () => {
    const parsed = TaskUpdateSchema.parse({ result: null })
    expect(parsed.result).toBeNull()
  })

  it("rejects bogus status enum values", () => {
    expect(() => TaskUpdateSchema.parse({ status: "INVALID" })).toThrow()
  })
})

describe("VisitCreateSchema", () => {
  it("F-14: lat/lng range coercion", () => {
    // mobile may send strings from form encoding
    const parsed = VisitCreateSchema.parse({
      agentId: "a1",
      customerId: "c1",
      latitude: "40.4093",
      longitude: "49.8671",
    })
    expect(parsed.latitude).toBe(40.4093)
    expect(parsed.longitude).toBe(49.8671)
  })

  it("F-14: rejects out-of-range coordinates", () => {
    expect(() =>
      VisitCreateSchema.parse({
        agentId: "a1",
        customerId: "c1",
        latitude: 91,
        longitude: 49.8671,
      })
    ).toThrow()
    expect(() =>
      VisitCreateSchema.parse({
        agentId: "a1",
        customerId: "c1",
        latitude: 40,
        longitude: -181,
      })
    ).toThrow()
  })

  it("F-28: force flag is accepted (server enforces role separately)", () => {
    const parsed = VisitCreateSchema.parse({
      agentId: "a1",
      customerId: "c1",
      force: true,
    })
    expect(parsed.force).toBe(true)
  })
})

describe("AlertUpdateSchema", () => {
  it("requires isResolved to be boolean (mobile resolveAlert)", () => {
    const parsed = AlertUpdateSchema.parse({ isResolved: true })
    expect(parsed.isResolved).toBe(true)
  })

  it("rejects missing isResolved", () => {
    expect(() => AlertUpdateSchema.parse({})).toThrow()
  })
})

describe("CustomerUpdateSchema — a web form posts untouched inputs as \"\"", () => {
  /**
   * Changing only the coordinates of ADV-DEMO Store 3 was refused with
   * "Validation failed" on address, phone and contact person: fields the
   * manager never touched, empty in the record since it was created. An empty
   * optional field means "unknown", the same as null.
   */
  it("treats an empty optional field as unknown instead of refusing the save", () => {
    const parsed = CustomerUpdateSchema.parse({
      code: "ADV-DEMO-STORE-3",
      name: "ADV-DEMO Store 3",
      category: "B",
      status: "ACTIVE",
      address: "",
      city: "Baku",
      district: "Narimanov",
      latitude: "40.401150",
      longitude: "49.835100",
      phone: "",
      contactPerson: "",
      notes: "",
    })
    expect(parsed.address).toBeNull()
    expect(parsed.phone).toBeNull()
    expect(parsed.contactPerson).toBeNull()
    expect(parsed.notes).toBeNull()
    expect(parsed.city).toBe("Baku")
    expect(parsed.latitude).toBeCloseTo(40.40115)
    expect(parsed.longitude).toBeCloseTo(49.8351)
  })

  it("still keeps a real value and still rejects a half coordinate pair", () => {
    expect(CustomerUpdateSchema.parse({ address: "  Abbasqulu Abbaszadə 13  " }).address)
      .toBe("Abbasqulu Abbaszadə 13")
    expect(() => CustomerUpdateSchema.parse({ latitude: 40.4 })).toThrow()
  })
})
