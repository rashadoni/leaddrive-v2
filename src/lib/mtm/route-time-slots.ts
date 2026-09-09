/**
 * Route visits are scheduled in practical half-hour slots. Keeping the list
 * central makes every route editor offer the same predictable choices.
 */
export const MTM_ROUTE_TIME_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = index * 30
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
})

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesFromTime(value: string | null | undefined): number | null {
  if (!value) return null
  const match = TIME_PATTERN.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function timeFromMinutes(totalMinutes: number): string {
  const bounded = Math.max(0, Math.min((23 * 60) + 30, totalMinutes))
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`
}

export function isMtmRouteTimeSlot(value: string | null | undefined): value is string {
  const minutes = minutesFromTime(value)
  return minutes !== null && minutes % 30 === 0
}

/** Converts historical arbitrary minutes to the nearest selectable slot. */
export function normalizeMtmRouteTimeSlot(value: string | null | undefined): string | null {
  const minutes = minutesFromTime(value)
  if (minutes === null) return null
  return timeFromMinutes(Math.round(minutes / 30) * 30)
}

/** The next practical visit time after the last stop, beginning at 09:00. */
export function nextMtmRouteTimeSlot(values: Array<string | null | undefined>): string {
  const last = [...values]
    .reverse()
    .map(normalizeMtmRouteTimeSlot)
    .find((value): value is string => value !== null)
  const lastMinutes = minutesFromTime(last)
  return timeFromMinutes(lastMinutes === null ? 9 * 60 : lastMinutes + 30)
}
