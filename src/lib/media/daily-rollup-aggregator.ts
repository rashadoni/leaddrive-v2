/**
 * Daily-rollup aggregator — R11 Media slice-2.
 *
 * Pure function that buckets ConsumptionEvents by (contentId, UTC day)
 * and emits per-bucket ContentMetrics. Slice-2 cron will call this
 * over the last 24h of raw events, then write the rollup rows to a
 * `media_content_daily_rollups` table (slice-2-mini schema work).
 *
 * Inventory memo item 15.5: "Daily-rollup aggregation job: 90 days of
 * raw events kept, then rolled up to per-day per-content metrics; raw
 * events pruned after rollup." This pure helper is the per-day-bucket
 * computation; cron scheduling + DB writer come with slice-2-mini.
 *
 * Pure synchronous — no DB, no I/O. The caller provides the events.
 */
import { aggregateContentMetrics } from "./content-metric-aggregator"
import type { ConsumptionEvent, ContentMetrics } from "./types"

/**
 * One bucket per (contentId, UTC day). `day` is the UTC date string
 * `YYYY-MM-DD` of the bucket; consumers can parse if a Date object
 * is needed.
 */
export interface DailyRollupBucket {
  contentId: string
  /** UTC day boundary, `YYYY-MM-DD` format (sortable as string). */
  day: string
  /** Start of the UTC day as Date (00:00:00.000Z). Convenience. */
  dayStart: Date
  /** Aggregated metrics for this bucket (single-day window). */
  metrics: ContentMetrics
}

export interface DailyRollupInput {
  events: readonly ConsumptionEvent[]
  /**
   * Inclusive window start (UTC). The aggregator buckets events
   * whose `occurredAt` is in [windowStart, windowEnd). Both are
   * truncated to UTC-day boundaries internally — partial-day
   * windows are not supported (the rollup contract is whole UTC
   * days). Caller passes the cron-window bounds; if they aren't
   * day-aligned, the aggregator floors windowStart and ceils
   * windowEnd to the nearest UTC midnight.
   */
  windowStart: Date
  windowEnd: Date
}

export type DailyRollupResult =
  | { ok: true; buckets: DailyRollupBucket[] }
  | { ok: false; error: string }

/**
 * UTC-day key as YYYY-MM-DD (sortable). Cross-platform String(Date)
 * formatting that doesn't depend on locale/timezone of the running node.
 */
function utcDayKey(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/** Beginning of the UTC day containing `d`. */
function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  )
}

/** Next UTC midnight after `d` (one whole day forward). */
function nextUtcDayStart(d: Date): Date {
  const next = new Date(d.getTime())
  next.setUTCDate(next.getUTCDate() + 1)
  return utcDayStart(next)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
/**
 * Defensive cap on iteration. Slice-2 cron runs daily on the last
 * 24h, but a one-shot backfill against 1 year of events would still
 * stay under this cap. If a caller asks for >400 days, return
 * `ok:false` to avoid runaway iteration.
 */
const MAX_DAYS = 400

export function aggregateDailyRollups(
  input: DailyRollupInput,
): DailyRollupResult {
  if (!(input.windowStart instanceof Date) || isNaN(input.windowStart.getTime())) {
    return { ok: false, error: "windowStart must be a finite Date" }
  }
  if (!(input.windowEnd instanceof Date) || isNaN(input.windowEnd.getTime())) {
    return { ok: false, error: "windowEnd must be a finite Date" }
  }
  if (input.windowEnd.getTime() <= input.windowStart.getTime()) {
    return { ok: false, error: "windowEnd must be strictly after windowStart" }
  }

  // Floor windowStart + ceil windowEnd to UTC-day boundaries.
  const start = utcDayStart(input.windowStart)
  // ceil: if windowEnd is already at midnight, use as-is; else bump to next.
  const ceiled =
    input.windowEnd.getTime() === utcDayStart(input.windowEnd).getTime()
      ? input.windowEnd
      : nextUtcDayStart(input.windowEnd)

  const totalDays = Math.round(
    (ceiled.getTime() - start.getTime()) / MS_PER_DAY,
  )
  if (totalDays > MAX_DAYS) {
    return {
      ok: false,
      error: `rollup window spans ${totalDays} days; max is ${MAX_DAYS}. Run as multiple smaller batches.`,
    }
  }

  // Group events by (contentId, dayKey). We touch each event once.
  // Map<contentId, Map<dayKey, ConsumptionEvent[]>>
  const grouped = new Map<string, Map<string, ConsumptionEvent[]>>()
  for (const ev of input.events) {
    if (!(ev.occurredAt instanceof Date) || isNaN(ev.occurredAt.getTime())) {
      continue // skip malformed events rather than fail the batch
    }
    // Exclude events outside the (already-ceiled) window.
    if (ev.occurredAt.getTime() < start.getTime()) continue
    if (ev.occurredAt.getTime() >= ceiled.getTime()) continue
    const dayKey = utcDayKey(ev.occurredAt)
    let perContent = grouped.get(ev.contentId)
    if (!perContent) {
      perContent = new Map()
      grouped.set(ev.contentId, perContent)
    }
    let bucket = perContent.get(dayKey)
    if (!bucket) {
      bucket = []
      perContent.set(dayKey, bucket)
    }
    bucket.push(ev)
  }

  // Compute metrics per bucket. Sorted output: contentId asc, then
  // day asc, so the result is deterministic for snapshot tests.
  const buckets: DailyRollupBucket[] = []
  const sortedContentIds = [...grouped.keys()].sort()
  for (const contentId of sortedContentIds) {
    const perDay = grouped.get(contentId)!
    const sortedDays = [...perDay.keys()].sort()
    for (const day of sortedDays) {
      const events = perDay.get(day)!
      // Per-bucket window is [dayStart, dayStart + 1 day).
      const [yyyy, mm, dd] = day.split("-").map((s) => Number(s))
      const dayStart = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0))
      const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)
      const result = aggregateContentMetrics({
        events,
        windowStart: dayStart,
        windowEnd: dayEnd,
      })
      if (!result.ok) {
        return {
          ok: false,
          error: `aggregateContentMetrics failed for (${contentId}, ${day}): ${result.error}`,
        }
      }
      buckets.push({
        contentId,
        day,
        dayStart,
        metrics: result.metrics,
      })
    }
  }

  return { ok: true, buckets }
}
