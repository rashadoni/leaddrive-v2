-- C5: Pardot / Account Engagement (Phase 7+ backlog — Marketing Cloud B2B depth).
--
-- Salesforce Marketing Cloud Account Engagement (Pardot) analogue.
-- Distinct from contact-level marketing (Phase 6 C2/C3/C4) because
-- B2B buying = ACCOUNT-level decision: scoring + grading + journeys
-- target the COMPANY, not the individual contact.
--
-- Slice 1 ships SCHEMA + 5 PURE HELPERS only. Out of scope (slice-2+):
--   • ABM playbook UI + per-stage automation actions.
--   • Intent signal ingestion (Bombora / 6sense / Demandbase webhook).
--   • Score / grade recompute cron with per-tenant configurable rules.
--   • Account 360 view (slice-2 layers on top of G1 UnifiedProfile).
--   • Sales-Marketing handoff (SAL → SQL → opp creation triggers).
--
-- 5 tables:
--   marketing_accounts            — account-level marketing record
--                                    (separate from CRM Company because:
--                                    (a) Account engagement scoring +
--                                    fit grading are marketing-team-owned
--                                    metrics distinct from sales-side
--                                    Company.lifecycleStage; (b) An
--                                    account may exist in Marketing
--                                    before sales-team adopts as Company)
--   account_intent_signals        — append-only log of buying-intent
--                                    events (page view on /pricing,
--                                    competitor research, RFP language
--                                    in chat, third-party intent feed)
--   abm_journeys                  — account-level ABM journey
--                                    (distinct from contact-level Journey:
--                                    targets the account as the unit;
--                                    progresses based on aggregate
--                                    account signal, not individual contact)
--   abm_journey_enrollments       — per-account enrollment in ABM journey
--                                    with stage progression
--   account_score_snapshots       — historical snapshots of computed
--                                    score + grade (append-only;
--                                    slice-2 cron writes daily)

-- ── MarketingAccount ───────────────────────────────────────────
-- Account-level marketing entity. Anchor for engagement scoring +
-- ICP fit grading + ABM journeys.
CREATE TABLE "marketing_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to CRM Company. NULL = marketing-only account
     *  (e.g. account in target list but no sales engagement yet). */
    "companyId" TEXT,
    /** Free-form account name (display label). */
    "accountName" TEXT NOT NULL,
    /** Lifecycle stage in the ABM funnel (DB CHECK):
     *  target | engaged | mql | sql | opportunity | customer | churned
     *  (Different from CRM Company.lifecycleStage which is sales-side.
     *   This is the marketing-team-owned ABM stage.)
     */
    "lifecycleStage" TEXT NOT NULL DEFAULT 'target',
    /** Ideal Customer Profile (ICP) tier (DB CHECK):
     *  tier_1 — best-fit (top 50 accounts)
     *  tier_2 — strong-fit
     *  tier_3 — adequate-fit
     *  tier_4 — opportunistic
     *  unscored — no fit assessment yet
     */
    "icpTier" TEXT NOT NULL DEFAULT 'unscored',
    /** Current engagement score (0..100; recomputed by slice-2 cron). */
    "engagementScore" INTEGER NOT NULL DEFAULT 0,
    /** Current grade (DB CHECK — fit-based letter grade):
     *  A — best fit
     *  B — strong fit
     *  C — adequate
     *  D — poor fit (caller may exclude from outreach)
     *  F — disqualified (do not solicit; e.g. competitor)
     *  unassigned — no grade yet
     */
    "grade" TEXT NOT NULL DEFAULT 'unassigned',
    /** Industry vertical slug. */
    "industrySlug" TEXT,
    /** Employee count bucket (DB CHECK):
     *  micro | small | mid_market | enterprise | strategic
     */
    "employeeBand" TEXT,
    /** Annual revenue (USD, slice-2 multi-currency). */
    "annualRevenueUsd" BIGINT,
    /** Account owner — marketing-team operator. */
    "ownerUserId" TEXT,
    /** Status-transition timestamps. */
    "becameEngagedAt" TIMESTAMP(3),
    "becameMqlAt" TIMESTAMP(3),
    "becameSqlAt" TIMESTAMP(3),
    "becameOpportunityAt" TIMESTAMP(3),
    "becameCustomerAt" TIMESTAMP(3),
    "churnedAt" TIMESTAMP(3),
    "churnReason" TEXT,
    /** Last signal timestamp (slice-2 cron updates). */
    "lastSignalAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_stage_check"
  CHECK ("lifecycleStage" IN (
    'target', 'engaged', 'mql', 'sql', 'opportunity', 'customer', 'churned'
  ));

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_icp_check"
  CHECK ("icpTier" IN ('tier_1', 'tier_2', 'tier_3', 'tier_4', 'unscored'));

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_grade_check"
  CHECK ("grade" IN ('A', 'B', 'C', 'D', 'F', 'unassigned'));

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_band_check"
  CHECK ("employeeBand" IS NULL OR "employeeBand" IN (
    'micro', 'small', 'mid_market', 'enterprise', 'strategic'
  ));

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_score_check"
  CHECK ("engagementScore" >= 0 AND "engagementScore" <= 100);

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_revenue_check"
  CHECK ("annualRevenueUsd" IS NULL OR "annualRevenueUsd" >= 0);

