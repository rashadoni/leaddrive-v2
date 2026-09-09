/**
 * Outage impact calculator — R6 slice 1.
 *
 * Given an outage window + affected meter snapshot, compute the
 * regulatory-reporting inputs the utility cares about:
 *
 *   • Customer-Minutes-Interrupted (CMI) = sum of per-meter down-minutes.
 *   • Outage duration (the bulk window).
 *   • Average down-minutes per meter.
 *
 * SAIDI / SAIFI / CAIDI are derived metrics caller computes from a
 * sliding window across many outages — this helper only emits the
 * single-outage contributions. Aggregation is the slice-2 reporting job.
 *
 * Per-meter restoration:
 *   • If `perMeterRestorations` is empty/undefined → all meters
 *     restored at `actualEndAt` (bulk).
 *   • Else → for each provided entry, the meter restored at that
 *     timestamp; remaining (affectedMeterCount − perMeter.length)
 *     meters fall back to bulk window.
 *
 * Pure synchronous. Caller (slice-2 cron) fetches actualStartAt /
 * actualEndAt / affectedMeterCount from the resolved outage row.
 */
import type {
  OutageImpactInput,
  OutageImpactResult,
  OutageImpactSummary,
} from "./types"

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

const MS_PER_MINUTE = 60 * 1000

export function calculateOutageImpact(
  input: OutageImpactInput
): OutageImpactResult {
  if (!isFiniteDate(input.actualStartAt)) {
    return { ok: false, error: "actualStartAt must be a finite Date" }
  }
  if (!isFiniteDate(input.actualEndAt)) {
    return { ok: false, error: "actualEndAt must be a finite Date" }
  }
  if (input.actualEndAt.getTime() <= input.actualStartAt.getTime()) {
    return {
      ok: false,
      error: "actualEndAt must be strictly after actualStartAt",
    }
  }
  if (
    !Number.isFinite(input.affectedMeterCount) ||
    input.affectedMeterCount < 0 ||
    !Number.isInteger(input.affectedMeterCount)
  ) {
    return {
      ok: false,
      error: "affectedMeterCount must be a non-negative integer",
    }
  }

  const startMs = input.actualStartAt.getTime()
  const endMs = input.actualEndAt.getTime()
  const bulkDownMinutes = (endMs - startMs) / MS_PER_MINUTE

  let totalDownMinutes = 0
  const perMeter = input.perMeterRestorations ?? []
  if (perMeter.length > input.affectedMeterCount) {
    return {
      ok: false,
      error: `perMeterRestorations.length (${perMeter.length}) exceeds affectedMeterCount (${input.affectedMeterCount})`,
    }
  }
  for (const r of perMeter) {
    if (!isFiniteDate(r.restoredAt)) {
      return {
        ok: false,
        error: "perMeterRestorations[].restoredAt must be a finite Date",
      }
    }
    const restoredMs = r.restoredAt.getTime()
    if (restoredMs < startMs) {
      return {
        ok: false,
        error: "perMeterRestorations[].restoredAt must be ≥ actualStartAt",
      }
    }
    if (restoredMs > endMs) {
      return {
        ok: false,
        error:
          "perMeterRestorations[].restoredAt must be ≤ actualEndAt (use the bulk window if a meter restored after)",
      }
    }
    totalDownMinutes += (restoredMs - startMs) / MS_PER_MINUTE
  }
  const remainingMeters = input.affectedMeterCount - perMeter.length
  totalDownMinutes += remainingMeters * bulkDownMinutes

  const customerMinutesInterrupted = totalDownMinutes
  const averagePerMeterMinutes =
    input.affectedMeterCount === 0
      ? 0
      : customerMinutesInterrupted / input.affectedMeterCount

  const summary: OutageImpactSummary = {
    customerMinutesInterrupted,
    outageDurationMinutes: bulkDownMinutes,
    averagePerMeterMinutes,
  }
  return { ok: true, summary }
}
