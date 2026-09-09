-- A12: Revenue Intelligence (Phase 1 / Sales Cloud).
--
-- Salesforce Revenue Intelligence analogue. Three measurement loops on
-- top of existing Deal + Pipeline tables:
--
--   1. Forecast accuracy — point-in-time snapshots vs. actual revenue
--      (was the Monday committed-$ accurate by Friday end-of-quarter?).
--   2. Pipeline waterfall — every stage transition as an append-only
--      event so "what changed since last week" is queryable.
--   3. Deal velocity — per (pipeline, stage) duration percentiles +
--      bottleneck detection (deals that sit too long).
--
-- Slice-1 ships schema + 5 pure helpers (types + forecast-snapshot-builder
-- + waterfall-analyzer + velocity-aggregator + forecast-accuracy-calculator).
-- NO cron runtime — slice-2 wires the weekly snapshot cron, transition
-- ingestion (hook into existing Deal stage-change), velocity recompute cron.
--
-- Slice-2 wires:
--   • Snapshot cron (default: Monday 09:00 org TZ; configurable).
--   • Stage-transition hook on Deal update (server-side middleware).
--   • Velocity recompute cron (nightly, last-30/90/180-day windows).
--   • Forecast accuracy recompute (close-of-period + after-close audits).
--   • Admin UI dashboards (Revenue Intelligence tab).
-- Slice-3 wires:
--   • AI commentary on forecast variance (Claude summarizes "why").
--   • Predicted-velocity model (slice-2 historical → forward-looking).
--   • Coaching nudges (deals stalled past p90 → notify rep + manager).

