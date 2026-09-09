/**
 * S3 Sales Sequences — shared helpers
 */

/**
 * Compute when the next step should fire.
 * Uses UTC millisecond arithmetic to avoid DST-shift by ±24h in local TZ.
 *
 * @param base      Reference date (enrollment time or previous step executed at)
 * @param delayDays Days offset from base (1 day = 86 400 000 ms)
 * @param opts.workdaysOnly  If true, a due date landing on Sat/Sun rolls forward
 *                           to the next Monday (UTC day-of-week — good enough for
 *                           a v1; org-timezone weekends are a future refinement).
 */
export function computeNextStepAt(base: Date, delayDays: number, opts?: { workdaysOnly?: boolean }): Date {
  const d = new Date(base.getTime() + delayDays * 86_400_000)
  if (opts?.workdaysOnly) {
    // getUTCDay: 0 = Sunday, 6 = Saturday → push to Monday.
    const day = d.getUTCDay()
    if (day === 6) d.setUTCDate(d.getUTCDate() + 2)
    else if (day === 0) d.setUTCDate(d.getUTCDate() + 1)
  }
  return d
}

/** Step types allowed in a sequence */
export const STEP_TYPES = ["email", "call", "task"] as const
export type SequenceStepType = (typeof STEP_TYPES)[number]

/** Enrollment statuses */
export const ENROLLMENT_STATUSES = ["active", "paused", "completed", "stopped"] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

/**
 * How long the runner cron leaves an OWNER-MANAGED (ownerId set) due touch in
 * the manager's queue before auto-executing it as a safety net. Ownerless
 * enrollments (API-created, no queue to appear in) are auto-run immediately —
 * the pre-cadence behavior.
 */
export const OWNED_TOUCH_GRACE_MS = 72 * 60 * 60 * 1000
