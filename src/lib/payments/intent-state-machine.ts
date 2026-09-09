/**
 * PaymentIntent state machine — D5 Phase 6 Block A slice 1.
 *
 * Validates a proposed status transition on a PaymentIntent and tells
 * the caller which timestamp side-effect to write. Pure synchronous —
 * slice-2 webhook handler wraps with the Prisma update + audit-row
 * insert inside a transaction.
 *
 * State graph (see `PAYMENT_INTENT_TRANSITIONS` in types.ts):
 *
 *   pending → processing / cancelled
 *   processing → requires_action / succeeded / failed / cancelled
 *   requires_action ↔ processing / succeeded / failed / cancelled
 *   succeeded → refunded / partially_refunded
 *   partially_refunded → partially_refunded / refunded
 *   failed / cancelled / refunded — terminal
 *
 * Side-effects:
 *   capturing  — set succeededAt = now()       (any → succeeded)
 *   failing    — set failedAt = now()          (any → failed)
 *   cancelling — set cancelledAt = now()       (any → cancelled)
 *   refunding  — no intent-level timestamp     (succeeded → refunded/
 *                                               partially_refunded; the
 *                                               PaymentRefund row carries
 *                                               its own succeededAt)
 *   none       — pending → processing, requires_action loops, etc.
 */
import {
  PAYMENT_INTENT_TRANSITIONS,
  type AdvanceIntentInput,
  type AdvanceIntentResult,
  type PaymentIntentStatus,
} from "./types"

const TERMINAL_STATES: ReadonlySet<PaymentIntentStatus> = new Set([
  "failed",
  "cancelled",
  "refunded",
])

export function advanceIntentState(
  input: AdvanceIntentInput
): AdvanceIntentResult {
  const { from, to } = input

  if (from === to) {
    // partially_refunded → partially_refunded is the ONE legit self-edge
    // (additional partial refunds). Everything else is a no-op error.
    if (from === "partially_refunded") {
      return { ok: true, sideEffect: "refunding" }
    }
    return {
      ok: false,
      error: `Already in state "${from}" — no-op transition rejected`,
    }
  }

  if (TERMINAL_STATES.has(from)) {
    return {
      ok: false,
      error: `Cannot transition from terminal state "${from}" → "${to}"`,
    }
  }

  const allowed = PAYMENT_INTENT_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Invalid intent transition: "${from}" → "${to}"`,
    }
  }

  let sideEffect: "capturing" | "failing" | "cancelling" | "refunding" | "none"

  if (to === "succeeded") {
    sideEffect = "capturing"
  } else if (to === "failed") {
    sideEffect = "failing"
  } else if (to === "cancelled") {
    sideEffect = "cancelling"
  } else if (to === "refunded" || to === "partially_refunded") {
    sideEffect = "refunding"
  } else {
    // pending → processing, processing → requires_action, requires_action
    // → processing — all status-only writes with no new timestamp.
    sideEffect = "none"
  }

  return { ok: true, sideEffect }
}

export function isTerminalIntentState(state: PaymentIntentStatus): boolean {
  return TERMINAL_STATES.has(state)
}
