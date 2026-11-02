/**
 * «Часы приёма» in the places' Excel file (owner, 2026-11-02, mockup «MTM: часы
 * приёма клиентов»: «Часы можно загрузить и из Excel — колонки «Пн с», «Пн до»,
 * «Обед» в том же файле, что и места»).
 *
 * A place's week is two columns a day and one lunch for every working day:
 * mon_from, mon_to … sun_from, sun_to, lunch_from, lunch_to. A row that leaves
 * all of them empty says nothing about hours, and the place keeps its own. A row
 * that fills any of them gives the whole week: a day with no time does not work,
 * and the lunch goes into each working day that holds it. Nothing is guessed — a
 * half-filled day or a week the card's editor would refuse is an error of the row.
 *
 * Pure: the import validates and writes, this reads the cells.
 */
import {
  MTM_WEEKDAYS,
  MtmWorkingHoursSchema,
  hoursMinutes,
  normalizeWorkingHours,
  type MtmDayHours,
  type MtmWeekday,
  type MtmWorkingHours,
} from "@/lib/mtm/customer-hours"

const DAY_KEYS: Record<MtmWeekday, string> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" }

export const MTM_EXCEL_HOURS_COLUMNS: string[] = [
  ...MTM_WEEKDAYS.flatMap((day) => [`${DAY_KEYS[day]}_from`, `${DAY_KEYS[day]}_to`]),
  "lunch_from",
  "lunch_to",
]

/** What the template shows under the hours columns: a pharmacy's week. */
export const MTM_EXCEL_HOURS_EXAMPLE: Record<string, string> = {
  mon_from: "09:00", mon_to: "18:00",
  tue_from: "09:00", tue_to: "18:00",
  wed_from: "09:00", wed_to: "18:00",
  thu_from: "09:00", thu_to: "18:00",
  fri_from: "09:00", fri_to: "18:00",
  sat_from: "10:00", sat_to: "15:00",
  sun_from: "", sun_to: "",
  lunch_from: "13:00", lunch_to: "14:00",
}

export type ExcelHoursReading =
  | { kind: "absent" }
  | { kind: "hours"; hours: MtmWorkingHours }
  | { kind: "invalid"; column: string; message: string; rawValue: unknown }

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * A clock from a cell: «9:00», «09:00», «9.00» typed as text, a time Excel keeps
 * as a fraction of a day (0.375), or the «HH:mm» the workbook reader gives for a
 * time-formatted cell. Empty — null; anything else — undefined.
 */
export function readExcelClock(value: unknown): string | null | undefined {
  if (value == null) return null
  if (typeof value === "number") {
    if (!(value >= 0 && value < 1)) return undefined
    const minutes = Math.round(value * 24 * 60)
    if (minutes >= 24 * 60) return undefined
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  }
  const text = String(value).trim()
  if (!text) return null
  const match = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(text)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return `${pad(hours)}:${pad(minutes)}`
}

/** The week a row of the places' file gives, if it gives one. */
export function readExcelWorkingHours(values: Record<string, unknown>): ExcelHoursReading {
  const clocks: Record<string, string | null> = {}
  let any = false
  for (const column of MTM_EXCEL_HOURS_COLUMNS) {
    const clock = readExcelClock(values[column])
    if (clock === undefined) return { kind: "invalid", column, message: "Use 24-hour time HH:mm, e.g. 09:00", rawValue: values[column] }
    clocks[column] = clock
    if (clock) any = true
  }
  if (!any) return { kind: "absent" }

  const lunchFrom = clocks.lunch_from
  const lunchTo = clocks.lunch_to
  if (Boolean(lunchFrom) !== Boolean(lunchTo)) {
    const column = lunchFrom ? "lunch_to" : "lunch_from"
    return { kind: "invalid", column, message: "Give the lunch both its start and its end, or neither", rawValue: values[column] }
  }
  if (lunchFrom && lunchTo && hoursMinutes(lunchTo)! <= hoursMinutes(lunchFrom)!) {
    return { kind: "invalid", column: "lunch_to", message: "The lunch must end after it starts", rawValue: values.lunch_to }
  }

  const week = {} as Record<MtmWeekday, MtmDayHours | null>
  for (const day of MTM_WEEKDAYS) {
    const fromColumn = `${DAY_KEYS[day]}_from`
    const toColumn = `${DAY_KEYS[day]}_to`
    const open = clocks[fromColumn]
    const close = clocks[toColumn]
    if (!open && !close) {
      week[day] = null
      continue
    }
    if (!open || !close) {
      const column = open ? toColumn : fromColumn
      return { kind: "invalid", column, message: "A working day needs both its opening and its closing time; leave both empty for a day off", rawValue: values[column] }
    }
    if (hoursMinutes(close)! <= hoursMinutes(open)!) {
      return { kind: "invalid", column: toColumn, message: "The place must close after it opens", rawValue: values[toColumn] }
    }
    const lunchFits = lunchFrom && lunchTo
      && hoursMinutes(lunchFrom)! > hoursMinutes(open)!
      && hoursMinutes(lunchTo)! < hoursMinutes(close)!
    week[day] = lunchFits ? { open, close, breakFrom: lunchFrom, breakTo: lunchTo } : { open, close }
  }

  const parsed = MtmWorkingHoursSchema.safeParse(week)
  if (!parsed.success) {
    return { kind: "invalid", column: "mon_from", message: parsed.error.issues[0]?.message || "These hours are not a valid week", rawValue: null }
  }
  return { kind: "hours", hours: normalizeWorkingHours(parsed.data) }
}
