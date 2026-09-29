export const BUSINESS_DAY_START = 7
export const BUSINESS_DAY_END = 19

export interface CalendarItem {
  id: string
  type: string
  title: string
  date: string
  endDate?: string
  hour: number
  endHour?: number
  allDay?: boolean
  status?: string
  priority?: string
  url?: string
  location?: string
  isOnline?: boolean
  eventType?: string
  completed?: boolean
}

export type CalendarSource = "tickets" | "tasks" | "events" | "activities"
export type CalendarSourceState = Record<CalendarSource, "ok" | "failed">

export const EMPTY_CALENDAR_SOURCES: CalendarSourceState = {
  tickets: "ok",
  tasks: "ok",
  events: "ok",
  activities: "ok",
}

export function getWeekDates(date: Date): Date[] {
  const anchor = new Date(date)
  const day = anchor.getDay()
  const diff = anchor.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(anchor.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday)
    next.setDate(monday.getDate() + index)
    return next
  })
}

export function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

export function calendarDateParam(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function itemsForCalendarDay(items: readonly CalendarItem[], date: Date): CalendarItem[] {
  return items
    .filter((item) => isSameCalendarDay(new Date(item.date), date))
    .slice()
    .sort((left, right) => {
      if (Boolean(left.allDay) !== Boolean(right.allDay)) return left.allDay ? -1 : 1
      return new Date(left.date).getTime() - new Date(right.date).getTime()
    })
}

export function isOutsideBusinessHours(item: CalendarItem): boolean {
  if (item.allDay) return false
  const hour = new Date(item.date).getHours()
  return hour < BUSINESS_DAY_START || hour >= BUSINESS_DAY_END
}

export function nextCalendarItem(items: readonly CalendarItem[], now: Date): CalendarItem | null {
  return items
    .filter((item) => !item.allDay && new Date(item.date).getTime() >= now.getTime())
    .slice()
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0] ?? null
}

export function failedCalendarSources(sources: CalendarSourceState): CalendarSource[] {
  return (Object.keys(sources) as CalendarSource[]).filter((source) => sources[source] === "failed")
}
