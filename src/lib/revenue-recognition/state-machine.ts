/**
 * PO + Schedule state machines — M4 Phase 6 Block C slice 1.
 *
 * Application-layer transition guards. DB also enforces the enum
 * via CHECK constraints; helper is the source of truth for "what
 * transitions are legal from where".
 *
 * Pure synchronous.
 */
import {
  PO_STATUSES,
  PO_TRANSITIONS,
  SCHEDULE_STATUSES,
  SCHEDULE_TRANSITIONS,
  type PoStatus,
  type ScheduleStatus,
  type TransitionResult,
} from "./types"

export function isPoStatus(s: unknown): s is PoStatus {
  return typeof s === "string" && (PO_STATUSES as readonly string[]).includes(s)
}

export function isScheduleStatus(s: unknown): s is ScheduleStatus {
  return (
    typeof s === "string" && (SCHEDULE_STATUSES as readonly string[]).includes(s)
  )
}

function checkTransition<T extends string>(
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
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canPoTransition(from: PoStatus, to: PoStatus): TransitionResult {
  if (!isPoStatus(from)) {
    return { ok: false, error: `po: from "${String(from)}" is not a known status` }
  }
  if (!isPoStatus(to)) {
    return { ok: false, error: `po: to "${String(to)}" is not a known status` }
  }
  return checkTransition(from, to, PO_TRANSITIONS, "po")
}

export function canScheduleTransition(
  from: ScheduleStatus,
  to: ScheduleStatus
): TransitionResult {
  if (!isScheduleStatus(from)) {
    return { ok: false, error: `schedule: from "${String(from)}" is not a known status` }
  }
  if (!isScheduleStatus(to)) {
    return { ok: false, error: `schedule: to "${String(to)}" is not a known status` }
  }
  return checkTransition(from, to, SCHEDULE_TRANSITIONS, "schedule")
}

export function poAllowedNext(from: PoStatus): readonly PoStatus[] {
  return PO_TRANSITIONS[from] ?? []
}

export function scheduleAllowedNext(from: ScheduleStatus): readonly ScheduleStatus[] {
  return SCHEDULE_TRANSITIONS[from] ?? []
}

export function isPoTerminal(s: PoStatus): boolean {
  return PO_TRANSITIONS[s].length === 0
}

export function isScheduleTerminal(s: ScheduleStatus): boolean {
  return SCHEDULE_TRANSITIONS[s].length === 0
}
