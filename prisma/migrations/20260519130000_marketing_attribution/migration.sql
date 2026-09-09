-- C9: Marketing Attribution (Phase 6 Block A — multi-touch attribution).
--
-- Salesforce Campaign Influence analogue. Given a deal that closed, the
-- attribution engine looks at the contact's touchpoint history (which
-- campaigns interacted with the contact across all channels) and assigns
-- revenue credit per campaign using one of five canonical attribution
-- models:
--   • first_touch — 100% credit to the earliest touchpoint
--   • last_touch  — 100% credit to the latest touchpoint
--   • linear      — equal credit (1/N) across all touchpoints
--   • time_decay  — exponential weighting toward conversion time
--   • u_shaped    — 40% first + 40% last + 20% spread across middle
--
-- Slice-1 ships schema + 5 pure helpers (types + model-evaluator +
-- touchpoint-aggregator + revenue-allocator + model-config-validator).
-- NO recomputation runtime — slice-2 wires the cron worker that walks
-- closed-won deals + their touchpoint chains + writes campaign_influences.
--
-- Slice-2 wires:
--   • Touchpoint ingestion adapter (from EmailLog, ContactEvent, page
--     views, ad clicks, campaign enrollments).
--   • Cron worker: on deal closed-won, recompute influences for active
--     models.
--   • Admin UI: model authoring + influence reports per campaign.
-- Slice-3 wires:
--   • Custom model authoring (user-defined weight curves).
--   • Real-time recomputation via G6 event stream (when deal stage
--     changes).
--   • Cross-deal pipeline-influenced reports (total pipeline $$ touched
--     by campaign X).

-- ═══════════════════════════════════════════════════════════════
-- 1. attribution_models — model definitions
-- ═══════════════════════════════════════════════════════════════
-- Per-org canonical attribution models. Slice-1 ships the five canonical
-- types; slice-3 adds user-defined types via the `config` JSONB.
CREATE TABLE "attribution_models" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Model type (DB CHECK):
     *   first_touch | last_touch | linear | time_decay | u_shaped | custom
     * "custom" reserved for slice-3 user-defined curves.
     */
    "modelType" TEXT NOT NULL,
    /**
     * Per-model knobs. Shape varies by modelType:
     *   first_touch / last_touch / linear — empty object.
     *   time_decay — { halfLifeDays: number }
     *   u_shaped   — { firstWeight: number, lastWeight: number,
     *                  middleWeight: number } (must sum to 1.0)
     *   custom     — { curve: [{ position: number, weight: number }, ...] }
     */
    "config" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft     — being authored
     *   active    — used by slice-2 cron worker
     *   archived  — terminal; preserved for audit on historical influences
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /**
     * Marks the org's default model — slice-2 UI defaults to this for
     * report views. NULL = no default selected. Unique-per-org (partial
     * index enforces).
     */
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attribution_models_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "attribution_models"
  ADD CONSTRAINT "attribution_models_type_check"
  CHECK ("modelType" IN ('first_touch', 'last_touch', 'linear', 'time_decay', 'u_shaped', 'custom'));

ALTER TABLE "attribution_models"
  ADD CONSTRAINT "attribution_models_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived'));

ALTER TABLE "attribution_models"
  ADD CONSTRAINT "attribution_models_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "attribution_models_org_name_uniq"
  ON "attribution_models"("organizationId", "name");
-- At most one default per org.
CREATE UNIQUE INDEX "attribution_models_org_default_uniq"
  ON "attribution_models"("organizationId")
  WHERE "isDefault" = true;
CREATE INDEX "attribution_models_org_status_idx"
  ON "attribution_models"("organizationId", "status");

ALTER TABLE "attribution_models"
  ADD CONSTRAINT "attribution_models_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status transitions: draft → active|archived, active → archived,
