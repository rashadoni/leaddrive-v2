import { describe, it, expect } from "vitest"
import { createDateFormatter, formatDate, formatDateTime, formatTime, formatWeekday } from "@/lib/format-date"

describe("formatDate", () => {
  const d = new Date("2026-05-30T12:00:00Z")

  it("honors the locale argument (date-part order differs en-US vs en-GB)", () => {
    // en-US => M/D/Y, en-GB => D/M/Y. Proves the locale is actually applied
    // without depending on non-English ICU data being present.
    expect(formatDate(d, "en-US")).not.toBe(formatDate(d, "en-GB"))
  })

  it("accepts Date, ISO string, and epoch number interchangeably", () => {
    expect(formatDate(d.toISOString(), "en-US")).toBe(formatDate(d, "en-US"))
    expect(formatDate(d.getTime(), "en-US")).toBe(formatDate(d, "en-US"))
  })

  it("returns '' for null / undefined / empty / unparseable input", () => {
    expect(formatDate(null, "en-US")).toBe("")
    expect(formatDate(undefined, "en-US")).toBe("")
    expect(formatDate("", "en-US")).toBe("")
    expect(formatDate("not-a-date", "en-US")).toBe("")
  })

  it("passes Intl.DateTimeFormatOptions through", () => {
    const out = formatDate(d, "en-US", { day: "2-digit", month: "short", year: "numeric" })
    expect(out).toMatch(/May/)
    expect(out).toMatch(/2026/)
  })

  it("produces a non-empty string for the az locale", () => {
    expect(formatDate(d, "az", { day: "numeric", month: "long", year: "numeric" })).not.toBe("")
  })

  it("az named months are deterministic — never the ICU 'M05' fallback", () => {
    // Prod regression: some ICU builds rendered az dates as "2026 M03 19".
    expect(formatDate(d, "az", { day: "2-digit", month: "short", year: "numeric" })).toBe("30 may 2026")
    expect(formatDate(new Date("2026-03-19T12:00:00Z"), "az", { day: "numeric", month: "short", year: "numeric" })).toBe("19 mar 2026")
    expect(formatDate(d, "az", { day: "numeric", month: "long" })).toBe("30 may")
    // az-Latn etc. take the same path; numeric months stay on Intl.
    expect(formatDate(d, "az", { day: "numeric", month: "numeric", year: "numeric" })).not.toMatch(/M\d\d/)
  })

  it("uses human Azerbaijani weekday and month names", () => {
    expect(formatDate(new Date("2026-08-24T00:00:00Z"), "az", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    })).toBe("24 avqust, bazar ertəsi")

    expect(formatDate(new Date("2026-08-20T12:00:00Z"), "az", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })).toBe("20 avqust 2026, cümə axşamı")
  })

  it("az path honors timeZone:'UTC' (1st-of-month must not shift for negative offsets)", () => {
    // Midnight UTC on June 1st: a negative-offset viewer's LOCAL month is May —
    // with timeZone:"UTC" the label must still be the June name.
    const firstOfMonth = new Date(Date.UTC(2026, 5, 1))
    expect(formatDate(firstOfMonth, "az", { month: "short", year: "numeric", timeZone: "UTC" })).toBe("iyn 2026")
  })
})

describe("Azerbaijani rendering never depends on ICU data (field UX audit W-02)", () => {
  // Saturday 5 September 2026, 15:23 in Baku (UTC+4).
  const at = new Date("2026-09-05T11:23:00Z")

  it("renders dateStyle presets deterministically", () => {
    expect(formatDate(at, "az", { dateStyle: "medium", timeZone: "Asia/Baku" })).toBe("5 sen 2026")
    expect(formatDate(at, "az", { dateStyle: "long", timeZone: "Asia/Baku" })).toBe("5 sentyabr 2026")
    expect(formatDate(at, "az", { dateStyle: "full", timeZone: "Asia/Baku" })).toBe("5 sentyabr 2026, şənbə")
    expect(formatDate(at, "az", { dateStyle: "short", timeZone: "Asia/Baku" })).toBe("05.09.2026")
    expect(formatDate(at, "az")).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
  })

  it("renders weekdays and the panel clock in Azerbaijani, not 'Sat'", () => {
    expect(formatWeekday(at, "az", "short", "Asia/Baku")).toBe("ş.")
    expect(formatWeekday(at, "az", "long", "Asia/Baku")).toBe("şənbə")
    expect(formatDate(at, "az", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Baku" }))
      .toBe("5 sentyabr 2026, şənbə")
    expect(formatDate(at, "az", { day: "2-digit", month: "2-digit", timeZone: "Asia/Baku" })).toBe("05.09")
  })

  it("renders date and time with a 24-hour clock in the requested zone", () => {
    expect(formatDateTime(at, "az", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" })).toBe("5 sen 2026, 15:23")
    expect(formatDateTime(at, "az", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })).toBe("05.09.2026, 11:23")
    expect(formatTime(at, "az", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baku" })).toBe("15:23")
    expect(formatTime(at, "az", { timeStyle: "short", timeZone: "UTC" })).toBe("11:23")
    expect(formatDateTime(at, "az", { timeStyle: "short", timeZone: "Asia/Baku" })).toBe("15:23")
  })

  it("crosses the day boundary by zone, not by the server clock", () => {
    const lateEvening = new Date("2026-09-05T21:30:00Z") // 01:30 on 6 September in Baku
    expect(formatDate(lateEvening, "az", { dateStyle: "medium", timeZone: "Asia/Baku" })).toBe("6 sen 2026")
    expect(formatDate(lateEvening, "az", { dateStyle: "medium", timeZone: "UTC" })).toBe("5 sen 2026")
  })

  it("survives an invalid time zone name instead of returning nothing", () => {
    expect(formatDate(at, "az", { dateStyle: "medium", timeZone: "Not/AZone" })).toMatch(/sen 2026$/)
  })
})

describe("createDateFormatter", () => {
  const at = new Date("2026-09-05T11:23:00Z")

  it("is a drop-in for Intl.DateTimeFormat#format with the same option names", () => {
    expect(createDateFormatter("az", { dateStyle: "medium", timeZone: "Asia/Baku" }).format(at)).toBe("5 sen 2026")
    expect(createDateFormatter("az", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }).format(at.toISOString())).toBe("5 sen 2026, 15:23")
    expect(createDateFormatter("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(at)).toBe("Sep 5, 2026")
    expect(createDateFormatter("en-US", { timeStyle: "short", timeZone: "UTC" }).format(at)).toMatch(/11:23/)
    expect(createDateFormatter("ru", { dateStyle: "medium" }).format(null)).toBe("")
  })
})