-- Status-timestamp coherence — each stage requires the prior stage's
-- timestamp (forward-only funnel; downgrades clear stage but preserve
-- timestamp for historical analysis).
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_engaged_coherence_check"
  CHECK ("lifecycleStage" NOT IN ('engaged', 'mql', 'sql', 'opportunity', 'customer')
         OR "becameEngagedAt" IS NOT NULL);
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_mql_coherence_check"
  CHECK ("lifecycleStage" NOT IN ('mql', 'sql', 'opportunity', 'customer')
         OR "becameMqlAt" IS NOT NULL);
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_sql_coherence_check"
  CHECK ("lifecycleStage" NOT IN ('sql', 'opportunity', 'customer')
         OR "becameSqlAt" IS NOT NULL);
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_opp_coherence_check"
  CHECK ("lifecycleStage" NOT IN ('opportunity', 'customer')
         OR "becameOpportunityAt" IS NOT NULL);
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_customer_coherence_check"
  CHECK ("lifecycleStage" <> 'customer' OR "becameCustomerAt" IS NOT NULL);
ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_churned_coherence_check"
  CHECK ("lifecycleStage" <> 'churned'
         OR ("churnedAt" IS NOT NULL AND "churnReason" IS NOT NULL));

CREATE UNIQUE INDEX "marketing_accounts_org_company_uniq"
  ON "marketing_accounts"("organizationId", "companyId")
  WHERE "companyId" IS NOT NULL;
CREATE INDEX "marketing_accounts_org_stage_idx"
  ON "marketing_accounts"("organizationId", "lifecycleStage");
CREATE INDEX "marketing_accounts_org_icp_idx"
  ON "marketing_accounts"("organizationId", "icpTier");
CREATE INDEX "marketing_accounts_org_grade_idx"
  ON "marketing_accounts"("organizationId", "grade");
CREATE INDEX "marketing_accounts_org_score_idx"
  ON "marketing_accounts"("organizationId", "engagementScore");
CREATE INDEX "marketing_accounts_owner_idx"
  ON "marketing_accounts"("ownerUserId");

ALTER TABLE "marketing_accounts"
  ADD CONSTRAINT "marketing_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Stage-transition timestamps immutable once set (IS DISTINCT FROM — N2 lesson).
