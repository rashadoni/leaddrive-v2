import { describe, expect, it } from "vitest"
import {
  commitmentOutcomeError,
  mobileCommitmentStatus,
  parseMobileCommitmentCreate,
  parseMobileCommitmentFulfill,
} from "@/lib/mtm/mobile-commitment"

describe("mobile commitment contract", () => {
  const submittedAt = new Date("2026-07-16T08:00:00.000Z")

  it("parses an immutable promise with an optional photo reference", () => {
    const parsed = parseMobileCommitmentCreate({
      clientCommitmentId: "commitment-client-1",
      visitId: "visit-1",
      productExternalId: "sku-1",
      productName: "ACC 200 mg",
      brandName: "ACC",
      promisedQuantity: 12.5,
      unit: "packs",
      dueAt: "2026-07-20T18:00:00.000Z",
      note: "Doctor agreed",
      evidenceClientPhotoId: "mobile-photo-1",
    }, submittedAt)

    expect(parsed.error).toBeNull()
    expect(parsed.input).toMatchObject({
      clientCommitmentId: "commitment-client-1",
      promisedQuantity: 12.5,
      evidenceClientPhotoId: "mobile-photo-1",
    })
  })

  it("rejects a promise due before its offline client timestamp", () => {
    const parsed = parseMobileCommitmentCreate({
      clientCommitmentId: "commitment-client-1",
      visitId: "visit-1",
      productName: "ACC",
      promisedQuantity: 1,
      unit: "pack",
      dueAt: "2026-07-16T07:59:59.000Z",
    }, submittedAt)
    expect(parsed.error).toMatch(/dueAt/)
  })

  it("accepts exactly two quantity decimals and rejects hidden rounding", () => {
    const base = {
      clientCommitmentId: "commitment-client-1",
      visitId: "visit-1",
      productName: "ACC",
      unit: "pack",
      dueAt: "2026-07-20T18:00:00.000Z",
    }
    expect(parseMobileCommitmentCreate({ ...base, promisedQuantity: 1.25 }, submittedAt).error).toBeNull()
    expect(parseMobileCommitmentCreate({ ...base, promisedQuantity: 1.255 }, submittedAt).error).toMatch(/2 decimals/)
  })

  it("validates promise-vs-fact outcome semantics", () => {
    expect(commitmentOutcomeError({ promisedQuantity: 10, actualQuantity: 10, outcome: "FULFILLED" })).toBeNull()
    expect(commitmentOutcomeError({ promisedQuantity: 10, actualQuantity: 4, outcome: "PARTIAL" })).toBeNull()
    expect(commitmentOutcomeError({ promisedQuantity: 10, actualQuantity: 0, outcome: "NOT_FULFILLED" })).toBeNull()
    expect(commitmentOutcomeError({ promisedQuantity: 10, actualQuantity: 9, outcome: "FULFILLED" })).toMatch(/FULFILLED/)
    expect(commitmentOutcomeError({ promisedQuantity: 10, actualQuantity: 10, outcome: "PARTIAL" })).toMatch(/PARTIAL/)
  })

  it("parses a fact and derives open/overdue/final statuses", () => {
    expect(parseMobileCommitmentFulfill({
      commitmentId: "commitment-1",
      clientFulfillmentId: "fulfillment-client-1",
      outcome: "PARTIAL",
      actualQuantity: 4,
    }).error).toBeNull()
    expect(mobileCommitmentStatus({
      dueAt: "2026-07-16T08:59:00.000Z",
      fulfillment: null,
      now: new Date("2026-07-16T09:00:00.000Z"),
    })).toBe("OVERDUE")
    expect(mobileCommitmentStatus({
      dueAt: "2026-07-17T09:00:00.000Z",
      fulfillment: { outcome: "PARTIAL" },
      now: new Date("2026-07-16T09:00:00.000Z"),
    })).toBe("PARTIAL")
  })
})
