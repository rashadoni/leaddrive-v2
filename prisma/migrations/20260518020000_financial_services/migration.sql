-- R1: Financial Services Cloud (Phase 6 Block E, closes Block E).
--
-- Salesforce FSC analogue. Wealth management / retail-commercial
-- banking / insurance — household-centric data model with multi-
-- party ownership, goal tracking, life-event triggers.
--
-- Workflow: KYC → account opening → goal setting → ongoing advisory.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine, aum-calculator,
-- goal-progress-calculator, kyc-validator, types). Money math uses
-- Decimal-native columns + BigInt-safe helpers (mirror M4 lesson).
--
-- Slice 2 wires:
--   • Admin UI for household management + account opening flow.
--   • Client portal for self-service balance + goal-progress views.
--   • KYC document upload + verification (slice-1 only validates
--     declared fields).
--   • Lead-to-household conversion (CRM Contact → FinancialHousehold).
-- Slice 3 wires:
--   • Portfolio recommendation engine (AI-driven, builds on H8 LLM).
--   • Churn-risk model (reuses G3 calculated-insights infra).
--   • OmniStudio FlexCard templates for household 360 view.
--   • External integrations (Plaid for balance pull, Yodlee).

-- ── FinancialHousehold ─────────────────────────────────────────
-- The central record. A household groups members, accounts, goals,
-- and life events. Status tracks lifecycle from prospect → active
-- → inactive (no activity) → closed (terminated relationship).
CREATE TABLE "financial_households" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Display name — typically "<Primary Last Name> Household". */
    "name" TEXT NOT NULL,
    /** Optional Contact link for the primary member. Soft FK — slice-2 promotes. */
    "primaryContactId" TEXT,
    /**
     * Total Assets Under Management — sum of account balances. Stored
     * denormalised for cheap dashboard reads; aum-calculator helper
     * computes the canonical value. Slice-2 cron refreshes nightly.
     */
    "totalAum" DECIMAL(18, 4) NOT NULL DEFAULT 0,
    /** ISO-4217 currency for the household-level aggregate. */
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    /**
     * KYC status (DB CHECK):
     *   not_started — no docs submitted
     *   in_review   — submitted, awaiting compliance
     *   approved    — passed KYC
     *   rejected    — failed KYC; reapply path is slice-2
     *   expired     — periodic re-verification due
     */
    "kycStatus" TEXT NOT NULL DEFAULT 'not_started',
    "kycCompletedAt" TIMESTAMP(3),
    /**
     * Lifecycle (DB CHECK):
     *   prospect | active | inactive | closed
     */
    "status" TEXT NOT NULL DEFAULT 'prospect',
    /** Set on transition to active. */
    "activatedAt" TIMESTAMP(3),
    /** Set on transition to closed. */
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_households_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_status_check"
  CHECK ("status" IN ('prospect', 'active', 'inactive', 'closed'));

ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_kyc_status_check"
  CHECK ("kycStatus" IN ('not_started', 'in_review', 'approved', 'rejected', 'expired'));

ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_total_aum_check"
  CHECK ("totalAum" >= 0);

ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_currency_check"
  CHECK ("baseCurrency" ~ '^[A-Z]{3}$');

-- Status-timestamp coherence
ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_active_coherence_check"
  CHECK ("status" <> 'active' OR "activatedAt" IS NOT NULL);
ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_closed_coherence_check"
  CHECK ("status" <> 'closed' OR "closedAt" IS NOT NULL);
ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_kyc_completed_coherence_check"
  CHECK ("kycStatus" <> 'approved' OR "kycCompletedAt" IS NOT NULL);

CREATE INDEX "financial_households_org_status_idx"
  ON "financial_households"("organizationId", "status");
CREATE INDEX "financial_households_org_kyc_idx"
  ON "financial_households"("organizationId", "kycStatus");
CREATE INDEX "financial_households_org_aum_idx"
  ON "financial_households"("organizationId", "totalAum");

ALTER TABLE "financial_households"
  ADD CONSTRAINT "financial_households_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activation + close timestamps + KYC completion immutable once set.
