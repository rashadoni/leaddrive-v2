/**
 * Aggregate functions — N6 Phase 4 slice 1.
 *
 * Pure number-cruncher: takes an array of (possibly mixed-type) values
 * and the chosen aggregate function, returns the numeric result.
 * Non-finite + non-numeric values are skipped so a single bad row
 * doesn't poison the aggregate; the engine surfaces the skip count
 * via `childCount`.
 *
 * Returns null when no usable values remain — caller persists null
 * which the UI displays as "—" (vs zero, which is a meaningful value
 * for sum/count).
 */
import type { AggregateFn } from "./types"

export interface CoerceOptions {
  /**
   * When false (default), Date values coerce to epoch ms — only
   * meaningful for min/max ordering. When true, Date values are
   * rejected (returns null). Set true for sum/avg so a date column
   * doesn't produce a nonsensical millisecond sum.
   */
  rejectDates?: boolean
}

/**
 * Coerce a raw value into a finite number, or null if uncoerceable.
 * Booleans → 0/1 (lets a count-like sum over a flag column work);
 * strings parsed via Number(); NaN/Infinity collapse to null;
 * Dates → epoch ms unless `rejectDates` is set (used by sum/avg
 * which would otherwise return a meaningless ms aggregate).
 */
export function coerceNumeric(value: unknown, options: CoerceOptions = {}): number | null {
  if (value == null) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "string") {
    const trimmed = value.trim()
    // JS quirk: Number("") === 0, but for our purposes an empty string
    // is "no data" not "zero". Treat as null so it's skipped.
    if (trimmed.length === 0) return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  if (value instanceof Date) return options.rejectDates ? null : value.getTime()
  // Prisma.Decimal (and any Decimal.js-compatible object) — convert via toNumber()
  if (typeof value === "object" && typeof (value as any).toNumber === "function") {
    const n = (value as any).toNumber()
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Apply `fn` to `values`. `values` is the raw set extracted from
 * child rows; this helper does the coercion + null-skipping in one
 * pass so callers don't have to.
 *
 * For `count`, the field-value array is ignored — we count present
 * (non-null) rows. The caller passes one entry per child row.
 */
export function aggregate(fn: AggregateFn, values: readonly unknown[]): number | null {
  if (fn === "count") return values.length

  // sum/avg over a Date column would emit a meaningless ms aggregate
  // — reject Dates for sum/avg; allow them for min/max where ordering
  // by epoch ms IS the desired "earliest/latest" semantic.
  const rejectDates = fn === "sum" || fn === "avg"
  const nums: number[] = []
  for (const v of values) {
    const n = coerceNumeric(v, { rejectDates })
    if (n !== null) nums.push(n)
  }
  if (nums.length === 0) return null

  switch (fn) {
    case "sum": {
      let s = 0
      for (const n of nums) s += n
      return s
    }
    case "avg": {
      let s = 0
      for (const n of nums) s += n
      return s / nums.length
    }
    case "min": {
      let m = nums[0]
      for (let i = 1; i < nums.length; i++) if (nums[i] < m) m = nums[i]
      return m
    }
    case "max": {
      let m = nums[0]
      for (let i = 1; i < nums.length; i++) if (nums[i] > m) m = nums[i]
      return m
    }
    default: {
      const exhaustive: never = fn
      throw new Error(`Unsupported aggregate function: ${exhaustive}`)
    }
  }
}
