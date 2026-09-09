-- R7: Insurance Cloud (Phase 7 backlog item).
--
-- Salesforce Insurance Cloud analogue. Policy administration, claims
-- processing, underwriter + adjuster service team. Targeting P&C
-- insurance (auto/home/commercial) + life insurance.
--
-- Slice 1 ships SCHEMA + 5 PURE HELPERS only. Out of scope (slice-2+):
--   • Underwriting workflow UI + rating engine.
--   • Claims intake portal + adjuster mobile app.
--   • Fraud detection AI (reuse H1 agent framework).
--   • Reinsurance ceding ledger (advanced — slice-3+).
--   • Regulatory filing exports (NAIC / state DOI).
--
-- 5 tables:
--   policy_holders        — anchor entity (distinct from CRM Contact:
--                            insured-party data shape + audit boundary
--                            + dependent-spouse + occupation rating)
--   policies              — policy contract (auto/home/life/health/
--                            commercial); lifecycle quote → bound →
--                            active → expired/lapsed/cancelled
--   claims                — claim filed against a policy; lifecycle
--                            reported → under_review → approved →
--                            settled (+ denied / closed_no_action)
--   beneficiaries         — per-policy beneficiary record (life
--                            insurance primarily); allocation 0-100%
--                            with policy-level sum constraint enforced
--                            by slice-2 validator
--   service_team_members  — underwriters + adjusters (one table, role
--                            discriminator); license, specialty,
--                            availability

-- ── PolicyHolder ───────────────────────────────────────────────
-- Insured party. Distinct from CRM Contact because:
--   • Holder data shape includes occupation (rating), date-of-birth
--     (life mortality table lookup), tax id (W-9 / claim 1099 reporting).
--   • Audit boundary — slice-2 wraps PII columns with pgcrypto.
--   • Same legal person may have multiple policies; same address may
--     have multiple holders (joint home insurance).
CREATE TABLE "policy_holders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to CRM Contact for sales-funnel correspondence. */
    "contactId" TEXT,
    /** Insured number — institutional, UNIQUE per tenant. */
    "holderNumber" TEXT NOT NULL,
    /** Legal name (PII — slice-2 pgcrypto wrap). */
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    /** Date of birth (PII — quasi-identifier; required for life policies). */
    "dateOfBirth" TIMESTAMP(3),
    /** Tax / SSN (PII — slice-2 pgcrypto wrap). */
    "taxId" TEXT,
    /** Mailing address (PII). */
    "mailingAddressLine1" TEXT,
    "mailingCity" TEXT,
    "mailingPostalCode" TEXT,
    "mailingCountry" TEXT,
    /** Occupation rating slug (slice-2 wires to rating engine). */
    "occupationSlug" TEXT,
    /** Lifecycle (DB CHECK):
     *  prospect | active | inactive | deceased
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "deceasedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "policy_holders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_status_check"
  CHECK ("status" IN ('prospect', 'active', 'inactive', 'deceased'));

ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_holder_number_check"
  CHECK (length("holderNumber") >= 1 AND length("holderNumber") <= 64);

ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'inactive', 'deceased')
         OR "activatedAt" IS NOT NULL);
ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_inactive_coherence_check"
  CHECK ("status" <> 'inactive' OR "deactivatedAt" IS NOT NULL);
ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_deceased_coherence_check"
  CHECK ("status" <> 'deceased' OR "deceasedAt" IS NOT NULL);

CREATE UNIQUE INDEX "policy_holders_org_number_uniq"
  ON "policy_holders"("organizationId", "holderNumber");
CREATE INDEX "policy_holders_org_status_idx"
  ON "policy_holders"("organizationId", "status");
CREATE INDEX "policy_holders_contact_idx"
  ON "policy_holders"("contactId");

ALTER TABLE "policy_holders"
  ADD CONSTRAINT "policy_holders_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION policy_holders_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'policy_holders.activatedAt is immutable once set (holder %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deactivatedAt" IS NOT NULL AND NEW."deactivatedAt" IS DISTINCT FROM OLD."deactivatedAt" THEN
    RAISE EXCEPTION 'policy_holders.deactivatedAt is immutable once set (holder %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deceasedAt" IS NOT NULL AND NEW."deceasedAt" IS DISTINCT FROM OLD."deceasedAt" THEN
    RAISE EXCEPTION 'policy_holders.deceasedAt is immutable once set (holder %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_holders_timestamps_immutable_trigger
  BEFORE UPDATE ON "policy_holders"
  FOR EACH ROW
  EXECUTE FUNCTION policy_holders_timestamps_immutable_fn();

-- ── InsuranceServiceTeamMember ─────────────────────────────────
-- Underwriters + claims adjusters. One table because routing logic
-- (which adjuster gets the claim) often needs to know both pools.
CREATE TABLE "insurance_service_team_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Optional User link for team members who log into the CRM. */
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    /** Role (DB CHECK):
     *  underwriter | senior_underwriter | claims_adjuster | senior_adjuster
     *  | claims_examiner | special_investigations  (SIU — fraud investigator)
     */
    "role" TEXT NOT NULL,
    /** State / jurisdiction license number (where applicable). */
    "licenseNumber" TEXT,
    /** Licensed-in-jurisdictions (ISO state/region codes; slice-1 free-form). */
    "licensedRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /** Lines specialty (DB CHECK array values):
     *  auto | home | life | health | commercial | umbrella | marine
     */
    "linesSpecialty" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "insurance_service_team_members_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "insurance_service_team_members"
  ADD CONSTRAINT "insurance_service_team_members_role_check"
  CHECK ("role" IN (
    'underwriter', 'senior_underwriter', 'claims_adjuster',
    'senior_adjuster', 'claims_examiner', 'special_investigations'
  ));

