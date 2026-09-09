/**
 * Enrollment validator — R10 slice 1.
 *
 * Given a prospective enrollment + student's existing enrollment
 * history + course prerequisites, return whether the enrollment
 * should be allowed.
 *
 * Checks (in order — first failure short-circuits):
 *   1. Prerequisites — every prerequisiteCourseIds entry must be
 *      `completed` in the student's history.
 *   2. Already enrolled in same (course, term) — caller has the
 *      DB UNIQUE constraint as a backstop, but helper rejects
 *      eagerly so callers get a clear error before INSERT fails.
 *   3. Duplicate-completed — student already passed this course in
 *      a prior term. Default behavior: REJECT (no re-take). Caller
 *      can override with `allowRetake: true`.
 *   4. Credit cap — sum of credits for active (`enrolled` /
 *      `pending` / `audit`) enrollments in the SAME term must not
 *      exceed `maxCreditsPerTerm` (default 18, slice-2 may parameterise
 *      per tenant).
 *
 * Pure synchronous.
 */
import {
  DEFAULT_MAX_CREDITS_PER_TERM,
  type ExistingEnrollment,
  type PrerequisiteCheck,
  type ValidateEnrollmentInput,
  type ValidateEnrollmentResult,
} from "./types"

const ACTIVE_FOR_CAP: ReadonlySet<ExistingEnrollment["status"]> = new Set([
  "pending",
  "enrolled",
  "audit",
])

export function validateEnrollment(
  input: ValidateEnrollmentInput
): ValidateEnrollmentResult {
  const { enrollment, existing, prerequisites } = input
  const maxCredits = input.maxCreditsPerTerm ?? DEFAULT_MAX_CREDITS_PER_TERM
  const allowRetake = input.allowRetake ?? false

  // 0. Sanity-check input. Architect-pass-1 close-out: bad-input
  // rejections use `invalid_input` so caller telemetry distinguishes
  // malformed payloads from genuine business-rule violations.
  if (
    typeof enrollment.studentId !== "string" ||
    enrollment.studentId.length === 0
  ) {
    return {
      ok: false,
      reason: "invalid_input",
      details: "enrollment.studentId is required",
    }
  }
  if (
    typeof enrollment.courseId !== "string" ||
    enrollment.courseId.length === 0
  ) {
    return {
      ok: false,
      reason: "invalid_input",
      details: "enrollment.courseId is required",
    }
  }
  if (typeof enrollment.termId !== "string" || enrollment.termId.length === 0) {
    return {
      ok: false,
      reason: "invalid_input",
      details: "enrollment.termId is required",
    }
  }
  if (
    typeof enrollment.credits !== "number" ||
    !Number.isInteger(enrollment.credits) ||
    enrollment.credits < 0 ||
    enrollment.credits > 12
  ) {
    return {
      ok: false,
      reason: "invalid_input",
      details: `enrollment.credits ${enrollment.credits} must be an integer 0..12`,
    }
  }

  // 1. Prerequisites — caller pre-resolves; we just walk the result.
  for (const p of prerequisites) {
    if (!p.completed) {
      return {
        ok: false,
        reason: "prerequisite_not_completed",
        details: `student has not completed prerequisite course ${p.courseId}`,
      }
    }
  }

  // 2. Already in this (course, term). The DB UNIQUE constraint
  // `(studentId, courseId, termId)` is the authoritative backstop —
  // a duplicate INSERT would fail with P2002. Helper rejects eagerly
  // here so the caller gets a meaningful `already_enrolled_this_term`
  // reason instead of an opaque unique-violation DB error.
  //
  // Architect-pass-1 close-out: removed the `status !== "failed"`
  // sub-condition — the DB UNIQUE blocks ANY same-slot duplicate
  // regardless of status, so the predicate was unreachable.
  const sameSlot = existing.find(
    (e) =>
      e.courseId === enrollment.courseId &&
      e.termId === enrollment.termId
  )
  if (sameSlot) {
    return {
      ok: false,
      reason: "already_enrolled_this_term",
      details: `student already has a row for course ${enrollment.courseId} in term ${enrollment.termId} (status=${sameSlot.status})`,
    }
  }

  // 3. Already completed (prior term) — only allow if caller opts in.
  if (!allowRetake) {
    const priorCompleted = existing.find(
      (e) => e.courseId === enrollment.courseId && e.status === "completed"
    )
    if (priorCompleted) {
      return {
        ok: false,
        reason: "duplicate_completed_no_retake",
        details: `student already completed course ${enrollment.courseId} in a prior term — pass allowRetake=true to override`,
      }
    }
  }

  // 4. Credit cap — sum credits across ACTIVE enrollments in the SAME term.
  const sameTermCredits = existing
    .filter((e) => e.termId === enrollment.termId && ACTIVE_FOR_CAP.has(e.status))
    .reduce((acc, e) => acc + (e.credits ?? 0), 0)
  if (sameTermCredits + enrollment.credits > maxCredits) {
    return {
      ok: false,
      reason: "credit_cap_exceeded",
      details: `term ${enrollment.termId} would total ${sameTermCredits + enrollment.credits} credits — exceeds cap ${maxCredits}`,
    }
  }

  return { ok: true }
}
