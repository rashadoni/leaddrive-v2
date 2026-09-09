-- R8: Public Sector Cloud (Phase 7 backlog item).
--
-- Salesforce Public Sector Cloud (PSCC) analogue. Citizen-facing
-- case management, licensing (permits / certifications), grant
-- administration. Caseworkers + inspectors + grant officers.
--
-- IMPORTANT — FedRAMP / compliance scope:
--   This slice ships SCHEMA + PURE HELPERS only. FedRAMP / IRAP
--   certification (encryption at rest beyond DB defaults, FIPS-
--   validated cryptography, continuous monitoring) is OUT OF SCOPE
--   for slice 1. Caller-side policy enforcement + DB-level pgcrypto
--   column encryption land in slice 2; certification audit is a
--   year-long business workstream beyond developer-roadmap scope.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine + case-
-- routing-classifier + license-expiration-calculator + grant-
-- disbursement-calculator + types). NO admin UI, NO citizen portal,
-- NO encryption hooks beyond declarative column flags.
--
-- Slice 2 wires:
--   • pgcrypto column encryption for SSN / TIN / address.
--   • Caseworker desktop + citizen portal.
--   • FOIA / records-request endpoints (with redaction layer).
--   • Inter-agency referral workflow.
-- Slice 3 wires:
--   • Audit log (every citizen-data read logged).
--   • AI triage + caseload-balancing (reuse H1 agent framework).
--   • Compliance reporting (NIST 800-53 controls export).
--
-- 5 tables:
--   public_sector_officials — caseworkers / inspectors / grant officers
--                              + role discriminator + agency assignment
--   citizens                — anchor entity (resident / constituent;
--                              distinct from CRM Contact: SSN/TIN +
--                              service-address + jurisdiction)
--   public_sector_cases     — citizen request (distinct from CRM Ticket:
--                              FOIA-able, audit boundary, statutory
--                              response deadline)
--   licenses                — issued permit / certification (lifecycle
--                              applied → under_review → issued →
--                              expired/revoked/suspended)
--   grants                  — grant award (lifecycle submitted →
--                              under_review → approved → disbursed
--                              + denied/withdrawn side exits)

-- ── PublicSectorOfficial ───────────────────────────────────────
-- Caseworker / inspector / grant officer. Distinct from CRM User
-- because: officials have an agency/department assignment + duty
-- specialty + statutory authority level (line/supervisor/director).
CREATE TABLE "public_sector_officials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional User link for officials who log into the CRM. */
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    /** Role (DB CHECK):
     *  caseworker | senior_caseworker | inspector | grant_officer
     *  | supervisor | director | clerk
     */
    "role" TEXT NOT NULL DEFAULT 'caseworker',
    /** Agency slug — e.g. "dmv", "health-dept", "housing-authority".
     *  Slice-2 may add an Agency table; slice-1 free-form per tenant. */
    "agencySlug" TEXT NOT NULL,
    /** Department within agency — optional sub-division. */
    "departmentSlug" TEXT,
    /** Authority level (DB CHECK):
     *  line — case-level decisions
     *  supervisor — sign-off + escalation handling
     *  director — agency-wide policy + statutory authority
     */
    "authorityLevel" TEXT NOT NULL DEFAULT 'line',
    /** Specialties array — e.g. ["housing", "food-stamps"]. */
    "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "public_sector_officials_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public_sector_officials"
  ADD CONSTRAINT "public_sector_officials_role_check"
  CHECK ("role" IN (
    'caseworker', 'senior_caseworker', 'inspector', 'grant_officer',
    'supervisor', 'director', 'clerk'
  ));

ALTER TABLE "public_sector_officials"
  ADD CONSTRAINT "public_sector_officials_authority_check"
  CHECK ("authorityLevel" IN ('line', 'supervisor', 'director'));

CREATE UNIQUE INDEX "public_sector_officials_org_email_uniq"
  ON "public_sector_officials"("organizationId", "email");
CREATE INDEX "public_sector_officials_org_role_idx"
  ON "public_sector_officials"("organizationId", "role");
CREATE INDEX "public_sector_officials_org_agency_idx"
  ON "public_sector_officials"("organizationId", "agencySlug");
CREATE INDEX "public_sector_officials_org_active_idx"
  ON "public_sector_officials"("organizationId", "isActive");

