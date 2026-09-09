-- G5: Segment Activation (Phase 6 Block B deferred item — final Phase 6 slice).
--
-- Salesforce Data Cloud Activation analogue. Bridges G4 DataCloudSegment
-- ↔ external destinations (C3 AdAudienceSync for FB/Google/LinkedIn,
-- C2 MobileCampaign for push/SMS, slice-2 email-campaign for marketing
-- email).
--
-- Was deferred from Block B because it depended on C3 Advertising
-- Studio for the audience-sync infrastructure. With C3 ✅ merged
-- (PR #20, commit 890cc85d), G5 unblocks.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine + member-diff
-- + target-router + schedule-evaluator + types). NO actual dispatch
-- to external APIs (slice-2 wires the runtime that calls C3's
-- audience-payload-builder + C2's dispatchers).
--
-- Slice 2 wires:
--   • Activation cron worker: walks active activations, computes diff,
--     dispatches via target-specific helper.
--   • Admin UI for activation authoring + run history.
--   • Cross-target rollup reporting.
-- Slice 3 wires:
--   • Real-time activation via G6 event stream (deferred from Block B).
--   • Email-campaign target (slice-2 + email-campaign module).
--   • Smart-scheduling: pause activations on quiet-hour windows
--     (reuse C2 delivery-scheduler).

-- ── SegmentActivation ──────────────────────────────────────────
-- Per (segment, target) activation config. One row maps a G4 segment
-- to a destination (C3 audience sync, C2 mobile campaign, or future
-- email/webhook). The segmentRef + targetType + targetId tuple is
-- the unique key — re-activation reuses the same row.
CREATE TABLE "segment_activations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Source segment reference. Slice-1: `dataCloudSegment_<id>` opaque string. */
    "segmentRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /**
     * Target type (DB CHECK):
     *   ad_audience_sync  — sync to C3 AdAudienceSync row (FB/Google/etc.)
     *   mobile_campaign   — enroll into C2 MobileCampaign audience
     *   email_campaign    — slice-2 marketing email module
     *   webhook           — slice-2 generic HTTP delivery
     */
    "targetType" TEXT NOT NULL,
    /** Target-table-specific id; soft FK because target tables are diverse. */
    "targetId" TEXT NOT NULL,
    /**
     * Lifecycle (DB CHECK):
     *   draft     — being authored
     *   active    — cron evaluates schedule + dispatches
     *   paused    — temporarily off; cron skips
     *   archived  — terminal; preserved for audit
     *   error     — last run failed; auto-recovers to active on next success
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /**
     * Cron-style schedule string (`0 3 * * *` = nightly 3am).
     * NULL = manual-only (admin triggers via "Run Now" button slice-2).
     * Slice-1 schedule-evaluator parses + decides next run.
     */
    "schedule" TEXT,
    /** Snapshot of last successful run end time. */
    "lastSuccessAt" TIMESTAMP(3),
    /** Last run end (whether success or fail). */
    "lastRunAt" TIMESTAMP(3),
    /** Set on transition to error. */
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    /** Set on transition to archived. */
    "archivedAt" TIMESTAMP(3),
    /**
     * Membership snapshot at last successful run — list of member ids
     * the slice-2 worker dispatched. Diff calculator takes prev/current
     * sets to compute adds + removes.
     */
    "lastMemberCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segment_activations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_target_type_check"
  CHECK ("targetType" IN ('ad_audience_sync', 'mobile_campaign', 'email_campaign', 'webhook'));

ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_status_check"
  CHECK ("status" IN ('draft', 'active', 'paused', 'archived', 'error'));

ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_member_count_check"
  CHECK ("lastMemberCount" >= 0);

-- Coherence
ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_error_coherence_check"
  CHECK ("status" <> 'error' OR ("lastErrorAt" IS NOT NULL AND "lastErrorMessage" IS NOT NULL));
ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "segment_activations_org_segment_target_uniq"
  ON "segment_activations"("organizationId", "segmentRef", "targetType", "targetId");
CREATE INDEX "segment_activations_org_status_idx"
  ON "segment_activations"("organizationId", "status");
CREATE INDEX "segment_activations_org_last_run_idx"
  ON "segment_activations"("organizationId", "lastRunAt");

ALTER TABLE "segment_activations"
  ADD CONSTRAINT "segment_activations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- archivedAt immutable once set (IS DISTINCT FROM — N2 lesson).
-- Intentionally MUTABLE (advance each run/success): lastRunAt,
-- lastSuccessAt, lastErrorAt, lastErrorMessage, lastMemberCount.
-- These are "high-water mark" fields the slice-2 worker bumps; locking
-- them would break the activation lifecycle. Architect-pass-1 close-out:
-- comment was misleading (said "archivedAt + lastSuccessAt" but only
-- archivedAt was protected). Fixed semantic — lastSuccessAt stays mutable.
CREATE OR REPLACE FUNCTION segment_activations_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'segment_activations.archivedAt is immutable once set (activation %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER segment_activations_timestamps_immutable_trigger
  BEFORE UPDATE ON "segment_activations"
  FOR EACH ROW
  EXECUTE FUNCTION segment_activations_timestamps_immutable_fn();

-- ── SegmentActivationRun ───────────────────────────────────────
-- Per-execution audit. Slice-2 worker inserts one row per activation
-- fire (cron-triggered or manual). Captures member counts + diff +
-- status + outcome.
CREATE TABLE "segment_activation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    /**
     * Run lifecycle (DB CHECK):
     *   pending   — queued
     *   running   — dispatcher in flight
     *   succeeded — completed without error
     *   failed    — hit a hard error mid-run
     *   skipped   — eligibility check failed (paused / no diff / etc.)
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Trigger source (DB CHECK): cron | manual | api. */
    "triggerSource" TEXT NOT NULL DEFAULT 'cron',
    /** Member counts captured at run time. */
    "membersTotal" INTEGER NOT NULL DEFAULT 0,
    "membersAdded" INTEGER NOT NULL DEFAULT 0,
    "membersRemoved" INTEGER NOT NULL DEFAULT 0,
    /** Set on transition to running. */
    "startedAt" TIMESTAMP(3),
    /** Set on transition to succeeded/failed/skipped. */
    "endedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    /** Slice-2 worker fills with target-specific receipts. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segment_activation_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_status_check"
  CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'skipped'));

ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_trigger_check"
  CHECK ("triggerSource" IN ('cron', 'manual', 'api'));

ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_members_check"
  CHECK (
    "membersTotal" >= 0 AND "membersAdded" >= 0 AND "membersRemoved" >= 0
  );

