/**
 * B10 milestone-status-evaluator — slice-1 pure helper.
 *
 * Given a milestone's current state + reference time, determine:
 *   • What status SHOULD it be (e.g. flipped to "missed" once overdue)?
 *   • Does it need a transition write?
 *   • How many seconds until/past the deadline?
 *
 * Slice-2 cron worker walks active milestones and calls this for each,
 * applying the suggested transition if any.
 *
 * Pure function: no DB, no clock.
 *
 * Decision tree:
 *   • Terminal status (met / waived) → keep, secondsToDeadline = null
 *   • "missed" status:
 *     - Operator may flip to met/waived (handled by separate route)
 *     - Helper itself doesn't auto-recover; leaves as missed.
 *     - secondsToDeadline = negative (post-deadline)
 *   • "in_progress" / "pending":
 *     - If asOf < dueAt → keep status, secondsToDeadline = positive
 *     - If asOf >= dueAt → suggest "missed" transition
 */

import {
  MILESTONE_STATUSES,
  MILESTONE_STATUS_TRANSITIONS,
  type MilestoneStatus,
  type MilestoneStatusEvaluationInput,
  type MilestoneStatusEvaluationResult,
} from "./types"

/**
 * Returns the effective status + transition recommendation.
 *
 * Defensive behaviors:
 *   • Unknown status → keep, no transition, secondsToDeadline = null.
 *   • met/waived terminal → secondsToDeadline = null, needsTransition false.
 *   • missed with NULL missedAt (data corruption) → keep but flag in
 *     metadata? slice-2's call.
 */
export function evaluateMilestoneStatus(
  input: MilestoneStatusEvaluationInput,
): MilestoneStatusEvaluationResult {
  const { milestone, asOf } = input

  if (!MILESTONE_STATUSES.includes(milestone.status)) {
    return {
      effectiveStatus: milestone.status,
      needsTransition: false,
      secondsToDeadline: null,
      isOverdueButNotMissed: false,
    }
  }

  // Terminal statuses — nothing to do.
  if (milestone.status === "met" || milestone.status === "waived") {
    return {
      effectiveStatus: milestone.status,
      needsTransition: false,
      secondsToDeadline: null,
      isOverdueButNotMissed: false,
    }
  }

  const dueMs = milestone.dueAt.getTime()
  const asOfMs = asOf.getTime()
  const secondsToDeadline = Math.round((dueMs - asOfMs) / 1000)

  // Already missed — operator may still flip but helper leaves as-is.
  if (milestone.status === "missed") {
    return {
      effectiveStatus: "missed",
      needsTransition: false,
      secondsToDeadline,
      isOverdueButNotMissed: false,
    }
  }

  // pending / in_progress
  if (asOfMs >= dueMs) {
    return {
      effectiveStatus: "missed",
      needsTransition: true,
      secondsToDeadline,
      isOverdueButNotMissed: true,
    }
  }

  return {
    effectiveStatus: milestone.status,
    needsTransition: false,
    secondsToDeadline,
    isOverdueButNotMissed: false,
  }
}

// ── State machine helpers (mirror DB triggers) ──────────────────

export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return (
    typeof value === "string" &&
    MILESTONE_STATUSES.includes(value as MilestoneStatus)
  )
}

export function canTransitionMilestoneStatus(
  current: MilestoneStatus,
  next: MilestoneStatus,
): boolean {
  if (current === next) return true
  return MILESTONE_STATUS_TRANSITIONS[current].includes(next)
}
