-- C12: Multi-channel Campaign Orchestrator (Phase 6 / Marketing Cloud).
--
-- Salesforce Marketing Cloud Engagement "Journey" channel orchestration
-- analogue. Given a campaign + a target audience (contact set), decide
-- WHICH channel to use per contact based on:
--   • Per-contact opted-in channels + preferred priority.
--   • Org-level quiet-hours / frequency caps from active policy.
--   • Cross-channel dedup: don't hit the same contact twice on different
--     channels for the same campaign within a dedup window.
--
-- Slice-1 ships schema + 5 pure helpers (types + channel-priority-
-- resolver + quiet-hours-checker + frequency-cap-checker + cross-
-- channel-dedup). NO dispatch runtime — slice-2 wires the worker that
-- reads campaigns + policies + contact prefs and writes orchestrated_
-- deliveries rows, then hands off to existing channel-specific senders
-- (sendEmail / sendSms / sendPush / sendTelegram).
--
-- Slice-2 wires:
--   • Orchestration cron worker: walks campaigns ready to fire, runs
--     priority resolver per contact, writes deliveries, dispatches.
--   • Admin UI: policy authoring + quiet-hours editor + frequency-cap
--     limits + per-contact preferences override.
--   • Per-contact preference center (slice-2 portal page).
-- Slice-3 wires:
--   • AI channel preference learning (which channel each contact
--     actually engages with — slice-3 adjusts priority dynamically).
--   • Real-time event-driven orchestration via G6 event stream.

-- ═══════════════════════════════════════════════════════════════
-- 1. channel_preferences — per-contact channel opt-in / priority
-- ═══════════════════════════════════════════════════════════════
-- One row per (contact, channel). Slice-2 ingestion writes from
-- preference-center portal page; slice-2 admin UI lets operators
-- import bulk opt-ins/outs.
CREATE TABLE "channel_preferences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    /**
     * Channel (DB CHECK):
     *   email | sms | push | telegram | whatsapp | voice | postal
     * Matches the wider channel taxonomy across the platform.
     */
    "channel" TEXT NOT NULL,
    /**
     * 1 = most-preferred, higher = less-preferred. NULL = no
     * preference expressed (helper treats as default priority).
     * Lower-numbered channels are tried first.
     */
    "priority" INTEGER,
    /**
     * Opt-in flag. Defaults to true on insert; explicit opt-out
     * via slice-2 preference-center flips to false.
     */
    "isOptedIn" BOOLEAN NOT NULL DEFAULT true,
    /**
     * Free-form reason when opt-out is recorded.
     * INTENTIONALLY mutable — operator may overwrite with a more specific
     * reason later (e.g. "unsubscribed" → "GDPR right-to-be-forgotten").
     * The lifecycle trigger does NOT lock this column.
     */
    "optOutReason" TEXT,
    /** Set on transition to opted-out; immutable once set. */
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_preferences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "channel_preferences"
  ADD CONSTRAINT "channel_preferences_channel_check"
  CHECK ("channel" IN ('email', 'sms', 'push', 'telegram', 'whatsapp', 'voice', 'postal'));

ALTER TABLE "channel_preferences"
  ADD CONSTRAINT "channel_preferences_priority_check"
  CHECK ("priority" IS NULL OR ("priority" >= 1 AND "priority" <= 100));

-- Coherence: opted-out implies optedOutAt set.
ALTER TABLE "channel_preferences"
  ADD CONSTRAINT "channel_preferences_optout_coherence_check"
  CHECK ("isOptedIn" = true OR "optedOutAt" IS NOT NULL);

CREATE UNIQUE INDEX "channel_preferences_contact_channel_uniq"
  ON "channel_preferences"("contactId", "channel");
CREATE INDEX "channel_preferences_org_contact_idx"
  ON "channel_preferences"("organizationId", "contactId");
CREATE INDEX "channel_preferences_org_opted_in_idx"
  ON "channel_preferences"("organizationId", "isOptedIn");

ALTER TABLE "channel_preferences"
  ADD CONSTRAINT "channel_preferences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_preferences"
  ADD CONSTRAINT "channel_preferences_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutability: contactId + channel are the natural key (UNIQUE'd above);
