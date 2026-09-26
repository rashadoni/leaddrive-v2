import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"

export type MtmPhotoPeriod = "today" | "week" | "all"

/**
 * The first instant of "today" or "this week" (Monday) in the organization's
 * timezone. Review of #205: the photos page used the browser's clock, so a
 * manager abroad — or a laptop set to UTC — saw a different "today" from the
 * one every other MTM screen uses.
 */
export function mtmPhotoPeriodStart(period: MtmPhotoPeriod, now: Date, timezone: string): number {
  if (period === "all") return Number.NEGATIVE_INFINITY
  const today = currentDateKey(now, timezone)
  if (period === "today") return localDateKeyToUtc(today, timezone).getTime()
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay()
  return localDateKeyToUtc(addDateKeyDays(today, -((weekday + 6) % 7)), timezone).getTime()
}
