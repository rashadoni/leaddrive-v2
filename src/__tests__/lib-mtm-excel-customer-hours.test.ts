/**
 * «Часы приёма» from the places' Excel file (owner, 2026-11-02, mockup «MTM:
 * часы приёма клиентов»): what a row's hours columns say about a place's week.
 */
import { describe, expect, it } from "vitest"
import { MTM_EXCEL_HOURS_COLUMNS, readExcelClock, readExcelWorkingHours } from "@/lib/mtm/excel-customer-hours"

const weekdays = (from: string, to: string) => Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri"].flatMap((day) => [[`${day}_from`, from], [`${day}_to`, to]]),
)

describe("a clock from a cell", () => {
  it("reads typed text, Excel's fraction of a day and empty cells", () => {
    expect(readExcelClock("9:00")).toBe("09:00")
    expect(readExcelClock("09.30")).toBe("09:30")
    expect(readExcelClock("18:00:00")).toBe("18:00")
    expect(readExcelClock(0.375)).toBe("09:00")
    expect(readExcelClock(null)).toBeNull()
    expect(readExcelClock("  ")).toBeNull()
  })

  it("refuses what is not a time of day", () => {
    for (const value of ["9", "25:00", "09:75", "утро", 1.5, -0.1]) expect(readExcelClock(value)).toBeUndefined()
  })
})

describe("a week from a row", () => {
  it("says nothing when the row fills no hours column — the place keeps its hours", () => {
    expect(readExcelWorkingHours({ external_code: "1", name: "X" })).toEqual({ kind: "absent" })
    expect(MTM_EXCEL_HOURS_COLUMNS).toHaveLength(16)
  })

  it("gives the whole week: empty days do not work, the lunch goes into each day that holds it", () => {
    const reading = readExcelWorkingHours({ ...weekdays("09:00", "18:00"), sat_from: "10:00", sat_to: "13:00", lunch_from: "13:00", lunch_to: "14:00" })
    expect(reading.kind).toBe("hours")
    if (reading.kind !== "hours") return
    expect(reading.hours[1]).toEqual({ open: "09:00", close: "18:00", breakFrom: "13:00", breakTo: "14:00" })
    // Saturday closes at the lunch: no lunch inside it.
    expect(reading.hours[6]).toEqual({ open: "10:00", close: "13:00" })
    expect(reading.hours[7]).toBeNull()
  })

  it("names the cell of a half-filled day, a half lunch, a day that closes before it opens and a bad time", () => {
    expect(readExcelWorkingHours({ ...weekdays("09:00", "18:00"), sat_from: "10:00" })).toMatchObject({ kind: "invalid", column: "sat_to" })
    expect(readExcelWorkingHours({ ...weekdays("09:00", "18:00"), lunch_to: "14:00" })).toMatchObject({ kind: "invalid", column: "lunch_from" })
    expect(readExcelWorkingHours({ ...weekdays("09:00", "18:00"), mon_to: "08:00" })).toMatchObject({ kind: "invalid", column: "mon_to" })
    expect(readExcelWorkingHours({ ...weekdays("09:00", "18:00"), tue_from: "девять" })).toMatchObject({ kind: "invalid", column: "tue_from", rawValue: "девять" })
  })

  it("refuses a lunch alone, with no working day", () => {
    expect(readExcelWorkingHours({ lunch_from: "13:00", lunch_to: "14:00" })).toMatchObject({ kind: "invalid" })
  })
})
