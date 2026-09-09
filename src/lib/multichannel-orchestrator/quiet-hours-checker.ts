/**
 * C12 quiet-hours-checker — slice-1 pure helper.
 *
 * Given a target time + policy.quietHours config, decide if the time
 * falls within any quiet-hours window.
 *
 * Time math is UTC-based with explicit hour-of-day extraction. Slice-1
 * uses UTC offsets only; slice-2 will swap to IANA tz via Intl when
 * timezone field is non-empty (left as slice-2 deferral; this slice
 * accepts the timezone but treats it as UTC).
 *
 * Window semantics:
 *   from = "21:00" to = "08:00" wraps midnight (21:00 → 23:59 + 00:00 → 07:59).
 *   from <= to is in-day (e.g. 12:00 → 14:00).
 *   from = to means an empty window (no match).
 *   dayOfWeek: "any" matches every day; integer matches only that day.
 */

import type {
  QuietHoursConfig,
  QuietHoursCheckResult,
  QuietHoursWindow,
} from "./types"

export interface QuietHoursInput {
  config: QuietHoursConfig
  asOf: Date
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Returns { inQuietHours, matchedWindow? }.
 *
 * Empty config (no windows[]) → not in quiet hours.
 * Slice-1 caveat: config.timezone is read but treated as UTC for the
 * day-of-week + hour extraction. Slice-2 will add Intl-based tz support;
 * marker code path noted inline.
 */
export function checkQuietHours(
  input: QuietHoursInput,
): QuietHoursCheckResult {
  const windows = input.config.windows
  if (!Array.isArray(windows) || windows.length === 0) {
    return { inQuietHours: false }
  }
  // Slice-1: UTC math. Slice-2 will resolve `config.timezone` via Intl.
  // For now: hours-from-UTC; behavior is documented.
  const asOfDayOfWeek = input.asOf.getUTCDay() // 0..6
  const asOfMinutes = input.asOf.getUTCHours() * 60 + input.asOf.getUTCMinutes()

  for (const window of windows) {
    if (!isValidWindow(window)) continue
    if (
      window.dayOfWeek !== "any" &&
      window.dayOfWeek !== asOfDayOfWeek
    ) {
      continue
    }
    if (isInWindow(asOfMinutes, window)) {
      return { inQuietHours: true, matchedWindow: window }
    }
  }
  return { inQuietHours: false }
}

/**
 * Compute the next "quiet hours end" instant after `asOf`.
 *
 * **SLICE-1 STUB — do not rely on this in production code.**
 * Always returns null. Slice-2 will implement proper next-end-of-window
 * calculation with Intl-based tz arithmetic; until then, the
 * orchestration worker should only consult `checkQuietHours` for the
 * point-in-time question and reschedule on the next cron tick.
 *
 * Architect pass-1 fix: previously this returned null silently without
 * the warning, risking slice-2 wiring believing it "works".
 *
 * @deprecated Slice-1 placeholder. Wire to slice-2 implementation.
 */
export function nextQuietHoursEnd(
  _input: QuietHoursInput,
): Date | null {
  return null
}

// ── Internals ───────────────────────────────────────────────────

function isValidWindow(window: QuietHoursWindow): boolean {
  if (
    window.dayOfWeek !== "any" &&
    !Number.isInteger(window.dayOfWeek)
  ) {
    return false
  }
  if (
    typeof window.dayOfWeek === "number" &&
    (window.dayOfWeek < 0 || window.dayOfWeek > 6)
  ) {
    return false
  }
  if (typeof window.from !== "string" || typeof window.to !== "string") {
    return false
  }
  if (!TIME_REGEX.test(window.from) || !TIME_REGEX.test(window.to)) {
    return false
  }
  return true
}

function isInWindow(
  asOfMinutes: number,
  window: QuietHoursWindow,
): boolean {
  const fromMin = timeToMinutes(window.from)
  const toMin = timeToMinutes(window.to)
  if (fromMin === toMin) return false // empty window
  if (fromMin < toMin) {
    // In-day window: from ≤ now < to.
    return asOfMinutes >= fromMin && asOfMinutes < toMin
  }
  // Wraps midnight: now ≥ from OR now < to.
  return asOfMinutes >= fromMin || asOfMinutes < toMin
}

function timeToMinutes(time: string): number {
  const [hh, mm] = time.split(":")
  return Number(hh) * 60 + Number(mm)
}
