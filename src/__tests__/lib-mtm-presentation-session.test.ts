import { describe, expect, it } from "vitest"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import {
  boundedActiveDurationSeconds,
  isPresentationTimePlausible,
  normalizeViewedPages,
  PresentationSessionProgressSchema,
} from "@/lib/mtm/presentation-session"

describe("product presentation access", () => {
  it("inherits a portfolio membership through all descendants, not siblings", () => {
    const visible = expandVisibleProductGroupIds([
      { id: "portfolio", parentId: null, hasDirectMembership: true },
      { id: "therapy-a", parentId: "portfolio", hasDirectMembership: false },
      { id: "product-line", parentId: "therapy-a", hasDirectMembership: false },
      { id: "other", parentId: null, hasDirectMembership: false },
    ])
    expect([...visible]).toEqual(["portfolio", "therapy-a", "product-line"])
  })
})

describe("presentation evidence normalization", () => {
  it("deduplicates and sorts viewed pages", () => {
    expect(normalizeViewedPages([4, 2, 4, 1])).toEqual([1, 2, 4])
  })

  it("never accepts more active time than wall-clock time", () => {
    expect(boundedActiveDurationSeconds({
      openedAt: new Date("2026-09-19T10:00:00.000Z"),
      lastViewedAt: new Date("2026-09-19T10:05:00.000Z"),
      requestedSeconds: 900,
    })).toBe(300)
  })

  it("requires presentation pages to fit the declared document", () => {
    const parsed = PresentationSessionProgressSchema.safeParse({
      lastViewedAt: "2026-09-19T10:05:00.000Z",
      activeDurationSeconds: 120,
      pageCount: 3,
      lastPage: 4,
      pagesViewed: [1, 4],
      pageEvents: [],
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts an offline opening only inside the recorded visit window", () => {
    const visitCheckInAt = new Date("2026-09-19T10:00:00.000Z")
    const visitCheckOutAt = new Date("2026-09-19T10:30:00.000Z")
    expect(isPresentationTimePlausible({
      openedAt: new Date("2026-09-19T10:12:00.000Z"),
      visitCheckInAt,
      visitCheckOutAt,
      now: new Date("2026-09-19T11:00:00.000Z"),
    })).toBe(true)
    expect(isPresentationTimePlausible({
      openedAt: new Date("2026-09-19T11:00:00.000Z"),
      visitCheckInAt,
      visitCheckOutAt,
      now: new Date("2026-09-19T11:00:00.000Z"),
    })).toBe(false)
  })
})
