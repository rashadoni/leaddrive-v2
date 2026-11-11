/**
 * When the line asks Zeytun's 1C again (owner 2026-11-11: «принимаю»). Zeytun's
 * programmer: their API serves many clients besides us, and the pharmacy list
 * changes once or twice a day. Every download here is one request to 1C; the
 * half-hourly cron tick only looks at our own attempt record.
 *
 * - Pharmacy list (ListClients, ~1.5 min): at 07:00 and 19:00 Baku.
 * - Stock and prices (AvailableBalances): hourly 09:00–18:00 Baku, every three
 *   hours at night, fresh again by 09:00. The line tells pharmacies how much is
 *   left, so the working day keeps the hourly copy.
 *
 * Each "next" is a few minutes early on purpose: the cron tick that runs at the
 * hour must find the download due, or the schedule slips by a tick (an hourly
 * interval on half-hourly ticks became every 1.5 h).
 */

/** Azerbaijan: UTC+4 all year. */
const BAKU_OFFSET_MS = 4 * 3_600_000
const HOUR = 3_600_000
const EARLY = 5 * 60_000

const PHARMACY_LIST_HOURS = [7, 19]
const STOCK_DAY_FROM = 9, STOCK_DAY_TO = 18
const STOCK_DAY_EVERY = HOUR, STOCK_NIGHT_EVERY = 3 * HOUR

/** The instant of hh:00 Baku on the Baku day that contains `now`, shifted by `days`. */
function bakuHour(now: number, hour: number, days = 0): number {
  const local = now + BAKU_OFFSET_MS
  const midnight = local - (((local % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR))
  return midnight + days * 24 * HOUR + hour * HOUR - BAKU_OFFSET_MS
}

/** The first 07:00 or 19:00 Baku after `now`, a few minutes early. */
export function nextPharmacyListAt(now: number): number {
  for (const days of [0, 1]) {
    for (const hour of PHARMACY_LIST_HOURS) {
      const at = bakuHour(now, hour, days) - EARLY
      if (at > now) return at
    }
  }
  return bakuHour(now, PHARMACY_LIST_HOURS[0], 2) - EARLY
}

/** After a stock download at `now`: an hour later by day, three at night, never later than the morning's first. */
export function nextStockAt(now: number): number {
  const hour = Math.floor((((now + BAKU_OFFSET_MS) % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR) / HOUR)
  if (hour >= STOCK_DAY_FROM && hour < STOCK_DAY_TO) return now + STOCK_DAY_EVERY - EARLY
  const morning = bakuHour(now, STOCK_DAY_FROM, hour >= STOCK_DAY_TO ? 1 : 0) - EARLY
  return Math.min(now + STOCK_NIGHT_EVERY - EARLY, Math.max(morning, now + EARLY))
}
