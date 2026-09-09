/**
 * T8 Cobrowse — pure state machine.
 *
 * The cobrowse lifecycle has 4 invariants the route layer can't
 * encode declaratively in a single CHECK constraint:
 *
 *   1. `active` REQUIRES `consentGivenAt` set (consent gate)
 *   2. `pending → ended` is allowed (agent cancelled before customer
 *      joined) but `pending → active` is NOT (customer must join +
 *      consent first)
 *   3. `paused ↔ active` is a loop — can re-pause and re-resume
 *      arbitrarily
 *   4. `ended` is terminal — no transitions out
 *
 * Putting these in one helper means the state machine is unit-
 * testable in isolation from Prisma, and route handlers stay
 * declarative ("if (!canTransition(...)) return 409").
 */

import type { CobrowseStatus } from "./types"

export interface SessionContext {
  /** Current status of the session row. */
  currentStatus: CobrowseStatus
  /** Whether the customer has granted consent. Required for
   *  any transition into `active`. */
  consentGiven: boolean
}

/** Map of from-state → set of allowed to-states. */
const ALLOWED: Record<CobrowseStatus, Set<CobrowseStatus>> = {
  pending: new Set<CobrowseStatus>(["awaiting_consent", "ended"]),
  awaiting_consent: new Set<CobrowseStatus>(["active", "ended"]),
  active: new Set<CobrowseStatus>(["paused", "ended"]),
  paused: new Set<CobrowseStatus>(["active", "ended"]),
  ended: new Set<CobrowseStatus>([]), // terminal
}

export interface TransitionResult {
  ok: boolean
  /** Reason code when ok = false; undefined when ok = true. */
  reason?: "invalid_transition" | "consent_required" | "terminal"
}

export function canTransition(ctx: SessionContext, next: CobrowseStatus): TransitionResult {
  if (ctx.currentStatus === "ended") {
    return { ok: false, reason: "terminal" }
  }
  if (!ALLOWED[ctx.currentStatus].has(next)) {
    return { ok: false, reason: "invalid_transition" }
  }
  // Consent gate — slice-1 invariant #1.
  if (next === "active" && !ctx.consentGiven) {
    return { ok: false, reason: "consent_required" }
  }
  return { ok: true }
}

/** Convenience: list reachable next states from current. Used by
 *  slice-3 agent UI to render the right action buttons. */
export function allowedNextStates(currentStatus: CobrowseStatus): CobrowseStatus[] {
  return Array.from(ALLOWED[currentStatus])
}