ALTER TABLE "public_sector_officials"
  ADD CONSTRAINT "public_sector_officials_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Citizen ─────────────────────────────────────────────────────
-- Resident / constituent. Distinct from CRM Contact because:
--   • SSN / TIN is required for benefits eligibility (PII — slice-2
--     pgcrypto wrap).
--   • Jurisdiction matters (county / district / municipality).
--   • Audit boundary — every citizen-data read is FOIA-able.
CREATE TABLE "citizens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to CRM Contact for outreach correspondence. */
    "contactId" TEXT,
    /** Citizen record number — UNIQUE per tenant. */
    "citizenNumber" TEXT NOT NULL,
    /** Legal name (PII — slice-2 pgcrypto wrap). */
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    /** Date of birth (PII — quasi-identifier; used for benefits eligibility). */
    "dateOfBirth" TIMESTAMP(3),
    /** SSN / Tax ID (PII — slice-2 pgcrypto wrap; benefits eligibility). */
    "taxId" TEXT,
    /** Residence address (PII). */
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    /** Jurisdiction slug — county/district code (slice-2 wires to
     *  jurisdiction table; slice-1 free-form). */
    "jurisdictionSlug" TEXT,
    /** Lifecycle (DB CHECK):
     *  active | inactive (moved out of jurisdiction) | deceased
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    "deactivatedAt" TIMESTAMP(3),
    "deceasedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "citizens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "citizens"
  ADD CONSTRAINT "citizens_status_check"
  CHECK ("status" IN ('active', 'inactive', 'deceased'));

ALTER TABLE "citizens"
  ADD CONSTRAINT "citizens_number_check"
  CHECK (length("citizenNumber") >= 1 AND length("citizenNumber") <= 64);

ALTER TABLE "citizens"
  ADD CONSTRAINT "citizens_inactive_coherence_check"
  CHECK ("status" <> 'inactive' OR "deactivatedAt" IS NOT NULL);
ALTER TABLE "citizens"
  ADD CONSTRAINT "citizens_deceased_coherence_check"
  CHECK ("status" <> 'deceased' OR "deceasedAt" IS NOT NULL);

CREATE UNIQUE INDEX "citizens_org_number_uniq"
  ON "citizens"("organizationId", "citizenNumber");
CREATE INDEX "citizens_org_status_idx"
  ON "citizens"("organizationId", "status");
CREATE INDEX "citizens_org_jurisdiction_idx"
  ON "citizens"("organizationId", "jurisdictionSlug");
CREATE INDEX "citizens_contact_idx"
  ON "citizens"("contactId");

ALTER TABLE "citizens"
  ADD CONSTRAINT "citizens_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lifecycle timestamps immutable once set (N2 IS DISTINCT FROM pattern).
CREATE OR REPLACE FUNCTION citizens_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."deactivatedAt" IS NOT NULL AND NEW."deactivatedAt" IS DISTINCT FROM OLD."deactivatedAt" THEN
    RAISE EXCEPTION 'citizens.deactivatedAt is immutable once set (citizen %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deceasedAt" IS NOT NULL AND NEW."deceasedAt" IS DISTINCT FROM OLD."deceasedAt" THEN
    RAISE EXCEPTION 'citizens.deceasedAt is immutable once set (citizen %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER citizens_timestamps_immutable_trigger
  BEFORE UPDATE ON "citizens"
  FOR EACH ROW
  EXECUTE FUNCTION citizens_timestamps_immutable_fn();

-- ── PublicSectorCase ────────────────────────────────────────────
-- Citizen request / inquiry / complaint. Distinct from CRM Ticket
-- because:
--   • FOIA-able (every read logged in slice-2).
--   • Has a statutory response deadline (statutoryDueAt) — e.g. 30
--     days for housing complaints, 60 days for grant inquiries.
--   • Routes to an agency, not just a queue.
CREATE TABLE "public_sector_cases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "citizenId" TEXT NOT NULL,
    /** Case number — institutional, UNIQUE per tenant. */
    "caseNumber" TEXT NOT NULL,
    /** Case type (DB CHECK):
     *  benefits_application | benefits_recertification | complaint
     *  | inquiry | inspection_request | hearing_request
     *  | records_request | appeal | grievance
     */
    "caseType" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  submitted → intake | denied | withdrawn
     *  intake → assigned | denied | withdrawn
     *  assigned → in_progress | denied | withdrawn
     *  in_progress → resolved | escalated | denied | withdrawn
     *  escalated → resolved | denied
     *  resolved — terminal
     *  denied — terminal
     *  withdrawn — terminal
     */
    "status" TEXT NOT NULL DEFAULT 'submitted',
    /** Priority (DB CHECK):
     *  routine | elevated | urgent | emergency
     */
    "priority" TEXT NOT NULL DEFAULT 'routine',
    /** Assigned agency + department slugs. */
    "agencySlug" TEXT NOT NULL,
    "departmentSlug" TEXT,
    /** Assigned official — soft FK. */
    "assignedOfficialId" TEXT,
    /** Subject of the case (free-form). */
    "subject" TEXT NOT NULL,
    "description" TEXT,
    /** Statutory deadline — when the agency MUST respond by law.
     *  NULL = no statutory deadline; slice-2 cron alerts at T-7d. */
    "statutoryDueAt" TIMESTAMP(3),
    /** Status-transition timestamps. */
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intakeStartedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "workStartedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    /** Decision rationale (denied / resolved with notes). */
    "decisionRationale" TEXT,
    /** Withdrawal reason (citizen withdraws the case). */
    "withdrawalReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "public_sector_cases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_type_check"
  CHECK ("caseType" IN (
    'benefits_application', 'benefits_recertification', 'complaint',
    'inquiry', 'inspection_request', 'hearing_request',
    'records_request', 'appeal', 'grievance'
  ));

ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_status_check"
  CHECK ("status" IN (
    'submitted', 'intake', 'assigned', 'in_progress', 'escalated',
    'resolved', 'denied', 'withdrawn'
  ));

ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_priority_check"
  CHECK ("priority" IN ('routine', 'elevated', 'urgent', 'emergency'));