-- ═══════════════════════════════════════════════════════════════
-- 1. forecast_snapshots — point-in-time forecast capture
-- ═══════════════════════════════════════════════════════════════
-- Each row = one snapshot at a point in time, scoped to org or a
-- specific pipeline or a specific rep. Slice-2 cron inserts weekly;
-- admins can also trigger ad-hoc captures via UI.
CREATE TABLE "forecast_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /**
     * Scope discriminator (DB CHECK):
     *   org      — whole org (scopeRef NULL)
     *   pipeline — single pipeline (scopeRef = pipelineId)
     *   user     — single rep (scopeRef = userId)
     */
    "scope" TEXT NOT NULL,
    /** Target id when scope != 'org'; NULL when scope = 'org'. */
    "scopeRef" TEXT,
    /** Forecast period start/end (e.g. quarter). */
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    /**
     * Committed bucket: deals at "high confidence" stages (won/closed +
     * verbal-commit / contract-sent) weighted at 100%. Slice-1 builder
     * uses a stage-probability map; slice-2 admin UI configurable.
     */
    "committedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /**
     * Best-case: committed + "strong-possibility" stages (>= 70%).
     */
    "bestCaseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /**
     * Probability-weighted forecast: sum of (deal.amount * stage.probability).
     */
    "forecastAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /** Counts for fast dashboard rendering. */
    "dealsCommitted" INTEGER NOT NULL DEFAULT 0,
    "dealsBestCase" INTEGER NOT NULL DEFAULT 0,
    "dealsTotal" INTEGER NOT NULL DEFAULT 0,
    /** Reporting currency. */
    "currency" TEXT NOT NULL DEFAULT 'USD',
    /** Who triggered the snapshot (slice-2 cron sets to NULL). */
    "capturedBy" TEXT,
    /** Free-form context (cron trigger id, ad-hoc reason, etc.). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forecast_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_scope_check"
  CHECK ("scope" IN ('org', 'pipeline', 'user'));

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_scope_ref_coherence_check"
  CHECK (
    ("scope" = 'org' AND "scopeRef" IS NULL)
    OR ("scope" IN ('pipeline', 'user') AND "scopeRef" IS NOT NULL)
  );

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_period_check"
  CHECK ("periodStart" < "periodEnd");

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_amounts_check"
  CHECK (
    "committedAmount" >= 0
    AND "bestCaseAmount" >= 0
    AND "forecastAmount" >= 0
  );

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_counts_check"
  CHECK (
    "dealsCommitted" >= 0
    AND "dealsBestCase" >= 0
    AND "dealsTotal" >= 0
    AND "dealsCommitted" <= "dealsBestCase"
    AND "dealsBestCase" <= "dealsTotal"
  );

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_bestcase_dominates_committed_check"
  CHECK ("bestCaseAmount" >= "committedAmount");

CREATE INDEX "forecast_snapshots_org_date_idx"
  ON "forecast_snapshots"("organizationId", "snapshotDate");
CREATE INDEX "forecast_snapshots_org_scope_idx"
  ON "forecast_snapshots"("organizationId", "scope", "scopeRef");
CREATE INDEX "forecast_snapshots_period_idx"
  ON "forecast_snapshots"("organizationId", "periodStart", "periodEnd");

ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Architect pass-1 fix: capturedBy is FK to users (was bare TEXT with
-- cross-tenant gap). ON DELETE SET NULL so user-deletion doesn't tank
-- audit; the snapshot's organizationId remains.
ALTER TABLE "forecast_snapshots"
  ADD CONSTRAINT "forecast_snapshots_capturedBy_fkey"
  FOREIGN KEY ("capturedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cross-table coherence: capturedBy (if set) belongs to same org.
-- Architect pass-1 fix — the original schema only enforced FK at write
-- time without org-match, so an admin in org A could reference a user
-- in org B as the captureBy actor.
CREATE OR REPLACE FUNCTION forecast_snapshots_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  user_org_id TEXT;
BEGIN
  IF NEW."capturedBy" IS NOT NULL THEN
    SELECT "organizationId" INTO user_org_id
      FROM "users" WHERE "id" = NEW."capturedBy";
    IF user_org_id IS NULL THEN
      RAISE EXCEPTION 'forecast_snapshots.capturedBy "%" does not resolve', NEW."capturedBy"
        USING ERRCODE = 'check_violation';
    END IF;
    IF user_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'forecast_snapshots: capturedBy "%" belongs to org "%" but snapshot references org "%"',
        NEW."capturedBy", user_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forecast_snapshots_coherence_trigger
  BEFORE INSERT ON "forecast_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_snapshots_coherence_fn();

-- Append-only — snapshots are historical fact.
CREATE OR REPLACE FUNCTION forecast_snapshots_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'forecast_snapshots is append-only (snapshot % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forecast_snapshots_append_only_trigger
  BEFORE UPDATE ON "forecast_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_snapshots_append_only_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. pipeline_stage_transitions — append-only stage-change log
-- ═══════════════════════════════════════════════════════════════
-- Each row = one Deal stage change. Slice-2 stage-change hook inserts;
-- waterfall-analyzer reads to bucket (created/upgraded/downgraded/won/
-- lost/stalled). Decoupled from existing AuditLog so domain queries
-- don't have to scan the firehose audit table.
CREATE TABLE "pipeline_stage_transitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "pipelineId" TEXT,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    /** Deal amount AT transition time (denormalized — deals get re-priced). */
    "fromAmount" DOUBLE PRECISION,
    "toAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "transitionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /**
     * Why-tag (DB CHECK):
     *   created      — deal first entered a stage (fromStage NULL)
     *   advanced     — moved forward toward won (probability up)
     *   regressed    — moved back to earlier stage (probability down)
     *   won          — closed-won terminal
     *   lost         — closed-lost terminal
     *   reopened     — closed → open again
     *   reassigned   — stage stable, ownership changed (still tracked)
     */
    "transitionType" TEXT NOT NULL,
    /** Optional freeform reason ("competitor", "budget cut", etc.). */
    "reason" TEXT,
    /** Who made the change (NULL = system / cron). */
    "actorUserId" TEXT,
    /**
     * How long the deal sat in fromStage before this transition.
     * Useful for waterfall + velocity. NULL when fromStage is NULL.
     */
    "durationInPrevStageSeconds" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipeline_stage_transitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_type_check"
  CHECK ("transitionType" IN ('created', 'advanced', 'regressed', 'won', 'lost', 'reopened', 'reassigned'));

ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_amounts_check"
  CHECK (
    ("fromAmount" IS NULL OR "fromAmount" >= 0)
    AND "toAmount" >= 0
  );

