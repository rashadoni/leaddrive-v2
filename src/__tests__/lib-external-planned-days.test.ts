import { describe, expect, it } from "vitest"
import { dayInZone, externalPlannedDaysSchema, midnightInZone } from "@/lib/tasks/external-import"

describe("a calendar day carried over from another tool", () => {
  it("starts at midnight in the people's own zone, whatever the server's", () => {
    expect(midnightInZone("2026-11-06", "Asia/Baku").toISOString()).toBe("2026-11-05T20:00:00.000Z")
    expect(midnightInZone("2026-07-01", "Europe/Berlin").toISOString()).toBe("2026-06-30T22:00:00.000Z") // summer time
    expect(midnightInZone("2026-12-01", "Europe/Berlin").toISOString()).toBe("2026-11-30T23:00:00.000Z")
  })
  it("reads an existing start as its day there — the first import's 00:00Z is the same day in Baku", () => {
    expect(dayInZone(new Date("2026-11-02T00:00:00.000Z"), "Asia/Baku")).toBe("2026-11-02")
    expect(dayInZone(new Date("2026-11-01T20:00:00.000Z"), "Asia/Baku")).toBe("2026-11-02")
    expect(dayInZone(new Date("2026-11-01T19:59:59.000Z"), "Asia/Baku")).toBe("2026-11-01")
  })
  it("takes a day or nothing, and a real time zone", () => {
    expect(externalPlannedDaysSchema.safeParse({ source: "bordio", timeZone: "Asia/Baku", days: [{ externalId: "a", day: null }] }).success).toBe(true)
    expect(externalPlannedDaysSchema.safeParse({ source: "bordio", timeZone: "Mars/Olympus", days: [{ externalId: "a", day: null }] }).success).toBe(false)
    expect(externalPlannedDaysSchema.safeParse({ source: "bordio", timeZone: "Asia/Baku", days: [{ externalId: "a", day: "6 Nov" }] }).success).toBe(false)
  })
})