CREATE OR REPLACE FUNCTION marketing_accounts_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."becameEngagedAt" IS NOT NULL AND NEW."becameEngagedAt" IS DISTINCT FROM OLD."becameEngagedAt" THEN
    RAISE EXCEPTION 'marketing_accounts.becameEngagedAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."becameMqlAt" IS NOT NULL AND NEW."becameMqlAt" IS DISTINCT FROM OLD."becameMqlAt" THEN
    RAISE EXCEPTION 'marketing_accounts.becameMqlAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."becameSqlAt" IS NOT NULL AND NEW."becameSqlAt" IS DISTINCT FROM OLD."becameSqlAt" THEN
    RAISE EXCEPTION 'marketing_accounts.becameSqlAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."becameOpportunityAt" IS NOT NULL AND NEW."becameOpportunityAt" IS DISTINCT FROM OLD."becameOpportunityAt" THEN
    RAISE EXCEPTION 'marketing_accounts.becameOpportunityAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."becameCustomerAt" IS NOT NULL AND NEW."becameCustomerAt" IS DISTINCT FROM OLD."becameCustomerAt" THEN
    RAISE EXCEPTION 'marketing_accounts.becameCustomerAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."churnedAt" IS NOT NULL AND NEW."churnedAt" IS DISTINCT FROM OLD."churnedAt" THEN
    RAISE EXCEPTION 'marketing_accounts.churnedAt is immutable once set (account %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_accounts_timestamps_immutable_trigger
  BEFORE UPDATE ON "marketing_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION marketing_accounts_timestamps_immutable_fn();

-- ── AccountIntentSignal ────────────────────────────────────────
-- Append-only log of buying-intent events. Slice-2 ingester writes
-- one row per signal; analyzer aggregates over time-window to feed
-- engagement-score-calculator.
CREATE TABLE "account_intent_signals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketingAccountId" TEXT NOT NULL,
    /** Signal kind (DB CHECK):
     *  page_view_high_intent  — viewed /pricing, /demo, etc.
     *  page_view_research     — viewed /docs, /blog
     *  content_download       — downloaded gated content
     *  form_submission        — filled high-intent form (demo request, RFP)
     *  email_engagement       — opened/clicked nurture email
     *  chat_high_intent       — language indicating buying ("how much?", "ROI?")
     *  third_party_intent     — Bombora/6sense/Demandbase signal
     *  competitor_research    — visited /vs/<competitor>
     *  event_attendance       — attended webinar / event
     *  social_engagement      — engaged with brand on LinkedIn/Twitter
     */
    "signalKind" TEXT NOT NULL,
    /** Signal weight (DB CHECK: 1..100) — slice-2 reads per-tenant
     *  config; slice-1 helpers compute defaults. */
    "weight" INTEGER NOT NULL DEFAULT 5,
    /** Optional contact at the account whose action triggered the signal. */
    "contactId" TEXT,
    /** Optional URL / resource the signal references. */
    "resourceRef" TEXT,
    /** Wall-clock when signal happened. */
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_intent_signals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "account_intent_signals"
  ADD CONSTRAINT "account_intent_signals_kind_check"
  CHECK ("signalKind" IN (
    'page_view_high_intent', 'page_view_research', 'content_download',
    'form_submission', 'email_engagement', 'chat_high_intent',
    'third_party_intent', 'competitor_research', 'event_attendance',
    'social_engagement'
  ));

ALTER TABLE "account_intent_signals"
  ADD CONSTRAINT "account_intent_signals_weight_check"
  CHECK ("weight" >= 1 AND "weight" <= 100);

CREATE INDEX "account_intent_signals_account_time_idx"
  ON "account_intent_signals"("marketingAccountId", "occurredAt");
CREATE INDEX "account_intent_signals_org_kind_idx"
  ON "account_intent_signals"("organizationId", "signalKind");
CREATE INDEX "account_intent_signals_contact_idx"
  ON "account_intent_signals"("contactId");

ALTER TABLE "account_intent_signals"
  ADD CONSTRAINT "account_intent_signals_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_intent_signals"
  ADD CONSTRAINT "account_intent_signals_marketingAccountId_fkey"
  FOREIGN KEY ("marketingAccountId") REFERENCES "marketing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: NO UPDATE allowed.
