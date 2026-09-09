/**
 * Checkout state machine — D2 Phase 6 Block A slice 1.
 *
 * Validates a proposed state transition on a `CheckoutSession`.
 * Three move kinds:
 *
 *   forward   — natural progression (shipping → payment → review → completed)
 *   backward  — buyer edits a prior step (allowed only pre-completion)
 *   terminal  — failure / expiration from any pre-terminal state
 *
 * Pure synchronous. Caller (slice-2 route) wraps with the actual
 * Prisma update inside a transaction.
 */
import {
  BACKWARD_TRANSITIONS,
  FORWARD_TRANSITIONS,
  type AdvanceCheckoutInput,
  type AdvanceCheckoutResult,
  type CheckoutStatus,
} from "./types"

const TERMINAL_STATES: ReadonlySet<CheckoutStatus> = new Set([
  "completed",
  "failed",
  "expired",
])

export function advanceCheckoutState(input: AdvanceCheckoutInput): AdvanceCheckoutResult {
  const { from, to } = input

  if (from === to) {
    return { ok: false, error: `Already in state "${from}" — no-op transition rejected` }
  }

  // Terminal-state source: nothing leaves a terminal state.
  if (TERMINAL_STATES.has(from)) {
    return {
      ok: false,
      error: `Cannot transition from terminal state "${from}" → "${to}"`,
    }
  }

  const forwardAllowed = FORWARD_TRANSITIONS[from]
  if (forwardAllowed.includes(to)) {
    return {
      ok: true,
      kind: to === "failed" || to === "expired" ? "terminal" : "forward",
    }
  }

  const backwardAllowed = BACKWARD_TRANSITIONS[from]
  if (backwardAllowed.includes(to)) {
    return { ok: true, kind: "backward" }
  }

  return {
    ok: false,
    error: `Invalid transition: "${from}" → "${to}"`,
  }
}

/**
 * Convenience query: is the state terminal (no further transitions)?
 */
export function isTerminalCheckoutState(state: CheckoutStatus): boolean {
  return TERMINAL_STATES.has(state)
}
