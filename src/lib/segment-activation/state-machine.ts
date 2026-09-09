/**
 * Activation + Run state machines — G5 slice 1.
 *
 * Pure synchronous transition guards. DB CHECKs enforce enum
 * membership; helper enforces transition allow-list.
 */
import {
  ACTIVATION_STATUSES,
  ACTIVATION_TRANSITIONS,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  type ActivationStatus,
  type RunStatus,
  type TransitionResult,
} from "./types"

export function isActivationStatus(s: unknown): s is ActivationStatus {
  return typeof s === "string" && (ACTIVATION_STATUSES as readonly string[]).includes(s)
}

export function isRunStatus(s: unknown): s is RunStatus {
  return typeof s === "string" && (RUN_STATUSES as readonly string[]).includes(s)
}

function check<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionResult {
  if (from === to) {
    return { ok: false, error: `${kind}: cannot transition from "${from}" to itself` }
  }
  const allowed = table[from]
  if (!allowed) {
    return { ok: false, error: `${kind}: unknown from-status "${String(from)}"` }
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `${kind}: "${from}" is terminal — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canActivationTransition(
  from: ActivationStatus,
  to: ActivationStatus
): TransitionResult {
  if (!isActivationStatus(from)) {
    return { ok: false, error: `activation: from "${String(from)}" is not a known status` }
  }
  if (!isActivationStatus(to)) {
    return { ok: false, error: `activation: to "${String(to)}" is not a known status` }
  }
  return check(from, to, ACTIVATION_TRANSITIONS, "activation")
}

export function canRunTransition(from: RunStatus, to: RunStatus): TransitionResult {
  if (!isRunStatus(from)) {
    return { ok: false, error: `run: from "${String(from)}" is not a known status` }
  }
  if (!isRunStatus(to)) {
    return { ok: false, error: `run: to "${String(to)}" is not a known status` }
  }
  return check(from, to, RUN_TRANSITIONS, "run")
}

export function activationAllowedNext(s: ActivationStatus): readonly ActivationStatus[] {
  return ACTIVATION_TRANSITIONS[s] ?? []
}
export function runAllowedNext(s: RunStatus): readonly RunStatus[] {
  return RUN_TRANSITIONS[s] ?? []
}

export function isActivationTerminal(s: ActivationStatus): boolean {
  return ACTIVATION_TRANSITIONS[s].length === 0
}
export function isRunTerminal(s: RunStatus): boolean {
  return RUN_TRANSITIONS[s].length === 0
}
