-- R10: Education Cloud (Phase 6 Block E first slice).
--
-- Salesforce Education Data Architecture (EDA) analogue. Student
-- lifecycle, course catalog, term-based enrollments, faculty.
--
-- Workflow: recruit → admit → enroll → advise → graduate.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine, enrollment-
-- validator with prerequisites + credit-cap + term-overlap, gpa-
-- calculator with standard 4.0 scale, term-resolver for current/
-- upcoming/past windowing).
--
-- Slice 2 wires:
--   • Admin UI for course catalog + term planning.
--   • Student portal (`(portal)/education/`) for self-service
--     registration + GPA + transcripts.
--   • Bulk-import flows (CSV).
--   • Advisor assignment + meeting scheduler.
-- Slice 3 wires:
--   • Grade-book + assignment tracking.
--   • Financial-aid / scholarship modules.
--   • Reusable OmniStudio FlexCard templates for student record view
--     (N16 integration).

-- ── EducationAcademicTerm ──────────────────────────────────────
-- Semester / quarter / trimester. Enrollments are tied to a term.
-- `code` is the human-readable label ("Fall 2026"); slug is URL-safe.
CREATE TABLE "education_academic_terms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug — UNIQUE per tenant. */
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /** Term kind hint: semester | quarter | trimester | summer. */
    "termKind" TEXT NOT NULL DEFAULT 'semester',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    /** Registration window — distinct from term active window. */
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    /**
     * Status (DB CHECK):
     *   planning      — admin draft, no registration yet
     *   registration  — open for enrollment, term hasn't started
     *   active        — term in session
     *   completed     — term ended
     *   cancelled     — term aborted (rare; preserved for audit)
     */
    "status" TEXT NOT NULL DEFAULT 'planning',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_academic_terms_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_status_check"
  CHECK ("status" IN ('planning', 'registration', 'active', 'completed', 'cancelled'));

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_kind_check"
  CHECK ("termKind" IN ('semester', 'quarter', 'trimester', 'summer'));

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_period_check"
  CHECK ("endDate" > "startDate");

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_registration_window_check"
  CHECK (
    "registrationOpensAt" IS NULL
    OR "registrationClosesAt" IS NULL
    OR "registrationClosesAt" > "registrationOpensAt"
  );

CREATE UNIQUE INDEX "education_academic_terms_org_slug_uniq"
  ON "education_academic_terms"("organizationId", "slug");
CREATE INDEX "education_academic_terms_org_status_idx"
  ON "education_academic_terms"("organizationId", "status");
CREATE INDEX "education_academic_terms_period_idx"
  ON "education_academic_terms"("organizationId", "startDate", "endDate");

ALTER TABLE "education_academic_terms"
  ADD CONSTRAINT "education_academic_terms_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EducationFaculty ───────────────────────────────────────────
-- Instructor record. Faculty teach courses (via course.facultyId FK).
CREATE TABLE "education_faculty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional User link for faculty who log in to CRM. */
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    /** Department slug — opaque to slice 1 (no department table yet). */
    "departmentSlug" TEXT,
    /** Faculty title: professor | associate | adjunct | lecturer | teaching_assistant. */
    "title" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_faculty_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "education_faculty"
  ADD CONSTRAINT "education_faculty_title_check"
  CHECK (
    "title" IS NULL
    OR "title" IN ('professor', 'associate', 'adjunct', 'lecturer', 'teaching_assistant')
  );

CREATE UNIQUE INDEX "education_faculty_org_email_uniq"
  ON "education_faculty"("organizationId", "email");
CREATE INDEX "education_faculty_org_active_idx"
  ON "education_faculty"("organizationId", "isActive");
CREATE INDEX "education_faculty_department_idx"
  ON "education_faculty"("organizationId", "departmentSlug");

ALTER TABLE "education_faculty"
  ADD CONSTRAINT "education_faculty_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EducationCourse ────────────────────────────────────────────
-- Course catalog. Independent of academic term — same course can run
-- multiple times across terms (slice-2 may add CourseOffering as a
-- per-term instance with capacity, schedule, etc.). Slice 1 keeps
-- 1:N from course to enrollments + denormalises term linkage on each
-- enrollment row.
CREATE TABLE "education_courses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Course code — UNIQUE per tenant (e.g. "CS101"). */
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    /** Credit hours awarded on successful completion. */
    "credits" INTEGER NOT NULL,
    /** Department slug. */
    "departmentSlug" TEXT,
    /** Lead instructor for the canonical offering. NULL = no assigned faculty. */
    "facultyId" TEXT,
    /**
     * Prerequisite course IDs — slice-1 enrollment-validator
     * walks this array to verify the student has completed all
     * prerequisites before allowing enroll. JSONB array of course
     * ids: `["course_id_A", "course_id_B"]`.
     */
    "prerequisiteCourseIds" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_courses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "education_courses"
  ADD CONSTRAINT "education_courses_credits_check"
  CHECK ("credits" >= 0 AND "credits" <= 12);

