/**
 * Health Cloud state machine — R2 slice 1.
 *
 * Three lifecycles sharing a transition-table pattern:
 *   • Patient     — active/inactive/discharged/deceased
 *   • Encounter   — scheduled → checked_in → in_progress → completed
 *                   (+ no_show / cancelled side exits)
 *   • Care Plan   — draft → active → paused/completed (+ cancelled)
 *
 * Pure: state + intent → result. No DB writes (slice-2 worker applies
 * the result inside a transaction with the immutability triggers we
 * declared in the schema).
 *
 * Drift guards: each transition table is reachable across all enum
 * values, and the helper rejects unknown enum values up front (defends
 * against caller passing a stale string from a typo or a future enum
 * addition that this code hasn't been updated for).
 */
import {
  CARE_PLAN_STATUSES,
  CARE_PLAN_TRANSITIONS,
  ENCOUNTER_STATUSES,
  ENCOUNTER_TRANSITIONS,
  PATIENT_STATUSES,
  PATIENT_TRANSITIONS,
  type CarePlanStatus,
  type EncounterStatus,
  type PatientStatus,
  type TransitionResult,
} from "./types"

function isPatientStatus(v: unknown): v is PatientStatus {
  return (
    typeof v === "string" && (PATIENT_STATUSES as readonly string[]).includes(v)
  )
}

function isEncounterStatus(v: unknown): v is EncounterStatus {
  return (
    typeof v === "string" &&
    (ENCOUNTER_STATUSES as readonly string[]).includes(v)
  )
}

function isCarePlanStatus(v: unknown): v is CarePlanStatus {
  return (
    typeof v === "string" &&
    (CARE_PLAN_STATUSES as readonly string[]).includes(v)
  )
}

/**
 * Validate a patient status transition.
 *
 * Returns `{ok: true}` if `from → to` is in the transition table, else
 * `{ok: false, error}`. Used by slice-2 PATCH /health-patients before
 * the UPDATE statement is issued.
 */
export function transitionPatient(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isPatientStatus(from)) {
    return { ok: false, error: `unknown patient status "${String(from)}"` }
  }
  if (!isPatientStatus(to)) {
    return {
      ok: false,
      error: `unknown patient target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  const legal = PATIENT_TRANSITIONS[from]
  if (!legal.includes(to)) {
    return {
      ok: false,
      error: `illegal patient transition: ${from} → ${to}`,
    }
  }
  return { ok: true }
}

/** Returns true iff status is a terminal (no further transitions). */
export function isPatientTerminal(status: PatientStatus): boolean {
  return PATIENT_TRANSITIONS[status].length === 0
}

/**
 * Validate an encounter status transition.
 */
export function transitionEncounter(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isEncounterStatus(from)) {
    return { ok: false, error: `unknown encounter status "${String(from)}"` }
  }
  if (!isEncounterStatus(to)) {
    return {
      ok: false,
      error: `unknown encounter target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  const legal = ENCOUNTER_TRANSITIONS[from]
  if (!legal.includes(to)) {
    return {
      ok: false,
      error: `illegal encounter transition: ${from} → ${to}`,
    }
  }
  return { ok: true }
}

export function isEncounterTerminal(status: EncounterStatus): boolean {
  return ENCOUNTER_TRANSITIONS[status].length === 0
}

/**
 * Validate a care plan status transition.
 */
export function transitionCarePlan(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isCarePlanStatus(from)) {
    return { ok: false, error: `unknown care plan status "${String(from)}"` }
  }
  if (!isCarePlanStatus(to)) {
    return {
      ok: false,
      error: `unknown care plan target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  const legal = CARE_PLAN_TRANSITIONS[from]
  if (!legal.includes(to)) {
    return {
      ok: false,
      error: `illegal care plan transition: ${from} → ${to}`,
    }
  }
  return { ok: true }
}

export function isCarePlanTerminal(status: CarePlanStatus): boolean {
  return CARE_PLAN_TRANSITIONS[status].length === 0
}

/* ─── Allowed-next-state introspection (used by UI button gating) ──── */

export function allowedNextPatient(
  from: PatientStatus
): readonly PatientStatus[] {
  return PATIENT_TRANSITIONS[from]
}

export function allowedNextEncounter(
  from: EncounterStatus
): readonly EncounterStatus[] {
  return ENCOUNTER_TRANSITIONS[from]
}

export function allowedNextCarePlan(
  from: CarePlanStatus
): readonly CarePlanStatus[] {
  return CARE_PLAN_TRANSITIONS[from]
}
