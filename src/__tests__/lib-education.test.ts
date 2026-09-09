/**
 * Tests for R10 Education Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  canEnrollmentTransition,
  canStudentTransition,
  canTermTransition,
  enrollmentAllowedNext,
  isEnrollmentStatus,
  isEnrollmentTerminal,
  isStudentStatus,
  isStudentTerminal,
  isTermStatus,
  isTermTerminal,
  studentAllowedNext,
  termAllowedNext,
} from "@/lib/education/state-machine"
import { validateEnrollment } from "@/lib/education/enrollment-validator"
import { calculateGpa, roundGpa } from "@/lib/education/gpa-calculator"
import { resolveTerms, termContaining } from "@/lib/education/term-resolver"
import {
  DEFAULT_MAX_CREDITS_PER_TERM,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  GPA_COUNTED_GRADES,
  GRADE_POINT_SCALE,
  LETTER_GRADES,
  STUDENT_STATUSES,
  STUDENT_TRANSITIONS,
  TERM_KINDS,
  TERM_STATUSES,
  TERM_TRANSITIONS,
  type ExistingEnrollment,
  type LetterGrade,
  type TermWindow,
} from "@/lib/education/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("R10 — student state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of STUDENT_STATUSES) expect(isStudentStatus(s)).toBe(true)
  })

  it("rejects unknown statuses", () => {
    for (const s of ["", "Prospect", "ALUMNI", "frob", 42, null]) {
      expect(isStudentStatus(s)).toBe(false)
    }
  })

  it("prospect → applicant / inactive", () => {
    expect(canStudentTransition("prospect", "applicant").ok).toBe(true)
    expect(canStudentTransition("prospect", "inactive").ok).toBe(true)
  })

  it("prospect → graduated rejected (must walk lifecycle)", () => {
    expect(canStudentTransition("prospect", "graduated").ok).toBe(false)
  })

  it("graduated is terminal", () => {
    expect(isStudentTerminal("graduated")).toBe(true)
    expect(canStudentTransition("graduated", "enrolled").ok).toBe(false)
  })

  it("withdrawn → applicant allowed (re-apply)", () => {
    expect(canStudentTransition("withdrawn", "applicant").ok).toBe(true)
  })

  it("inactive can resume to applicant / admitted / enrolled", () => {
    for (const to of ["applicant", "admitted", "enrolled"] as const) {
      expect(canStudentTransition("inactive", to).ok).toBe(true)
    }
  })

  it("rejects self-transition", () => {
    for (const s of STUDENT_STATUSES) {
      expect(canStudentTransition(s, s).ok).toBe(false)
    }
  })

  it("studentAllowedNext matches table", () => {
    for (const s of STUDENT_STATUSES) {
      expect(studentAllowedNext(s)).toEqual(STUDENT_TRANSITIONS[s])
    }
  })
})

describe("R10 — term state-machine", () => {
  it("planning → registration / cancelled", () => {
    expect(canTermTransition("planning", "registration").ok).toBe(true)
    expect(canTermTransition("planning", "cancelled").ok).toBe(true)
  })

  it("registration → active / cancelled", () => {
    expect(canTermTransition("registration", "active").ok).toBe(true)
  })

  it("active → completed allowed", () => {
    expect(canTermTransition("active", "completed").ok).toBe(true)
  })

  it("completed is terminal", () => {
    expect(isTermTerminal("completed")).toBe(true)
  })

  it("rejects skip from planning to completed", () => {
    expect(canTermTransition("planning", "completed").ok).toBe(false)
  })

  it("isTermStatus + termAllowedNext", () => {
    for (const s of TERM_STATUSES) {
      expect(isTermStatus(s)).toBe(true)
      expect(termAllowedNext(s)).toEqual(TERM_TRANSITIONS[s])
    }
  })
})

describe("R10 — enrollment state-machine", () => {
  it("pending → enrolled / dropped / audit", () => {
    expect(canEnrollmentTransition("pending", "enrolled").ok).toBe(true)
    expect(canEnrollmentTransition("pending", "dropped").ok).toBe(true)
    expect(canEnrollmentTransition("pending", "audit").ok).toBe(true)
  })

  it("enrolled → completed / failed / dropped / audit", () => {
    for (const to of ["completed", "failed", "dropped", "audit"] as const) {
      expect(canEnrollmentTransition("enrolled", to).ok).toBe(true)
    }
  })

  it("audit → completed / failed / dropped (regradable)", () => {
    for (const to of ["completed", "failed", "dropped"] as const) {
      expect(canEnrollmentTransition("audit", to).ok).toBe(true)
    }
  })

  it("completed / failed / dropped are terminal", () => {
    for (const s of ["completed", "failed", "dropped"] as const) {
      expect(isEnrollmentTerminal(s)).toBe(true)
    }
  })

  it("isEnrollmentStatus + enrollmentAllowedNext parity", () => {
    for (const s of ENROLLMENT_STATUSES) {
      expect(isEnrollmentStatus(s)).toBe(true)
      expect(enrollmentAllowedNext(s)).toEqual(ENROLLMENT_TRANSITIONS[s])
    }
  })
})

/* ─── Enrollment validator ────────────────────────────────────────────── */

