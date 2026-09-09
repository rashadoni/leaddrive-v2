/**
 * Who finds out that a promise was missed, and when.
 *
 * The owner asked for a missed commitment to be visible to the salesperson,
 * their management, and the marketing team that sourced the lead. The order and
 * the delay matter more than the list does.
 *
 * A salesperson whose manager learns of a slip in the same second they do stops
 * recording commitments — not because they are dishonest, but because the only
 * way to avoid an instant black mark is to never write the promise down. The
 * mechanism then reports perfect compliance on an empty dataset, which is worse
 * than the problem it replaced. So the first window belongs to the person who
 * can still fix it quietly; management is told only if it is still open after
 * the grace period.
 *
 * Marketing gets no alert at all here, deliberately. They cannot make the call,
 * and an alert to someone who cannot act is an alert that gets muted — and then
 * the people who CAN act stop reading the channel it arrives in. Their view is
 * a digest, built from the same rows.
 */

export const MANAGER_GRACE_MINUTES = 45

export type CommitmentEscalationState = {
  dueDate: Date
  /** When the assignee was told it had come due. */
  overdueNotifiedAt: Date | null
  /** When it was raised above them. */
  escalatedAt: Date | null
  /** Set once the work is finished; a completed commitment escalates to nobody. */
  completedAt: Date | null
}

export type EscalationStep = "none" | "notify-assignee" | "escalate-manager"

export function nextEscalationStep(state: CommitmentEscalationState, now: Date): EscalationStep {
  if (state.completedAt) return "none"
  if (now.getTime() < state.dueDate.getTime()) return "none"
  if (!state.overdueNotifiedAt) return "notify-assignee"
  if (state.escalatedAt) return "none"
  // Measured from the deadline, not from when we managed to send the first
  // notice: a cron that ran late must not hand the salesperson a shorter grace
  // period than the next one gets.
  const graceEnds = state.dueDate.getTime() + MANAGER_GRACE_MINUTES * 60_000
  return now.getTime() >= graceEnds ? "escalate-manager" : "none"
}