-- Created-vs-non-created coherence (architect pass-1 tightening):
--   created   → fromStage / fromAmount / durationInPrevStageSeconds ALL NULL
--   non-created → fromStage NOT NULL AND fromAmount NOT NULL
-- Without the fromAmount-NOT-NULL clause for non-created, slice-2
-- ingestion could conflate non-created transitions with created
-- semantics in waterfall-analyzer (toAmount - 0 = toAmount, same as
-- created delta).
ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_created_coherence_check"
  CHECK (
    ("transitionType" = 'created' AND "fromStage" IS NULL AND "fromAmount" IS NULL AND "durationInPrevStageSeconds" IS NULL)
    OR ("transitionType" <> 'created' AND "fromStage" IS NOT NULL AND "fromAmount" IS NOT NULL)
  );

ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_duration_check"
  CHECK ("durationInPrevStageSeconds" IS NULL OR "durationInPrevStageSeconds" >= 0);

CREATE INDEX "pipeline_stage_transitions_org_deal_idx"
  ON "pipeline_stage_transitions"("organizationId", "dealId", "transitionedAt");
CREATE INDEX "pipeline_stage_transitions_org_pipeline_idx"
  ON "pipeline_stage_transitions"("organizationId", "pipelineId", "transitionedAt")
  WHERE "pipelineId" IS NOT NULL;
CREATE INDEX "pipeline_stage_transitions_org_type_idx"
  ON "pipeline_stage_transitions"("organizationId", "transitionType", "transitionedAt");

ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pipeline_stage_transitions"
  ADD CONSTRAINT "pipeline_stage_transitions_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only.
CREATE OR REPLACE FUNCTION pipeline_stage_transitions_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'pipeline_stage_transitions is append-only (transition % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pipeline_stage_transitions_append_only_trigger
  BEFORE UPDATE ON "pipeline_stage_transitions"
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_stage_transitions_append_only_fn();

-- Cross-table coherence — deal + (pipeline if set) + (actor if set) same org.
CREATE OR REPLACE FUNCTION pipeline_stage_transitions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  deal_org_id TEXT;
  pipeline_org_id TEXT;
  actor_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO deal_org_id
    FROM "deals" WHERE "id" = NEW."dealId";
  IF deal_org_id IS NULL THEN
    RAISE EXCEPTION 'pipeline_stage_transitions.dealId "%" does not resolve', NEW."dealId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF deal_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'pipeline_stage_transitions: deal "%" belongs to org "%" but transition references org "%"',
      NEW."dealId", deal_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."pipelineId" IS NOT NULL THEN
    SELECT "organizationId" INTO pipeline_org_id
      FROM "pipelines" WHERE "id" = NEW."pipelineId";
    IF pipeline_org_id IS NULL THEN
      RAISE EXCEPTION 'pipeline_stage_transitions.pipelineId "%" does not resolve', NEW."pipelineId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF pipeline_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'pipeline_stage_transitions: pipeline "%" belongs to org "%" but transition references org "%"',
        NEW."pipelineId", pipeline_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."actorUserId" IS NOT NULL THEN
    SELECT "organizationId" INTO actor_org_id
      FROM "users" WHERE "id" = NEW."actorUserId";
    IF actor_org_id IS NULL THEN
      RAISE EXCEPTION 'pipeline_stage_transitions.actorUserId "%" does not resolve', NEW."actorUserId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF actor_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'pipeline_stage_transitions: actor "%" belongs to org "%" but transition references org "%"',
        NEW."actorUserId", actor_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pipeline_stage_transitions_coherence_trigger
  BEFORE INSERT ON "pipeline_stage_transitions"
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_stage_transitions_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. deal_velocity_metrics — aggregated stage-duration percentiles
-- ═══════════════════════════════════════════════════════════════
-- Per (pipeline, stage, period) — slice-2 nightly cron recomputes
-- avg/p50/p90 from pipeline_stage_transitions over a rolling window
-- (last-30/90/180 days). One row per (pipeline, stage, periodKey).
CREATE TABLE "deal_velocity_metrics" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    /**
     * Period bucket (DB CHECK):
     *   last_30d | last_90d | last_180d | last_365d
     * Slice-1 fixed set; slice-2 may add custom windows.
     */
    "periodKey" TEXT NOT NULL,
    /** Wall-clock window the metric covers (informational). */
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    /** Counts. */
    "dealsEntered" INTEGER NOT NULL DEFAULT 0,
    "dealsExited" INTEGER NOT NULL DEFAULT 0,
    "dealsAdvanced" INTEGER NOT NULL DEFAULT 0,
    "dealsRegressed" INTEGER NOT NULL DEFAULT 0,
    "dealsLost" INTEGER NOT NULL DEFAULT 0,
    "dealsWon" INTEGER NOT NULL DEFAULT 0,
    /**
     * Stage-duration percentiles (seconds, INTEGER for indexability).
     * NULL when no exited deals in the window (insufficient data).
     */
    "avgDurationSeconds" INTEGER,
    "p50DurationSeconds" INTEGER,
    "p90DurationSeconds" INTEGER,
    /** Forward-conversion: % of entered deals that advanced. */
    "conversionRate" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deal_velocity_metrics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_period_key_check"
  CHECK ("periodKey" IN ('last_30d', 'last_90d', 'last_180d', 'last_365d'));

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_period_range_check"
  CHECK ("periodStart" < "periodEnd");

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_counts_check"
  CHECK (
    "dealsEntered" >= 0
    AND "dealsExited" >= 0
    AND "dealsAdvanced" >= 0
    AND "dealsRegressed" >= 0
    AND "dealsLost" >= 0
    AND "dealsWon" >= 0
    AND "dealsExited" >= "dealsAdvanced" + "dealsRegressed" + "dealsLost" + "dealsWon"
  );

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_durations_check"
  CHECK (
    ("avgDurationSeconds" IS NULL OR "avgDurationSeconds" >= 0)
    AND ("p50DurationSeconds" IS NULL OR "p50DurationSeconds" >= 0)
    AND ("p90DurationSeconds" IS NULL OR "p90DurationSeconds" >= 0)
  );

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_percentile_ordering_check"
  CHECK (
    ("p50DurationSeconds" IS NULL OR "p90DurationSeconds" IS NULL
     OR "p50DurationSeconds" <= "p90DurationSeconds")
  );

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_conversion_rate_check"
  CHECK ("conversionRate" IS NULL OR ("conversionRate" >= 0 AND "conversionRate" <= 1));