-- locking them prevents accidental re-key. optedOutAt set-once.
-- Re-opt-in is allowed: flips isOptedIn back to true but optedOutAt
-- stays as audit trail of the last opt-out.
CREATE OR REPLACE FUNCTION channel_preferences_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."contactId" IS DISTINCT FROM OLD."contactId" THEN
    RAISE EXCEPTION 'channel_preferences.contactId is immutable (preference %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."channel" IS DISTINCT FROM OLD."channel" THEN
    RAISE EXCEPTION 'channel_preferences.channel is immutable (preference %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."optedOutAt" IS NOT NULL AND NEW."optedOutAt" IS DISTINCT FROM OLD."optedOutAt" THEN
    RAISE EXCEPTION 'channel_preferences.optedOutAt is immutable once set (preference %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channel_preferences_immutable_trigger
  BEFORE UPDATE ON "channel_preferences"
  FOR EACH ROW
  EXECUTE FUNCTION channel_preferences_immutable_fn();

-- Coherence: contact same org as preference.
CREATE OR REPLACE FUNCTION channel_preferences_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  contact_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO contact_org_id
    FROM "contacts" WHERE "id" = NEW."contactId";
  IF contact_org_id IS NULL THEN
    RAISE EXCEPTION 'channel_preferences.contactId "%" does not resolve', NEW."contactId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF contact_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'channel_preferences: contact "%" belongs to org "%" but preference references org "%"',
      NEW."contactId", contact_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channel_preferences_coherence_trigger
  BEFORE INSERT ON "channel_preferences"
  FOR EACH ROW
  EXECUTE FUNCTION channel_preferences_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. orchestration_policies — org-level routing rules
-- ═══════════════════════════════════════════════════════════════
-- Per-tenant policy. Slice-2 lets operators author multiple policies
-- (e.g. "transactional", "marketing-promo", "winback") and pick one
-- per campaign. At most one default policy per org.
CREATE TABLE "orchestration_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Channel priority order. Array of channel strings — index 0 is
     * tried first. Per-contact override (channel_preferences.priority)
     * supersedes this. Validator ensures every entry is a known channel.
     */
    "channelPriority" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /**
     * Quiet-hours config JSON. Shape:
     *   { "timezone": "Europe/Warsaw",
     *     "windows": [
     *       { "dayOfWeek": "any" | 0..6, "from": "21:00", "to": "08:00" }
     *     ] }
     * "any" = applies every day of week. "from > to" wraps around midnight.
     * quiet-hours-checker.ts evaluates.
     */
    "quietHours" JSONB NOT NULL DEFAULT '{}',
    /**
     * Frequency-cap config JSON. Shape:
     *   { "perChannel": [
     *       { "channel": "email", "maxPerDay": 3, "maxPerWeek": 10 },
     *       { "channel": "sms",   "maxPerDay": 1 }
     *     ],
     *     "overall": { "maxPerDay": 5 } }
     * frequency-cap-checker.ts evaluates against delivery history.
     */
    "frequencyCaps" JSONB NOT NULL DEFAULT '{}',
    /**
     * Cross-channel dedup window in seconds. If a campaign already
     * delivered to contact via channel A within this window, don't
     * attempt channel B for the same campaign. Default 24h.
     */
    "dedupWindowSeconds" INTEGER NOT NULL DEFAULT 86400,
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft | active | archived
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Org-default policy — at most one per org (partial unique index). */
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orchestration_policies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orchestration_policies"
  ADD CONSTRAINT "orchestration_policies_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived'));

ALTER TABLE "orchestration_policies"
  ADD CONSTRAINT "orchestration_policies_dedup_window_check"
  CHECK ("dedupWindowSeconds" >= 0 AND "dedupWindowSeconds" <= 30 * 86400);

ALTER TABLE "orchestration_policies"
  ADD CONSTRAINT "orchestration_policies_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

-- channelPriority array entries must all be valid channels (architect
-- pass-1 suggestion — defense-in-depth so a corrupt write can't
-- silently widen the channel set). Empty array allowed.
ALTER TABLE "orchestration_policies"
  ADD CONSTRAINT "orchestration_policies_channel_priority_check"
  CHECK (
    "channelPriority" <@ ARRAY['email', 'sms', 'push', 'telegram', 'whatsapp', 'voice', 'postal']::TEXT[]
  );