-- Uses IS DISTINCT FROM (N2 architect lesson — handles NULL correctly).
CREATE OR REPLACE FUNCTION financial_households_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'financial_households.activatedAt is immutable once set (hh %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
    RAISE EXCEPTION 'financial_households.closedAt is immutable once set (hh %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."kycCompletedAt" IS NOT NULL AND NEW."kycCompletedAt" IS DISTINCT FROM OLD."kycCompletedAt" THEN
    RAISE EXCEPTION 'financial_households.kycCompletedAt is immutable once set (hh %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_households_timestamps_immutable_trigger
  BEFORE UPDATE ON "financial_households"
  FOR EACH ROW
  EXECUTE FUNCTION financial_households_timestamps_immutable_fn();

-- ── FinancialHouseholdMember ───────────────────────────────────
-- Household ↔ Contact junction with role + ownership percentage.
-- One household can have many members (primary + spouse + dependents).
CREATE TABLE "financial_household_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    /** Soft FK to Contact — slice-2 promotes. */
    "contactId" TEXT NOT NULL,
    /**
     * Role within household (DB CHECK):
     *   primary | spouse | child | dependent | trustee | beneficiary
     */
    "role" TEXT NOT NULL,
    /**
     * Ownership percentage of household assets (0..100). Sums across
     * all members SHOULD equal 100 but slice-1 doesn't enforce — slice-2
     * admin UI surfaces a warning. SHARED households (spouse 50/50) are
     * the common case.
     */
    "ownershipPct" DECIMAL(5, 2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_household_members_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_household_members"
  ADD CONSTRAINT "financial_household_members_role_check"
  CHECK ("role" IN ('primary', 'spouse', 'child', 'dependent', 'trustee', 'beneficiary'));

ALTER TABLE "financial_household_members"
  ADD CONSTRAINT "financial_household_members_ownership_check"
  CHECK ("ownershipPct" >= 0 AND "ownershipPct" <= 100);

-- One Contact link per household — same person can't be both primary
-- and spouse on the same household. Cross-household membership is OK
-- (spouse-of-A could be dependent-of-B in unusual family structures).
CREATE UNIQUE INDEX "financial_household_members_household_contact_uniq"
  ON "financial_household_members"("householdId", "contactId");
CREATE INDEX "financial_household_members_org_household_idx"
  ON "financial_household_members"("organizationId", "householdId");
CREATE INDEX "financial_household_members_contact_idx"
  ON "financial_household_members"("contactId");
CREATE INDEX "financial_household_members_role_idx"
  ON "financial_household_members"("householdId", "role");

ALTER TABLE "financial_household_members"
  ADD CONSTRAINT "financial_household_members_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_household_members"
  ADD CONSTRAINT "financial_household_members_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "financial_households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── FinancialAccount ───────────────────────────────────────────
-- Per-account record. Accounts belong to a household. Account types
-- cover wealth management (brokerage, retirement) + retail banking
-- (checking, savings, credit card, loan).
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    /** Account label as the client sees it ("Joint Checking", "Jim's 401k"). */
    "name" TEXT NOT NULL,
    /** Institution-side account number (masked at display time). */
    "accountNumber" TEXT NOT NULL,
    /**
     * Account type (DB CHECK):
     *   checking | savings | brokerage | ira_traditional | ira_roth
     *   | 401k | 529 | credit_card | mortgage | personal_loan
     *   | hsa | trust
     */
    "accountType" TEXT NOT NULL,
    /**
     * Lifecycle (DB CHECK):
     *   pending — application submitted, not yet opened
     *   open    — active
     *   frozen  — temporary hold (compliance / fraud / dispute)
     *   closed  — terminated; preserved for audit
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Current balance — sign matches account direction (loan = negative). */
    "balance" DECIMAL(18, 4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    /** Institution name — "Vanguard", "Chase", etc. */
    "institutionName" TEXT,
    /** Set on transition to open. */
    "openedAt" TIMESTAMP(3),
    /** Set on transition to closed. */
    "closedAt" TIMESTAMP(3),
    /** Set on transition to frozen. */
    "frozenAt" TIMESTAMP(3),
    /** Last successful balance sync via Plaid/Yodlee (slice 3). */
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_type_check"
  CHECK ("accountType" IN (
    'checking', 'savings', 'brokerage', 'ira_traditional', 'ira_roth',
    '401k', '529', 'credit_card', 'mortgage', 'personal_loan',
    'hsa', 'trust'
  ));

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_status_check"
  CHECK ("status" IN ('pending', 'open', 'frozen', 'closed'));

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Status-timestamp coherence
ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_open_coherence_check"
  CHECK ("status" NOT IN ('open', 'frozen', 'closed') OR "openedAt" IS NOT NULL);
ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_closed_coherence_check"
  CHECK ("status" <> 'closed' OR "closedAt" IS NOT NULL);
ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_frozen_coherence_check"
  CHECK ("status" <> 'frozen' OR "frozenAt" IS NOT NULL);

CREATE UNIQUE INDEX "financial_accounts_household_number_uniq"
  ON "financial_accounts"("householdId", "accountNumber");
CREATE INDEX "financial_accounts_org_status_idx"
  ON "financial_accounts"("organizationId", "status");
CREATE INDEX "financial_accounts_household_type_idx"
  ON "financial_accounts"("householdId", "accountType");
CREATE INDEX "financial_accounts_org_last_synced_idx"
  ON "financial_accounts"("organizationId", "lastSyncedAt");

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "financial_households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- openedAt + closedAt + frozenAt immutable once set.
CREATE OR REPLACE FUNCTION financial_accounts_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."openedAt" IS NOT NULL AND NEW."openedAt" IS DISTINCT FROM OLD."openedAt" THEN
    RAISE EXCEPTION 'financial_accounts.openedAt is immutable once set (acct %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
    RAISE EXCEPTION 'financial_accounts.closedAt is immutable once set (acct %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."frozenAt" IS NOT NULL AND NEW."frozenAt" IS DISTINCT FROM OLD."frozenAt" THEN
    RAISE EXCEPTION 'financial_accounts.frozenAt is immutable once set (acct %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_accounts_timestamps_immutable_trigger
  BEFORE UPDATE ON "financial_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION financial_accounts_timestamps_immutable_fn();

-- ── FinancialGoal ──────────────────────────────────────────────
-- Savings / retirement / college / down-payment goals. Progress
-- computed by goal-progress-calculator helper against linked
-- accounts (slice-2 wires linkage; slice-1 stores manual currentAmount).
CREATE TABLE "financial_goals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /**
     * Goal type (DB CHECK) — drives default advice tooling:
     *   retirement | college | home_purchase | emergency_fund
     *   | major_purchase | debt_payoff | custom
     */
    "goalType" TEXT NOT NULL DEFAULT 'custom',
    "targetAmount" DECIMAL(18, 4) NOT NULL,
    /** Current progress amount — manually maintained slice-1; linked-account-sum slice-2. */
    "currentAmount" DECIMAL(18, 4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    /** Target date — when the goal should be achieved. */
    "targetDate" TIMESTAMP(3),
    /**
     * Lifecycle (DB CHECK):
     *   active | achieved | abandoned | paused
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    /** Set on transition to achieved. */
    "achievedAt" TIMESTAMP(3),
    /** Set on transition to abandoned. */
    "abandonedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_type_check"
  CHECK ("goalType" IN (
    'retirement', 'college', 'home_purchase', 'emergency_fund',
    'major_purchase', 'debt_payoff', 'custom'
  ));

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_status_check"
  CHECK ("status" IN ('active', 'achieved', 'abandoned', 'paused'));

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_target_check"
  CHECK ("targetAmount" > 0);

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_current_check"
  CHECK ("currentAmount" >= 0);

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Achieved/abandoned coherence
ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_achieved_coherence_check"
  CHECK ("status" <> 'achieved' OR "achievedAt" IS NOT NULL);
ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_abandoned_coherence_check"
  CHECK ("status" <> 'abandoned' OR "abandonedAt" IS NOT NULL);

CREATE INDEX "financial_goals_org_status_idx"
  ON "financial_goals"("organizationId", "status");
CREATE INDEX "financial_goals_household_idx"
  ON "financial_goals"("householdId");
CREATE INDEX "financial_goals_household_type_idx"
  ON "financial_goals"("householdId", "goalType");

ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_goals"
  ADD CONSTRAINT "financial_goals_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "financial_households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- achievedAt + abandonedAt immutable once set.
CREATE OR REPLACE FUNCTION financial_goals_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."achievedAt" IS NOT NULL AND NEW."achievedAt" IS DISTINCT FROM OLD."achievedAt" THEN
    RAISE EXCEPTION 'financial_goals.achievedAt is immutable once set (goal %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."abandonedAt" IS NOT NULL AND NEW."abandonedAt" IS DISTINCT FROM OLD."abandonedAt" THEN
    RAISE EXCEPTION 'financial_goals.abandonedAt is immutable once set (goal %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_goals_timestamps_immutable_trigger
  BEFORE UPDATE ON "financial_goals"
  FOR EACH ROW
  EXECUTE FUNCTION financial_goals_timestamps_immutable_fn();

-- ── FinancialLifeEvent ─────────────────────────────────────────
-- Life-event log. Triggers advisor outreach + recommendation
-- recompute. Append-only — DB trigger blocks UPDATE.
CREATE TABLE "financial_life_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    /**
     * Event type (DB CHECK):
     *   marriage | divorce | birth | death | retirement
     *   | job_change | inheritance | home_purchase
     *   | major_illness | child_education_start | other
     */
    "eventType" TEXT NOT NULL,
    /** Event date — may be in the past (logged after the fact) or future (planned). */
    "eventDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    /**
     * Optional Contact reference — for "marriage" the spouse contact,
     * for "death" the deceased member. Soft FK — slice-1 stays loose.
     */
    "involvedContactId" TEXT,
    /**
     * Outreach status (DB CHECK):
     *   logged       — event recorded, no advisor follow-up yet
     *   acknowledged — advisor saw the alert
     *   actioned     — advisor reached out / updated plan
     *   dismissed    — admin chose not to act
     */
    "outreachStatus" TEXT NOT NULL DEFAULT 'logged',
    "actionedAt" TIMESTAMP(3),
    "actionedBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_life_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "financial_life_events"
  ADD CONSTRAINT "financial_life_events_type_check"
  CHECK ("eventType" IN (
    'marriage', 'divorce', 'birth', 'death', 'retirement',
    'job_change', 'inheritance', 'home_purchase',
    'major_illness', 'child_education_start', 'other'
  ));

ALTER TABLE "financial_life_events"
  ADD CONSTRAINT "financial_life_events_outreach_check"
  CHECK ("outreachStatus" IN ('logged', 'acknowledged', 'actioned', 'dismissed'));

-- actionedAt coherence
ALTER TABLE "financial_life_events"
  ADD CONSTRAINT "financial_life_events_actioned_coherence_check"
  CHECK (
    "outreachStatus" <> 'actioned'
    OR ("actionedAt" IS NOT NULL AND "actionedBy" IS NOT NULL)
  );

CREATE INDEX "financial_life_events_org_household_idx"
  ON "financial_life_events"("organizationId", "householdId");
CREATE INDEX "financial_life_events_household_event_idx"
  ON "financial_life_events"("householdId", "eventDate");
CREATE INDEX "financial_life_events_org_outreach_idx"
  ON "financial_life_events"("organizationId", "outreachStatus");

ALTER TABLE "financial_life_events"
  ADD CONSTRAINT "financial_life_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_life_events"
  ADD CONSTRAINT "financial_life_events_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "financial_households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- actionedAt immutable once set.
CREATE OR REPLACE FUNCTION financial_life_events_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."actionedAt" IS NOT NULL AND NEW."actionedAt" IS DISTINCT FROM OLD."actionedAt" THEN
    RAISE EXCEPTION 'financial_life_events.actionedAt is immutable once set (event %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Event date itself is immutable after creation — slice-2 may relax
  -- if "planned date moved" becomes a real workflow.
  IF NEW."eventDate" IS DISTINCT FROM OLD."eventDate" THEN
    RAISE EXCEPTION 'financial_life_events.eventDate is immutable (event %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_life_events_timestamps_immutable_trigger
  BEFORE UPDATE ON "financial_life_events"
  FOR EACH ROW
  EXECUTE FUNCTION financial_life_events_timestamps_immutable_fn();
