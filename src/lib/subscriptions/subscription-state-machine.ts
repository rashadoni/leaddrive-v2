/**
 * Subscription state machine — D4 slice 1.
 *
 * Validates a proposed status transition on a Subscription and tells
 * the caller which timestamp / event side-effect to write. Pure
 * synchronous — slice-2 routes wrap with the Prisma update + a
 * `SubscriptionEvent` insert inside a transaction.
 *
 * State graph (see SUBSCRIPTION_TRANSITIONS in types.ts):
 *
 *   trial → active / past_due / cancelled
 *   active → past_due / paused / cancelled
 *   past_due → active / cancelled
 *   paused → active / cancelled
 *   cancelled — terminal
 *
 * The route enforces refund + payment-provider side-effects; this
 * helper is purely a graph + side-effect-tag function.
 */
import {
  SUBSCRIPTION_TRANSITIONS,
  type AdvanceSubscriptionInput,
  type AdvanceSubscriptionResult,
  type SubscriptionStatus,
} from "./types"

const TERMINAL_STATES: ReadonlySet<SubscriptionStatus> = new Set(["cancelled"])

export function advanceSubscriptionState(
  input: AdvanceSubscriptionInput
): AdvanceSubscriptionResult {
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

  const allowed = SUBSCRIPTION_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Invalid subscription transition: "${from}" → "${to}"`,
    }
  }

  // Side-effect derivation. `trialEnding` is its own tag because
  // moving from `trial` to either `active` or `past_due` is a
  // distinct accounting event (the customer's trial just ended); the
  // caller emits a `trial_ended` SubscriptionEvent IN ADDITION to the
  // status-specific event (`activated` / `dunning_started`).
  let sideEffect:
    | "activating"
    | "pausing"
    | "resuming"
    | "suspending"
    | "cancelling"
    | "trialEnding"

  if (to === "cancelled") {
    sideEffect = "cancelling"
  } else if (to === "paused") {
    sideEffect = "pausing"
  } else if (from === "trial") {
    // trial → active OR trial → past_due
    sideEffect = "trialEnding"
  } else if (to === "active") {
    // past_due → active (recovery) OR paused → active (resume)
    sideEffect = from === "paused" ? "resuming" : "activating"
  } else if (to === "past_due") {
    // active → past_due
    sideEffect = "suspending"
  } else {
    // Unreachable given the table above, but the exhaustive branch
    // gives TS narrowing and protects against a future graph edit.
    return {
      ok: false,
      error: `Unhandled side-effect for transition: "${from}" → "${to}"`,
    }
  }

  return { ok: true, sideEffect }
}

export function isTerminalSubscriptionState(state: SubscriptionStatus): boolean {
  return TERMINAL_STATES.has(state)
}
