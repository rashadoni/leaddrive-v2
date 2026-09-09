/**
 * Insurance state machine — R7 slice 1.
 *
 * Three lifecycles (mirrors R2/R6 pattern):
 *   • Holder — prospect → active → inactive/deceased
 *   • Policy — quote → bound → active → expired/lapsed/cancelled
 *   • Claim  — reported → under_review → approved → settled
 *              (+ denied / closed_no_action side exits)
 *
 * Pure: state + intent → result. No DB writes.
 */
import {
  CLAIM_STATUSES,
  CLAIM_TRANSITIONS,
  HOLDER_STATUSES,
  HOLDER_TRANSITIONS,
  POLICY_STATUSES,
  POLICY_TRANSITIONS,
  type ClaimStatus,
  type HolderStatus,
  type PolicyStatus,
  type TransitionResult,
} from "./types"

function isHolderStatus(v: unknown): v is HolderStatus {
  return (
    typeof v === "string" && (HOLDER_STATUSES as readonly string[]).includes(v)
  )
}

function isPolicyStatus(v: unknown): v is PolicyStatus {
  return (
    typeof v === "string" && (POLICY_STATUSES as readonly string[]).includes(v)
  )
}

function isClaimStatus(v: unknown): v is ClaimStatus {
  return (
    typeof v === "string" && (CLAIM_STATUSES as readonly string[]).includes(v)
  )
}

/* ─── Holder lifecycle ───────────────────────────────────────────────── */

export function transitionHolder(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isHolderStatus(from)) {
    return { ok: false, error: `unknown holder status "${String(from)}"` }
  }
  if (!isHolderStatus(to)) {
    return { ok: false, error: `unknown holder target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!HOLDER_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal holder transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isHolderTerminal(status: HolderStatus): boolean {
  return HOLDER_TRANSITIONS[status].length === 0
}

export function allowedNextHolder(
  from: HolderStatus
): readonly HolderStatus[] {
  return HOLDER_TRANSITIONS[from]
}

/* ─── Policy lifecycle ───────────────────────────────────────────────── */

export function transitionPolicy(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isPolicyStatus(from)) {
    return { ok: false, error: `unknown policy status "${String(from)}"` }
  }
  if (!isPolicyStatus(to)) {
    return { ok: false, error: `unknown policy target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!POLICY_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal policy transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isPolicyTerminal(status: PolicyStatus): boolean {
  return POLICY_TRANSITIONS[status].length === 0
}

export function allowedNextPolicy(
  from: PolicyStatus
): readonly PolicyStatus[] {
  return POLICY_TRANSITIONS[from]
}

/* ─── Claim lifecycle ────────────────────────────────────────────────── */

export function transitionClaim(from: unknown, to: unknown): TransitionResult {
  if (!isClaimStatus(from)) {
    return { ok: false, error: `unknown claim status "${String(from)}"` }
  }
  if (!isClaimStatus(to)) {
    return { ok: false, error: `unknown claim target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!CLAIM_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal claim transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isClaimTerminal(status: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[status].length === 0
}

export function allowedNextClaim(from: ClaimStatus): readonly ClaimStatus[] {
  return CLAIM_TRANSITIONS[from]
}

/* ─── Context-aware claim transition (slice-2) ──────────────────────── */

/**
 * Context for a claim transition decision. Mirrors R6
 * `OutageTransitionContext` shape — caller passes the relevant row
 * fields straight from the DB. The wrapper layers operational
 * gates on top of the pure state machine.
 */
export interface ClaimTransitionContext {
  /**
   * Claim's `lossDate` (immutable, NOT NULL per slice-1 schema).
   * Used by future slice-2 rules to gate reversal windows by
   * statute-of-limitations (not enforced today; reserved field).
   */
  lossDate: Date
  /**
   * Claim's `adjusterId`. NULL when the claim is in the intake queue
   * with no human owner yet. Required for the un-approve reversal —
   * un-approving requires an accountable operator on record (SIU
   * audit trail: "who decided to walk this back").
   */
  adjusterId: string | null
  /** Caller-supplied "now" for testability. Defaults to current time. */
  asOf?: Date
}

/**
 * Context-aware claim transition wrapper. Layers operational gates
 * over the pure state machine for transitions that require row
 * context (currently only `approved → under_review` un-approve).
 *
 * Mirrors `canTransitionOutage` from R6. Slice-2 inventory items 5 + 9
 * R7 portion close here. Future SIU fraud-window rule (reject
 * un-approve when (now - lossDate) > 90 days) is reserved — see
 * `ClaimTransitionContext.lossDate` — but not enforced today; the
 * lossDate field is plumbed through so a follow-up adding the rule
 * is a one-line change at the gate site.
 *
 * Rule (current):
 *   • `to !== 'under_review' from 'approved'` (i.e. anything except
 *     un-approve) → pure state-machine pass-through, no context check.
 *   • `from='approved' && to='under_review'` (un-approve reversal):
 *     - require `ctx.adjusterId !== null` (SIU audit-trail rule —
 *       reversal MUST have an accountable adjuster on record).
 *
 * Returns the same TransitionResult shape — drop-in for `transitionClaim`.
 */
export function canTransitionClaim(
  from: unknown,
  to: unknown,
  ctx: ClaimTransitionContext,
): TransitionResult {
  // Pure state-machine gate first — short-circuit on illegal transitions
  // before the context check (operator gets the clearest error).
  const stateMachine = transitionClaim(from, to)
  if (!stateMachine.ok) return stateMachine

  // Un-approve reversal gate (the only context-aware path today).
  if (from === "approved" && to === "under_review") {
    if (ctx.adjusterId === null || ctx.adjusterId === undefined || ctx.adjusterId === "") {
      return {
        ok: false,
        error:
          "Un-approve reversal requires an assigned adjuster on the claim (SIU audit-trail rule). Assign an adjuster before reversing approval.",
      }
    }
    // Future hook: statute-of-limitations check on ctx.lossDate vs ctx.asOf
    // — reserved, not enforced today.
  }

  return { ok: true }
}
