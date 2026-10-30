import { expect, it } from "vitest"
import { computeSlots, defaultWeeklyHours } from "@/lib/booking/availability"
it("preserves a previous meeting's buffer using the maximum, rather than summing or dropping it", () => {
  const result = computeSlots({ rules: { timezone: "UTC", weekly: { ...defaultWeeklyHours(), "1": [{ start: "09:00", end: "12:00" }] }, durationMinutes: 30, minNoticeMinutes: 0, maxDaysAhead: 1, bufferMinutes: 20 }, now: new Date("2026-10-26T08:00:00Z"), hostIds: ["host"], busyByHost: new Map([["host", [{ start: new Date("2026-10-26T09:00:00Z"), end: new Date("2026-10-26T09:30:00Z"), bufferAfterMinutes: 30 }]]]) })
  const starts = result.find((day) => day.date === "2026-10-26")!.slots.map((slot) => slot.startsAt)
  expect(starts).not.toContain("2026-10-26T09:30:00.000Z")
  expect(starts).toContain("2026-10-26T10:00:00.000Z")
})
