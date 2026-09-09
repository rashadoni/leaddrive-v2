/**
 * Working hours for the web chat widget.
 *
 * Schema in DB (widget.workingHours JSON):
 *   {
 *     timezone: "Europe/Warsaw",        // optional; defaults to system TZ
 *     mon: [["09:00", "18:00"]],
 *     tue: [["09:00", "18:00"]],
 *     ...
 *     sat: [],                          // empty = closed
 *     sun: []
 *   }
 *
 * When workingHours is null or an empty object, the widget is treated as "always online".
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

type Range = [string, string]
interface WorkingHoursConfig {
  timezone?: string
  [day: string]: Range[] | string | undefined
}

export function isWidgetOnline(hours: unknown, now: Date = new Date()): boolean {
  if (!hours || typeof hours !== "object") return true
  const cfg = hours as WorkingHoursConfig

  // Build weekday + HH:MM in the configured timezone (fallback: server local)
  const tz = cfg.timezone || undefined
  let weekdayIdx: number
  let hhmm: string
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
    const wd = parts.find(p => p.type === "weekday")?.value || ""
    const hour = parts.find(p => p.type === "hour")?.value || "00"
    const minute = parts.find(p => p.type === "minute")?.value || "00"
    const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    weekdayIdx = wdMap[wd] ?? now.getDay()
    hhmm = `${hour}:${minute}`
  } catch {
    weekdayIdx = now.getDay()
    hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  }

  const dayKey = DAY_KEYS[weekdayIdx]
  const ranges = cfg[dayKey]

  // Config exists but day is missing = always online (partial config). Require explicit empty [] to mean closed.
  if (ranges === undefined) return true
  if (!Array.isArray(ranges)) return true

  if (ranges.length === 0) return false

  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2) continue
    const [from, to] = r
    if (hhmm >= from && hhmm < to) return true
  }
  return false
}
