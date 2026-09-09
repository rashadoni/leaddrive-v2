/**
 * Contract status state-machine — M5 Phase 6 Block C slice 1.
 *
 * Validates Contract.status transitions. Slice 1 enforces transitions
 * at the application layer; slice-2 adds a DB CHECK constraint after
 * one-time backfill of legacy free-text statuses.
 *
 * Pure synchronous.
 */
import {
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  type ContractStatus,
  type TransitionInput,
  type TransitionResult,
} from "./types"

/**
 * Type guard — caller-supplied string against the canonical enum.
 * Defensive against legacy DB rows ("draft " with trailing space,
 * "Active" with wrong case, etc.).
 */
export function isContractStatus(s: unknown): s is ContractStatus {
  return typeof s === "string" && (CONTRACT_STATUSES as readonly string[]).includes(s)
}

/**
 * Returns `{ ok: true }` if the (from, to) transition is allowed by
 * CONTRACT_TRANSITIONS. Otherwise returns `{ ok: false, error }` with
 * a UI-actionable message naming the allowed targets.
 *
 * Idempotent self-transitions (from === to) are intentionally
 * REJECTED — callers should short-circuit on no-op writes themselves.
 */
export function canTransition(input: TransitionInput): TransitionResult {
  if (!isContractStatus(input.from)) {
    return {
      ok: false,
      error: `from status "${String(input.from)}" is not a recognised ContractStatus`,
    }
  }
  if (!isContractStatus(input.to)) {
    return {
      ok: false,
      error: `to status "${String(input.to)}" is not a recognised ContractStatus`,
    }
  }
  if (input.from === input.to) {
    return {
      ok: false,
      error: `cannot transition from "${input.from}" to itself — caller should short-circuit no-op`,
    }
  }
  const allowed = CONTRACT_TRANSITIONS[input.from]
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `"${input.from}" is a terminal state — no transitions allowed`
          : `transition "${input.from}" → "${input.to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

/**
 * Convenience — returns the set of valid next statuses for a current
 * status. Used by UI to grey-out illegal moves.
 */
export function allowedNextStatuses(from: ContractStatus): readonly ContractStatus[] {
  return CONTRACT_TRANSITIONS[from]
}

/**
 * Terminal status check — `renewed`, `expired`, `terminated`,
 * `rejected`, `cancelled` are end-states. Renewal flow creates a NEW
 * contract row rather than reviving a terminal one.
 */
export function isTerminal(s: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[s].length === 0
}
