/**
 * Content metric aggregator — R11 slice 1.
 *
 * Given a list of consumption events + a time window, compute:
 *   • uniqueSubscribers — DAU/MAU input
 *   • viewStarts / viewCompletes / viewAbandons — funnel
 *   • completionRate — view_complete / view_start
 *   • avgEngagedSeconds — average across view_complete events
 *   • clicks / conversions — ad-side counters
 *
 * Filtering:
 *   • Only events with occurredAt ∈ [windowStart, windowEnd) included.
 *   • Events outside window silently dropped (slice-2 aggregator pre-
 *     filters by SQL range scan; this helper is the post-fetch reducer).
 *
 * Pure synchronous.
 */
import {
  EVENT_KINDS,
  type AggregateMetricsInput,
  type AggregateMetricsResult,
  type ConsumptionEvent,
  type ContentMetrics,
} from "./types"

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isEventKind(v: unknown): boolean {
  return typeof v === "string" && (EVENT_KINDS as readonly string[]).includes(v)
}

export function aggregateContentMetrics(
  input: AggregateMetricsInput
): AggregateMetricsResult {
  if (!Array.isArray(input.events)) {
    return { ok: false, error: "events must be an array" }
  }
  if (!isFiniteDate(input.windowStart)) {
    return { ok: false, error: "windowStart must be a finite Date" }
  }
  if (!isFiniteDate(input.windowEnd)) {
    return { ok: false, error: "windowEnd must be a finite Date" }
  }
  if (input.windowEnd.getTime() <= input.windowStart.getTime()) {
    return {
      ok: false,
      error: "windowEnd must be strictly after windowStart",
    }
  }

  const startMs = input.windowStart.getTime()
  const endMs = input.windowEnd.getTime()
  const uniqueSubs = new Set<string>()
  let viewStarts = 0
  let viewCompletes = 0
  let viewAbandons = 0
  let clicks = 0
  let conversions = 0
  let engagedSecondsSum = 0
  let engagedSecondsCount = 0

  for (const e of input.events) {
    if (e === null || typeof e !== "object") {
      return { ok: false, error: "every event must be an object" }
    }
    if (!isFiniteDate(e.occurredAt)) {
      return { ok: false, error: "event.occurredAt must be a finite Date" }
    }
    if (!isEventKind(e.eventKind)) {
      return {
        ok: false,
        error: `unknown event.eventKind "${String(e.eventKind)}"`,
      }
    }
    const t = e.occurredAt.getTime()
    if (t < startMs || t >= endMs) continue // out-of-window, skip
    if (typeof e.subscriberId === "string" && e.subscriberId.length > 0) {
      uniqueSubs.add(e.subscriberId)
    }
    switch (e.eventKind) {
      case "view_start":
        viewStarts++
        break
      case "view_complete":
        viewCompletes++
        if (
          e.engagedSeconds !== null &&
          e.engagedSeconds !== undefined &&
          Number.isFinite(e.engagedSeconds) &&
          e.engagedSeconds >= 0
        ) {
          engagedSecondsSum += e.engagedSeconds
          engagedSecondsCount++
        }
        break
      case "view_abandon":
        viewAbandons++
        break
      case "click":
        clicks++
        break
      case "conversion":
        conversions++
        break
      // view_progress / share / bookmark — counted in uniqueSubs but not
      // in any specific funnel counter (slice-2 may add).
    }
  }

  // Slice-2: return null (not NaN) when viewStarts=0. Type-safe
  // undefined signal — see ContentMetrics.completionRate docstring.
  //
  // Defensive clamp ≤ 1: in normal operation viewCompletes is bounded
  // above by viewStarts (slice-1 validator enforces — a single
  // view_complete event requires a matching view_start). The clamp
  // defends against future validator-bypass paths (e.g. raw SQL
  // backfill, ETL imports) where the invariant could leak; capping
  // at 1.0 keeps the metric well-formed for downstream dashboards.
  const completionRate: number | null =
    viewStarts > 0 ? Math.min(viewCompletes / viewStarts, 1) : null
  const avgEngagedSeconds =
    engagedSecondsCount > 0 ? engagedSecondsSum / engagedSecondsCount : 0

  const metrics: ContentMetrics = {
    uniqueSubscribers: uniqueSubs.size,
    viewStarts,
    viewCompletes,
    viewAbandons,
    completionRate,
    avgEngagedSeconds,
    clicks,
    conversions,
  }
  return { ok: true, metrics }
}