CREATE UNIQUE INDEX "insurance_service_team_members_org_email_uniq"
  ON "insurance_service_team_members"("organizationId", "email");
CREATE INDEX "insurance_service_team_members_org_role_idx"
  ON "insurance_service_team_members"("organizationId", "role");
CREATE INDEX "insurance_service_team_members_org_active_idx"
  ON "insurance_service_team_members"("organizationId", "isActive");

ALTER TABLE "insurance_service_team_members"
  ADD CONSTRAINT "insurance_service_team_members_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Policy ─────────────────────────────────────────────────────
-- Insurance policy contract. Lifecycle quote → bound → active →
-- expired/lapsed/cancelled. Premium + coverage limits are slice-1
-- declarative; rating engine is slice-2.
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyHolderId" TEXT NOT NULL,
    /** Policy number — institutional, UNIQUE per tenant. */
    "policyNumber" TEXT NOT NULL,
    /** Line of business (DB CHECK):
     *  auto | home | life | health | commercial | umbrella | marine
     */
    "lineOfBusiness" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  quote     — quote issued, not yet bound
     *  bound     — payment received, awaiting effective date
     *  active    — currently in force
     *  expired   — past expiration without renewal
     *  lapsed    — non-payment lapse
     *  cancelled — operator-initiated termination
     */
    "status" TEXT NOT NULL DEFAULT 'quote',
    /** Coverage limit — face value of policy (e.g. $250K liability,
     *  $500K life). DECIMAL for accounting precision. */
    "coverageLimit" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Deductible (applicable to P&C; NULL for life). */
    "deductible" DECIMAL(18, 2),
    /** Annual premium — total yearly cost. */
    "annualPremium" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Billing frequency (DB CHECK):
     *  annual | semi_annual | quarterly | monthly
     */
    "billingFrequency" TEXT NOT NULL DEFAULT 'annual',
    /** Effective date — when policy goes into force. */
    "effectiveDate" TIMESTAMP(3),
    /** Expiration date — when policy ends if not renewed. */
    "expirationDate" TIMESTAMP(3),
    /** Underwriter who approved the bind (soft FK). */
    "underwriterId" TEXT,
    /** Status-transition timestamps. */
    "boundAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "lapsedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_line_check"
  CHECK ("lineOfBusiness" IN (
    'auto', 'home', 'life', 'health', 'commercial', 'umbrella', 'marine'
  ));

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_status_check"
  CHECK ("status" IN (
    'quote', 'bound', 'active', 'expired', 'lapsed', 'cancelled'
  ));

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_billing_check"
  CHECK ("billingFrequency" IN (
    'annual', 'semi_annual', 'quarterly', 'monthly'
  ));

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_coverage_check"
  CHECK ("coverageLimit" >= 0);
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_premium_check"
  CHECK ("annualPremium" >= 0);
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_deductible_check"
  CHECK ("deductible" IS NULL OR "deductible" >= 0);

