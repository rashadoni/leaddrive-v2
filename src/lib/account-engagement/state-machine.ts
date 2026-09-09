/**
 * Account Engagement state machine — C5 slice 1.
 *
 * Three lifecycles:
 *   • Account    — target → engaged → mql → sql → opportunity → customer
 *                  (+ downgrades + churned exit)
 *   • Journey    — draft → active → paused → archived
 *   • Enrollment — enrolled → in_progress → goal_met (+ exited/failed)
 *
 * Pure synchronous.
 */
import {
  ACCOUNT_LIFECYCLE_STAGES,
  ACCOUNT_LIFECYCLE_TRANSITIONS,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  JOURNEY_STATUSES,
  JOURNEY_TRANSITIONS,
  type AccountLifecycleStage,
  type EnrollmentStatus,
  type JourneyStatus,
  type TransitionResult,
} from "./types"

function isAccountStage(v: unknown): v is AccountLifecycleStage {
  return (
    typeof v === "string" &&
    (ACCOUNT_LIFECYCLE_STAGES as readonly string[]).includes(v)
  )
}

function isJourneyStatus(v: unknown): v is JourneyStatus {
  return (
    typeof v === "string" &&
    (JOURNEY_STATUSES as readonly string[]).includes(v)
  )
}

function isEnrollmentStatus(v: unknown): v is EnrollmentStatus {
  return (
    typeof v === "string" &&
    (ENROLLMENT_STATUSES as readonly string[]).includes(v)
  )
}

/* ─── Account lifecycle ──────────────────────────────────────────────── */

export function transitionAccount(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isAccountStage(from)) {
    return { ok: false, error: `unknown account stage "${String(from)}"` }
  }
  if (!isAccountStage(to)) {
    return { ok: false, error: `unknown account target stage "${String(to)}"` }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!ACCOUNT_LIFECYCLE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal account transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isAccountTerminal(stage: AccountLifecycleStage): boolean {
  return ACCOUNT_LIFECYCLE_TRANSITIONS[stage].length === 0
}

export function allowedNextAccount(
  from: AccountLifecycleStage
): readonly AccountLifecycleStage[] {
  return ACCOUNT_LIFECYCLE_TRANSITIONS[from]
}

/* ─── Journey lifecycle ──────────────────────────────────────────────── */

export function transitionJourney(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isJourneyStatus(from)) {
    return { ok: false, error: `unknown journey status "${String(from)}"` }
  }
  if (!isJourneyStatus(to)) {
    return {
      ok: false,
      error: `unknown journey target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!JOURNEY_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `illegal journey transition: ${from} → ${to}` }
  }
  return { ok: true }
}

export function isJourneyTerminal(status: JourneyStatus): boolean {
  return JOURNEY_TRANSITIONS[status].length === 0
}

export function allowedNextJourney(
  from: JourneyStatus
): readonly JourneyStatus[] {
  return JOURNEY_TRANSITIONS[from]
}

/* ─── Enrollment lifecycle ───────────────────────────────────────────── */

export function transitionEnrollment(
  from: unknown,
  to: unknown
): TransitionResult {
  if (!isEnrollmentStatus(from)) {
    return { ok: false, error: `unknown enrollment status "${String(from)}"` }
  }
  if (!isEnrollmentStatus(to)) {
    return {
      ok: false,
      error: `unknown enrollment target status "${String(to)}"`,
    }
  }
  if (from === to) {
    return { ok: false, error: `no-op transition (${from} → ${to})` }
  }
  if (!ENROLLMENT_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      error: `illegal enrollment transition: ${from} → ${to}`,
    }
  }
  return { ok: true }
}

export function isEnrollmentTerminal(status: EnrollmentStatus): boolean {
  return ENROLLMENT_TRANSITIONS[status].length === 0
}

export function allowedNextEnrollment(
  from: EnrollmentStatus
): readonly EnrollmentStatus[] {
  return ENROLLMENT_TRANSITIONS[from]
}
