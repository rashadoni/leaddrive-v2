import { describe, expect, it } from "vitest"
import { workdayAutoCloseAt, type WorkdayAutoCloseFacts } from "@/lib/mtm/workday-auto-close"

const at = (clock: string, date = "2026-11-20") => new Date(`${date}T${clock}:00.000+04:00`)
const facts = (over: Partial<WorkdayAutoCloseFacts>): WorkdayAutoCloseFacts => ({
  workDateKey: "2026-11-20",
  timezone: "Asia/Baku",
  hour: 20,
  enabledAt: at("00:01", "2026-11-19"),
  startedAt: at("10:00"),
  lastEventAt: at("10:00"),
  returned: false,
  plannedEndAt: null,
  visitOpen: false,
  lastCheckOutAt: null,
  now: at("20:02"),
  ...over,
})
const iso = (value: Date | null) => value?.toISOString() ?? null

describe("when a forgotten workday ends", () => {
  it("is not due before the hour", () => {
    expect(workdayAutoCloseAt(facts({ now: at("19:59") }))).toBeNull()
  })

  it("ends at the hour however late the job comes", () => {
    expect(iso(workdayAutoCloseAt(facts({ now: at("08:00", "2026-11-21") })))).toBe(iso(at("20:00")))
  })

  it("is not back-dated before the moment the switch was turned on", () => {
    expect(iso(workdayAutoCloseAt(facts({ enabledAt: at("21:15"), now: at("21:17") })))).toBe(iso(at("21:15")))
    expect(workdayAutoCloseAt(facts({ enabledAt: at("21:15"), now: at("21:10") }))).toBeNull()
  })

  it("ends after the last thing that happened in it", () => {
    expect(iso(workdayAutoCloseAt(facts({ lastEventAt: at("20:01") })))).toBe(iso(new Date(at("20:01").getTime() + 1_000)))
  })

  it("a visit closed after the hour moves the end; one closed the next day does not", () => {
    expect(iso(workdayAutoCloseAt(facts({ lastCheckOutAt: at("20:40"), now: at("20:42") })))).toBe(iso(at("20:40")))
    expect(iso(workdayAutoCloseAt(facts({ lastCheckOutAt: at("11:00", "2026-11-21"), now: at("11:05", "2026-11-21") })))).toBe(iso(at("20:00")))
  })

  it("an open visit holds it until the end of the date, not longer", () => {
    expect(workdayAutoCloseAt(facts({ visitOpen: true, now: at("23:58") }))).toBeNull()
    expect(iso(workdayAutoCloseAt(facts({ visitOpen: true, now: at("00:03", "2026-11-21") })))).toBe(iso(at("23:59")))
  })

  it("a shift planned past the hour ends at its planned end, even the next morning", () => {
    const plannedEndAt = at("06:00", "2026-11-21")
    expect(workdayAutoCloseAt(facts({ plannedEndAt, now: at("23:59") }))).toBeNull()
    expect(iso(workdayAutoCloseAt(facts({ plannedEndAt, now: at("06:02", "2026-11-21") })))).toBe(iso(plannedEndAt))
  })

  it("a day returned to, or begun after the hour, ends with its date", () => {
    expect(workdayAutoCloseAt(facts({ returned: true, now: at("21:00") }))).toBeNull()
    expect(iso(workdayAutoCloseAt(facts({ returned: true, now: at("00:01", "2026-11-21") })))).toBe(iso(at("23:59")))
    expect(workdayAutoCloseAt(facts({ startedAt: at("20:30"), lastEventAt: at("20:30"), now: at("21:00") }))).toBeNull()
  })
})