-- Window CHECK: expiration > effective when both set.
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_window_check"
  CHECK ("expirationDate" IS NULL OR "effectiveDate" IS NULL
         OR "expirationDate" > "effectiveDate");

-- Status-timestamp coherence.
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_bound_coherence_check"
  CHECK ("status" NOT IN ('bound', 'active', 'expired', 'lapsed', 'cancelled')
         OR "boundAt" IS NOT NULL);
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'expired', 'lapsed')
         OR ("activatedAt" IS NOT NULL AND "effectiveDate" IS NOT NULL));
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_expired_coherence_check"
  CHECK ("status" <> 'expired' OR "expiredAt" IS NOT NULL);
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_lapsed_coherence_check"
  CHECK ("status" <> 'lapsed' OR "lapsedAt" IS NOT NULL);
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled'
         OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE UNIQUE INDEX "policies_org_number_uniq"
  ON "policies"("organizationId", "policyNumber");
CREATE INDEX "policies_holder_idx"
  ON "policies"("policyHolderId");
CREATE INDEX "policies_org_status_idx"
  ON "policies"("organizationId", "status");
CREATE INDEX "policies_org_line_idx"
  ON "policies"("organizationId", "lineOfBusiness");
CREATE INDEX "policies_org_effective_idx"
  ON "policies"("organizationId", "effectiveDate");

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_policyHolderId_fkey"
  FOREIGN KEY ("policyHolderId") REFERENCES "policy_holders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policies"
  ADD CONSTRAINT "policies_underwriterId_fkey"
  FOREIGN KEY ("underwriterId") REFERENCES "insurance_service_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION policies_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."boundAt" IS NOT NULL AND NEW."boundAt" IS DISTINCT FROM OLD."boundAt" THEN
    RAISE EXCEPTION 'policies.boundAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'policies.activatedAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."expiredAt" IS NOT NULL AND NEW."expiredAt" IS DISTINCT FROM OLD."expiredAt" THEN
    RAISE EXCEPTION 'policies.expiredAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."lapsedAt" IS NOT NULL AND NEW."lapsedAt" IS DISTINCT FROM OLD."lapsedAt" THEN
    RAISE EXCEPTION 'policies.lapsedAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'policies.cancelledAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policies_timestamps_immutable_trigger
  BEFORE UPDATE ON "policies"
  FOR EACH ROW
  EXECUTE FUNCTION policies_timestamps_immutable_fn();

-- ── Beneficiary ────────────────────────────────────────────────
-- Per-policy beneficiary record. Life insurance carries one or more
-- (primary + contingent). P&C policies typically have no beneficiaries.
-- Allocation % must sum to ≤ 100 per policy-tier (primary vs contingent),
-- enforced by slice-2 validator at write time (DB CHECK enforces only
-- per-row 0..100 bounds).
CREATE TABLE "beneficiaries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    /** Tier (DB CHECK):
     *  primary    — receives payout first
     *  contingent — receives if all primary deceased / disclaim
     */
    "tier" TEXT NOT NULL DEFAULT 'primary',
    /** Beneficiary type (DB CHECK):
     *  person | trust | charity | estate
     */
    "beneficiaryType" TEXT NOT NULL DEFAULT 'person',
    /** Beneficiary legal name. */
    "fullName" TEXT NOT NULL,
    /** Relationship to insured (free-form: spouse, child, sibling, etc.). */
    "relationship" TEXT,
    /** Allocation percentage 0..100 (within tier sums to ≤ 100). */
    "allocationPct" DECIMAL(5, 2) NOT NULL,
    /** Tax id (PII — slice-2 pgcrypto wrap). */
    "taxId" TEXT,
    /** Date of birth (PII — required for minor beneficiaries → trustee). */
    "dateOfBirth" TIMESTAMP(3),
    /** Designation date — wall-clock when assigned. */
    "designatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /** Revocation date — set when beneficiary removed (soft-delete). */
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_tier_check"
  CHECK ("tier" IN ('primary', 'contingent'));

ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_type_check"
  CHECK ("beneficiaryType" IN ('person', 'trust', 'charity', 'estate'));

ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_allocation_check"
  CHECK ("allocationPct" >= 0 AND "allocationPct" <= 100);

