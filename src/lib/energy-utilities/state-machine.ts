/**
 * Energy & Utilities state machine — R6 slice 1.
 *
 * Four lifecycles share the same transition-table pattern (mirrors
 * the R2 Health state-machine.ts shape):
 *   • Customer    — prospect → active → suspended/terminated
 *   • Meter       — pending_install → active → disconnected → retired
 *   • Outage      — pending → active → resolved (+ cancelled)
 *   • ServiceCall — received → dispatched → in_progress → resolved (+ cancelled)
 *
 * Pure: state + intent → result. Slice-2 worker applies the transition
 * inside a DB transaction under the immutability triggers declared
 * in the schema.
 */
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TRANSITIONS,
  METER_STATUSES,
  METER_TRANSITIONS,
  OUTAGE_STATUSES,
  OUTAGE_TRANSITIONS,
  SERVICE_CALL_STATUSES,
  SERVICE_CALL_TRANSITIONS,
  type CustomerStatus,
  type MeterStatus,
  type OutageStatus,
  type ServiceCallStatus,
  type TransitionResult,
} from "./types"

function isCustomerStatus(v: unknown): v is CustomerStatus {
  return (
    typeof v === "string" &&
    (CUSTOMER_STATUSES as readonly string[]).includes(v)
  )
}

function isMeterStatus(v: unknown): v is MeterStatus {
  return (
    typeof v === "string" && (METER_STATUSES as readonly string[]).includes(v)
  )
}

function isOutageStatus(v: unknown): v is OutageStatus {
  return (
    typeof v === "string" &&
    (OUTAGE_STATUSES as readonly string[]).includes(v)
  )
}

function isServiceCallStatus(v: unknown): v is ServiceCallStatus {
  return (
    typeof v === "string" &&
    (SERVICE_CALL_STATUSES as readonly string[]).includes(v)
  )
}

/* ─── Customer lifecycle ─────────────────────────────────────────────── */

