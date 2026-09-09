/**
 * S6 CPQ state machine — slice-2.
 *
 * Pure: (current state, target state) → result. No Prisma, no I/O.
 * The route layer calls this BEFORE persisting any status change so
 * an illegal transition surfaces as a 400 rather than a corrupt row.
 *
 * Pattern parallels `src/lib/insurance/state-machine.ts` and the
 * other industry-cloud state machines.
 */
import { QUOTE_STATUSES, QUOTE_TRANSITIONS, type QuoteStatus, type TransitionResult } from "./types"

function isQuoteStatus(v: unknown): v is QuoteStatus {
  return typeof v === "string" && (QUOTE_STATUSES as readonly string[]).includes(v)
}

/**
 * Validate a quote status transition.
 *
 * Returns `{ ok: true }` if the transition is legal, or
 * `{ ok: false, error }` with a human-readable reason.
 *
 * No-op transitions (same → same) are rejected — the route layer
 * should skip the PATCH entirely if nothing changes, not call this
 * with identical values.
 */
export function transitionQuote(from: unknown, to: unknown): TransitionResult {
  if (!isQuoteStatus(from)) {
    return { ok: false, error: `unknown quote status "${String(from)}"` }
  }
  if (!isQuoteStatus(to)) {
    return { ok: false, error: `unknown quote target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal quote transition: ${from} → ${to}` }
  }
  return { ok: true }
}

/**
 * Map a target state to the corresponding lifecycle timestamp field
 * the route layer must stamp. NULL for transitions that don't have a
 * dedicated timestamp (`expired` — no separate field; the row's
 * `validUntil` already records when it became eligible).
 */
export function timestampFieldFor(target: QuoteStatus): "sentAt" | "viewedAt" | "acceptedAt" | "rejectedAt" | null {
  switch (target) {
    case "sent":
      return "sentAt"
    case "viewed":
      return "viewedAt"
    case "accepted":
      return "acceptedAt"
    case "rejected":
      return "rejectedAt"
    default:
      return null
  }
}