-- Revocation coherence — both fields together or neither.
ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_revocation_coherence_check"
  CHECK (("revokedAt" IS NULL AND "revocationReason" IS NULL)
         OR ("revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL));

CREATE INDEX "beneficiaries_policy_tier_idx"
  ON "beneficiaries"("policyId", "tier");
CREATE INDEX "beneficiaries_org_idx"
  ON "beneficiaries"("organizationId");
CREATE INDEX "beneficiaries_active_idx"
  ON "beneficiaries"("policyId") WHERE "revokedAt" IS NULL;

ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "beneficiaries"
  ADD CONSTRAINT "beneficiaries_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- designatedAt + revokedAt immutable once set.
CREATE OR REPLACE FUNCTION beneficiaries_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."designatedAt" IS NOT NULL AND NEW."designatedAt" IS DISTINCT FROM OLD."designatedAt" THEN
    RAISE EXCEPTION 'beneficiaries.designatedAt is immutable once set (beneficiary %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'beneficiaries.revokedAt is immutable once set (beneficiary %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER beneficiaries_timestamps_immutable_trigger
  BEFORE UPDATE ON "beneficiaries"
  FOR EACH ROW
  EXECUTE FUNCTION beneficiaries_timestamps_immutable_fn();

-- ── Claim ──────────────────────────────────────────────────────
-- Claim filed against a policy. Lifecycle:
--   reported     → under_review | denied | closed_no_action
--   under_review → approved | denied | closed_no_action
--   approved     → settled
--   settled      — terminal (payout disbursed)
--   denied       — terminal (claim rejected; insured may appeal in slice-2)
--   closed_no_action — terminal (no merit; e.g. duplicate, jurisdiction)
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    /** Claim number — institutional, UNIQUE per tenant. */
    "claimNumber" TEXT NOT NULL,
    /** Loss type (DB CHECK):
     *  collision | theft | fire | weather | liability | medical
     *  | property_damage | death | disability | other
     */
    "lossType" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  reported | under_review | approved | settled
     *  | denied | closed_no_action
     */
    "status" TEXT NOT NULL DEFAULT 'reported',
    /** Severity tier (DB CHECK):
     *  minor    — total < $5K
     *  moderate — $5K..$50K
     *  major    — $50K..$500K
     *  catastrophic — > $500K
     */
    "severity" TEXT NOT NULL DEFAULT 'minor',
    /** Date of loss — wall-clock when incident occurred. */
    "lossDate" TIMESTAMP(3) NOT NULL,
    /** Date reported — wall-clock when claim was filed. */
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /** Initial reserve — operator's first estimate of liability. */
    "initialReserveAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Current reserve — updated as investigation progresses. */
    "currentReserveAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Paid-to-date — running total of payments disbursed. */
    "paidAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Description (free-form claimant statement). */
    "description" TEXT,
    /** Assigned adjuster (soft FK to insurance_service_team_members). */
    "adjusterId" TEXT,
    /** Possible fraud flag — slice-2 SIU triage. */
    "fraudFlag" BOOLEAN NOT NULL DEFAULT FALSE,
    /** Status-transition timestamps. */
    "reviewStartedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "closedNoActionAt" TIMESTAMP(3),
    /** Decision rationale (used by approved / denied / closed). */
    "decisionRationale" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_loss_type_check"
  CHECK ("lossType" IN (
    'collision', 'theft', 'fire', 'weather', 'liability', 'medical',
    'property_damage', 'death', 'disability', 'other'
  ));

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_status_check"
  CHECK ("status" IN (
    'reported', 'under_review', 'approved', 'settled',
    'denied', 'closed_no_action'
  ));

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_severity_check"
  CHECK ("severity" IN ('minor', 'moderate', 'major', 'catastrophic'));

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_reserve_check"
  CHECK ("initialReserveAmount" >= 0 AND "currentReserveAmount" >= 0);

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_paid_check"
  CHECK ("paidAmount" >= 0);

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_loss_before_reported_check"
  CHECK ("lossDate" <= "reportedAt");

-- Status-timestamp coherence.
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_review_coherence_check"
  CHECK ("status" NOT IN ('under_review', 'approved', 'settled', 'denied', 'closed_no_action')
         OR "reviewStartedAt" IS NOT NULL);
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_approved_coherence_check"
  CHECK ("status" NOT IN ('approved', 'settled') OR "approvedAt" IS NOT NULL);
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_settled_coherence_check"
  CHECK ("status" <> 'settled' OR "settledAt" IS NOT NULL);
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_denied_coherence_check"
  CHECK ("status" <> 'denied'
         OR ("deniedAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_closed_coherence_check"
  CHECK ("status" <> 'closed_no_action'
         OR ("closedNoActionAt" IS NOT NULL AND "decisionRationale" IS NOT NULL));

CREATE UNIQUE INDEX "claims_org_number_uniq"
  ON "claims"("organizationId", "claimNumber");
CREATE INDEX "claims_policy_idx"
  ON "claims"("policyId");
CREATE INDEX "claims_org_status_idx"
  ON "claims"("organizationId", "status");
CREATE INDEX "claims_org_severity_idx"
  ON "claims"("organizationId", "severity");
CREATE INDEX "claims_adjuster_idx"
  ON "claims"("adjusterId");
CREATE INDEX "claims_fraud_idx"
  ON "claims"("organizationId", "fraudFlag") WHERE "fraudFlag" = TRUE;

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "claims"
  ADD CONSTRAINT "claims_adjusterId_fkey"
  FOREIGN KEY ("adjusterId") REFERENCES "insurance_service_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION claims_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- lossDate + reportedAt immutable — backdating these would defeat
  -- the lossDate ≤ reportedAt CHECK invariant via a paired UPDATE.
  -- A correction to the reported event time = new claim row (slice-2
  -- adds a 'reopened' status with an explicit linkage).
  IF NEW."lossDate" IS DISTINCT FROM OLD."lossDate" THEN
    RAISE EXCEPTION 'claims.lossDate is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."reportedAt" IS DISTINCT FROM OLD."reportedAt" THEN
    RAISE EXCEPTION 'claims.reportedAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."reviewStartedAt" IS NOT NULL AND NEW."reviewStartedAt" IS DISTINCT FROM OLD."reviewStartedAt" THEN
    RAISE EXCEPTION 'claims.reviewStartedAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."approvedAt" IS NOT NULL AND NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" THEN
    RAISE EXCEPTION 'claims.approvedAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."settledAt" IS NOT NULL AND NEW."settledAt" IS DISTINCT FROM OLD."settledAt" THEN
    RAISE EXCEPTION 'claims.settledAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deniedAt" IS NOT NULL AND NEW."deniedAt" IS DISTINCT FROM OLD."deniedAt" THEN
    RAISE EXCEPTION 'claims.deniedAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."closedNoActionAt" IS NOT NULL AND NEW."closedNoActionAt" IS DISTINCT FROM OLD."closedNoActionAt" THEN
    RAISE EXCEPTION 'claims.closedNoActionAt is immutable once set (claim %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claims_timestamps_immutable_trigger
  BEFORE UPDATE ON "claims"
  FOR EACH ROW
  EXECUTE FUNCTION claims_timestamps_immutable_fn();

-- ── Cross-table coherence (C2/C4/G5/R2/R6 pattern) ─────────────
-- Five coherence checks (all BEFORE INSERT, NULL-tolerant for
-- optional FKs):
--   policies.policyHolderId    → holder.org    match (required)
--   policies.underwriterId     → service-team.org match (optional)
--   claims.policyId            → policy.org    match (required)
--   claims.adjusterId          → service-team.org match (optional)
--   beneficiaries.policyId     → policy.org    match (required)
--
-- Slice-2 ticket: extend each fn to BEFORE INSERT OR UPDATE OF
-- <fk-cols> to also defend against post-create re-parenting writes.

CREATE OR REPLACE FUNCTION policies_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  holder_org_id TEXT;
  underwriter_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO holder_org_id
    FROM "policy_holders"
    WHERE "id" = NEW."policyHolderId";
  IF holder_org_id IS NULL THEN
    RAISE EXCEPTION 'policies.policyHolderId "%" does not resolve',
      NEW."policyHolderId" USING ERRCODE = 'check_violation';
  END IF;
  IF holder_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'policies: holder "%" belongs to org "%" but policy references org "%"',
      NEW."policyHolderId", holder_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Underwriter org coherence: when set, the assigned underwriter
  -- must belong to the same org (caller error or malicious cross-
  -- tenant write would otherwise bypass the SET NULL FK).
  IF NEW."underwriterId" IS NOT NULL THEN
    SELECT "organizationId" INTO underwriter_org_id
      FROM "insurance_service_team_members"
      WHERE "id" = NEW."underwriterId";
    IF underwriter_org_id IS NULL THEN
      RAISE EXCEPTION 'policies.underwriterId "%" does not resolve',
        NEW."underwriterId" USING ERRCODE = 'check_violation';
    END IF;
    IF underwriter_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'policies: underwriter "%" belongs to org "%" but policy references org "%"',
        NEW."underwriterId", underwriter_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policies_coherence_trigger
  BEFORE INSERT ON "policies"
  FOR EACH ROW
  EXECUTE FUNCTION policies_coherence_fn();

CREATE OR REPLACE FUNCTION claims_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  policy_org_id TEXT;
  adjuster_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO policy_org_id
    FROM "policies"
    WHERE "id" = NEW."policyId";
  IF policy_org_id IS NULL THEN
    RAISE EXCEPTION 'claims.policyId "%" does not resolve',
      NEW."policyId" USING ERRCODE = 'check_violation';
  END IF;
  IF policy_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'claims: policy "%" belongs to org "%" but claim references org "%"',
      NEW."policyId", policy_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Adjuster org coherence: when set, the assigned adjuster
  -- must belong to the same org.
  IF NEW."adjusterId" IS NOT NULL THEN
    SELECT "organizationId" INTO adjuster_org_id
      FROM "insurance_service_team_members"
      WHERE "id" = NEW."adjusterId";
    IF adjuster_org_id IS NULL THEN
      RAISE EXCEPTION 'claims.adjusterId "%" does not resolve',
        NEW."adjusterId" USING ERRCODE = 'check_violation';
    END IF;
    IF adjuster_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'claims: adjuster "%" belongs to org "%" but claim references org "%"',
        NEW."adjusterId", adjuster_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claims_coherence_trigger
  BEFORE INSERT ON "claims"
  FOR EACH ROW
  EXECUTE FUNCTION claims_coherence_fn();

CREATE OR REPLACE FUNCTION beneficiaries_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  policy_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO policy_org_id
    FROM "policies"
    WHERE "id" = NEW."policyId";
  IF policy_org_id IS NULL THEN
    RAISE EXCEPTION 'beneficiaries.policyId "%" does not resolve',
      NEW."policyId" USING ERRCODE = 'check_violation';
  END IF;
  IF policy_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'beneficiaries: policy "%" belongs to org "%" but beneficiary references org "%"',
      NEW."policyId", policy_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER beneficiaries_coherence_trigger
  BEFORE INSERT ON "beneficiaries"
  FOR EACH ROW
  EXECUTE FUNCTION beneficiaries_coherence_fn();
