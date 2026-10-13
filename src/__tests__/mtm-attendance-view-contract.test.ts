import { describe, expect, it } from "vitest"
import { AttendanceViewConfigSchema, AttendanceViewCreateSchema } from "@/lib/mtm/attendance-view-contract"

const config = { version: 1, mode: "DAY", columns: ["worked", "employee"], showTotals: false, filters: { from: "2026-10-01", to: "2026-10-31", form: "ALL" } }
describe("personal attendance form validation", () => {
  it("retains column order, totals and the precise period", () => {
    expect(AttendanceViewConfigSchema.parse(config)).toEqual(config)
  })
  it("rejects duplicate columns and columns from a different row type", () => {
    for (const columns of [["employee", "employee"], ["phoneAt"], [], ["latitude"]]) {
      expect(AttendanceViewConfigSchema.safeParse({ ...config, columns }).success).toBe(false)
    }
  })
  it("requires journal columns and journal filtering together", () => {
    expect(AttendanceViewConfigSchema.safeParse({ ...config, mode: "JOURNAL", columns: ["event"] }).success).toBe(false)
    expect(AttendanceViewConfigSchema.safeParse({ ...config, mode: "JOURNAL", columns: ["event", "phoneAt"], filters: { ...config.filters, form: "JOURNAL" } }).success).toBe(true)
    expect(AttendanceViewConfigSchema.safeParse({ ...config, filters: { ...config.filters, form: "JOURNAL" } }).success).toBe(false)
  })
  it("requires the exact complete month including leap February", () => {
    const monthly = { ...config, mode: "MONTH", columns: ["days", "employee", "absent"] }
    expect(AttendanceViewConfigSchema.safeParse(monthly).success).toBe(true)
    for (const [from, to, valid] of [["2024-02-01", "2024-02-29", true], ["2026-02-01", "2026-02-28", true], ["2026-10-02", "2026-10-31", false], ["2026-10-01", "2026-10-30", false], ["2026-10-01", "2026-11-30", false], ["2026-10-01", "invalid", false]] as const) {
      expect(AttendanceViewConfigSchema.safeParse({ ...monthly, filters: { from, to, form: "ALL" } }).success).toBe(valid)
    }
  })
  it("rejects invalid ranges, forged sharing and ownership fields", () => {
    for (const filters of [{ from: "bad", to: "bad" }, { from: "2026-01-01", to: "2027-02-01" }, { from: "2026-10-31", to: "2026-10-01" }]) {
      expect(AttendanceViewConfigSchema.safeParse({ ...config, filters }).success).toBe(false)
    }
    const value = { config, name: "Fixture report", requestId: "8f29b5f8-6f38-4e01-bf48-2f0598ee74cc" }
    expect(AttendanceViewCreateSchema.safeParse(value).success).toBe(true)
    for (const extra of [{ userId: "another-user" }, { isShared: true }, { organizationId: "another-tenant" }]) {
      expect(AttendanceViewCreateSchema.safeParse({ ...value, ...extra }).success).toBe(false)
    }
  })
})