CREATE OR REPLACE FUNCTION account_intent_signals_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'account_intent_signals is append-only; UPDATE not allowed (signal %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_intent_signals_no_update_trigger
  BEFORE UPDATE ON "account_intent_signals"
  FOR EACH ROW
  EXECUTE FUNCTION account_intent_signals_no_update_fn();

-- ── ABMJourney ─────────────────────────────────────────────────
-- Account-level ABM journey definition. Distinct from contact-level
-- Journey (Phase 1 marketing) because progression is account-aggregate.
CREATE TABLE "abm_journeys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journeyNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  draft — being authored
     *  active — accepting enrollments
     *  paused — no new enrollments (existing continue)
     *  archived — terminated
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Target ICP tier(s) — accounts of these tiers eligible for
     *  enrollment. Empty array = any tier. */
    "targetIcpTiers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /** Target lifecycle stage(s) — accounts in these stages eligible. */
    "targetStages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /** Journey definition JSON — slice-2 builds visual graph editor
     *  on top; slice-1 stores as opaque blob for round-trip. */
    "definition" JSONB NOT NULL DEFAULT '{"stages":[]}',
    /** Goal — what completion means (DB CHECK):
     *  pipeline_creation — opportunity created
     *  meeting_booked — sales meeting set
     *  trial_started — trial / freemium signup
     *  custom — caller defines in metadata
     */
    "goalKind" TEXT NOT NULL DEFAULT 'pipeline_creation',
    "activatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "abm_journeys_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "abm_journeys"
  ADD CONSTRAINT "abm_journeys_status_check"
  CHECK ("status" IN ('draft', 'active', 'paused', 'archived'));

ALTER TABLE "abm_journeys"
  ADD CONSTRAINT "abm_journeys_goal_check"
  CHECK ("goalKind" IN (
    'pipeline_creation', 'meeting_booked', 'trial_started', 'custom'
  ));

ALTER TABLE "abm_journeys"
  ADD CONSTRAINT "abm_journeys_activated_coherence_check"
  CHECK ("status" NOT IN ('active', 'paused', 'archived') OR "activatedAt" IS NOT NULL);
ALTER TABLE "abm_journeys"
  ADD CONSTRAINT "abm_journeys_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "abm_journeys_org_number_uniq"
  ON "abm_journeys"("organizationId", "journeyNumber");
CREATE INDEX "abm_journeys_org_status_idx"
  ON "abm_journeys"("organizationId", "status");

ALTER TABLE "abm_journeys"
  ADD CONSTRAINT "abm_journeys_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION abm_journeys_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'abm_journeys.activatedAt is immutable once set (journey %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'abm_journeys.archivedAt is immutable once set (journey %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER abm_journeys_timestamps_immutable_trigger
  BEFORE UPDATE ON "abm_journeys"
  FOR EACH ROW
  EXECUTE FUNCTION abm_journeys_timestamps_immutable_fn();

-- ── ABMJourneyEnrollment ───────────────────────────────────────
-- Per-account enrollment in an ABM journey.
CREATE TABLE "abm_journey_enrollments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "marketingAccountId" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  enrolled    — initial state
     *  in_progress — account is moving through stages
     *  goal_met    — account hit the journey goal
     *  exited      — account exited without meeting goal
     *  failed      — account fell out due to disqualification
     */
    "status" TEXT NOT NULL DEFAULT 'enrolled',
    /** Current stage index in the journey definition (0-based). */
    "currentStageIndex" INTEGER NOT NULL DEFAULT 0,
    /** Stage-history JSON — append-only log of stages traversed. */
    "stageHistory" JSONB NOT NULL DEFAULT '[]',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAdvancedAt" TIMESTAMP(3),
    "goalMetAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "abm_journey_enrollments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_status_check"
  CHECK ("status" IN ('enrolled', 'in_progress', 'goal_met', 'exited', 'failed'));

ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_stage_check"
  CHECK ("currentStageIndex" >= 0);