-- Course code shape — uppercase letters + digits + dashes.
ALTER TABLE "education_courses"
  ADD CONSTRAINT "education_courses_code_check"
  CHECK ("code" ~ '^[A-Z][A-Z0-9]{0,7}[- ]?[0-9]{1,5}[A-Z]?$');

CREATE UNIQUE INDEX "education_courses_org_code_uniq"
  ON "education_courses"("organizationId", "code");
CREATE INDEX "education_courses_org_active_idx"
  ON "education_courses"("organizationId", "isActive");
CREATE INDEX "education_courses_department_idx"
  ON "education_courses"("organizationId", "departmentSlug");
CREATE INDEX "education_courses_faculty_idx"
  ON "education_courses"("facultyId");

ALTER TABLE "education_courses"
  ADD CONSTRAINT "education_courses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "education_courses"
  ADD CONSTRAINT "education_courses_facultyId_fkey"
  FOREIGN KEY ("facultyId") REFERENCES "education_faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── EducationStudent ───────────────────────────────────────────
-- Student record. Distinct from CRM Contact because student lifecycle
-- (prospect → applicant → admitted → enrolled → graduated → withdrawn)
-- doesn't map cleanly to deal/contact stage; per EDA the SIS-side
-- record is its own concept.
CREATE TABLE "education_students" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional Contact link for prospects who came in via CRM. */
    "contactId" TEXT,
    /** Optional User link for students who log in to the portal. */
    "userId" TEXT,
    /** Student ID (institutional) — UNIQUE per tenant. */
    "externalStudentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    /** Birthdate for age-based enrollment rules (slice-2). */
    "birthDate" TIMESTAMP(3),
    /**
     * Lifecycle (DB CHECK):
     *   prospect    — initial interest, no application yet
     *   applicant   — submitted application
     *   admitted    — accepted, not yet enrolled
     *   enrolled    — currently taking courses
     *   graduated   — completed program
     *   withdrawn   — left without completing
     *   inactive    — paused / leave of absence
     */
    "status" TEXT NOT NULL DEFAULT 'prospect',
    /** Program slug — slice-1 opaque; slice-2 may add a Program table. */
    "programSlug" TEXT,
    /** Enrollment year for cohort tracking. */
    "cohortYear" INTEGER,
    /** Set on transition to admitted. */
    "admittedAt" TIMESTAMP(3),
    /** Set on transition to enrolled (first time). */
    "enrolledAt" TIMESTAMP(3),
    /** Set on transition to graduated. */
    "graduatedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_students_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_status_check"
  CHECK ("status" IN (
    'prospect', 'applicant', 'admitted', 'enrolled',
    'graduated', 'withdrawn', 'inactive'
  ));

ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_cohort_check"
  CHECK ("cohortYear" IS NULL OR ("cohortYear" >= 1900 AND "cohortYear" <= 2200));

ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_external_id_check"
  CHECK (length("externalStudentId") >= 1 AND length("externalStudentId") <= 64);

-- Status-timestamp coherence: admitted ⇒ admittedAt, enrolled ⇒ enrolledAt,
-- graduated ⇒ graduatedAt.
ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_admitted_coherence_check"
  CHECK (
    "status" NOT IN ('admitted', 'enrolled', 'graduated')
    OR "admittedAt" IS NOT NULL
  );
ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_enrolled_coherence_check"
  CHECK (
    "status" NOT IN ('enrolled', 'graduated')
    OR "enrolledAt" IS NOT NULL
  );
ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_graduated_coherence_check"
  CHECK ("status" <> 'graduated' OR "graduatedAt" IS NOT NULL);

CREATE UNIQUE INDEX "education_students_org_external_uniq"
  ON "education_students"("organizationId", "externalStudentId");
CREATE UNIQUE INDEX "education_students_org_email_uniq"
  ON "education_students"("organizationId", "email");
CREATE INDEX "education_students_org_status_idx"
  ON "education_students"("organizationId", "status");
CREATE INDEX "education_students_org_program_idx"
  ON "education_students"("organizationId", "programSlug");
CREATE INDEX "education_students_org_cohort_idx"
  ON "education_students"("organizationId", "cohortYear");