CREATE UNIQUE INDEX "deal_velocity_metrics_unique_idx"
  ON "deal_velocity_metrics"("pipelineId", "stage", "periodKey");
CREATE INDEX "deal_velocity_metrics_org_pipeline_idx"
  ON "deal_velocity_metrics"("organizationId", "pipelineId", "periodKey");
CREATE INDEX "deal_velocity_metrics_org_computed_idx"
  ON "deal_velocity_metrics"("organizationId", "computedAt");

ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_velocity_metrics"
  ADD CONSTRAINT "deal_velocity_metrics_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Identifier immutability — (pipelineId, stage, periodKey) is natural key.
CREATE OR REPLACE FUNCTION deal_velocity_metrics_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."pipelineId" IS DISTINCT FROM OLD."pipelineId" THEN
    RAISE EXCEPTION 'deal_velocity_metrics.pipelineId is immutable (metric %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."stage" IS DISTINCT FROM OLD."stage" THEN
    RAISE EXCEPTION 'deal_velocity_metrics.stage is immutable (metric %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."periodKey" IS DISTINCT FROM OLD."periodKey" THEN
    RAISE EXCEPTION 'deal_velocity_metrics.periodKey is immutable (metric %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deal_velocity_metrics_immutable_trigger
  BEFORE UPDATE ON "deal_velocity_metrics"
  FOR EACH ROW
  EXECUTE FUNCTION deal_velocity_metrics_immutable_fn();

