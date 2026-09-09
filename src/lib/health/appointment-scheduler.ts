/**
 * Appointment scheduler — R2 slice 1.
 *
 * Given a proposed encounter slot + already-booked slots for the same
 * provider, decide if the new booking fits or report conflicts.
 *
 * Pure synchronous. Slice-2 worker:
 *   1. Reads requested provider + time window.
 *   2. Queries existing encounters for that provider in the window
 *      (+ small surrounding buffer to detect "min gap" conflicts).
 *   3. Hands the request + slots to this helper.
 *   4. If ok=true → INSERT. If conflicts → 409 response with the list.
 *
 * Conflict rules:
 *   • Overlap = new.start < existing.end AND new.end > existing.start
 *     (half-open intervals — back-to-back at the boundary is OK by
 *     default; "min gap" rule enforces a buffer if requested).
 *   • Cancelled / no_show slots DO NOT block — they're historical.
 *   • Min gap (minutes): adjacent slots within gap minutes also
 *     conflict. Caller passes 0 for back-to-back-allowed.
 *
 * Drift guards:
 *   • Reject non-finite Date instances
 *   • Reject end ≤ start
 *   • Reject negative minGapMinutes
 *   • Reject existing slot belonging to a different provider
 *     (programmer error — caller is supposed to filter upstream;
 *      we double-check)
 */
import {
  ENCOUNTER_STATUSES,
  type AppointmentConflict,
  type EncounterStatus,
  type ScheduleAppointmentInput,
  type ScheduleAppointmentResult,
} from "./types"

const MS_PER_MINUTE = 60 * 1000

/** A slot "blocks" if its status isn't a terminal-with-no-effect. */
const BLOCKING_STATUSES: ReadonlySet<EncounterStatus> = new Set([
  "scheduled",
  "checked_in",
  "in_progress",
  "completed",
])

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isEncounterStatus(v: unknown): v is EncounterStatus {
  return (
    typeof v === "string" &&
    (ENCOUNTER_STATUSES as readonly string[]).includes(v)
  )
}

/**
 * Check the requested slot against existing slots.
 *
 * Returns `{ok: true}` if the request fits, else `{ok: false, conflicts}`
 * with the full set of blocking slots (caller may present all
 * conflicts at once rather than fail-fast on the first).
 */
export function scheduleAppointment(
  input: ScheduleAppointmentInput
): ScheduleAppointmentResult {
  const req = input.request
  if (!isFiniteDate(req.scheduledStartAt)) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "request.scheduledStartAt must be a valid finite Date",
    }
  }
  if (!isFiniteDate(req.scheduledEndAt)) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "request.scheduledEndAt must be a valid finite Date",
    }
  }
  if (req.scheduledEndAt.getTime() <= req.scheduledStartAt.getTime()) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "request.scheduledEndAt must be strictly after scheduledStartAt",
    }
  }

  const minGap = input.minGapMinutes ?? 0
  if (!Number.isFinite(minGap) || minGap < 0) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "minGapMinutes must be a finite non-negative number",
    }
  }
  const minGapMs = minGap * MS_PER_MINUTE

  const conflicts: AppointmentConflict[] = []
  const reqStart = req.scheduledStartAt.getTime()
  const reqEnd = req.scheduledEndAt.getTime()

  for (const slot of input.existingSlots) {
    if (slot.providerId !== req.providerId) {
      // Programmer error — caller passed a slot for another provider.
      // Treat as a hard conflict rather than silently ignore.
      conflicts.push({
        conflictingSlotId: slot.id,
        reason: "overlap",
      })
      continue
    }
    if (!isEncounterStatus(slot.status)) {
      // Unknown status — treat as blocking (fail-safe).
      conflicts.push({
        conflictingSlotId: slot.id,
        reason: "overlap",
      })
      continue
    }
    if (!BLOCKING_STATUSES.has(slot.status)) {
      // cancelled / no_show — historical, doesn't block.
      continue
    }
    if (
      !isFiniteDate(slot.scheduledStartAt) ||
      !isFiniteDate(slot.scheduledEndAt)
    ) {
      // Garbage slot — treat as blocking.
      conflicts.push({
        conflictingSlotId: slot.id,
        reason: "overlap",
      })
      continue
    }
    const slotStart = slot.scheduledStartAt.getTime()
    const slotEnd = slot.scheduledEndAt.getTime()

    // Overlap check (half-open intervals).
    if (reqStart < slotEnd && reqEnd > slotStart) {
      conflicts.push({
        conflictingSlotId: slot.id,
        reason: "overlap",
      })
      continue
    }
    // Min-gap check (only fires if no overlap).
    if (minGapMs > 0) {
      // Distance between intervals = max(0, max(a.start - b.end, b.start - a.end))
      // For non-overlapping intervals one of those is positive.
      const gapBefore = reqStart - slotEnd // > 0 if slot is before req
      const gapAfter = slotStart - reqEnd // > 0 if slot is after req
      const distance = gapBefore > 0 ? gapBefore : gapAfter
      if (distance > 0 && distance < minGapMs) {
        conflicts.push({
          conflictingSlotId: slot.id,
          reason: "gap_too_small",
        })
      }
    }
  }

  if (conflicts.length > 0) {
    return { ok: false, reason: "conflicts", conflicts }
  }
  return { ok: true }
}

/** Test-only export — surfaces the blocking-status set. */
export const __SCHEDULER_INTERNALS = { BLOCKING_STATUSES }
