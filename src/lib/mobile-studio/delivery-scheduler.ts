/**
 * Delivery scheduler — C2 slice 1.
 *
 * Given a tenant's quiet-hours window + an asOf timestamp, returns
 * `canDeliver` boolean + `nextDeliveryAt` if currently blocked.
 *
 *   No quiet hours configured (both NULL or start === end) → always deliver.
 *   Otherwise: quiet hours are a contiguous block in [start, end). If the
 *   block wraps midnight (start > end), then "quiet" is [start, 24) ∪ [0, end).
 *
 *   Local hour is computed using the tenant's `timezone` (IANA name) via
 *   Intl.DateTimeFormat. Slice-1 does NOT do per-recipient timezone —
 *   tenant-uniform.
 *
 * Pure synchronous. No Prisma imports.
 */
import {
  type CheckDeliveryInput,
  type CheckDeliveryResult,
  type DeliveryCheckResult,
  type DeliveryWindow,
} from "./types"

const VALID_HOUR_MIN = 0
const VALID_HOUR_MAX = 23

function isValidHour(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= VALID_HOUR_MIN &&
    n <= VALID_HOUR_MAX
  )
}

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/**
 * Compute the hour-of-day (0..23) at `at` in the given IANA timezone.
 * Returns null if the timezone is invalid.
 */
function hourInTimezone(at: Date, timezone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
    })
    const part = fmt.formatToParts(at).find((p) => p.type === "hour")
    if (!part) return null
    const h = parseInt(part.value, 10)
    // Intl can return "24" instead of "00" in some implementations — normalise.
    if (h === 24) return 0
    if (Number.isInteger(h) && h >= 0 && h <= 23) return h
    return null
  } catch {
    return null
  }
}

/**
 * Determine whether `hour` falls inside the quiet-hours block [start, end).
 * Handles wrap-around (start > end).
 */
function isInQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false // no quiet hours
  if (start < end) {
    return hour >= start && hour < end
  }
  // Wrap: e.g. start=22, end=8 → quiet is [22, 24) ∪ [0, 8)
  return hour >= start || hour < end
}

/**
 * Given current local hour + quiet config, compute hours-until-window-opens.
 */
function hoursUntilEnd(hour: number, start: number, end: number): number {
  if (start === end) return 0 // no quiet hours
  // We're in quiet hours, by precondition of the caller. Find distance to `end`.
  if (start < end) {
    // Non-wrap: distance from hour to end.
    return end - hour
  }
  // Wrap: end could be earlier in the next day's morning.
  if (hour >= start) {
    // We're past start before midnight; distance = (24 - hour) + end.
    return 24 - hour + end
  }
  // We're after midnight, before end.
  return end - hour
}

export function checkDelivery(input: CheckDeliveryInput): CheckDeliveryResult {
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a valid Date" }
  }
  if (!input.window || typeof input.window !== "object") {
    return { ok: false, error: "window must be an object" }
  }
  const w: DeliveryWindow = input.window

  // No quiet hours configured at all → always deliver.
  if (w.quietHoursStart === undefined && w.quietHoursEnd === undefined) {
    const check: DeliveryCheckResult = {
      canDeliver: true,
      nextDeliveryAt: null,
      localHourAtAsOf: null,
    }
    return { ok: true, check }
  }

  // If one endpoint is set but not the other, that's a config error.
  if (
    (w.quietHoursStart === undefined) !== (w.quietHoursEnd === undefined)
  ) {
    return {
      ok: false,
      error: "window must have both quietHoursStart and quietHoursEnd, or neither",
    }
  }

  if (!isValidHour(w.quietHoursStart) || !isValidHour(w.quietHoursEnd)) {
    return {
      ok: false,
      error: "quietHoursStart / quietHoursEnd must be integers in 0..23",
    }
  }

  // Resolve timezone. Default to UTC.
  const tz = typeof w.timezone === "string" && w.timezone.length > 0 ? w.timezone : "UTC"

  const localHour = hourInTimezone(input.asOf, tz)
  if (localHour === null) {
    return {
      ok: false,
      error: `timezone "${tz}" is not a valid IANA zone`,
    }
  }

  if (!isInQuietHours(localHour, w.quietHoursStart, w.quietHoursEnd)) {
    const check: DeliveryCheckResult = {
      canDeliver: true,
      nextDeliveryAt: null,
      localHourAtAsOf: localHour,
    }
    return { ok: true, check }
  }

  // We're in quiet hours. Compute next allowed delivery time.
  const hoursToWait = hoursUntilEnd(localHour, w.quietHoursStart, w.quietHoursEnd)
  const nextDeliveryAt = new Date(input.asOf.getTime() + hoursToWait * 60 * 60 * 1000)
  const check: DeliveryCheckResult = {
    canDeliver: false,
    nextDeliveryAt,
    localHourAtAsOf: localHour,
  }
  return { ok: true, check }
}