-- Status-timestamp coherence.
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_intake_coherence_check"
  CHECK ("status" NOT IN ('intake', 'assigned', 'in_progress', 'escalated', 'resolved')
         OR "intakeStartedAt" IS NOT NULL);
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_assigned_coherence_check"
  CHECK ("status" NOT IN ('assigned', 'in_progress', 'escalated', 'resolved')
         OR ("assignedAt" IS NOT NULL AND "assignedOfficialId" IS NOT NULL));
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_work_coherence_check"
  CHECK ("status" NOT IN ('in_progress', 'escalated', 'resolved')
         OR "workStartedAt" IS NOT NULL);
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_resolved_coherence_check"
  CHECK ("status" <> 'resolved' OR "resolvedAt" IS NOT NULL);
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_denied_coherence_check"
  CHECK ("status" <> 'denied'
         OR ("deniedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_withdrawn_coherence_check"
  CHECK ("status" <> 'withdrawn'
         OR ("withdrawnAt" IS NOT NULL AND "withdrawalReason" IS NOT NULL));
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_escalated_coherence_check"
  CHECK ("status" <> 'escalated' OR "escalatedAt" IS NOT NULL);

CREATE UNIQUE INDEX "public_sector_cases_org_number_uniq"
  ON "public_sector_cases"("organizationId", "caseNumber");
CREATE INDEX "public_sector_cases_citizen_idx"
  ON "public_sector_cases"("citizenId");
CREATE INDEX "public_sector_cases_org_status_idx"
  ON "public_sector_cases"("organizationId", "status");
CREATE INDEX "public_sector_cases_org_agency_idx"
  ON "public_sector_cases"("organizationId", "agencySlug");
CREATE INDEX "public_sector_cases_assigned_idx"
  ON "public_sector_cases"("organizationId", "assignedOfficialId", "status");
CREATE INDEX "public_sector_cases_due_idx"
  ON "public_sector_cases"("organizationId", "statutoryDueAt")
  WHERE "statutoryDueAt" IS NOT NULL AND "status" NOT IN ('resolved', 'denied', 'withdrawn');

ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ON DELETE RESTRICT — case history is FOIA-able; cannot drop with
-- citizen. To remove a citizen, slice-2 worker first archives all
-- associated cases (or sets Citizen.status='inactive'/'deceased' to
-- prevent new ones), then DELETE the citizen row.
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_citizenId_fkey"
  FOREIGN KEY ("citizenId") REFERENCES "citizens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_sector_cases"
  ADD CONSTRAINT "public_sector_cases_assignedOfficialId_fkey"
  FOREIGN KEY ("assignedOfficialId") REFERENCES "public_sector_officials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public_sector_cases_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- submittedAt unconditionally immutable — backdating defeats
  -- statutory deadline tracking.
  IF NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.submittedAt is immutable (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."intakeStartedAt" IS NOT NULL AND NEW."intakeStartedAt" IS DISTINCT FROM OLD."intakeStartedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.intakeStartedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."assignedAt" IS NOT NULL AND NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.assignedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."workStartedAt" IS NOT NULL AND NEW."workStartedAt" IS DISTINCT FROM OLD."workStartedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.workStartedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.resolvedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deniedAt" IS NOT NULL AND NEW."deniedAt" IS DISTINCT FROM OLD."deniedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.deniedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt" THEN
    RAISE EXCEPTION 'public_sector_cases.withdrawnAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."escalatedAt" IS NOT NULL AND NEW."escalatedAt" IS DISTINCT FROM OLD."escalatedAt" THEN
    RAISE EXCEPTION 'public_sector_cases.escalatedAt is immutable once set (case %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_cases_timestamps_immutable_trigger
  BEFORE UPDATE ON "public_sector_cases"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_cases_timestamps_immutable_fn();

-- ── License ─────────────────────────────────────────────────────
-- Issued permit / license / certification. Lifecycle:
--   applied → under_review → issued | denied
--   issued → expired | revoked | suspended
--   suspended → issued (reinstated) | revoked
--   denied — terminal
--   expired — terminal
--   revoked — terminal
CREATE TABLE "public_sector_licenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "citizenId" TEXT,
    /** License number — UNIQUE per tenant. */
    "licenseNumber" TEXT NOT NULL,
    /** License type (DB CHECK):
     *  driver | business | building_permit | food_service | liquor
     *  | professional | hunting_fishing | event_permit | other
     */
    "licenseType" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  applied | under_review | issued | denied | expired
     *  | suspended | revoked
     */
    "status" TEXT NOT NULL DEFAULT 'applied',
    /** Issuing official (e.g. inspector who approved) — soft FK. */
    "issuingOfficialId" TEXT,
    /** Optional case linkage — license issuance often goes through a case. */
    "caseId" TEXT,
    /** Application + decision dates. */
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    /** Decision rationale (denied / revoked / suspended). */
    "decisionRationale" TEXT,
    /** Fee + payment status — slice-2 wires to D5 Payments. */
    "feeAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "public_sector_licenses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_type_check"
  CHECK ("licenseType" IN (
    'driver', 'business', 'building_permit', 'food_service', 'liquor',
    'professional', 'hunting_fishing', 'event_permit', 'other'
  ));

ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_status_check"
  CHECK ("status" IN (
    'applied', 'under_review', 'issued', 'denied', 'expired',
    'suspended', 'revoked'
  ));

ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_fee_check"
  CHECK ("feeAmount" >= 0);

ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_currency_check"
  CHECK (length("feeCurrency") = 3);

-- Window CHECK: expiresAt > issuedAt when both set.
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_window_check"
  CHECK ("expiresAt" IS NULL OR "issuedAt" IS NULL OR "expiresAt" > "issuedAt");

-- Status-timestamp coherence.
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_review_coherence_check"
  CHECK ("status" NOT IN ('under_review', 'issued', 'denied', 'expired', 'suspended', 'revoked')
         OR "reviewStartedAt" IS NOT NULL);
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_issued_coherence_check"
  CHECK ("status" NOT IN ('issued', 'expired', 'suspended', 'revoked')
         OR ("issuedAt" IS NOT NULL AND "expiresAt" IS NOT NULL));
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_expired_coherence_check"
  CHECK ("status" <> 'expired' OR "expiredAt" IS NOT NULL);
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_suspended_coherence_check"
  CHECK ("status" <> 'suspended'
         OR ("suspendedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_revoked_coherence_check"
  CHECK ("status" <> 'revoked'
         OR ("revokedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_denied_coherence_check"
  CHECK ("status" <> 'denied'
         OR ("deniedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));

CREATE UNIQUE INDEX "public_sector_licenses_org_number_uniq"
  ON "public_sector_licenses"("organizationId", "licenseNumber");
CREATE INDEX "public_sector_licenses_citizen_idx"
  ON "public_sector_licenses"("citizenId");
CREATE INDEX "public_sector_licenses_org_status_idx"
  ON "public_sector_licenses"("organizationId", "status");
CREATE INDEX "public_sector_licenses_org_type_idx"
  ON "public_sector_licenses"("organizationId", "licenseType");
CREATE INDEX "public_sector_licenses_expires_idx"
  ON "public_sector_licenses"("organizationId", "expiresAt")
  WHERE "status" = 'issued';
CREATE INDEX "public_sector_licenses_case_idx"
  ON "public_sector_licenses"("caseId");

ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_citizenId_fkey"
  FOREIGN KEY ("citizenId") REFERENCES "citizens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_issuingOfficialId_fkey"
  FOREIGN KEY ("issuingOfficialId") REFERENCES "public_sector_officials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public_sector_licenses"
  ADD CONSTRAINT "public_sector_licenses_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "public_sector_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public_sector_licenses_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.appliedAt is immutable (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."reviewStartedAt" IS NOT NULL AND NEW."reviewStartedAt" IS DISTINCT FROM OLD."reviewStartedAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.reviewStartedAt is immutable once set (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."issuedAt" IS NOT NULL AND NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.issuedAt is immutable once set (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."expiredAt" IS NOT NULL AND NEW."expiredAt" IS DISTINCT FROM OLD."expiredAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.expiredAt is immutable once set (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.revokedAt is immutable once set (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deniedAt" IS NOT NULL AND NEW."deniedAt" IS DISTINCT FROM OLD."deniedAt" THEN
    RAISE EXCEPTION 'public_sector_licenses.deniedAt is immutable once set (license %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- suspendedAt is intentionally NOT immutable — slice-2 may re-suspend
  -- a license that was reinstated and later suspended again. Audit
  -- trail captured in slice-2 history table.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_licenses_timestamps_immutable_trigger
  BEFORE UPDATE ON "public_sector_licenses"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_licenses_timestamps_immutable_fn();

-- ── Grant ───────────────────────────────────────────────────────
-- Grant award. Lifecycle (mirrors src/lib/public-sector/types.ts
-- GRANT_TRANSITIONS):
--   submitted    → under_review | withdrawn
--   under_review → approved | denied | withdrawn
--   approved     → disbursing | cancelled
--   disbursing   → disbursed | cancelled (mid-stream cancellation; remainder void)
--   disbursed    — terminal
--   denied       — terminal (no direct path from submitted — must
--                  pass through under_review first)
--   withdrawn    — terminal
--   cancelled    — terminal
CREATE TABLE "public_sector_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "citizenId" TEXT,
    /** Grant application number — UNIQUE per tenant. */
    "grantNumber" TEXT NOT NULL,
    /** Grant program slug (e.g. "housing-assistance-2026", "small-business-relief"). */
    "programSlug" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  submitted | under_review | approved | disbursing
     *  | disbursed | denied | withdrawn | cancelled
     */
    "status" TEXT NOT NULL DEFAULT 'submitted',
    /** Requested amount. */
    "requestedAmount" DECIMAL(18, 2) NOT NULL,
    /** Approved amount (may be ≤ requested). */
    "approvedAmount" DECIMAL(18, 2),
    /** Disbursed running total. */
    "disbursedAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Currency. */
    "currency" TEXT NOT NULL DEFAULT 'USD',
    /** Assigned grant officer — soft FK. */
    "assignedOfficialId" TEXT,
    /** Optional case linkage. */
    "caseId" TEXT,
    /** Application narrative. */
    "narrative" TEXT,
    /** Decision rationale. */
    "decisionRationale" TEXT,
    /** Withdrawal / cancellation reason. */
    "terminationReason" TEXT,
    /** Status-transition timestamps. */
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "disbursingStartedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "public_sector_grants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_status_check"
  CHECK ("status" IN (
    'submitted', 'under_review', 'approved', 'disbursing',
    'disbursed', 'denied', 'withdrawn', 'cancelled'
  ));

ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_requested_check"
  CHECK ("requestedAmount" >= 0);
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_approved_check"
  CHECK ("approvedAmount" IS NULL OR "approvedAmount" >= 0);
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_disbursed_check"
  CHECK ("disbursedAmount" >= 0);
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_currency_check"
  CHECK (length("currency") = 3);
-- Disbursement cannot exceed approval (where approval is set).
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_disbursement_bound_check"
  CHECK ("approvedAmount" IS NULL OR "disbursedAmount" <= "approvedAmount");

-- Status-timestamp coherence.
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_review_coherence_check"
  CHECK ("status" NOT IN ('under_review', 'approved', 'disbursing', 'disbursed', 'denied')
         OR "reviewStartedAt" IS NOT NULL);
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_approved_coherence_check"
  CHECK ("status" NOT IN ('approved', 'disbursing', 'disbursed', 'cancelled')
         OR ("approvedAt" IS NOT NULL AND "approvedAmount" IS NOT NULL));
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_disbursing_coherence_check"
  CHECK ("status" NOT IN ('disbursing', 'disbursed')
         OR "disbursingStartedAt" IS NOT NULL);
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_disbursed_coherence_check"
  CHECK ("status" <> 'disbursed'
         OR ("disbursedAt" IS NOT NULL AND "approvedAmount" IS NOT NULL
             AND "disbursedAmount" = "approvedAmount"));
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_denied_coherence_check"
  CHECK ("status" <> 'denied'
         OR ("deniedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_withdrawn_coherence_check"
  CHECK ("status" <> 'withdrawn'
         OR ("withdrawnAt" IS NOT NULL AND "terminationReason" IS NOT NULL));
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled'
         OR ("cancelledAt" IS NOT NULL AND "terminationReason" IS NOT NULL));

CREATE UNIQUE INDEX "public_sector_grants_org_number_uniq"
  ON "public_sector_grants"("organizationId", "grantNumber");
CREATE INDEX "public_sector_grants_citizen_idx"
  ON "public_sector_grants"("citizenId");
CREATE INDEX "public_sector_grants_org_status_idx"
  ON "public_sector_grants"("organizationId", "status");
CREATE INDEX "public_sector_grants_org_program_idx"
  ON "public_sector_grants"("organizationId", "programSlug");
CREATE INDEX "public_sector_grants_assigned_idx"
  ON "public_sector_grants"("assignedOfficialId");
CREATE INDEX "public_sector_grants_case_idx"
  ON "public_sector_grants"("caseId");

ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_citizenId_fkey"
  FOREIGN KEY ("citizenId") REFERENCES "citizens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_assignedOfficialId_fkey"
  FOREIGN KEY ("assignedOfficialId") REFERENCES "public_sector_officials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public_sector_grants"
  ADD CONSTRAINT "public_sector_grants_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "public_sector_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public_sector_grants_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.submittedAt is immutable (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."reviewStartedAt" IS NOT NULL AND NEW."reviewStartedAt" IS DISTINCT FROM OLD."reviewStartedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.reviewStartedAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."approvedAt" IS NOT NULL AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.approvedAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."disbursingStartedAt" IS NOT NULL AND NEW."disbursingStartedAt" IS DISTINCT FROM OLD."disbursingStartedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.disbursingStartedAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."disbursedAt" IS NOT NULL AND NEW."disbursedAt" IS DISTINCT FROM OLD."disbursedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.disbursedAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deniedAt" IS NOT NULL AND NEW."deniedAt" IS DISTINCT FROM OLD."deniedAt" THEN
    RAISE EXCEPTION 'public_sector_grants.deniedAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt" THEN
    RAISE EXCEPTION 'public_sector_grants.withdrawnAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'public_sector_grants.cancelledAt is immutable once set (grant %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_grants_timestamps_immutable_trigger
  BEFORE UPDATE ON "public_sector_grants"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_grants_timestamps_immutable_fn();

-- ── Cross-table coherence (C2/C4/G5/R2/R6/R7 pattern) ──────────
-- Six coherence checks (all BEFORE INSERT, NULL-tolerant for optional FKs):
--   public_sector_cases.citizenId          → citizen.org match (required)
--   public_sector_cases.assignedOfficialId → official.org match (optional)
--   licenses.citizenId                     → citizen.org match (optional)
--   licenses.issuingOfficialId             → official.org match (optional)
--   licenses.caseId                        → case.org match (optional)
--   grants.citizenId                       → citizen.org match (optional)
--   grants.assignedOfficialId              → official.org match (optional)
--   grants.caseId                          → case.org match (optional)
--
-- Slice-2 ticket: extend to BEFORE INSERT OR UPDATE OF <fk-cols>.

CREATE OR REPLACE FUNCTION public_sector_cases_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  citizen_org_id TEXT;
  official_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO citizen_org_id
    FROM "citizens" WHERE "id" = NEW."citizenId";
  IF citizen_org_id IS NULL THEN
    RAISE EXCEPTION 'public_sector_cases.citizenId "%" does not resolve',
      NEW."citizenId" USING ERRCODE = 'check_violation';
  END IF;
  IF citizen_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'public_sector_cases: citizen "%" belongs to org "%" but case references org "%"',
      NEW."citizenId", citizen_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."assignedOfficialId" IS NOT NULL THEN
    SELECT "organizationId" INTO official_org_id
      FROM "public_sector_officials" WHERE "id" = NEW."assignedOfficialId";
    IF official_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_cases.assignedOfficialId "%" does not resolve',
        NEW."assignedOfficialId" USING ERRCODE = 'check_violation';
    END IF;
    IF official_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_cases: official "%" belongs to org "%" but case references org "%"',
        NEW."assignedOfficialId", official_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_cases_coherence_trigger
  BEFORE INSERT ON "public_sector_cases"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_cases_coherence_fn();

CREATE OR REPLACE FUNCTION public_sector_licenses_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  citizen_org_id TEXT;
  official_org_id TEXT;
  case_org_id TEXT;
BEGIN
  IF NEW."citizenId" IS NOT NULL THEN
    SELECT "organizationId" INTO citizen_org_id
      FROM "citizens" WHERE "id" = NEW."citizenId";
    IF citizen_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_licenses.citizenId "%" does not resolve',
        NEW."citizenId" USING ERRCODE = 'check_violation';
    END IF;
    IF citizen_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_licenses: citizen "%" belongs to org "%" but license references org "%"',
        NEW."citizenId", citizen_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."issuingOfficialId" IS NOT NULL THEN
    SELECT "organizationId" INTO official_org_id
      FROM "public_sector_officials" WHERE "id" = NEW."issuingOfficialId";
    IF official_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_licenses.issuingOfficialId "%" does not resolve',
        NEW."issuingOfficialId" USING ERRCODE = 'check_violation';
    END IF;
    IF official_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_licenses: official "%" belongs to org "%" but license references org "%"',
        NEW."issuingOfficialId", official_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."caseId" IS NOT NULL THEN
    SELECT "organizationId" INTO case_org_id
      FROM "public_sector_cases" WHERE "id" = NEW."caseId";
    IF case_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_licenses.caseId "%" does not resolve',
        NEW."caseId" USING ERRCODE = 'check_violation';
    END IF;
    IF case_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_licenses: case "%" belongs to org "%" but license references org "%"',
        NEW."caseId", case_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_licenses_coherence_trigger
  BEFORE INSERT ON "public_sector_licenses"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_licenses_coherence_fn();

CREATE OR REPLACE FUNCTION public_sector_grants_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  citizen_org_id TEXT;
  official_org_id TEXT;
  case_org_id TEXT;
BEGIN
  IF NEW."citizenId" IS NOT NULL THEN
    SELECT "organizationId" INTO citizen_org_id
      FROM "citizens" WHERE "id" = NEW."citizenId";
    IF citizen_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_grants.citizenId "%" does not resolve',
        NEW."citizenId" USING ERRCODE = 'check_violation';
    END IF;
    IF citizen_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_grants: citizen "%" belongs to org "%" but grant references org "%"',
        NEW."citizenId", citizen_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."assignedOfficialId" IS NOT NULL THEN
    SELECT "organizationId" INTO official_org_id
      FROM "public_sector_officials" WHERE "id" = NEW."assignedOfficialId";
    IF official_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_grants.assignedOfficialId "%" does not resolve',
        NEW."assignedOfficialId" USING ERRCODE = 'check_violation';
    END IF;
    IF official_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_grants: official "%" belongs to org "%" but grant references org "%"',
        NEW."assignedOfficialId", official_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."caseId" IS NOT NULL THEN
    SELECT "organizationId" INTO case_org_id
      FROM "public_sector_cases" WHERE "id" = NEW."caseId";
    IF case_org_id IS NULL THEN
      RAISE EXCEPTION 'public_sector_grants.caseId "%" does not resolve',
        NEW."caseId" USING ERRCODE = 'check_violation';
    END IF;
    IF case_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'public_sector_grants: case "%" belongs to org "%" but grant references org "%"',
        NEW."caseId", case_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER public_sector_grants_coherence_trigger
  BEFORE INSERT ON "public_sector_grants"
  FOR EACH ROW
  EXECUTE FUNCTION public_sector_grants_coherence_fn();