describe("R10 — enrollment-validator", () => {
  const NEW_ENROLLMENT = {
    studentId: "stu_1",
    courseId: "CS201",
    termId: "term_fall_2026",
    credits: 4,
  }

  it("accepts when no existing + no prerequisites", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(true)
  })

  it("accepts when all prerequisites completed", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [],
      prerequisites: [
        { courseId: "CS101", completed: true },
        { courseId: "MATH100", completed: true },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when a prerequisite is incomplete", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [],
      prerequisites: [
        { courseId: "CS101", completed: true },
        { courseId: "MATH100", completed: false },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("prerequisite_not_completed")
  })

  it("rejects when student already enrolled in same (course, term)", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        {
          courseId: "CS201",
          termId: "term_fall_2026",
          status: "enrolled",
          credits: 4,
          gradePoints: null,
        },
      ],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("already_enrolled_this_term")
  })

  it("rejects re-take when previously completed (default)", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        {
          courseId: "CS201",
          termId: "term_spring_2025",
          status: "completed",
          credits: 4,
          gradePoints: 3.7,
        },
      ],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("duplicate_completed_no_retake")
  })

  it("accepts re-take when allowRetake=true", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        {
          courseId: "CS201",
          termId: "term_spring_2025",
          status: "completed",
          credits: 4,
          gradePoints: 3.7,
        },
      ],
      prerequisites: [],
      allowRetake: true,
    })
    expect(r.ok).toBe(true)
  })

  it("accepts re-take after FAIL (no allowRetake needed)", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        {
          courseId: "CS201",
          termId: "term_spring_2025",
          status: "failed",
          credits: 4,
          gradePoints: 0.0,
        },
      ],
      prerequisites: [],
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when same-term credit cap would be exceeded", () => {
    // Already 15 credits enrolled this term; new is 4 → 19 > 18 cap.
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        {
          courseId: "CS101",
          termId: "term_fall_2026",
          status: "enrolled",
          credits: 9,
          gradePoints: null,
        },
        {
          courseId: "MATH200",
          termId: "term_fall_2026",
          status: "enrolled",
          credits: 6,
          gradePoints: null,
        },
      ],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("credit_cap_exceeded")
  })

  it("ignores completed enrollments in OTHER terms when computing cap", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [
        // Same student, but PRIOR term — shouldn't count against fall_2026 cap.
        {
          courseId: "BIO101",
          termId: "term_spring_2026",
          status: "completed",
          credits: 12,
          gradePoints: 3.0,
        },
      ],
      prerequisites: [],
    })
    expect(r.ok).toBe(true)
  })

  it("respects custom maxCreditsPerTerm", () => {
    const r = validateEnrollment({
      enrollment: NEW_ENROLLMENT,
      existing: [],
      prerequisites: [],
      maxCreditsPerTerm: 3, // 4 > 3 → reject
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("credit_cap_exceeded")
  })

  it("rejects bad credits input (negative)", () => {
    const r = validateEnrollment({
      enrollment: { ...NEW_ENROLLMENT, credits: -1 },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    // Architect-pass-1 close-out: bad-input rejections route to
    // `invalid_input`, not the business-rule `credit_cap_exceeded`.
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("rejects bad credits input — over 12 (routes to invalid_input, not cap)", () => {
    const r = validateEnrollment({
      enrollment: { ...NEW_ENROLLMENT, credits: 13 },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("rejects missing studentId (routes to invalid_input)", () => {
    const r = validateEnrollment({
      enrollment: { ...NEW_ENROLLMENT, studentId: "" },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })
})

/* ─── GPA calculator ──────────────────────────────────────────────────── */

describe("R10 — gpa-calculator", () => {
  function mkEnrollment(
    credits: number,
    gradePoints: number | null,
    status: ExistingEnrollment["status"] = "completed"
  ): ExistingEnrollment {
    return {
      courseId: `course_${Math.random()}`,
      termId: "term_x",
      status,
      credits,
      gradePoints,
    }
  }

  it("returns null GPA when no graded enrollments", () => {
    const r = calculateGpa({ enrollments: [] })
    expect(r.gpa).toBeNull()
    expect(r.creditHoursAttempted).toBe(0)
    expect(r.creditHoursEarned).toBe(0)
  })

  it("computes simple 4.0 case", () => {
    // 3 credits @ 4.0 = 12 quality points / 3 attempted = 4.0
    const r = calculateGpa({ enrollments: [mkEnrollment(3, 4.0)] })
    expect(r.gpa).toBeCloseTo(4.0)
    expect(r.creditHoursAttempted).toBe(3)
    expect(r.creditHoursEarned).toBe(3)
  })

  it("weights GPA by credits", () => {
    // 4-credit A (4.0) + 3-credit B (3.0) = (16 + 9) / 7 = 25/7 ≈ 3.571
    const r = calculateGpa({
      enrollments: [mkEnrollment(4, 4.0), mkEnrollment(3, 3.0)],
    })
    expect(r.gpa).toBeCloseTo(25 / 7, 4)
    expect(r.creditHoursAttempted).toBe(7)
    expect(r.creditHoursEarned).toBe(7)
  })

  it("F counts toward attempted but NOT earned credits", () => {
    const r = calculateGpa({
      enrollments: [mkEnrollment(3, 4.0), mkEnrollment(3, 0.0)],
    })
    expect(r.gpa).toBeCloseTo(2.0)
    expect(r.creditHoursAttempted).toBe(6)
    expect(r.creditHoursEarned).toBe(3) // F doesn't earn
  })

  it("P-grade adds to creditHoursEarned but not GPA", () => {
    const r = calculateGpa({
      enrollments: [mkEnrollment(3, 4.0), mkEnrollment(3, null)],
      letterGradeByIndex: { 1: "P" },
    })
    expect(r.gpa).toBeCloseTo(4.0)
    expect(r.creditHoursAttempted).toBe(3)
    // 3 from numeric A + 3 from P = 6 earned
    expect(r.creditHoursEarned).toBe(6)
  })

  it("I-grade is excluded from BOTH attempted and earned", () => {
    const r = calculateGpa({
      enrollments: [mkEnrollment(3, 4.0), mkEnrollment(3, null)],
      letterGradeByIndex: { 1: "I" },
    })
    expect(r.gpa).toBeCloseTo(4.0)
    expect(r.creditHoursAttempted).toBe(3)
    expect(r.creditHoursEarned).toBe(3)
  })

  it("uses letterGradeByIndex when gradePoints is null", () => {
    const r = calculateGpa({
      enrollments: [mkEnrollment(3, null)],
      letterGradeByIndex: { 0: "B+" }, // 3.3
    })
    expect(r.gpa).toBeCloseTo(3.3)
  })

  it("ignores enrollments with no grade + no letter fallback", () => {
    const r = calculateGpa({
      enrollments: [mkEnrollment(3, 4.0), mkEnrollment(3, null, "enrolled")],
    })
    expect(r.gpa).toBeCloseTo(4.0)
    expect(r.countedEnrollments).toBe(1)
  })

  it("ignores bad-credit enrollments", () => {
    const r = calculateGpa({
      enrollments: [
        mkEnrollment(3, 4.0),
        // Bad: negative credits
        { ...mkEnrollment(0, 3.0), credits: -1 },
      ],
    })
    expect(r.gpa).toBeCloseTo(4.0)
    expect(r.countedEnrollments).toBe(1)
  })

  it("roundGpa truncates to 2dp", () => {
    expect(roundGpa(3.456789)).toBe(3.46)
    expect(roundGpa(3.444)).toBe(3.44)
    expect(roundGpa(null)).toBeNull()
  })
})

/* ─── Term resolver ───────────────────────────────────────────────────── */

describe("R10 — term-resolver", () => {
  function mkTerm(
    id: string,
    startISO: string,
    endISO: string,
    opts: Partial<TermWindow> = {}
  ): TermWindow {
    return {
      id,
      startDate: new Date(startISO),
      endDate: new Date(endISO),
      registrationOpensAt: opts.registrationOpensAt ?? null,
      registrationClosesAt: opts.registrationClosesAt ?? null,
      status: opts.status ?? "active",
    }
  }

  it("identifies current term", () => {
    const fall = mkTerm("fall", "2026-08-15", "2026-12-15")
    const spring = mkTerm("spring", "2026-01-15", "2026-05-15", { status: "completed" })
    const r = resolveTerms({
      terms: [fall, spring],
      asOf: new Date("2026-10-01"),
    })
    expect(r.current?.id).toBe("fall")
  })

  it("returns null when asOf is between terms", () => {
    const fall = mkTerm("fall", "2026-08-15", "2026-12-15", { status: "completed" })
    const spring = mkTerm("spring", "2027-01-15", "2027-05-15")
    const r = resolveTerms({
      terms: [fall, spring],
      asOf: new Date("2026-12-20"),
    })
    expect(r.current).toBeNull()
  })

  it("registrationOpen requires explicit window", () => {
    const fall = mkTerm("fall", "2026-08-15", "2026-12-15", {
      registrationOpensAt: new Date("2026-06-01"),
      registrationClosesAt: new Date("2026-08-14"),
      status: "registration",
    })
    const r = resolveTerms({
      terms: [fall],
      asOf: new Date("2026-07-15"),
    })
    expect(r.registrationOpen).toHaveLength(1)
    expect(r.registrationOpen[0].id).toBe("fall")
  })

  it("registrationOpen excludes terms with no window configured", () => {
    const fall = mkTerm("fall", "2026-08-15", "2026-12-15")
    const r = resolveTerms({
      terms: [fall],
      asOf: new Date("2026-07-15"),
    })
    expect(r.registrationOpen).toHaveLength(0)
  })

  it("registrationOpen excludes terms whose window already closed", () => {
    const fall = mkTerm("fall", "2026-08-15", "2026-12-15", {
      registrationOpensAt: new Date("2026-06-01"),
      registrationClosesAt: new Date("2026-08-14"),
    })
    const r = resolveTerms({
      terms: [fall],
      asOf: new Date("2026-08-15"), // boundary — exclusive close
    })
    expect(r.registrationOpen).toHaveLength(0)
  })

  it("upcoming sorted earliest-first", () => {
    const t1 = mkTerm("t1", "2027-01-15", "2027-05-15")
    const t2 = mkTerm("t2", "2027-08-15", "2027-12-15")
    const r = resolveTerms({
      terms: [t2, t1],
      asOf: new Date("2026-10-01"),
    })
    expect(r.upcoming.map((t) => t.id)).toEqual(["t1", "t2"])
  })

  it("past sorted latest-first", () => {
    const t1 = mkTerm("t1", "2024-01-15", "2024-05-15", { status: "completed" })
    const t2 = mkTerm("t2", "2024-08-15", "2024-12-15", { status: "completed" })
    const r = resolveTerms({
      terms: [t1, t2],
      asOf: new Date("2026-10-01"),
    })
    expect(r.past.map((t) => t.id)).toEqual(["t2", "t1"])
  })

  it("excludes cancelled terms", () => {
    const cancelled = mkTerm("c", "2026-08-15", "2026-12-15", { status: "cancelled" })
    const r = resolveTerms({
      terms: [cancelled],
      asOf: new Date("2026-10-01"),
    })
    expect(r.current).toBeNull()
    expect(r.upcoming).toHaveLength(0)
    expect(r.past).toHaveLength(0)
  })

  it("filters invalid terms (endDate <= startDate)", () => {
    const bad: TermWindow = {
      id: "bad",
      startDate: new Date("2026-12-31"),
      endDate: new Date("2026-01-01"),
      registrationOpensAt: null,
      registrationClosesAt: null,
      status: "active",
    }
    const r = resolveTerms({ terms: [bad], asOf: new Date("2026-06-01") })
    expect(r.current).toBeNull()
  })

  it("returns empty when asOf is invalid", () => {
    const r = resolveTerms({ terms: [], asOf: new Date(NaN) })
    expect(r.current).toBeNull()
    expect(r.upcoming).toEqual([])
  })

  it("termContaining convenience", () => {
    const fall = {
      id: "fall",
      startDate: new Date("2026-08-15"),
      endDate: new Date("2026-12-15"),
      registrationOpensAt: null,
      registrationClosesAt: null,
      status: "active" as const,
    }
    expect(termContaining([fall], new Date("2026-10-01"))?.id).toBe("fall")
    expect(termContaining([fall], new Date("2027-01-01"))).toBeNull()
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("R10 — registry drift guards", () => {
  it("STUDENT_STATUSES exactly 7", () => {
    expect(STUDENT_STATUSES).toEqual([
      "prospect",
      "applicant",
      "admitted",
      "enrolled",
      "graduated",
      "withdrawn",
      "inactive",
    ])
  })

  it("TERM_STATUSES exactly 5", () => {
    expect(TERM_STATUSES).toEqual([
      "planning",
      "registration",
      "active",
      "completed",
      "cancelled",
    ])
  })

  it("ENROLLMENT_STATUSES exactly 6", () => {
    expect(ENROLLMENT_STATUSES).toEqual([
      "pending",
      "enrolled",
      "dropped",
      "completed",
      "failed",
      "audit",
    ])
  })

  it("TERM_KINDS exactly 4", () => {
    expect(TERM_KINDS).toEqual(["semester", "quarter", "trimester", "summer"])
  })

  it("LETTER_GRADES exactly 15", () => {
    expect(LETTER_GRADES).toHaveLength(15)
  })

  it("GRADE_POINT_SCALE: A=4.0, F=0.0, I/W/P/NP=null", () => {
    expect(GRADE_POINT_SCALE.A).toBe(4.0)
    expect(GRADE_POINT_SCALE.F).toBe(0.0)
    expect(GRADE_POINT_SCALE.I).toBeNull()
    expect(GRADE_POINT_SCALE.W).toBeNull()
    expect(GRADE_POINT_SCALE.P).toBeNull()
    expect(GRADE_POINT_SCALE.NP).toBeNull()
  })

  it("GPA_COUNTED_GRADES excludes I/W/P/NP", () => {
    const excluded: LetterGrade[] = ["I", "W", "P", "NP"]
    for (const e of excluded) {
      expect(GPA_COUNTED_GRADES.includes(e)).toBe(false)
    }
    // 15 total - 4 excluded = 11 counted
    expect(GPA_COUNTED_GRADES).toHaveLength(11)
  })

  it("DEFAULT_MAX_CREDITS_PER_TERM is 18", () => {
    expect(DEFAULT_MAX_CREDITS_PER_TERM).toBe(18)
  })

  it("STUDENT_TRANSITIONS covers every status", () => {
    for (const s of STUDENT_STATUSES) {
      expect(STUDENT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal student statuses are exactly [graduated]", () => {
    const terminals = STUDENT_STATUSES.filter((s) => STUDENT_TRANSITIONS[s].length === 0)
    expect(terminals).toEqual(["graduated"])
  })

  it("Terminal enrollment statuses are exactly [completed, failed, dropped]", () => {
    const terminals = ENROLLMENT_STATUSES.filter(
      (s) => ENROLLMENT_TRANSITIONS[s].length === 0
    )
    expect(terminals.sort()).toEqual(["completed", "dropped", "failed"])
  })
})

/* ─── Post-architect-pass-1 fixes ─────────────────────────────────────── */

describe("R10 — post-architect (enrollment-validator invalid_input)", () => {
  const BASE = {
    studentId: "stu_1",
    courseId: "CS201",
    termId: "term_x",
    credits: 4,
  }

  it("missing studentId returns reason='invalid_input'", () => {
    const r = validateEnrollment({
      enrollment: { ...BASE, studentId: "" },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("missing courseId returns reason='invalid_input'", () => {
    const r = validateEnrollment({
      enrollment: { ...BASE, courseId: "" },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("missing termId returns reason='invalid_input'", () => {
    const r = validateEnrollment({
      enrollment: { ...BASE, termId: "" },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("non-integer credits returns reason='invalid_input'", () => {
    const r = validateEnrollment({
      enrollment: { ...BASE, credits: 3.5 },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("credits over 12 returns reason='invalid_input' (was misrouted to credit_cap_exceeded)", () => {
    const r = validateEnrollment({
      enrollment: { ...BASE, credits: 13 },
      existing: [],
      prerequisites: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })
})

describe("R10 — post-architect (term-resolver status filtering)", () => {
  function mkTerm(
    id: string,
    startISO: string,
    endISO: string,
    opts: Partial<TermWindow> = {}
  ): TermWindow {
    return {
      id,
      startDate: new Date(startISO),
      endDate: new Date(endISO),
      registrationOpensAt: opts.registrationOpensAt ?? null,
      registrationClosesAt: opts.registrationClosesAt ?? null,
      status: opts.status ?? "active",
    }
  }

  it("`current` excludes planning terms even when dates match", () => {
    const draft = mkTerm("draft", "2026-08-15", "2026-12-15", { status: "planning" })
    const r = resolveTerms({
      terms: [draft],
      asOf: new Date("2026-10-01"),
    })
    expect(r.current).toBeNull()
  })

  it("`current` excludes completed terms even when asOf inside (date misalignment)", () => {
    const stale = mkTerm("stale", "2026-08-15", "2026-12-15", { status: "completed" })
    const r = resolveTerms({
      terms: [stale],
      asOf: new Date("2026-10-01"),
    })
    expect(r.current).toBeNull()
  })

  it("`current` accepts terms in registration status", () => {
    const reg = mkTerm("reg", "2026-08-15", "2026-12-15", { status: "registration" })
    const r = resolveTerms({
      terms: [reg],
      asOf: new Date("2026-10-01"),
    })
    expect(r.current?.id).toBe("reg")
  })

  it("`registrationOpen` excludes active/completed/planning terms even with stale window", () => {
    // Active term with a legacy registration window that hasn't been
    // cleared — should NOT appear in registrationOpen since status
    // is no longer "registration".
    const active = mkTerm("active", "2026-08-15", "2026-12-15", {
      status: "active",
      registrationOpensAt: new Date("2026-06-01"),
      registrationClosesAt: new Date("2027-01-01"), // stale, still wide
    })
    const r = resolveTerms({
      terms: [active],
      asOf: new Date("2026-10-01"),
    })
    expect(r.registrationOpen).toHaveLength(0)
  })

  it("`registrationOpen` only includes status='registration' terms", () => {
    const reg = mkTerm("reg", "2026-08-15", "2026-12-15", {
      status: "registration",
      registrationOpensAt: new Date("2026-06-01"),
      registrationClosesAt: new Date("2026-08-14"),
    })
    const r = resolveTerms({
      terms: [reg],
      asOf: new Date("2026-07-15"),
    })
    expect(r.registrationOpen).toHaveLength(1)
    expect(r.registrationOpen[0].id).toBe("reg")
  })
})
