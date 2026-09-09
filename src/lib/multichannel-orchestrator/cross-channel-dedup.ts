/**
 * C12 cross-channel-dedup — slice-1 pure helper.
 *
 * Decide whether a candidate delivery to a contact for a campaign
 * should be suppressed because the same campaign already reached the
 * contact through ANY channel within the dedup window.
 *
 * Cross-channel dedup is the central UX guarantee of the orchestrator:
 * "I won't be hit by the same campaign twice on different channels."
 *
 * Pure function: no DB.
 *
 * Dedup rule:
 *   Look back `dedupWindowSeconds` from `asOf`. If any prior delivery
 *   for the same (contact, campaign) within that window has outcome=
 *   "attempted" — suppress. "Suppressed" / "deduped" / "no_channel"
 *   prior deliveries don't count (they didn't reach the contact).
 *
 *   Same-channel prior is ALSO a dedup — even an email-then-email
 *   within window suppresses (idempotency).
 *
 *   dedupWindowSeconds = 0 → no dedup (every delivery allowed).
 */

import {
  POLICY_STATUS_TRANSITIONS,
  POLICY_STATUSES,
  RUN_STATUS_TRANSITIONS,
  RUN_STATUSES,
  type DedupCheckInput,
  type DedupCheckResult,
  type PolicyStatus,
  type RunStatus,
} from "./types"

/**
 * Decide if the candidate delivery should be deduped.
 *
 * Properties:
 *   • Empty priorDeliveries → no dedup.
 *   • dedupWindowSeconds ≤ 0 → no dedup.
 *   • Deliveries outside window → not considered.
 *   • Considered deliveries with outcome != "attempted" → don't count
 *     (they didn't actually send).
 */
export function checkCrossChannelDedup(
  input: DedupCheckInput,
): DedupCheckResult {
  if (input.dedupWindowSeconds <= 0) {
    return { shouldDedup: false }
  }
  const cutoffMs = input.asOf.getTime() - input.dedupWindowSeconds * 1000
  for (const prior of input.priorDeliveries) {
    if (prior.outcome !== "attempted") continue
    if (prior.decidedAt.getTime() < cutoffMs) continue
    // Found an attempted delivery within window → dedup.
    return {
      shouldDedup: true,
      reason:
        prior.selectedChannel === input.candidateChannel
          ? `same channel (${prior.selectedChannel}) within ${input.dedupWindowSeconds}s window`
          : `cross-channel: ${prior.selectedChannel} delivery within ${input.dedupWindowSeconds}s window`,
    }
  }
  return { shouldDedup: false }
}

// ── State-machine helpers (mirror DB triggers) ──────────────────

export function isPolicyStatus(value: unknown): value is PolicyStatus {
  return (
    typeof value === "string" &&
    POLICY_STATUSES.includes(value as PolicyStatus)
  )
}

export function canTransitionPolicyStatus(
  current: PolicyStatus,
  next: PolicyStatus,
): boolean {
  if (current === next) return true
  return POLICY_STATUS_TRANSITIONS[current].includes(next)
}

export function isRunStatus(value: unknown): value is RunStatus {
  return (
    typeof value === "string" && RUN_STATUSES.includes(value as RunStatus)
  )
}

export function canTransitionRunStatus(
  current: RunStatus,
  next: RunStatus,
): boolean {
  if (current === next) return true
  return RUN_STATUS_TRANSITIONS[current].includes(next)
}