export function transitionCustomer(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isCustomerStatus(from)) {
    return { ok: false, error: `unknown customer status "${String(from)}"` }
  }
  if (!isCustomerStatus(to)) {
    return {
      ok: false,
      error: `unknown customer target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!CUSTOMER_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal customer transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isCustomerTerminal(status: CustomerStatus): boolean {
  return CUSTOMER_TRANSITIONS[status].length === 0
}

export function allowedNextCustomer(
  from: CustomerStatus
): readonly CustomerStatus[] {
  return CUSTOMER_TRANSITIONS[from]
}

/* ─── Meter lifecycle ────────────────────────────────────────────────── */

export function transitionMeter(from: unknown, to: unknown): TransitionResult {
  if (!isMeterStatus(from)) {
    return { ok: false, error: `unknown meter status "${String(from)}"` }
  }
  if (!isMeterStatus(to)) {
    return { ok: false, error: `unknown meter target status "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!METER_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal meter transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isMeterTerminal(status: MeterStatus): boolean {
  return METER_TRANSITIONS[status].length === 0
}

export function allowedNextMeter(from: MeterStatus): readonly MeterStatus[] {
  return METER_TRANSITIONS[from]
}

/* ─── Outage lifecycle ───────────────────────────────────────────────── */

/**
 * Validate an outage status transition.
 *
 * IMPORTANT (slice-1 dual-check warning):
 *   The DB has an additional `outages_cancelled_coherence_check`
 *   constraint that requires `scheduledStartAt IS NOT NULL` for any
 *   row with status='cancelled'. This state-machine helper does NOT
 *   know about that — it only validates the from→to legality of the
 *   transition table.
 *
 *   Caller must therefore check BOTH:
 *     1. `transitionOutage(from, to)` is `{ok: true}`
 *     2. If `to === 'cancelled'`, the outage row must have
 *        `scheduledStartAt` populated (i.e. it was a planned outage).
 *
 *   In practice: unplanned outages (cause='equipment_failure',
 *   'weather', etc., no scheduledStartAt) cannot be cancelled — they
 *   are RESOLVED once power restores, even if the original alert was
 *   spurious. The transition table allows `pending → cancelled` for
 *   the planned-outage use case (a scheduled maintenance window that
 *   gets called off before start).
 *
 *   Slice-2 may introduce a context-aware variant
 *   `canTransitionOutage(from, to, ctx)` that takes the row context
 *   and gates the cancel path. Slice-1 keeps the state-machine pure.
 */
export function transitionOutage(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isOutageStatus(from)) {
    return { ok: false, error: `unknown outage status "${String(from)}"` }
  }
  if (!isOutageStatus(to)) {
    return {
      ok: false,
      error: `unknown outage target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!OUTAGE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal outage transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isOutageTerminal(status: OutageStatus): boolean {
  return OUTAGE_TRANSITIONS[status].length === 0
}

export function allowedNextOutage(
  from: OutageStatus
): readonly OutageStatus[] {
  return OUTAGE_TRANSITIONS[from]
}

/* ─── Context-aware outage transition (slice-2) ──────────────────────── */

/**
 * Context for an outage transition decision. Mirrors the slice-1
 * `outages_cancelled_coherence_check` DB constraint
 * (`status='cancelled' ⇒ scheduledStartAt IS NOT NULL`): only planned
 * outages may be cancelled, since "cancellation" only makes sense
 * before the scheduled window opens.
 */
export interface OutageTransitionContext {
  /**
   * The outage's `scheduledStartAt`. NULL for unplanned outages
   * (cause='equipment_failure' / 'weather' / 'third_party_damage' /
   * 'overload' / etc. — no maintenance window). Caller pulls this
   * straight from the row.
   */
  scheduledStartAt: Date | null
}

/**
 * Context-aware outage transition wrapper. Layers the
 * `scheduledStartAt`-required gate on top of the pure state-machine
 * for the `cancelled` target, eliminating the slice-1 dual-check
 * caller burden (where the route layer had to first call
 * `transitionOutage` then separately check `scheduledStartAt`).
 *
 * Slice-1 JSDoc explicitly anticipated this helper:
 *   > Slice-2 may introduce a context-aware variant
 *   > `canTransitionOutage(from, to, ctx)` that takes the row context
 *   > and gates the cancel path. Slice-1 keeps the state-machine pure.
 *
 * Rule:
 *   • If `to !== 'cancelled'` → pure transitionOutage (no context check).
 *   • If `to === 'cancelled'` AND `ctx.scheduledStartAt === null` →
 *     reject with operator-friendly error explaining that unplanned
 *     outages must be resolved, not cancelled.
 *   • Else → pure transitionOutage gate fires.
 *
 * Returns the same TransitionResult shape so callers can swap
 * `transitionOutage` for this without other code changes.
 */
export function canTransitionOutage(
  from: unknown,
  to: unknown,
  ctx: OutageTransitionContext
): TransitionResult {
  // Pure state-machine gate first — short-circuit on illegal transitions
  // before the context check (operator gets the clearest error).
  const stateMachine = transitionOutage(from, to)
  if (!stateMachine.ok) return stateMachine

  // Context check only applies to cancellation.
  if (to === "cancelled") {
    if (ctx.scheduledStartAt === null || ctx.scheduledStartAt === undefined) {
      return {
        ok: false,
        error:
          "Unplanned outages cannot be cancelled (no scheduledStartAt). Mark them resolved once power restores.",
      }
    }
  }
  return { ok: true }
}

/* ─── ServiceCall lifecycle ──────────────────────────────────────────── */

export function transitionServiceCall(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isServiceCallStatus(from)) {
    return {
      ok: false,
      error: `unknown service call status "${String(from)}"`,
    }
  }
  if (!isServiceCallStatus(to)) {
    return {
      ok: false,
      error: `unknown service call target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!SERVICE_CALL_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      error: `illegal service call transition: ${from} → ${to}`,
    }
  }
  return { ok: true }
}

export function isServiceCallTerminal(status: ServiceCallStatus): boolean {
  return SERVICE_CALL_TRANSITIONS[status].length === 0
}

export function allowedNextServiceCall(
  from: ServiceCallStatus
): readonly ServiceCallStatus[] {
  return SERVICE_CALL_TRANSITIONS[from]
}