-- archived terminal. modelType + archivedAt immutable once set.
CREATE OR REPLACE FUNCTION attribution_models_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- modelType immutable (changing type would invalidate historical
  -- influence rows).
  IF NEW."modelType" IS DISTINCT FROM OLD."modelType" THEN
    RAISE EXCEPTION 'attribution_models.modelType is immutable (model %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- archivedAt set once.
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'attribution_models.archivedAt is immutable once set (model %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Status transitions.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'attribution_models status: archived is terminal (model %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'attribution_models status: draft → % is invalid (model %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('archived') THEN
      RAISE EXCEPTION 'attribution_models status: active → % is invalid (model %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attribution_models_lifecycle_trigger
  BEFORE UPDATE ON "attribution_models"
  FOR EACH ROW
  EXECUTE FUNCTION attribution_models_lifecycle_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. campaign_touchpoints — append-only interaction log
-- ═══════════════════════════════════════════════════════════════
-- Each row = one contact × campaign interaction (email opened, link
-- clicked, ad served, landing-page view, form submit, etc.). Slice-2
-- ingestion adapter writes these from various sources. Slice-1 just
-- defines the contract.
--
-- IMMUTABILITY: append-only. The historical record is what attribution
-- depends on; mutating it would invalidate computed influences.
CREATE TABLE "campaign_touchpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    /**
     * Optional opportunity ref — if the touchpoint is provably linked
     * to a specific deal (via attribution session, UTM, or post-conversion
     * linking). NULL = "general contact touchpoint" — aggregator
     * decides relevance per-deal via timeline overlap.
     */
    "dealId" TEXT,
    /**
     * Touchpoint channel (DB CHECK):
     *   email | ad | web | social | event | sms | call | other
     * Matches the wider C-track channel taxonomy.
     */
    "channel" TEXT NOT NULL,
    /**
     * Free-form touchpoint type within channel
     * (e.g. "email_opened", "ad_clicked", "form_submit", "landing_visited").
     */
    "touchpointType" TEXT NOT NULL,
    /**
     * When the interaction actually happened (publisher-supplied; ingestion
     * adapter normalizes to UTC).
     */
    "occurredAt" TIMESTAMP(3) NOT NULL,
    /**
     * Optional metadata: utm params, ad placement, page URL, etc.
     */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_touchpoints_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "campaign_touchpoints"
  ADD CONSTRAINT "campaign_touchpoints_channel_check"
  CHECK ("channel" IN ('email', 'ad', 'web', 'social', 'event', 'sms', 'call', 'other'));

CREATE INDEX "campaign_touchpoints_org_contact_occurred_idx"
  ON "campaign_touchpoints"("organizationId", "contactId", "occurredAt");
CREATE INDEX "campaign_touchpoints_campaign_occurred_idx"
  ON "campaign_touchpoints"("campaignId", "occurredAt");
CREATE INDEX "campaign_touchpoints_org_deal_occurred_idx"
  ON "campaign_touchpoints"("organizationId", "dealId", "occurredAt")
  WHERE "dealId" IS NOT NULL;

ALTER TABLE "campaign_touchpoints"
  ADD CONSTRAINT "campaign_touchpoints_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_touchpoints"
  ADD CONSTRAINT "campaign_touchpoints_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_touchpoints"
  ADD CONSTRAINT "campaign_touchpoints_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_touchpoints"
  ADD CONSTRAINT "campaign_touchpoints_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: block all UPDATEs (history is the source of truth).
CREATE OR REPLACE FUNCTION campaign_touchpoints_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'campaign_touchpoints is append-only (touchpoint % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_touchpoints_append_only_trigger
  BEFORE UPDATE ON "campaign_touchpoints"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_touchpoints_append_only_fn();

-- Cross-table coherence: contact + campaign + deal all must share the
-- touchpoint's organizationId. INSERT-only — FK cols are immutable
-- via append-only trigger.
CREATE OR REPLACE FUNCTION campaign_touchpoints_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  contact_org_id TEXT;
  campaign_org_id TEXT;
  deal_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO contact_org_id
    FROM "contacts" WHERE "id" = NEW."contactId";
  IF contact_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_touchpoints.contactId "%" does not resolve', NEW."contactId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF contact_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_touchpoints: contact "%" belongs to org "%" but touchpoint references org "%"',
      NEW."contactId", contact_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO campaign_org_id
    FROM "campaigns" WHERE "id" = NEW."campaignId";
  IF campaign_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_touchpoints.campaignId "%" does not resolve', NEW."campaignId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF campaign_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_touchpoints: campaign "%" belongs to org "%" but touchpoint references org "%"',
      NEW."campaignId", campaign_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."dealId" IS NOT NULL THEN
    SELECT "organizationId" INTO deal_org_id
      FROM "deals" WHERE "id" = NEW."dealId";
    IF deal_org_id IS NULL THEN
      RAISE EXCEPTION 'campaign_touchpoints.dealId "%" does not resolve', NEW."dealId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF deal_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'campaign_touchpoints: deal "%" belongs to org "%" but touchpoint references org "%"',
        NEW."dealId", deal_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_touchpoints_coherence_trigger
  BEFORE INSERT ON "campaign_touchpoints"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_touchpoints_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. campaign_influences — computed credit per (deal, campaign, model)
-- ═══════════════════════════════════════════════════════════════
-- One row per (deal, campaign, model) tuple. Slice-2 worker recomputes
-- the row each time the deal stage advances or touchpoint timeline
-- changes. Identifier columns immutable; weight + attributedRevenue +
-- touchpointCount mutable (recomputation).
CREATE TABLE "campaign_influences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    /**
     * Credit weight in [0, 1]. Sum across all influences for a (deal,
     * model) pair MUST equal 1.0 if any touchpoints exist (slice-2 worker
     * enforces via revenue-allocator).
     */
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /**
     * weight * deal.amount — pre-computed for fast reporting.
     */
    "attributedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /** Number of touchpoints from this campaign that contributed. */
    "touchpointCount" INTEGER NOT NULL DEFAULT 0,
    /** When the slice-2 worker last recomputed this row. */
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_influences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_weight_check"
  CHECK ("weight" >= 0 AND "weight" <= 1);
ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_revenue_check"
  CHECK ("attributedRevenue" >= 0);
ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_touchpoint_count_check"
  CHECK ("touchpointCount" >= 0);

CREATE UNIQUE INDEX "campaign_influences_deal_campaign_model_uniq"
  ON "campaign_influences"("dealId", "campaignId", "modelId");
CREATE INDEX "campaign_influences_org_campaign_idx"
  ON "campaign_influences"("organizationId", "campaignId");
CREATE INDEX "campaign_influences_org_deal_idx"
  ON "campaign_influences"("organizationId", "dealId");
CREATE INDEX "campaign_influences_model_computed_idx"
  ON "campaign_influences"("modelId", "computedAt");

ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_influences"
  ADD CONSTRAINT "campaign_influences_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "attribution_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Identifier columns immutable. weight / attributedRevenue / touchpointCount
-- / computedAt are mutable (recomputation each run).
CREATE OR REPLACE FUNCTION campaign_influences_identifiers_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."dealId" IS DISTINCT FROM OLD."dealId" THEN
    RAISE EXCEPTION 'campaign_influences.dealId is immutable (influence %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."campaignId" IS DISTINCT FROM OLD."campaignId" THEN
    RAISE EXCEPTION 'campaign_influences.campaignId is immutable (influence %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."modelId" IS DISTINCT FROM OLD."modelId" THEN
    RAISE EXCEPTION 'campaign_influences.modelId is immutable (influence %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_influences_identifiers_immutable_trigger
  BEFORE UPDATE ON "campaign_influences"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_influences_identifiers_immutable_fn();

-- Cross-table coherence: deal + campaign + model all in same org.
CREATE OR REPLACE FUNCTION campaign_influences_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  deal_org_id TEXT;
  campaign_org_id TEXT;
  model_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO deal_org_id
    FROM "deals" WHERE "id" = NEW."dealId";
  IF deal_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_influences.dealId "%" does not resolve', NEW."dealId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF deal_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_influences: deal "%" belongs to org "%" but influence references org "%"',
      NEW."dealId", deal_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO campaign_org_id
    FROM "campaigns" WHERE "id" = NEW."campaignId";
  IF campaign_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_influences.campaignId "%" does not resolve', NEW."campaignId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF campaign_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_influences: campaign "%" belongs to org "%" but influence references org "%"',
      NEW."campaignId", campaign_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO model_org_id
    FROM "attribution_models" WHERE "id" = NEW."modelId";
  IF model_org_id IS NULL THEN
    RAISE EXCEPTION 'campaign_influences.modelId "%" does not resolve', NEW."modelId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF model_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'campaign_influences: model "%" belongs to org "%" but influence references org "%"',
      NEW."modelId", model_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_influences_coherence_trigger
  BEFORE INSERT ON "campaign_influences"
  FOR EACH ROW
  EXECUTE FUNCTION campaign_influences_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. attribution_calculation_runs — audit of recomputation passes
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 cron worker inserts one row per run. Captures scope, results,
-- duration, errors.
CREATE TABLE "attribution_calculation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    /**
     * Run lifecycle (DB CHECK + transition trigger):
     *   pending   — queued
     *   running   — worker in flight
     *   succeeded — finished, all deals recomputed
     *   failed    — hit a hard error mid-run
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Trigger source (DB CHECK): cron | manual | api. */
    "triggerSource" TEXT NOT NULL DEFAULT 'cron',
    /** Deal scope at run start. */
    "dealsTotal" INTEGER NOT NULL DEFAULT 0,
    "dealsProcessed" INTEGER NOT NULL DEFAULT 0,
    /** Influences written / updated this run. */
    "influencesWritten" INTEGER NOT NULL DEFAULT 0,
    /** Set on transition to running. */
    "startedAt" TIMESTAMP(3),
    /** Set on transition to succeeded/failed. */
    "endedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attribution_calculation_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_status_check"
  CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'));
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_trigger_check"
  CHECK ("triggerSource" IN ('cron', 'manual', 'api'));
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_counts_check"
  CHECK ("dealsTotal" >= 0 AND "dealsProcessed" >= 0 AND "influencesWritten" >= 0);
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_processed_bound_check"
  CHECK ("dealsProcessed" <= "dealsTotal");

-- Status-timestamp coherence
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_started_coherence_check"
  CHECK ("status" NOT IN ('running', 'succeeded', 'failed') OR "startedAt" IS NOT NULL);
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_ended_coherence_check"
  CHECK ("status" NOT IN ('succeeded', 'failed') OR "endedAt" IS NOT NULL);
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_failed_coherence_check"
  CHECK ("status" <> 'failed' OR "errorMessage" IS NOT NULL);

CREATE INDEX "attribution_calculation_runs_org_status_idx"
  ON "attribution_calculation_runs"("organizationId", "status");
CREATE INDEX "attribution_calculation_runs_model_started_idx"
  ON "attribution_calculation_runs"("modelId", "startedAt");

ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attribution_calculation_runs"
  ADD CONSTRAINT "attribution_calculation_runs_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "attribution_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status transitions: pending → running → succeeded|failed; pending may
-- jump straight to failed (queue rejection). Terminal statuses immutable.
-- Timestamps + modelId immutable once set.
CREATE OR REPLACE FUNCTION attribution_calculation_runs_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."modelId" IS DISTINCT FROM OLD."modelId" THEN
    RAISE EXCEPTION 'attribution_calculation_runs.modelId is immutable (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'attribution_calculation_runs.startedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'attribution_calculation_runs.endedAt is immutable once set (run %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Status transitions.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" IN ('succeeded', 'failed') THEN
      RAISE EXCEPTION 'attribution_calculation_runs status: % is terminal (run %)', OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'pending' AND NEW."status" NOT IN ('running', 'failed') THEN
      RAISE EXCEPTION 'attribution_calculation_runs status: pending → % is invalid (run %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'running' AND NEW."status" NOT IN ('succeeded', 'failed') THEN
      RAISE EXCEPTION 'attribution_calculation_runs status: running → % is invalid (run %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attribution_calculation_runs_lifecycle_trigger
  BEFORE UPDATE ON "attribution_calculation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION attribution_calculation_runs_lifecycle_fn();

-- Cross-table coherence: model in same org.
CREATE OR REPLACE FUNCTION attribution_calculation_runs_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  model_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO model_org_id
    FROM "attribution_models" WHERE "id" = NEW."modelId";
  IF model_org_id IS NULL THEN
    RAISE EXCEPTION 'attribution_calculation_runs.modelId "%" does not resolve', NEW."modelId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF model_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'attribution_calculation_runs: model "%" belongs to org "%" but run references org "%"',
      NEW."modelId", model_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attribution_calculation_runs_coherence_trigger
  BEFORE INSERT ON "attribution_calculation_runs"
  FOR EACH ROW
  EXECUTE FUNCTION attribution_calculation_runs_coherence_fn();
