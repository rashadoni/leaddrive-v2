/**
 * Education Cloud types — R10 Phase 6 Block E first slice.
 *
 * Salesforce EDA analogue. Shared shape between 5 pure helpers:
 *   1. state-machine          — student / term / enrollment lifecycles
 *   2. enrollment-validator   — prerequisite + credit-cap + term-overlap
 *   3. gpa-calculator         — standard 4.0 scale aggregator
 *   4. term-resolver          — current / upcoming / past windowing
 *   5. (re-exported)          — typed I/O for slice-2 caller code
 *
 * Pure — no Prisma imports.
 */

/* ─── Student status + transitions ────────────────────────────────────── */

export const STUDENT_STATUSES = [
  "prospect",
  "applicant",
  "admitted",
  "enrolled",
  "graduated",
  "withdrawn",
  "inactive",
] as const

export type StudentStatus = (typeof STUDENT_STATUSES)[number]

/**
 *   prospect → applicant | inactive
 *   applicant → admitted | withdrawn | inactive
 *   admitted → enrolled | withdrawn | inactive
 *   enrolled → graduated | withdrawn | inactive
 *   inactive → applicant | admitted | enrolled (back to wherever; resume)
 *   graduated → []     (terminal)
 *   withdrawn → applicant  (re-apply after withdrawal — slice-2 may
 *                          require admin override)
 */
export const STUDENT_TRANSITIONS: Readonly<
  Record<StudentStatus, readonly StudentStatus[]>
> = {
  prospect: ["applicant", "inactive"],
  applicant: ["admitted", "withdrawn", "inactive"],
  admitted: ["enrolled", "withdrawn", "inactive"],
  enrolled: ["graduated", "withdrawn", "inactive"],
  graduated: [],
  withdrawn: ["applicant"],
  inactive: ["applicant", "admitted", "enrolled"],
}

/* ─── Term status + transitions ───────────────────────────────────────── */

export const TERM_STATUSES = [
  "planning",
  "registration",
  "active",
  "completed",
  "cancelled",
] as const

export type TermStatus = (typeof TERM_STATUSES)[number]

export const TERM_TRANSITIONS: Readonly<Record<TermStatus, readonly TermStatus[]>> = {
  planning: ["registration", "cancelled"],
  registration: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

export const TERM_KINDS = ["semester", "quarter", "trimester", "summer"] as const
export type TermKind = (typeof TERM_KINDS)[number]

/* ─── Enrollment status + transitions ─────────────────────────────────── */

export const ENROLLMENT_STATUSES = [
  "pending",
  "enrolled",
  "dropped",
  "completed",
  "failed",
  "audit",
] as const

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

/**
 *   pending → enrolled | dropped | audit
 *   enrolled → completed | failed | dropped | audit
 *   audit → completed | failed | dropped  (audit row can be regraded)
 *   completed / failed / dropped → []
 *
 * Slice-2 may add `incomplete` → `completed` re-grading after I-grade
 * issuance.
 */
export const ENROLLMENT_TRANSITIONS: Readonly<
  Record<EnrollmentStatus, readonly EnrollmentStatus[]>
> = {
  pending: ["enrolled", "dropped", "audit"],
  enrolled: ["completed", "failed", "dropped", "audit"],
  audit: ["completed", "failed", "dropped"],
  completed: [],
  failed: [],
  dropped: [],
}

/* ─── Letter grade ↔ grade points (US 4.0 scale) ──────────────────────── */

/**
 * Standard US 4.0 scale. Helpers use grade points for math; letter
 * grade is the human-readable label.
 *
 *   I (incomplete) / W (withdrawn) — not in the 4.0 scale, no points.
 *   P / NP — pass/no-pass, not in 4.0 scale.
 *
 * Slice-2 may parameterise the scale per tenant (some institutions
 * use 4.3 with A+, others use 100-point scale).
 */
export const LETTER_GRADES = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "F",
  "I",
  "W",
  "P",
  "NP",
] as const

export type LetterGrade = (typeof LETTER_GRADES)[number]

export const GRADE_POINT_SCALE: Readonly<Record<LetterGrade, number | null>> = {
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  F: 0.0,
  I: null, // incomplete — excluded from GPA
  W: null, // withdrawn — excluded from GPA
  P: null, // pass — excluded from GPA but credits count
  NP: null, // no pass — excluded from GPA, no credits
}

/**
 * Grades that COUNT toward GPA (have a numeric grade point). I/W/P/NP
 * are excluded. Drift-guard test pins this set.
 */