ALTER TABLE "education_students"
  ADD CONSTRAINT "education_students_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status-transition timestamps immutable once set (uses IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION education_students_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."admittedAt" IS NOT NULL AND NEW."admittedAt" IS DISTINCT FROM OLD."admittedAt" THEN
    RAISE EXCEPTION 'education_students.admittedAt is immutable once set (student %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."enrolledAt" IS NOT NULL AND NEW."enrolledAt" IS DISTINCT FROM OLD."enrolledAt" THEN
    RAISE EXCEPTION 'education_students.enrolledAt is immutable once set (student %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."graduatedAt" IS NOT NULL AND NEW."graduatedAt" IS DISTINCT FROM OLD."graduatedAt" THEN
    RAISE EXCEPTION 'education_students.graduatedAt is immutable once set (student %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER education_students_timestamps_immutable_trigger
  BEFORE UPDATE ON "education_students"
  FOR EACH ROW
  EXECUTE FUNCTION education_students_timestamps_immutable_fn();

-- ── EducationEnrollment ────────────────────────────────────────
-- Student-course junction with term + grade. Unique per (student,
-- course, term) — re-taking a course is a NEW row in a later term.
CREATE TABLE "education_enrollments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    /**
     * Lifecycle (DB CHECK):
     *   pending     — student registered, awaiting confirmation
     *   enrolled    — confirmed, attending
     *   dropped     — student left before completion (no grade)
     *   completed   — finished, grade assigned
     *   failed      — finished, did not meet passing standard
     *   audit       — attended for audit (no grade impact)
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Grade points 0.00-4.00; NULL until graded. */
    "gradePoints" DECIMAL(3, 2),
    /** Letter grade — A / A- / B+ / B / B- / ... / F / I (incomplete) / W (withdrawn). */
    "letterGrade" TEXT,
    /** Credit hours earned — typically course.credits, but can vary (audit = 0). */
    "creditsEarned" INTEGER,
    /** Slice-2 may extend with mid-term + final + assignment-level breakdowns. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_enrollments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_status_check"
  CHECK ("status" IN (
    'pending', 'enrolled', 'dropped', 'completed', 'failed', 'audit'
  ));

ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_grade_points_check"
  CHECK (
    "gradePoints" IS NULL
    OR ("gradePoints" >= 0 AND "gradePoints" <= 4)
  );

ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_letter_grade_check"
  CHECK (
    "letterGrade" IS NULL
    OR "letterGrade" IN (
      'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
      'I', 'W', 'P', 'NP'
    )
  );

ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_credits_check"
  CHECK ("creditsEarned" IS NULL OR ("creditsEarned" >= 0 AND "creditsEarned" <= 12));

-- Completion coherence: status='completed' requires gradePoints +
-- letterGrade + creditsEarned + completedAt.
ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_complete_coherence_check"
  CHECK (
    "status" <> 'completed'
    OR (
      "gradePoints" IS NOT NULL
      AND "letterGrade" IS NOT NULL
      AND "creditsEarned" IS NOT NULL
      AND "completedAt" IS NOT NULL
    )
  );

-- Drop coherence: status='dropped' requires droppedAt.
ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_drop_coherence_check"
  CHECK ("status" <> 'dropped' OR "droppedAt" IS NOT NULL);

-- One row per (student, course, term) — retakes go in a different term.
CREATE UNIQUE INDEX "education_enrollments_student_course_term_uniq"
  ON "education_enrollments"("studentId", "courseId", "termId");
CREATE INDEX "education_enrollments_org_status_idx"
  ON "education_enrollments"("organizationId", "status");
CREATE INDEX "education_enrollments_student_idx"
  ON "education_enrollments"("studentId");
CREATE INDEX "education_enrollments_course_idx"
  ON "education_enrollments"("courseId");
CREATE INDEX "education_enrollments_term_idx"
  ON "education_enrollments"("termId");

ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "education_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "education_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "education_enrollments"
  ADD CONSTRAINT "education_enrollments_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "education_academic_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Terminal-timestamp immutability (uses IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION education_enrollments_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'education_enrollments.completedAt is immutable once set (enr %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."droppedAt" IS NOT NULL AND NEW."droppedAt" IS DISTINCT FROM OLD."droppedAt" THEN
    RAISE EXCEPTION 'education_enrollments.droppedAt is immutable once set (enr %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER education_enrollments_timestamps_immutable_trigger
  BEFORE UPDATE ON "education_enrollments"
  FOR EACH ROW
  EXECUTE FUNCTION education_enrollments_timestamps_immutable_fn();