-- Status-timestamp coherence.
ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_goal_coherence_check"
  CHECK ("status" <> 'goal_met' OR "goalMetAt" IS NOT NULL);
ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_exited_coherence_check"
  CHECK ("status" NOT IN ('exited', 'failed')
         OR ("exitedAt" IS NOT NULL AND "exitReason" IS NOT NULL));

CREATE UNIQUE INDEX "abm_journey_enrollments_journey_account_uniq"
  ON "abm_journey_enrollments"("journeyId", "marketingAccountId");
CREATE INDEX "abm_journey_enrollments_account_idx"
  ON "abm_journey_enrollments"("marketingAccountId");
CREATE INDEX "abm_journey_enrollments_org_status_idx"
  ON "abm_journey_enrollments"("organizationId", "status");

ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_journeyId_fkey"
  FOREIGN KEY ("journeyId") REFERENCES "abm_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abm_journey_enrollments"
  ADD CONSTRAINT "abm_journey_enrollments_marketingAccountId_fkey"
  FOREIGN KEY ("marketingAccountId") REFERENCES "marketing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION abm_journey_enrollments_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."enrolledAt" IS DISTINCT FROM OLD."enrolledAt" THEN
    RAISE EXCEPTION 'abm_journey_enrollments.enrolledAt is immutable (enrollment %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."goalMetAt" IS NOT NULL AND NEW."goalMetAt" IS DISTINCT FROM OLD."goalMetAt" THEN
    RAISE EXCEPTION 'abm_journey_enrollments.goalMetAt is immutable once set (enrollment %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."exitedAt" IS NOT NULL AND NEW."exitedAt" IS DISTINCT FROM OLD."exitedAt" THEN
    RAISE EXCEPTION 'abm_journey_enrollments.exitedAt is immutable once set (enrollment %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER abm_journey_enrollments_timestamps_immutable_trigger
  BEFORE UPDATE ON "abm_journey_enrollments"
  FOR EACH ROW
  EXECUTE FUNCTION abm_journey_enrollments_timestamps_immutable_fn();

-- ── AccountScoreSnapshot ───────────────────────────────────────
-- Historical record of computed score + grade. Append-only;
-- slice-2 cron writes one row per account per day.
CREATE TABLE "account_score_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketingAccountId" TEXT NOT NULL,
    /** Snapshot wall-clock — when the metrics were computed. */
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    /** Engagement score 0..100. */
    "engagementScore" INTEGER NOT NULL,
    /** Fit grade letter (A..F | unassigned) — see marketing_accounts.grade. */
    "grade" TEXT NOT NULL,
    /** ICP tier at snapshot time. */
    "icpTier" TEXT NOT NULL,
    /** Lifecycle stage at snapshot time. */
    "lifecycleStage" TEXT NOT NULL,
    /** Signal-count breakdown JSON — e.g.
     *  {"page_view_high_intent": 12, "form_submission": 3, ...} */
    "signalCounts" JSONB NOT NULL DEFAULT '{}',
    /** Notes — slice-2 attribution context. */
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_score_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_score_check"
  CHECK ("engagementScore" >= 0 AND "engagementScore" <= 100);

ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_grade_check"
  CHECK ("grade" IN ('A', 'B', 'C', 'D', 'F', 'unassigned'));

ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_icp_check"
  CHECK ("icpTier" IN ('tier_1', 'tier_2', 'tier_3', 'tier_4', 'unscored'));

ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_stage_check"
  CHECK ("lifecycleStage" IN (
    'target', 'engaged', 'mql', 'sql', 'opportunity', 'customer', 'churned'
  ));

CREATE INDEX "account_score_snapshots_account_time_idx"
  ON "account_score_snapshots"("marketingAccountId", "snapshotAt");
