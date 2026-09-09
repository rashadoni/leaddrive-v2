/**
 * GPA calculator — R10 slice 1.
 *
 * Standard 4.0-scale weighted GPA:
 *
 *   GPA = sum(credits[i] * gradePoints[i]) / sum(credits[i])
 *
 * Only enrollments with a numeric grade point contribute. I/W/P/NP
 * are excluded from the GPA math but P credits count toward
 * "credit hours earned" since they represent successful completion
 * without a numeric grade.
 *
 * Pure synchronous. Helper uses regular Number arithmetic (no BigInt
 * needed — grade points 0..4 × credits 0..12 × N rows fits in
 * Number.MAX_SAFE_INTEGER for any realistic transcript).
 */
import {
  GRADE_POINT_SCALE,
  type GpaInput,
  type GpaResult,
  type LetterGrade,
} from "./types"

const PASSING_NON_NUMERIC: ReadonlySet<LetterGrade> = new Set(["P"])

export function calculateGpa(input: GpaInput): GpaResult {
  let weightedSum = 0
  let creditsAttempted = 0
  let creditsEarned = 0
  let counted = 0

  for (let i = 0; i < input.enrollments.length; i++) {
    const e = input.enrollments[i]
    // Resolve effective grade points: prefer the row's own number,
    // fall back to letterGradeByIndex lookup if provided.
    let gp: number | null = e.gradePoints
    let letter: LetterGrade | undefined
    if (gp === null && input.letterGradeByIndex) {
      letter = input.letterGradeByIndex[i]
      if (letter !== undefined) {
        gp = GRADE_POINT_SCALE[letter]
      }
    }
    // Skip if neither numeric grade nor a letter mapping to a number.
    if (gp === null || gp === undefined) {
      // P-grade case: still counts as creditsEarned even without GPA contribution.
      if (letter && PASSING_NON_NUMERIC.has(letter)) {
        creditsEarned += e.credits
      }
      continue
    }
    // Reject obviously bad data — credits must be non-negative integer.
    if (
      typeof e.credits !== "number" ||
      !Number.isFinite(e.credits) ||
      e.credits < 0
    ) {
      continue
    }
    weightedSum += e.credits * gp
    creditsAttempted += e.credits
    counted += 1
    // F (0.0) attempts credit but earns 0.
    if (gp > 0) {
      creditsEarned += e.credits
    }
  }

  return {
    gpa: creditsAttempted > 0 ? weightedSum / creditsAttempted : null,
    creditHoursAttempted: creditsAttempted,
    creditHoursEarned: creditsEarned,
    countedEnrollments: counted,
  }
}

/**
 * Convenience: round a GPA to 2 decimal places. Helper math returns
 * full-precision; UI typically wants `3.42` instead of `3.41666...`.
 */
export function roundGpa(gpa: number | null): number | null {
  if (gpa === null) return null
  return Math.round(gpa * 100) / 100
}
