/**
 * Return / RMA state machine — D3 OMS Phase 6 Block A slice 1.
 *
 * Validates transitions on an OrderReturn and tells the caller which
 * timestamp column to populate (approvedAt / receivedAt / refundedAt).
 *
 * Linear-forward semantics with two reject/cancel branches:
 *
 *   requested → approved → received → refunded → closed
 *      ↓             ↓
 *      rejected   cancelled   (both terminal)
 *
 * Pure synchronous. Caller wraps with the Prisma update + refund
 * money side-effects (Stripe refund, ledger entry, etc.) in a
 * transaction.
 */
import {
  RETURN_TRANSITIONS,
  type AdvanceReturnInput,
  type AdvanceReturnResult,
  type ReturnStatus,
} from "./types"

const TERMINAL_STATES: ReadonlySet<ReturnStatus> = new Set([
  "closed",
  "rejected",
  "cancelled",
])

export function advanceReturnState(
  input: AdvanceReturnInput
): AdvanceReturnResult {
  const { from, to } = input

  if (from === to) {
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

  const allowed = RETURN_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Invalid return transition: "${from}" → "${to}"`,
    }
  }

  let sideEffect: "approving" | "receiving" | "refunding" | "none"
  if (to === "approved") sideEffect = "approving"
  else if (to === "received") sideEffect = "receiving"
  else if (to === "refunded") sideEffect = "refunding"
  // rejected / cancelled / closed: no new timestamp on the OrderReturn
  // (closed is set when status flips; refundedAt is already populated).
  else sideEffect = "none"

  return { ok: true, sideEffect }
}

export function isTerminalReturnState(state: ReturnStatus): boolean {
  return TERMINAL_STATES.has(state)
}
