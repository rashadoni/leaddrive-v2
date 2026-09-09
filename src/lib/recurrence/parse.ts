/**
 * Recurrence rule parser + next-date calculator — Roadmap #22.
 *
 * Format (intentionally smaller than RFC 5545 — covers the 99% case):
 *   daily                  — every day
 *   weekly                 — every 7 days
 *   monthly                — every month, same day-of-month
 *   yearly                 — every year, same date
 *   every:N:unit           — every N units (unit ∈ day|week|month)
 *                            N must be a positive integer ≥ 1, ≤ 365
 *
 * Examples:
 *   nextDueDate("2026-06-01", "daily")             → 2026-06-02
 *   nextDueDate("2026-06-01", "weekly")            → 2026-06-08
 *   nextDueDate("2026-06-01", "monthly")           → 2026-07-01
 *   nextDueDate("2026-06-01", "every:3:day")       → 2026-06-04
 *   nextDueDate("2026-01-31", "monthly")           → 2026-02-28 (clamped)
 *
 * Edge cases handled:
 *   - Feb 29 / Jan 31 → clamp to the last day of the target month
 *   - Year rollover for monthly + yearly
 *   - Invalid rules → null (caller decides whether that's a 400 or a no-op)
 */

export type RecurrenceUnit = "day" | "week" | "month"

export interface ParsedRecurrence {
  unit: RecurrenceUnit | "year"
  interval: number
}

export function parseRecurrenceRule(rule: string): ParsedRecurrence | null {
  if (!rule || typeof rule !== "string") return null
  const trimmed = rule.trim().toLowerCase()

  // Bare presets
  if (trimmed === "daily") return { unit: "day", interval: 1 }
  if (trimmed === "weekly") return { unit: "week", interval: 1 }
  if (trimmed === "monthly") return { unit: "month", interval: 1 }
  if (trimmed === "yearly") return { unit: "year", interval: 1 }

  // `every:N:unit`
  const match = trimmed.match(/^every:(\d+):(day|week|month)$/)
  if (match) {
    const interval = parseInt(match[1], 10)
    if (interval < 1 || interval > 365) return null
    const unit = match[2] as RecurrenceUnit
    return { unit, interval }
  }

  return null
}

/**
 * Compute the next due date by advancing `from` by the parsed recurrence.
 *
 * For "monthly" / "yearly": if the source day-of-month doesn't exist in
 * the target month (e.g. Jan 31 + 1 month = Feb 28/29), clamp to the last
 * valid day of that month.
 */
export function addRecurrence(from: Date, parsed: ParsedRecurrence): Date {
  const next = new Date(from.getTime())

  switch (parsed.unit) {
    case "day":
      next.setUTCDate(next.getUTCDate() + parsed.interval)
      return next

    case "week":
      next.setUTCDate(next.getUTCDate() + parsed.interval * 7)
      return next

    case "month": {
      const targetMonth = next.getUTCMonth() + parsed.interval
      const sourceDay = next.getUTCDate()
      // Set day=1 first so month overflow doesn't accidentally roll the
      // day forward (e.g. Jan 31 → setMonth(1) = Mar 3, wrong).
      next.setUTCDate(1)
      next.setUTCMonth(targetMonth)
      // Last day of the new month (day=0 of next month)
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
      next.setUTCDate(Math.min(sourceDay, lastDay))
      return next
    }

    case "year": {
      const targetYear = next.getUTCFullYear() + parsed.interval
      const sourceMonth = next.getUTCMonth()
      const sourceDay = next.getUTCDate()
      next.setUTCDate(1)
      next.setUTCFullYear(targetYear)
      next.setUTCMonth(sourceMonth)
      // Feb 29 → Feb 28 on non-leap years
      const lastDay = new Date(Date.UTC(targetYear, sourceMonth + 1, 0)).getUTCDate()
      next.setUTCDate(Math.min(sourceDay, lastDay))
      return next
    }
  }
}

/**
 * Convenience wrapper — parse + compute in one go. Returns null on parse
 * failure so callers can branch with a single null check.
 */
export function nextDueDate(from: Date | string, rule: string): Date | null {
  const parsed = parseRecurrenceRule(rule)
  if (!parsed) return null
  const fromDate = typeof from === "string" ? new Date(from) : from
  if (isNaN(fromDate.getTime())) return null
  return addRecurrence(fromDate, parsed)
}

/**
 * Human-readable label for the rule. Used by the task-form select +
 * detail-page badge.
 *
 * Locale-aware: pass a translator (`t`) that knows the four bare-preset
 * keys (`recurrenceDaily`/`Weekly`/`Monthly`/`Yearly`) + an
 * `recurrenceEvery` ICU template like `"Every {count} {unit}s"`. The
 * caller's locale wins. If no translator is provided we fall back to
 * English so the function stays callable from server contexts (logs,
 * notification messages) that don't have a `useTranslations` available.
 *
 * Returns the raw rule when it doesn't parse so the UI can still show
 * SOMETHING useful (truthful gap signal — "yo, your DB has 'fortnightly'").
 */
export type RecurrenceTranslator = (
  key:
    | "recurrenceDaily" | "recurrenceWeekly" | "recurrenceMonthly" | "recurrenceYearly"
    | "recurrenceEvery"
    | "recurrenceUnitDay" | "recurrenceUnitWeek" | "recurrenceUnitMonth" | "recurrenceUnitYear",
  vars?: Record<string, string | number>,
) => string

// English plural-aware fallback when no translator passed (used by server
// logs / notifications). For locales, the translator handles plural forms.
function englishUnitLabel(unit: ParsedRecurrence["unit"], count: number): string {
  const plural = count === 1 ? unit : `${unit}s`
  return plural
}

export function describeRecurrence(rule: string, t?: RecurrenceTranslator): string {
  const parsed = parseRecurrenceRule(rule)
  if (!parsed) return rule
  if (parsed.interval === 1) {
    switch (parsed.unit) {
      case "day":   return t ? t("recurrenceDaily")   : "Daily"
      case "week":  return t ? t("recurrenceWeekly")  : "Weekly"
      case "month": return t ? t("recurrenceMonthly") : "Monthly"
      case "year":  return t ? t("recurrenceYearly")  : "Yearly"
    }
  }
  // N>1 case — resolve a localized unit name first so the ICU template
  // `recurrenceEvery` doesn't end up with a bare English word in the
  // middle of a RU/AZ string (architect regression catch on the first
  // P2 fix). The translator returns the unit string per locale; we then
  // feed both `count` and the localized `unit` into the outer template.
  if (t) {
    const unitKey =
      parsed.unit === "day"   ? "recurrenceUnitDay"   :
      parsed.unit === "week"  ? "recurrenceUnitWeek"  :
      parsed.unit === "month" ? "recurrenceUnitMonth" :
      "recurrenceUnitYear"
    const localizedUnit = t(unitKey, { count: parsed.interval })
    return t("recurrenceEvery", { count: parsed.interval, unit: localizedUnit })
  }
  return `Every ${parsed.interval} ${englishUnitLabel(parsed.unit, parsed.interval)}`
}