CREATE UNIQUE INDEX "orchestration_policies_org_name_uniq"
  ON "orchestration_policies"("organizationId", "name");
CREATE UNIQUE INDEX "orchestration_policies_org_default_uniq"
  ON "orchestration_policies"("organizationId")
  WHERE "isDefault" = true;
CREATE INDEX "orchestration_policies_org_status_idx"
  ON "orchestration_policies"("organizationId", "status");

ALTER TABLE "orchestration_policies"
  ADD CONSTRAINT "orchestration_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status: draft → active|archived, active → archived, archived terminal.
CREATE OR REPLACE FUNCTION orchestration_policies_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'orchestration_policies.archivedAt is immutable once set (policy %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'orchestration_policies status: archived is terminal (policy %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'orchestration_policies status: draft → % is invalid (policy %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" <> 'archived' THEN
      RAISE EXCEPTION 'orchestration_policies status: active → % is invalid (policy %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orchestration_policies_lifecycle_trigger
  BEFORE UPDATE ON "orchestration_policies"
  FOR EACH ROW
  EXECUTE FUNCTION orchestration_policies_lifecycle_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. campaign_orchestration_runs — per-campaign-fire orchestration
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 worker inserts one row per orchestration pass. Captures
-- which policy was used, scope, counts, status.
CREATE TABLE "campaign_orchestration_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "policyId" TEXT,
    /**
     * Run lifecycle (DB CHECK + transition trigger):
     *   pending | running | succeeded | failed
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Trigger source (DB CHECK): cron | manual | api | webhook. */
    "triggerSource" TEXT NOT NULL DEFAULT 'manual',
    "contactsTotal" INTEGER NOT NULL DEFAULT 0,
    "deliveriesAttempted" INTEGER NOT NULL DEFAULT 0,
    /** Suppressed by quiet-hours window. */
    "deliveriesSuppressedByQuietHours" INTEGER NOT NULL DEFAULT 0,
    /** Suppressed by frequency-cap. */
    "deliveriesSuppressedByFrequencyCap" INTEGER NOT NULL DEFAULT 0,
    /** Skipped due to cross-channel dedup. */
    "deliveriesDeduped" INTEGER NOT NULL DEFAULT 0,
    /** No opted-in / preferred channel available. */
    "deliveriesNoChannelAvailable" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_orchestration_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_status_check"
  CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'));
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_trigger_check"
  CHECK ("triggerSource" IN ('cron', 'manual', 'api', 'webhook'));
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_counts_check"
  CHECK (
    "contactsTotal" >= 0
    AND "deliveriesAttempted" >= 0
    AND "deliveriesSuppressedByQuietHours" >= 0
    AND "deliveriesSuppressedByFrequencyCap" >= 0
    AND "deliveriesDeduped" >= 0
    AND "deliveriesNoChannelAvailable" >= 0
  );

-- Counts coherence: sum of (attempted + suppressed + deduped + nochannel)
-- should not exceed contactsTotal. Equal means full pass-through.
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_sum_bound_check"
  CHECK (
    "deliveriesAttempted" + "deliveriesSuppressedByQuietHours"
    + "deliveriesSuppressedByFrequencyCap" + "deliveriesDeduped"
    + "deliveriesNoChannelAvailable" <= "contactsTotal"
  );

-- Status-timestamp coherence
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_started_coherence_check"
  CHECK ("status" NOT IN ('running', 'succeeded', 'failed') OR "startedAt" IS NOT NULL);
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_ended_coherence_check"
  CHECK ("status" NOT IN ('succeeded', 'failed') OR "endedAt" IS NOT NULL);
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_failed_coherence_check"
  CHECK ("status" <> 'failed' OR "errorMessage" IS NOT NULL);

CREATE INDEX "campaign_orchestration_runs_org_status_idx"
  ON "campaign_orchestration_runs"("organizationId", "status");
CREATE INDEX "campaign_orchestration_runs_campaign_started_idx"
  ON "campaign_orchestration_runs"("campaignId", "startedAt");

ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_orchestration_runs"
  ADD CONSTRAINT "campaign_orchestration_runs_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "orchestration_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Status transitions: pending → running → succeeded|failed. pending may
-- jump to failed (queue rejection). campaignId + policyId + triggerSource
-- + timestamps immutable. metadata frozen once status reaches terminal.
CREATE OR REPLACE FUNCTION campaign_orchestration_runs_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."campaignId" IS DISTINCT FROM OLD."campaignId" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.campaignId is immutable (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- policyId is set-once-with-null-out (architect pass-1+2 close-out):
  -- re-pointing it after the worker starts running would invalidate the
  -- audit "which policy this run actually used". But the FK is `ON
  -- DELETE SET NULL`, so a policy deletion has to be allowed to cascade
  -- NULL — otherwise archived-policy cleanup wedges. So we forbid only
  -- non-NULL → different-non-NULL transitions; NULL-out via FK cascade
  -- is permitted.
  IF OLD."policyId" IS NOT NULL
     AND NEW."policyId" IS NOT NULL
     AND NEW."policyId" <> OLD."policyId" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.policyId is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- triggerSource is a set-once audit field (architect pass-1).
  IF NEW."triggerSource" IS DISTINCT FROM OLD."triggerSource" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.triggerSource is immutable (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.startedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.endedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- metadata frozen once status reaches a terminal state (architect
  -- pass-1: prevent retroactively rewriting run audit after the fact).
  -- During pending/running, the worker writes diagnostic context;
  -- after succeeded/failed, the row is historical record.
  IF OLD."status" IN ('succeeded', 'failed')
     AND NEW."metadata" IS DISTINCT FROM OLD."metadata" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.metadata is immutable after terminal status (run %, status %)', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" IN ('succeeded', 'failed') THEN
      RAISE EXCEPTION 'campaign_orchestration_runs status: % is terminal (run %)', OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'pending' AND NEW."status" NOT IN ('running', 'failed') THEN
      RAISE EXCEPTION 'campaign_orchestration_runs status: pending → % is invalid (run %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'running' AND NEW."status" NOT IN ('succeeded', 'failed') THEN
      RAISE EXCEPTION 'campaign_orchestration_runs status: running → % is invalid (run %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_orchestration_runs_lifecycle_trigger
  BEFORE UPDATE ON "campaign_orchestration_runs"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_orchestration_runs_lifecycle_fn();

-- Coherence: campaign + (policy if set) same org.
CREATE OR REPLACE FUNCTION campaign_orchestration_runs_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  campaign_org_id TEXT;
  policy_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO campaign_org_id
    FROM "campaigns" WHERE "id" = NEW."campaignId";
  IF campaign_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_orchestration_runs.campaignId "%" does not resolve', NEW."campaignId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF campaign_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_orchestration_runs: campaign "%" belongs to org "%" but run references org "%"',
      NEW."campaignId", campaign_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."policyId" IS NOT NULL THEN
    SELECT "organizationId" INTO policy_org_id
      FROM "orchestration_policies" WHERE "id" = NEW."policyId"
;
    IF policy_org_id IS NULL THEN
      RAISE EXCEPTION 'campaign_orchestration_runs.policyId "%" does not resolve', NEW."policyId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF policy_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'campaign_orchestration_runs: policy "%" belongs to org "%" but run references org "%"',
        NEW."policyId", policy_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_orchestration_runs_coherence_trigger
  BEFORE INSERT ON "campaign_orchestration_runs"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_orchestration_runs_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. orchestrated_deliveries — per-contact-per-run delivery decision
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 worker inserts one row per (run, contact) pair recording
-- the orchestration decision (which channel won + why other channels
-- were skipped). Append-only — decisions are historical fact.
CREATE TABLE "orchestrated_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    /**
     * The channel the orchestrator picked. NULL if outcome != 'attempted'
     * (no channel was picked because none were available / all suppressed).
     */
    "selectedChannel" TEXT,
    /**
     * Outcome (DB CHECK):
     *   attempted              — handed off to channel-specific sender
     *   no_channel_available   — contact has no opted-in channel or all
     *                            channels failed eligibility
     *   suppressed_quiet_hours — quiet-hours window blocks this contact
     *   suppressed_frequency_cap — frequency cap exceeded
     *   deduped                — same campaign hit contact via another
     *                            channel within dedupWindow
     */
    "outcome" TEXT NOT NULL,
    /**
     * The full priority chain the resolver computed for this contact,
     * before suppression rules applied. Useful for "why was X picked
     * over Y?" audit.
     */
    "channelChainResolved" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /**
     * Free-form reason text — slice-2 fills with diagnostic string
     * (e.g. "sms cap reached: 1/1 today", "telegram + email both in
     * quiet hours").
     */
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orchestrated_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_outcome_check"
  CHECK ("outcome" IN (
    'attempted', 'no_channel_available', 'suppressed_quiet_hours',
    'suppressed_frequency_cap', 'deduped'
  ));

ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_channel_check"
  CHECK (
    "selectedChannel" IS NULL
    OR "selectedChannel" IN ('email', 'sms', 'push', 'telegram', 'whatsapp', 'voice', 'postal')
  );

-- Outcome-channel coherence: attempted → channel NOT NULL; other → NULL.
ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_attempted_coherence_check"
  CHECK ("outcome" <> 'attempted' OR "selectedChannel" IS NOT NULL);
ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_nonattempted_coherence_check"
  CHECK ("outcome" = 'attempted' OR "selectedChannel" IS NULL);

-- One decision per (run, contact).
CREATE UNIQUE INDEX "orchestrated_deliveries_run_contact_uniq"
  ON "orchestrated_deliveries"("runId", "contactId");
CREATE INDEX "orchestrated_deliveries_org_campaign_decided_idx"
  ON "orchestrated_deliveries"("organizationId", "campaignId", "decidedAt");
CREATE INDEX "orchestrated_deliveries_org_contact_decided_idx"
  ON "orchestrated_deliveries"("organizationId", "contactId", "decidedAt");
CREATE INDEX "orchestrated_deliveries_org_outcome_idx"
  ON "orchestrated_deliveries"("organizationId", "outcome");

ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "campaign_orchestration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrated_deliveries"
  ADD CONSTRAINT "orchestrated_deliveries_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: orchestration decisions are historical fact.
CREATE OR REPLACE FUNCTION orchestrated_deliveries_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'orchestrated_deliveries is append-only (delivery % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orchestrated_deliveries_append_only_trigger
  BEFORE UPDATE ON "orchestrated_deliveries"
  FOR EACH ROW
  EXECUTE FUNCTION orchestrated_deliveries_append_only_fn();

-- Coherence: run + contact + campaign all same org; run.campaignId
-- matches delivery.campaignId (slice-2 worker enforces but trigger
-- guards data integrity at DB level).
CREATE OR REPLACE FUNCTION orchestrated_deliveries_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  run_org_id TEXT;
  run_campaign_id TEXT;
  contact_org_id TEXT;
  campaign_org_id TEXT;
BEGIN
  SELECT "organizationId", "campaignId" INTO run_org_id, run_campaign_id
    FROM "campaign_orchestration_runs" WHERE "id" = NEW."runId";
  IF run_org_id IS NULL THEN
    RAISE EXCEPTION 'orchestrated_deliveries.runId "%" does not resolve', NEW."runId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF run_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'orchestrated_deliveries: run "%" belongs to org "%" but delivery references org "%"',
      NEW."runId", run_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF run_campaign_id <> NEW."campaignId" THEN
    RAISE EXCEPTION 'orchestrated_deliveries: run "%" is for campaign "%" but delivery references campaign "%"',
      NEW."runId", run_campaign_id, NEW."campaignId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO contact_org_id
    FROM "contacts" WHERE "id" = NEW."contactId";
  IF contact_org_id IS NULL OR contact_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'orchestrated_deliveries: contact "%" does not resolve or org mismatch', NEW."contactId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO campaign_org_id
    FROM "campaigns" WHERE "id" = NEW."campaignId";
  IF campaign_org_id IS NULL OR campaign_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'orchestrated_deliveries: campaign "%" does not resolve or org mismatch', NEW."campaignId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orchestrated_deliveries_coherence_trigger
  BEFORE INSERT ON "orchestrated_deliveries"
  FOR EACH ROW
  EXECUTE FUNCTION orchestrated_deliveries_coherence_fn();