-- Coherence — pipeline same org.
CREATE OR REPLACE FUNCTION deal_velocity_metrics_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  pipeline_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO pipeline_org_id
    FROM "pipelines" WHERE "id" = NEW."pipelineId";
  IF pipeline_org_id IS NULL THEN
    RAISE EXCEPTION 'deal_velocity_metrics.pipelineId "%" does not resolve', NEW."pipelineId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF pipeline_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'deal_velocity_metrics: pipeline "%" belongs to org "%" but metric references org "%"',
      NEW."pipelineId", pipeline_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deal_velocity_metrics_coherence_trigger
  BEFORE INSERT ON "deal_velocity_metrics"
  FOR EACH ROW
  EXECUTE FUNCTION deal_velocity_metrics_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. forecast_accuracy_reports — actual vs snapshot variance
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 computes one row per (snapshot, periodEnd-or-after) when the
-- period closes — comparing the forecasted amounts vs what actually
-- closed in won deals. Append-only audit.
CREATE TABLE "forecast_accuracy_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    /**
     * "Actual" — sum of deal.amount for won deals closed within the
     * snapshot's period, in the snapshot's scope.
     */
    "actualAmount" DOUBLE PRECISION NOT NULL,
    /** Re-read at compute time — guards against snapshot row tamper (it's append-only but defense-in-depth). */
    "forecastedAmount" DOUBLE PRECISION NOT NULL,
    "committedAmount" DOUBLE PRECISION NOT NULL,
    "bestCaseAmount" DOUBLE PRECISION NOT NULL,
    /**
     * Variance metrics (actual - forecastedAmount). Positive = over-
     * delivered. Negative = under-delivered.
     */
    "varianceAbsForecast" DOUBLE PRECISION NOT NULL,
    "varianceAbsCommitted" DOUBLE PRECISION NOT NULL,
    "varianceAbsBestCase" DOUBLE PRECISION NOT NULL,
    /** Variance as % of forecast (0.05 = 5% over; -0.10 = 10% under). */
    "variancePctForecast" DOUBLE PRECISION,
    "variancePctCommitted" DOUBLE PRECISION,
    "variancePctBestCase" DOUBLE PRECISION,
    /**
     * Accuracy classification (DB CHECK):
     *   accurate        — within ±5% of forecast
     *   over_delivered  — > +5% of forecast (sandbagged)
     *   under_delivered — < -5% of forecast (missed)
     *   unknown         — insufficient data (forecast was 0)
     */
    "accuracyClass" TEXT NOT NULL DEFAULT 'unknown',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forecast_accuracy_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "forecast_accuracy_reports"
  ADD CONSTRAINT "forecast_accuracy_reports_actual_check"
  CHECK ("actualAmount" >= 0);

ALTER TABLE "forecast_accuracy_reports"
  ADD CONSTRAINT "forecast_accuracy_reports_accuracy_class_check"
  CHECK ("accuracyClass" IN ('accurate', 'over_delivered', 'under_delivered', 'unknown'));

-- One report per snapshot — re-computes update via DELETE+INSERT.
CREATE UNIQUE INDEX "forecast_accuracy_reports_snapshot_uniq_idx"
  ON "forecast_accuracy_reports"("snapshotId");
CREATE INDEX "forecast_accuracy_reports_org_class_idx"
  ON "forecast_accuracy_reports"("organizationId", "accuracyClass", "computedAt");
CREATE INDEX "forecast_accuracy_reports_org_computed_idx"
  ON "forecast_accuracy_reports"("organizationId", "computedAt");

ALTER TABLE "forecast_accuracy_reports"
  ADD CONSTRAINT "forecast_accuracy_reports_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forecast_accuracy_reports"
  ADD CONSTRAINT "forecast_accuracy_reports_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "forecast_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only.
CREATE OR REPLACE FUNCTION forecast_accuracy_reports_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'forecast_accuracy_reports is append-only (report % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forecast_accuracy_reports_append_only_trigger
  BEFORE UPDATE ON "forecast_accuracy_reports"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_accuracy_reports_append_only_fn();

-- Coherence — snapshot same org.
CREATE OR REPLACE FUNCTION forecast_accuracy_reports_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO snapshot_org_id
    FROM "forecast_snapshots" WHERE "id" = NEW."snapshotId";
  IF snapshot_org_id IS NULL THEN
    RAISE EXCEPTION 'forecast_accuracy_reports.snapshotId "%" does not resolve', NEW."snapshotId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF snapshot_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'forecast_accuracy_reports: snapshot "%" belongs to org "%" but report references org "%"',
      NEW."snapshotId", snapshot_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forecast_accuracy_reports_coherence_trigger
  BEFORE INSERT ON "forecast_accuracy_reports"
  FOR EACH ROW
  EXECUTE FUNCTION forecast_accuracy_reports_coherence_fn();
