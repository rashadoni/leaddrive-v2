/**
 * Meter reading validator — R6 slice 1 + slice-2 meter_replacement.
 *
 * Validates a candidate `meter_readings` row before INSERT. Rules:
 *   • source / quality must be in allow-list (DB CHECK also fires, but
 *     this lets callers fail fast with a typed error).
 *   • cumulativeValue ≥ 0 (matches DB CHECK).
 *   • readingAt is a finite Date.
 *   • unit is a non-empty short string (matches DB length check).
 *   • If prior reading exists:
 *       - readingAt > prior.readingAt (strict — readings are time-ordered)
 *       - For NEITHER corrected NOR meter_replacement sources:
 *         cumulativeValue ≥ prior.cumulativeValue
 *         (counter-rollback is not a normal event — meters only count
 *         up; a rollback usually means meter swap or read error)
 *       - unit matches prior.unit (caller doesn't silently swap units)
 *       - intervalValue check (when supplied) is SKIPPED for
 *         meter_replacement (new meter starts fresh; interval against
 *         old counter would be nonsensical)
 *   • source='corrected' MUST supply supersedesReadingId (DB CHECK enforces).
 *   • source='meter_replacement' MUST NOT supply supersedesReadingId
 *     (slice-2 contract — the new monotonic series is independent of
 *     the old meter's readings).
 *
 * Pure synchronous. No DB access — caller hands in the prior reading.
 */
import {
  READING_QUALITIES,
  READING_SOURCES,
  type ReadingQuality,
  type ReadingSource,
  type ValidateMeterReadingInput,
  type ValidateMeterReadingResult,
} from "./types"

function isReadingSource(v: unknown): v is ReadingSource {
  return (
    typeof v === "string" && (READING_SOURCES as readonly string[]).includes(v)
  )
}

function isReadingQuality(v: unknown): v is ReadingQuality {
  return (
    typeof v === "string" &&
    (READING_QUALITIES as readonly string[]).includes(v)
  )
}

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

const DEFAULT_INTERVAL_TOLERANCE = 0.0001

export function validateMeterReading(
  input: ValidateMeterReadingInput
): ValidateMeterReadingResult {
  // ── Enum gates
  if (!isReadingSource(input.source)) {
    return {
      ok: false,
      error: `unknown source "${String(input.source)}"`,
      field: "source",
    }
  }
  if (!isReadingQuality(input.quality)) {
    return {
      ok: false,
      error: `unknown quality "${String(input.quality)}"`,
      field: "quality",
    }
  }
  // ── Field-shape gates
  if (!isFiniteDate(input.readingAt)) {
    return {
      ok: false,
      error: "readingAt must be a finite Date",
      field: "readingAt",
    }
  }
  if (!isFiniteNonNegative(input.cumulativeValue)) {
    return {
      ok: false,
      error: "cumulativeValue must be a finite non-negative number",
      field: "cumulativeValue",
    }
  }
  if (
    typeof input.unit !== "string" ||
    input.unit.length === 0 ||
    input.unit.length > 16
  ) {
    return {
      ok: false,
      error: "unit must be a non-empty string of length 1..16",
      field: "unit",
    }
  }
  if (
    input.intervalValue !== null &&
    input.intervalValue !== undefined &&
    !Number.isFinite(input.intervalValue)
  ) {
    return {
      ok: false,
      error: "intervalValue must be a finite number when supplied",
      field: "intervalValue",
    }
  }

  // ── Source-coherence on supersedesReadingId
  if (input.source === "corrected") {
    if (
      input.supersedesReadingId === null ||
      input.supersedesReadingId === undefined ||
      typeof input.supersedesReadingId !== "string" ||
      input.supersedesReadingId.length === 0
    ) {
      return {
        ok: false,
        error: "source='corrected' requires supersedesReadingId",
        field: "supersedesReadingId",
      }
    }
  } else if (input.source === "meter_replacement") {
    // Slice-2 invariant: meter_replacement starts a fresh monotonic
    // series; it does NOT supersede any specific prior reading.
    // Reject the linkage to prevent operators from accidentally
    // mixing the two semantics (corrected = "this row replaces row X";
    // meter_replacement = "new physical meter, prior series ended").
    if (
      input.supersedesReadingId !== null &&
      input.supersedesReadingId !== undefined &&
      input.supersedesReadingId !== ""
    ) {
      return {
        ok: false,
        error:
          "source='meter_replacement' must not supply supersedesReadingId (use source='corrected' if linking to a specific prior reading)",
        field: "supersedesReadingId",
      }
    }
  }

  // ── Prior-reading continuity
  const prior = input.prior
  if (prior !== null && prior !== undefined) {
    if (!isFiniteDate(prior.readingAt)) {
      return {
        ok: false,
        error: "prior.readingAt must be a finite Date",
        field: "prior.readingAt",
      }
    }
    if (!isFiniteNonNegative(prior.cumulativeValue)) {
      return {
        ok: false,
        error: "prior.cumulativeValue must be a finite non-negative number",
        field: "prior.cumulativeValue",
      }
    }
    if (typeof prior.unit !== "string" || prior.unit.length === 0) {
      return {
        ok: false,
        error: "prior.unit must be a non-empty string",
        field: "prior.unit",
      }
    }
    // Time monotonicity
    if (input.readingAt.getTime() <= prior.readingAt.getTime()) {
      return {
        ok: false,
        error:
          "readingAt must be strictly after prior.readingAt (readings are time-ordered)",
        field: "readingAt",
      }
    }
    // Unit consistency
    if (input.unit !== prior.unit) {
      return {
        ok: false,
        error: `unit "${input.unit}" does not match prior unit "${prior.unit}"`,
        field: "unit",
      }
    }
    // Counter monotonicity (only when NOT correcting AND NOT a meter
    // replacement — both legitimately roll back).
    //   • source='corrected'  → row replaces a specific prior reading;
    //                           cumulative may be lower than prior.
    //   • source='meter_replacement' → new physical meter; cumulative
    //                                  starts fresh from 0 (or wherever
    //                                  the new meter shipped).
    const allowsRollback =
      input.source === "corrected" || input.source === "meter_replacement"
    if (!allowsRollback && input.cumulativeValue < prior.cumulativeValue) {
      return {
        ok: false,
        error: `cumulativeValue ${input.cumulativeValue} < prior ${prior.cumulativeValue} (counter rollback requires source='corrected' or 'meter_replacement')`,
        field: "cumulativeValue",
      }
    }
    // Interval coherence (if supplied). Skipped for meter_replacement —
    // computing (newMeter.cumulative − oldMeter.cumulative) is
    // nonsensical when the two are different physical devices.
    // Corrected source's "interval" is well-defined relative to the
    // row it supersedes (which IS the same meter), so the check still
    // applies there.
    if (
      input.intervalValue !== null &&
      input.intervalValue !== undefined &&
      input.source !== "meter_replacement"
    ) {
      const expectedInterval = input.cumulativeValue - prior.cumulativeValue
      const tolerance = input.intervalTolerance ?? DEFAULT_INTERVAL_TOLERANCE
      if (Math.abs(input.intervalValue - expectedInterval) > tolerance) {
        return {
          ok: false,
          error: `intervalValue ${input.intervalValue} does not match (cumulative − prior.cumulative) = ${expectedInterval}`,
          field: "intervalValue",
        }
      }
    }
  }

  return { ok: true }
}
