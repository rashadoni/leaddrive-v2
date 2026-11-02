import { describe, expect, it } from "vitest"
import { azOfficialCalendar } from "@/lib/mtm/az-official-calendar"

// Sources: Cabinet of Ministers decision No. 362 of 2 December 2025 (nk.gov.az)
// and the Ministry of Labour's 2026 production calendar (sosial.gov.az).
describe("Azerbaijan's official non-working days", () => {
  const holidays = (year: number, sixDay = false) => azOfficialCalendar(year, sixDay).entries.filter(entry => entry.kind === "PUBLIC_HOLIDAY").map(entry => entry.date.slice(5))
  const moved = (year: number, sixDay = false) => azOfficialCalendar(year, sixDay).entries.filter(entry => entry.kind === "WEEKEND").map(entry => entry.date.slice(5))

  it("2026: the decided holidays, overlaps as one date, and the moved rest days of a five-day week", () => {
    const year = azOfficialCalendar(2026)
    expect(year.complete).toBe(true)
    expect(year.source).toMatch(/362/)
    expect(holidays(2026)).toEqual(["01-01", "01-02", "01-20", "03-08", "03-20", "03-21", "03-22", "03-23", "03-24",
      "05-09", "05-27", "05-28", "06-15", "06-26", "11-08", "11-09", "12-31"])
    expect(year.entries.find(entry => entry.date === "2026-03-20")!.name).toBe("Novruz bayramı, Ramazan bayramı")
    expect(year.entries.find(entry => entry.date === "2026-05-28")!.name).toBe("Müstəqillik Günü, Qurban bayramı")
    expect(moved(2026)).toEqual(["03-09", "03-25", "03-26", "03-27", "03-30", "05-11", "05-29", "11-10"])
    expect(moved(2026, true)).toEqual(["03-25", "03-26", "05-29", "11-10"])
  })

  it("a year without a Cabinet decision gets only the fixed holidays and says it is incomplete", () => {
    const year = azOfficialCalendar(2027)
    expect(year).toMatchObject({ complete: false, source: null })
    expect(holidays(2027)).toEqual(["01-01", "01-02", "01-20", "03-08", "03-20", "03-21", "03-22", "03-23", "03-24",
      "05-09", "05-28", "06-15", "06-26", "11-08", "11-09", "12-31"])
    expect(moved(2027)).toEqual([])
  })
})
