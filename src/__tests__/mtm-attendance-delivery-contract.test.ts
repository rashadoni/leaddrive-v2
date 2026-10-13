import { describe, expect, it } from "vitest"
import { AttendanceDeliveryInputSchema, attendanceDeliveryConfig, nextAttendanceDeliveryAt } from "@/lib/mtm/attendance-delivery-contract"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
const config: AttendanceViewConfig = { version: 1, mode: "DAY", columns: ["employee", "worked"], showTotals: true, filters: { from: "2026-10-01", to: "2026-10-01", form: "ALL", employeeId: "employee-a", teamId: "team-a" } }
describe("Attendance email schedule calendar boundaries", () => {
  it.each([
    ["DAILY", "Asia/Baku", "2026-10-13T04:59:59Z", "2026-10-13T05:00:00.000Z", "2026-10-11", "2026-10-11"],
    ["DAILY", "Asia/Baku", "2026-10-13T05:00:00Z", "2026-10-14T05:00:00.000Z", "2026-10-12", "2026-10-12"],
    ["WEEKLY", "Asia/Baku", "2026-10-12T04:59:59Z", "2026-10-12T05:00:00.000Z", "2026-09-28", "2026-10-04"],
    ["WEEKLY", "Asia/Baku", "2026-10-13T05:00:00Z", "2026-10-19T05:00:00.000Z", "2026-10-05", "2026-10-11"],
    ["MONTHLY", "UTC", "2024-03-01T09:00:00Z", "2024-04-01T09:00:00.000Z", "2024-02-01", "2024-02-29"],
    ["MONTHLY", "UTC", "2027-01-31T22:00:00Z", "2027-02-01T09:00:00.000Z", "2026-12-01", "2026-12-31"],
    ["DAILY", "Europe/Berlin", "2026-03-28T08:00:00Z", "2026-03-29T07:00:00.000Z", "2026-03-27", "2026-03-27"],
    ["DAILY", "Europe/Berlin", "2026-10-24T07:00:00Z", "2026-10-25T08:00:00.000Z", "2026-10-23", "2026-10-23"],
  ] as const)("%s in %s after %s", (frequency, timezone, now, next, from, to) => {
    expect(nextAttendanceDeliveryAt(frequency, timezone, new Date(now)).toISOString()).toBe(next)
    expect(attendanceDeliveryConfig(config, frequency, timezone, new Date(now))).toEqual({ ...config, filters: { ...config.filters, from, to } })
  })
  it("keeps complete month grids, including leap February", () => {
    const grid = { ...config, mode: "MONTH" as const, columns: ["employee", "days"] as const, filters: { ...config.filters, from: "2026-10-01", to: "2026-10-31" } }
    expect(attendanceDeliveryConfig({ ...grid, columns: [...grid.columns] }, "MONTHLY", "UTC", new Date("2024-03-01T10:00:00Z")).filters).toMatchObject({ from: "2024-02-01", to: "2024-02-29" })
  })
  it("rejects unknown zones and dates rather than sending in an assumed timezone", () => {
    expect(() => nextAttendanceDeliveryAt("DAILY", "bad/zone", new Date())).toThrow()
    expect(() => nextAttendanceDeliveryAt("DAILY", "UTC", new Date("bad"))).toThrow()
  })
  it("validates recipients, header-safe names and month frequency without silently dropping input", () => {
    const input = { name: "Daily", config, frequency: "DAILY", format: "xlsx", locale: "ru", recipients: ["Person@EXAMPLE.TEST"], enabled: false }
    expect(AttendanceDeliveryInputSchema.parse(input).recipients).toEqual(["person@example.test"])
    for (const invalid of [{ recipients: ["person@example.test", "PERSON@example.test"] }, { recipients: [] }, { recipients: ["bad"] }, { recipients: Array.from({ length: 11 }, (_, i) => `${i}@example.test`) }, { name: "report\r\nBcc: other@example.test" }, { extra: true }]) expect(AttendanceDeliveryInputSchema.safeParse({ ...input, ...invalid }).success).toBe(false)
    expect(AttendanceDeliveryInputSchema.safeParse({ ...input, config: { ...config, mode: "MONTH", columns: ["days"], filters: { ...config.filters, to: "2026-10-31" } } }).success).toBe(false)
  })
})