-- Status-timestamp coherence
ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_started_coherence_check"
  CHECK ("status" NOT IN ('running', 'succeeded', 'failed', 'skipped') OR "startedAt" IS NOT NULL);
ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_ended_coherence_check"
  CHECK (
    "status" NOT IN ('succeeded', 'failed', 'skipped')
    OR "endedAt" IS NOT NULL
  );
ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_failed_coherence_check"
  CHECK ("status" <> 'failed' OR "errorMessage" IS NOT NULL);

CREATE INDEX "segment_activation_runs_activation_started_idx"
  ON "segment_activation_runs"("activationId", "startedAt");
CREATE INDEX "segment_activation_runs_org_status_idx"
  ON "segment_activation_runs"("organizationId", "status");
CREATE INDEX "segment_activation_runs_org_started_idx"
  ON "segment_activation_runs"("organizationId", "startedAt");

ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segment_activation_runs"
  ADD CONSTRAINT "segment_activation_runs_activationId_fkey"
  FOREIGN KEY ("activationId") REFERENCES "segment_activations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Run timestamps immutable once set.
CREATE OR REPLACE FUNCTION segment_activation_runs_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'segment_activation_runs.startedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'segment_activation_runs.endedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER segment_activation_runs_timestamps_immutable_trigger
  BEFORE UPDATE ON "segment_activation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION segment_activation_runs_timestamps_immutable_fn();

-- Cross-table coherence: run.organizationId MUST match parent
-- activation.organizationId (multi-tenant defense). Mirrors C2/C4
-- coherence-trigger pattern.
CREATE OR REPLACE FUNCTION segment_activation_runs_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  activation_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO activation_org_id
    FROM "segment_activations"
    WHERE "id" = NEW."activationId";
  IF activation_org_id IS NULL THEN
    RAISE EXCEPTION 'segment_activation_runs.activationId "%" does not resolve',
      NEW."activationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF activation_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'segment_activation_runs: activation "%" belongs to org "%" but run references org "%"',
      NEW."activationId", activation_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER segment_activation_runs_coherence_trigger
  BEFORE INSERT OR UPDATE ON "segment_activation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION segment_activation_runs_coherence_fn();
