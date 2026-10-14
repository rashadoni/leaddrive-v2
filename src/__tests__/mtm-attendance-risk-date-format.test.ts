import { afterEach, describe, expect, it, vi } from "vitest"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
import type { AttendanceRiskItem, AttendanceRiskReport } from "@/lib/mtm/attendance-risk-contract"

const originalDateTimeFormat = Intl.DateTimeFormat
const item: AttendanceRiskItem = {
  id: "fictional-risk", employeeId: "fictional-employee", employeeName: "Fictional employee",
  teamId: null, teamName: null, kind: "DELAYED_CLAIM", workDate: "2026-10-14", timezone: "Asia/Baku",
  claimedAt: "2026-10-13T23:50:25.480Z", serverReceivedAt: "2026-10-14T03:35:39.371Z",
  action: "START", createdAt: "2026-10-14T03:35:39.371Z", canDismiss: true,
  relatedNames: [], relatedNamesRestricted: false, usualName: null, usualDays: null, observedDays: null,
  deltaSeconds: 13513, thresholdSeconds: 900, branchName: null, distanceMeters: null,
  dismissal: { at: "2026-10-14T20:05:06.000Z", byName: "Fictional reviewer", reason: "Fictional explanation" },
}
function table(locale: "az" | "ru" | "en", overrides: Partial<AttendanceRiskItem> = {}) {
  const report: AttendanceRiskReport = {
    directory: [], items: [{ ...item, ...overrides }],
    snapshot: {
      id: "a".repeat(64), asOf: "2026-10-15T00:00:00.000Z",
      query: { from: "2026-10-13", to: "2026-10-15", status: "ALL", kind: "ALL", teamId: "", employeeId: "" },
    },
  }
  return buildAttendanceRiskTable(report, locale, key => key)
}
afterEach(() => vi.restoreAllMocks())

describe("attendance risk dates shared by the screen and exports", () => {
  it("renders both original and received clocks in Azerbaijani, with the local date crossing midnight", () => {
    const row = table("az").rows[0]
    expect(row.cells[3]).toBe("riskClaimed: 14 okt 2026, 03:50:25\nriskReceived: 14 okt 2026, 07:35:39\nAsia/Baku")
    expect(row.cells[5]).toBe("Fictional reviewer\n15 okt 2026, 00:05:06\nFictional explanation")
  })

  it("uses each item's own timezone for all three clocks", () => {
    const row = table("az", { timezone: "America/New_York" }).rows[0]
    expect(row.cells[3]).toBe("riskClaimed: 13 okt 2026, 19:50:25\nriskReceived: 13 okt 2026, 23:35:39\nAmerica/New_York")
    expect(row.cells[5]).toBe("Fictional reviewer\n14 okt 2026, 16:05:06\nFictional explanation")
  })

  it("does not depend on az ICU data when the runtime falls back to root month labels", () => {
    const fallback = "2026 M10 14 03:50:25"
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      const formatter = new originalDateTimeFormat(locales === "az" ? "en" : locales, options)
      return locales === "az" ? new Proxy(formatter, {
        get(target, property) { return property === "format" ? () => fallback : Reflect.get(target, property, target) },
      }) : formatter
    })
    expect(new Intl.DateTimeFormat("az").format(new Date(item.claimedAt))).toBe(fallback)
    const row = table("az").rows[0]
    expect(row.cells[3]).toBe("riskClaimed: 14 okt 2026, 03:50:25\nriskReceived: 14 okt 2026, 07:35:39\nAsia/Baku")
    expect(row.cells[5]).toBe("Fictional reviewer\n15 okt 2026, 00:05:06\nFictional explanation")
    expect(JSON.stringify(row)).not.toMatch(/M10/)
  })

  it.each(["ru", "en"] as const)("preserves native %s medium date and time behavior", locale => {
    const format = (value: string) => new originalDateTimeFormat(locale, {
      timeZone: item.timezone, dateStyle: "medium", timeStyle: "medium",
    }).format(new Date(value))
    const row = table(locale).rows[0]
    expect(row.cells[3]).toBe(`riskClaimed: ${format(item.claimedAt)}\nriskReceived: ${format(item.serverReceivedAt)}\nAsia/Baku`)
    expect(row.cells[5]).toBe(`Fictional reviewer\n${format(item.dismissal!.at)}\nFictional explanation`)
  })

  it("retains the original risk data and the absent decision marker", () => {
    const before = JSON.stringify(item)
    const row = table("az", { dismissal: null }).rows[0]
    expect(row.cells[5]).toBe("—")
    expect(row.cells[1]).toBe("2026-10-14\nriskStart")
    expect(JSON.stringify(item)).toBe(before)
  })
})