CREATE INDEX "account_score_snapshots_org_time_idx"
  ON "account_score_snapshots"("organizationId", "snapshotAt");
CREATE INDEX "account_score_snapshots_org_grade_idx"
  ON "account_score_snapshots"("organizationId", "grade");

ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_score_snapshots"
  ADD CONSTRAINT "account_score_snapshots_marketingAccountId_fkey"
  FOREIGN KEY ("marketingAccountId") REFERENCES "marketing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only.
CREATE OR REPLACE FUNCTION account_score_snapshots_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'account_score_snapshots is append-only; UPDATE not allowed (snapshot %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_score_snapshots_no_update_trigger
  BEFORE UPDATE ON "account_score_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION account_score_snapshots_no_update_fn();

-- ── Cross-table coherence (C2/C4/G5/R2/R6/R7/R8/R11 pattern) ───
-- 4 coherence checks (all BEFORE INSERT):
--   account_intent_signals.marketingAccountId      → account.org match (required)
--   abm_journey_enrollments.journeyId              → journey.org match (required)
--   abm_journey_enrollments.marketingAccountId     → account.org match (required)
--   account_score_snapshots.marketingAccountId     → account.org match (required)

CREATE OR REPLACE FUNCTION account_intent_signals_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  account_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO account_org_id
    FROM "marketing_accounts" WHERE "id" = NEW."marketingAccountId";
  IF account_org_id IS NULL THEN
    RAISE EXCEPTION 'account_intent_signals.marketingAccountId "%" does not resolve',
      NEW."marketingAccountId" USING ERRCODE = 'check_violation';
  END IF;
  IF account_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'account_intent_signals: account "%" belongs to org "%" but signal references org "%"',
      NEW."marketingAccountId", account_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_intent_signals_coherence_trigger
  BEFORE INSERT ON "account_intent_signals"
  FOR EACH ROW
  EXECUTE FUNCTION account_intent_signals_coherence_fn();

CREATE OR REPLACE FUNCTION abm_journey_enrollments_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  journey_org_id TEXT;
  account_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO journey_org_id
    FROM "abm_journeys" WHERE "id" = NEW."journeyId";
  IF journey_org_id IS NULL THEN
    RAISE EXCEPTION 'abm_journey_enrollments.journeyId "%" does not resolve',
      NEW."journeyId" USING ERRCODE = 'check_violation';
  END IF;
  IF journey_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'abm_journey_enrollments: journey "%" belongs to org "%" but enrollment references org "%"',
      NEW."journeyId", journey_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "organizationId" INTO account_org_id
    FROM "marketing_accounts" WHERE "id" = NEW."marketingAccountId";
  IF account_org_id IS NULL THEN
    RAISE EXCEPTION 'abm_journey_enrollments.marketingAccountId "%" does not resolve',
      NEW."marketingAccountId" USING ERRCODE = 'check_violation';
  END IF;
  IF account_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'abm_journey_enrollments: account "%" belongs to org "%" but enrollment references org "%"',
      NEW."marketingAccountId", account_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER abm_journey_enrollments_coherence_trigger
  BEFORE INSERT ON "abm_journey_enrollments"
  FOR EACH ROW
  EXECUTE FUNCTION abm_journey_enrollments_coherence_fn();

CREATE OR REPLACE FUNCTION account_score_snapshots_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  account_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO account_org_id
    FROM "marketing_accounts" WHERE "id" = NEW."marketingAccountId";
  IF account_org_id IS NULL THEN
    RAISE EXCEPTION 'account_score_snapshots.marketingAccountId "%" does not resolve',
      NEW."marketingAccountId" USING ERRCODE = 'check_violation';
  END IF;
  IF account_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'account_score_snapshots: account "%" belongs to org "%" but snapshot references org "%"',
      NEW."marketingAccountId", account_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_score_snapshots_coherence_trigger
  BEFORE INSERT ON "account_score_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION account_score_snapshots_coherence_fn();