export const GPA_COUNTED_GRADES: readonly LetterGrade[] = LETTER_GRADES.filter(
  (g) => GRADE_POINT_SCALE[g] !== null
)

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── Enrollment validator I/O ────────────────────────────────────────── */

/**
 * Existing enrollment row as input — caller pre-fetches a student's
 * enrollment history. Helper does NOT query the DB.
 */
export interface ExistingEnrollment {
  /** Foreign key to the course. */
  courseId: string
  /** Term id of this existing enrollment. */
  termId: string
  status: EnrollmentStatus
  /** Credits this enrollment will/did contribute. */
  credits: number
  /** Grade points (NULL for non-graded statuses). */
  gradePoints: number | null
}

export interface ProspectiveEnrollment {
  studentId: string
  courseId: string
  termId: string
  /** Course credits being attempted. */
  credits: number
}

export interface PrerequisiteCheck {
  /** Course id of the prerequisite. */
  courseId: string
  /** Did the student complete it successfully (status='completed')? */
  completed: boolean
}

export interface ValidateEnrollmentInput {
  /** The new enrollment being attempted. */
  enrollment: ProspectiveEnrollment
  /** Existing enrollments for the SAME student. */
  existing: readonly ExistingEnrollment[]
  /** Course prerequisites as resolved by caller. */
  prerequisites: readonly PrerequisiteCheck[]
  /** Per-term credit cap (typical 18). Slice-2 may parameterise. */
  maxCreditsPerTerm?: number
  /** Allow re-enroll in a course the student previously failed/dropped. */
  allowRetake?: boolean
}

export type ValidateEnrollmentResult =
  | { ok: true }
  | {
      ok: false
      /**
       * Hard rejection — caller MUST NOT INSERT.
       *
       * `invalid_input` covers malformed inputs (missing ids, bad
       * credit value) — distinct from the business-rule rejections
       * so caller telemetry doesn't conflate "duplicate completed"
       * alerts with "client sent empty studentId".
       */
      reason:
        | "invalid_input"
        | "prerequisite_not_completed"
        | "credit_cap_exceeded"
        | "already_enrolled_this_term"
        | "duplicate_completed_no_retake"
      details: string
    }

export const DEFAULT_MAX_CREDITS_PER_TERM = 18

/* ─── GPA calculator I/O ──────────────────────────────────────────────── */

export interface GpaInput {
  /** Enrollments to consider — caller decides scope (all-time, by term, etc.). */
  enrollments: readonly ExistingEnrollment[]
  /**
   * Optional letter-grade override for enrollments that don't have
   * `gradePoints` set yet (e.g. caller pre-fetches with letter only).
   * Keyed by enrollment-row position in `enrollments`.
   */
  letterGradeByIndex?: Readonly<Record<number, LetterGrade>>
}

export interface GpaResult {
  /** Weighted by credits. Returns null if no graded enrollments. */
  gpa: number | null
  /** Sum of credits that contributed to the GPA. */
  creditHoursAttempted: number
  /** Sum of credits with passing grades (P + non-F numeric). */
  creditHoursEarned: number
  /** Count of enrollments included in the math. */
  countedEnrollments: number
}

/* ─── Term resolver I/O ───────────────────────────────────────────────── */

export interface TermWindow {
  id: string
  startDate: Date
  endDate: Date
  /**
   * Registration window endpoints. Both endpoints null = "no window
   * configured" — term resolver EXCLUDES such terms from
   * `registrationOpen` regardless of `asOf` falling in the term's
   * main dates. Tenants that want always-open registration MUST set
   * both endpoints to wide bounds (e.g. registrationOpensAt = term
   * startDate minus 1 year; registrationClosesAt = term startDate +
   * 1 day).
   */
  registrationOpensAt: Date | null
  registrationClosesAt: Date | null
  status: TermStatus
}

export interface ResolveTermInput {
  /** All terms in scope — typically tenant's calendar. */
  terms: readonly TermWindow[]
  /** Caller-supplied "now". */
  asOf: Date
}

export interface ResolveTermResult {
  /** The term whose [startDate, endDate] contains asOf, if any. */
  current: TermWindow | null
  /** All terms whose registration window contains asOf, in startDate order. */
  registrationOpen: TermWindow[]
  /** Terms starting AFTER asOf, sorted earliest-first. */
  upcoming: TermWindow[]
  /** Terms ending BEFORE asOf, sorted latest-first (most recent first). */
  past: TermWindow[]
}
