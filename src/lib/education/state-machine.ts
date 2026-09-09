/**
 * Student / Term / Enrollment state machines — R10 slice 1.
 *
 * Application-layer transition guards. DB CHECKs enforce enum membership;
 * helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  STUDENT_STATUSES,
  STUDENT_TRANSITIONS,
  TERM_STATUSES,
  TERM_TRANSITIONS,
  type EnrollmentStatus,
  type StudentStatus,
  type TermStatus,
  type TransitionResult,
} from "./types"

export function isStudentStatus(s: unknown): s is StudentStatus {
  return typeof s === "string" && (STUDENT_STATUSES as readonly string[]).includes(s)
}

export function isTermStatus(s: unknown): s is TermStatus {
  return typeof s === "string" && (TERM_STATUSES as readonly string[]).includes(s)
}

export function isEnrollmentStatus(s: unknown): s is EnrollmentStatus {
  return typeof s === "string" && (ENROLLMENT_STATUSES as readonly string[]).includes(s)
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
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canStudentTransition(from: StudentStatus, to: StudentStatus): TransitionResult {
  if (!isStudentStatus(from)) {
    return { ok: false, error: `student: from "${String(from)}" is not a known status` }
  }
  if (!isStudentStatus(to)) {
    return { ok: false, error: `student: to "${String(to)}" is not a known status` }
  }
  return check(from, to, STUDENT_TRANSITIONS, "student")
}

export function canTermTransition(from: TermStatus, to: TermStatus): TransitionResult {
  if (!isTermStatus(from)) {
    return { ok: false, error: `term: from "${String(from)}" is not a known status` }
  }
  if (!isTermStatus(to)) {
    return { ok: false, error: `term: to "${String(to)}" is not a known status` }
  }
  return check(from, to, TERM_TRANSITIONS, "term")
}

export function canEnrollmentTransition(
  from: EnrollmentStatus,
  to: EnrollmentStatus
): TransitionResult {
  if (!isEnrollmentStatus(from)) {
    return { ok: false, error: `enrollment: from "${String(from)}" is not a known status` }
  }
  if (!isEnrollmentStatus(to)) {
    return { ok: false, error: `enrollment: to "${String(to)}" is not a known status` }
  }
  return check(from, to, ENROLLMENT_TRANSITIONS, "enrollment")
}

export function studentAllowedNext(s: StudentStatus): readonly StudentStatus[] {
  return STUDENT_TRANSITIONS[s] ?? []
}

export function termAllowedNext(s: TermStatus): readonly TermStatus[] {
  return TERM_TRANSITIONS[s] ?? []
}

export function enrollmentAllowedNext(s: EnrollmentStatus): readonly EnrollmentStatus[] {
  return ENROLLMENT_TRANSITIONS[s] ?? []
}

export function isStudentTerminal(s: StudentStatus): boolean {
  return STUDENT_TRANSITIONS[s].length === 0
}

export function isTermTerminal(s: TermStatus): boolean {
  return TERM_TRANSITIONS[s].length === 0
}

export function isEnrollmentTerminal(s: EnrollmentStatus): boolean {
  return ENROLLMENT_TRANSITIONS[s].length === 0
}
