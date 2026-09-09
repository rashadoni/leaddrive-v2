-- B10: Entitlement Process (Phase 1 / Service Cloud).
--
-- Salesforce Service Cloud Entitlement Process analogue. Adds a granular
-- milestone layer on top of the existing SlaPolicy (which only tracks
-- two coarse timestamps: firstResponseHours + resolutionHours).
--
-- The use case: enterprise support contracts demand more than just
-- "first response in 4h / resolution in 24h". They require per-stage
-- milestones — e.g. "problem identified in 2h", "workaround delivered
-- in 6h", "permanent fix in 5d" — each tracked, each escalated
-- independently.
--
-- Slice-1 ships schema + 5 pure helpers (types + milestone-due-
-- calculator + milestone-status-evaluator + entitlement-lifecycle +
-- escalation-planner). NO cron runtime — slice-2 wires:
--   • Hook into existing /api/cron/sla-escalation to also walk
--     entitlement_ticket_milestones and escalate per definition.
--   • Auto-create entitlement_ticket_milestones on Ticket create.
--   • Auto-complete on Ticket status transitions (status=resolved →
--     mark `resolution` milestone met).
--   • Admin UI: entitlement authoring + per-company assignment.
-- Slice-2 also extends:
--   • Business-hours calendar — milestone-due-calculator currently
--     uses naive 24x7 math; slice-2 wires the BusinessHoursOnly flag.
-- Slice-3 wires:
--   • AI breach-prediction (Claude scans active milestones, predicts
--     which will miss + suggests pre-emptive escalation).
--   • Customer-facing entitlement status portal page.

-- ═══════════════════════════════════════════════════════════════
-- 1. entitlements — per-company support entitlement
-- ═══════════════════════════════════════════════════════════════
-- One row per (company, slaPolicy) covering a validity window. Slice-2
-- admin UI lets ops assign entitlements when contracts start; the cron
-- worker walks active rows nightly to expire any past validTo.
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "slaPolicyId" TEXT NOT NULL,
    /**
     * Support tier (DB CHECK):
     *   basic       — entry-level, longer milestone windows
     *   standard    — default for paid plans
     *   premium     — faster milestones, higher escalation
     *   enterprise  — fastest milestones, named TAM, 24/7
     */
    "supportLevel" TEXT NOT NULL DEFAULT 'standard',
    /** Inclusive lower bound — entitlement starts being honored. */
    "validFrom" TIMESTAMP(3) NOT NULL,
    /**
     * Exclusive upper bound — entitlement no longer applies on or
     * after this date. NULL = open-ended (annually-renewing contracts).
     */
    "validTo" TIMESTAMP(3),
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft      — authoring; tickets aren't gated by it
     *   active     — gated by cron + lifecycle helpers
     *   suspended  — temporarily off (non-payment, breach by tenant)
     *   expired    — validTo passed (auto-flip by slice-2 cron)
     *   cancelled  — explicitly terminated (separate from expired)
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Set on transition to expired. */
    "expiredAt" TIMESTAMP(3),
    /** Set on transition to cancelled. */
    "cancelledAt" TIMESTAMP(3),
    /** Cancellation reason (when cancelled). */
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_support_level_check"
  CHECK ("supportLevel" IN ('basic', 'standard', 'premium', 'enterprise'));

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_status_check"
  CHECK ("status" IN ('draft', 'active', 'suspended', 'expired', 'cancelled'));

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_validity_range_check"
  CHECK ("validTo" IS NULL OR "validFrom" < "validTo");

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_expired_coherence_check"
  CHECK ("status" <> 'expired' OR "expiredAt" IS NOT NULL);
ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE INDEX "entitlements_org_company_idx"
  ON "entitlements"("organizationId", "companyId");
CREATE INDEX "entitlements_org_status_idx"
  ON "entitlements"("organizationId", "status");
CREATE INDEX "entitlements_org_validity_idx"
  ON "entitlements"("organizationId", "validFrom", "validTo");
-- At most one ACTIVE entitlement per company (defense-in-depth — slice-2
-- admin UI also gates this; partial unique index covers the DB).
CREATE UNIQUE INDEX "entitlements_company_active_uniq"
  ON "entitlements"("companyId")
  WHERE "status" = 'active';

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_slaPolicyId_fkey"
  FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lifecycle transitions (mirror of TS entitlement-lifecycle.ts):
--   draft      → active | cancelled
--   active     → suspended | expired | cancelled
--   suspended  → active | expired | cancelled
--   expired    → (terminal)
--   cancelled  → (terminal)
-- companyId + slaPolicyId immutable post-create (changing them would
-- amount to deleting + re-creating the entitlement record).
-- expiredAt + cancelledAt set-once.
CREATE OR REPLACE FUNCTION entitlements_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- organizationId immutable (defense-in-depth against cross-tenant leak;
  -- architect pass-1 fix).
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'entitlements.organizationId is immutable (entitlement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'entitlements.companyId is immutable (entitlement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."slaPolicyId" IS DISTINCT FROM OLD."slaPolicyId" THEN
    RAISE EXCEPTION 'entitlements.slaPolicyId is immutable (entitlement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."expiredAt" IS NOT NULL AND NEW."expiredAt" IS DISTINCT FROM OLD."expiredAt" THEN
    RAISE EXCEPTION 'entitlements.expiredAt is immutable once set (entitlement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'entitlements.cancelledAt is immutable once set (entitlement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" IN ('expired', 'cancelled') THEN
      RAISE EXCEPTION 'entitlements status: % is terminal (entitlement %)', OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'cancelled') THEN
      RAISE EXCEPTION 'entitlements status: draft → % is invalid (entitlement %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('suspended', 'expired', 'cancelled') THEN
      RAISE EXCEPTION 'entitlements status: active → % is invalid (entitlement %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'suspended' AND NEW."status" NOT IN ('active', 'expired', 'cancelled') THEN
      RAISE EXCEPTION 'entitlements status: suspended → % is invalid (entitlement %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    -- Defense-in-depth: unknown OLD status refused (per C5 pass-1 pattern).
    IF OLD."status" NOT IN ('draft', 'active', 'suspended', 'expired', 'cancelled') THEN
      RAISE EXCEPTION 'entitlements status: OLD status "%" is unknown — refusing transition (entitlement %, data corruption suspected)',
        OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlements_lifecycle_trigger
  BEFORE UPDATE ON "entitlements"
  FOR EACH ROW
  EXECUTE FUNCTION entitlements_lifecycle_fn();

-- Cross-table coherence: company + slaPolicy belong to same org.
CREATE OR REPLACE FUNCTION entitlements_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  company_org_id TEXT;
  policy_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO company_org_id
    FROM "companies" WHERE "id" = NEW."companyId";
  IF company_org_id IS NULL THEN
    RAISE EXCEPTION 'entitlements.companyId "%" does not resolve', NEW."companyId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF company_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'entitlements: company "%" belongs to org "%" but entitlement references org "%"',
      NEW."companyId", company_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO policy_org_id
    FROM "sla_policies" WHERE "id" = NEW."slaPolicyId";
  IF policy_org_id IS NULL THEN
    RAISE EXCEPTION 'entitlements.slaPolicyId "%" does not resolve', NEW."slaPolicyId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF policy_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'entitlements: sla_policy "%" belongs to org "%" but entitlement references org "%"',
      NEW."slaPolicyId", policy_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlements_coherence_trigger
  BEFORE INSERT ON "entitlements"
  FOR EACH ROW
  EXECUTE FUNCTION entitlements_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. entitlement_milestone_definitions — milestone-types catalog
-- ═══════════════════════════════════════════════════════════════
-- Per-entitlement, defines the milestone types tracked (first_response,
-- problem_identified, etc.) with their due windows. One milestone-
-- definition row per (entitlement, type, severityTier).
CREATE TABLE "entitlement_milestone_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    /**
     * Milestone type (DB CHECK):
     *   first_response       — initial agent reply
     *   problem_identified   — RCA done, root cause known
     *   workaround_delivered — temporary fix in customer's hand
     *   resolution           — permanent fix shipped
     *   escalation           — handoff to next-tier (L2/L3/TAM)
     */
    "type" TEXT NOT NULL,
    /** Human label for slice-2 UI display. */
    "name" TEXT NOT NULL,
    /**
     * Optional severity-tier scoping (DB CHECK):
     *   critical | high | normal | low | (NULL = applies to all)
     * Lets enterprise tenants set tighter windows for critical incidents.
     */
    "severityTier" TEXT,
    /**
     * Due window in seconds from the milestone-start event (slice-2 cron
     * decides what counts as "start" per type — e.g. first_response
     * starts at ticket create; resolution starts at ticket create
     * unless an alternative anchor is configured in metadata).
     */
    "dueWithinSeconds" INTEGER NOT NULL,
    /**
     * If true, ticket cannot transition to resolved/closed status
     * unless this milestone is met or waived. Slice-2 status-change
     * route enforces.
     */
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    /** Free-form config (escalation rules, anchor overrides). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entitlement_milestone_definitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "entitlement_milestone_definitions"
  ADD CONSTRAINT "entitlement_milestone_definitions_type_check"
  CHECK ("type" IN ('first_response', 'problem_identified', 'workaround_delivered', 'resolution', 'escalation'));

ALTER TABLE "entitlement_milestone_definitions"
  ADD CONSTRAINT "entitlement_milestone_definitions_severity_check"
  CHECK ("severityTier" IS NULL OR "severityTier" IN ('critical', 'high', 'normal', 'low'));

ALTER TABLE "entitlement_milestone_definitions"
  ADD CONSTRAINT "entitlement_milestone_definitions_due_check"
  CHECK ("dueWithinSeconds" > 0 AND "dueWithinSeconds" <= 31536000); -- max 365 days

-- One definition per (entitlement, type, severityTier) tuple. NULL severity
-- distinct from any tier — handled via COALESCE so the index is well-defined.
CREATE UNIQUE INDEX "entitlement_milestone_definitions_uniq_idx"
  ON "entitlement_milestone_definitions"("entitlementId", "type", COALESCE("severityTier", ''));

CREATE INDEX "entitlement_milestone_definitions_org_entitlement_idx"
  ON "entitlement_milestone_definitions"("organizationId", "entitlementId");

ALTER TABLE "entitlement_milestone_definitions"
  ADD CONSTRAINT "entitlement_milestone_definitions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_milestone_definitions"
  ADD CONSTRAINT "entitlement_milestone_definitions_entitlementId_fkey"
  FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Identifier immutability: entitlementId + type + severityTier form the
-- natural key. Changing dueWithinSeconds is allowed (admin tunes windows).
CREATE OR REPLACE FUNCTION entitlement_milestone_definitions_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- organizationId immutable (architect pass-1 fix).
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions.organizationId is immutable (def %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."entitlementId" IS DISTINCT FROM OLD."entitlementId" THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions.entitlementId is immutable (def %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions.type is immutable (def %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."severityTier" IS DISTINCT FROM OLD."severityTier" THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions.severityTier is immutable (def %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_milestone_definitions_immutable_trigger
  BEFORE UPDATE ON "entitlement_milestone_definitions"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_milestone_definitions_immutable_fn();

-- Coherence: entitlement same org.
CREATE OR REPLACE FUNCTION entitlement_milestone_definitions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  entitlement_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO entitlement_org_id
    FROM "entitlements" WHERE "id" = NEW."entitlementId";
  IF entitlement_org_id IS NULL THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions.entitlementId "%" does not resolve', NEW."entitlementId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF entitlement_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'entitlement_milestone_definitions: entitlement "%" belongs to org "%" but definition references org "%"',
      NEW."entitlementId", entitlement_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_milestone_definitions_coherence_trigger
  BEFORE INSERT ON "entitlement_milestone_definitions"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_milestone_definitions_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. entitlement_ticket_milestones — per-ticket per-milestone instances
-- ═══════════════════════════════════════════════════════════════
-- One row per (ticket, definition) tuple. Slice-2 hook creates these
-- on Ticket create. Slice-2 status-change route + cron update them as
-- the ticket progresses.
CREATE TABLE "entitlement_ticket_milestones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    /** Resolved type from the definition — denormalized for fast cron walks. */
    "type" TEXT NOT NULL,
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   pending      — not yet started (rare; mostly used for waiting-on-customer states)
     *   in_progress  — clock is running
     *   met          — completed before due
     *   missed       — clock ran out
     *   waived       — operator marked OK (e.g. customer cancelled)
     */
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    /** Computed when the row is inserted from the definition's dueWithinSeconds. */
    "dueAt" TIMESTAMP(3) NOT NULL,
    /** Set on transition to met. */
    "completedAt" TIMESTAMP(3),
    /** Set on transition to missed. */
    "missedAt" TIMESTAMP(3),
    /** Set on transition to waived. */
    "waivedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    /**
     * Last escalation level fired (0 = no escalation, 1 = first, 2 = second).
     * Slice-2 cron increments; entitlement-process slice doesn't enforce
     * a hard max (slice-2 will configure).
     */
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "lastEscalatedAt" TIMESTAMP(3),
    /** Free-form context (slice-2 cron may attach diagnostic). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entitlement_ticket_milestones_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_status_check"
  CHECK ("status" IN ('pending', 'in_progress', 'met', 'missed', 'waived'));

ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_type_check"
  CHECK ("type" IN ('first_response', 'problem_identified', 'workaround_delivered', 'resolution', 'escalation'));

-- escalationLevel cap raised to 100 (was 10) per architect pass-1 suggestion:
-- slice-2 admin UI may configure arbitrarily-long ladders for niche use
-- cases (24/7 enterprise tenants with bespoke escalation chains).
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_escalation_check"
  CHECK ("escalationLevel" >= 0 AND "escalationLevel" <= 100);

-- Status-timestamp coherence
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_met_coherence_check"
  CHECK ("status" <> 'met' OR "completedAt" IS NOT NULL);
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_missed_coherence_check"
  CHECK ("status" <> 'missed' OR "missedAt" IS NOT NULL);
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_waived_coherence_check"
  CHECK ("status" <> 'waived' OR ("waivedAt" IS NOT NULL AND "waivedReason" IS NOT NULL));

-- One row per (ticket, definition) — slice-2 hook is idempotent.
CREATE UNIQUE INDEX "entitlement_ticket_milestones_uniq_idx"
  ON "entitlement_ticket_milestones"("ticketId", "definitionId");
CREATE INDEX "entitlement_ticket_milestones_org_status_due_idx"
  ON "entitlement_ticket_milestones"("organizationId", "status", "dueAt");
CREATE INDEX "entitlement_ticket_milestones_org_ticket_idx"
  ON "entitlement_ticket_milestones"("organizationId", "ticketId");

ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_ticket_milestones"
  ADD CONSTRAINT "entitlement_ticket_milestones_definitionId_fkey"
  FOREIGN KEY ("definitionId") REFERENCES "entitlement_milestone_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lifecycle transitions:
--   pending      → in_progress | waived
--   in_progress  → met | missed | waived
--   met          → (terminal)
--   missed       → met | waived (operator override after-the-fact)
--   waived       → (terminal)
-- Identifier (ticketId + definitionId + type) immutable. Terminal
-- timestamps set-once. dueAt mutable on slice-2 re-anchoring.
CREATE OR REPLACE FUNCTION entitlement_ticket_milestones_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- organizationId immutable (architect pass-1 fix).
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.organizationId is immutable (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."ticketId" IS DISTINCT FROM OLD."ticketId" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.ticketId is immutable (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."definitionId" IS DISTINCT FROM OLD."definitionId" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.definitionId is immutable (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.type is immutable (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.completedAt is immutable once set (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."missedAt" IS NOT NULL AND NEW."missedAt" IS DISTINCT FROM OLD."missedAt" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.missedAt is immutable once set (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."waivedAt" IS NOT NULL AND NEW."waivedAt" IS DISTINCT FROM OLD."waivedAt" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.waivedAt is immutable once set (milestone %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Monotonicity: lastEscalatedAt must move forward (architect pass-1
  -- suggestion). Slice-2 cron writes new timestamps on each escalation
  -- fire; defensive guard against decreasing writes.
  IF OLD."lastEscalatedAt" IS NOT NULL
     AND NEW."lastEscalatedAt" IS NOT NULL
     AND NEW."lastEscalatedAt" < OLD."lastEscalatedAt" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.lastEscalatedAt must be monotonic (was %, attempted %)',
      OLD."lastEscalatedAt", NEW."lastEscalatedAt"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" IN ('met', 'waived') THEN
      RAISE EXCEPTION 'entitlement_ticket_milestones status: % is terminal (milestone %)', OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'pending' AND NEW."status" NOT IN ('in_progress', 'waived') THEN
      RAISE EXCEPTION 'entitlement_ticket_milestones status: pending → % is invalid (milestone %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'in_progress' AND NEW."status" NOT IN ('met', 'missed', 'waived') THEN
      RAISE EXCEPTION 'entitlement_ticket_milestones status: in_progress → % is invalid (milestone %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    -- "missed" is NOT terminal here — operator can flip to met/waived
    -- after-the-fact (e.g. customer late-acknowledged, deal saved).
    IF OLD."status" = 'missed' AND NEW."status" NOT IN ('met', 'waived') THEN
      RAISE EXCEPTION 'entitlement_ticket_milestones status: missed → % is invalid (milestone %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    -- Defense-in-depth.
    IF OLD."status" NOT IN ('pending', 'in_progress', 'met', 'missed', 'waived') THEN
      RAISE EXCEPTION 'entitlement_ticket_milestones status: OLD status "%" is unknown — refusing transition (milestone %)',
        OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_ticket_milestones_lifecycle_trigger
  BEFORE UPDATE ON "entitlement_ticket_milestones"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_ticket_milestones_lifecycle_fn();

-- Coherence: ticket + definition both same org; AND definition's type
-- matches the milestone's type (split-brain prevention).
CREATE OR REPLACE FUNCTION entitlement_ticket_milestones_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  ticket_org_id TEXT;
  def_org_id TEXT;
  def_type TEXT;
BEGIN
  SELECT "organizationId" INTO ticket_org_id
    FROM "tickets" WHERE "id" = NEW."ticketId";
  IF ticket_org_id IS NULL THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.ticketId "%" does not resolve', NEW."ticketId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF ticket_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones: ticket "%" belongs to org "%" but milestone references org "%"',
      NEW."ticketId", ticket_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId", "type" INTO def_org_id, def_type
    FROM "entitlement_milestone_definitions" WHERE "id" = NEW."definitionId";
  IF def_org_id IS NULL THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones.definitionId "%" does not resolve', NEW."definitionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF def_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones: definition "%" belongs to org "%" but milestone references org "%"',
      NEW."definitionId", def_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF def_type <> NEW."type" THEN
    RAISE EXCEPTION 'entitlement_ticket_milestones: definition "%" type is "%" but milestone references type "%"',
      NEW."definitionId", def_type, NEW."type"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_ticket_milestones_coherence_trigger
  BEFORE INSERT ON "entitlement_ticket_milestones"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_ticket_milestones_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. entitlement_audit_events — append-only audit log
-- ═══════════════════════════════════════════════════════════════
-- Append-only log of all entitlement + milestone state changes for
-- compliance / SLA-credit audits. Separate from generic AuditLog
-- so finance/contracts queries don't have to scan the firehose.
CREATE TABLE "entitlement_audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "milestoneId" TEXT,
    /**
     * Event type (DB CHECK):
     *   entitlement_created | entitlement_activated | entitlement_suspended
     *   | entitlement_resumed | entitlement_expired | entitlement_cancelled
     *   | milestone_started | milestone_met | milestone_missed
     *   | milestone_waived | milestone_escalated | milestone_re_anchored
     */
    "eventType" TEXT NOT NULL,
    /** Payload — typed by eventType in slice-2 helper. */
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entitlement_audit_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_event_type_check"
  CHECK ("eventType" IN (
    'entitlement_created', 'entitlement_activated', 'entitlement_suspended',
    'entitlement_resumed', 'entitlement_expired', 'entitlement_cancelled',
    'milestone_started', 'milestone_met', 'milestone_missed',
    'milestone_waived', 'milestone_escalated', 'milestone_re_anchored'
  ));

-- Either entitlementId or milestoneId must be set (events anchor to one).
ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_target_check"
  CHECK ("entitlementId" IS NOT NULL OR "milestoneId" IS NOT NULL);

CREATE INDEX "entitlement_audit_events_org_entitlement_idx"
  ON "entitlement_audit_events"("organizationId", "entitlementId", "occurredAt")
  WHERE "entitlementId" IS NOT NULL;
CREATE INDEX "entitlement_audit_events_org_milestone_idx"
  ON "entitlement_audit_events"("organizationId", "milestoneId", "occurredAt")
  WHERE "milestoneId" IS NOT NULL;
CREATE INDEX "entitlement_audit_events_org_event_type_idx"
  ON "entitlement_audit_events"("organizationId", "eventType", "occurredAt");

ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_entitlementId_fkey"
  FOREIGN KEY ("entitlementId") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "entitlement_ticket_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlement_audit_events"
  ADD CONSTRAINT "entitlement_audit_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: audit history is immutable.
CREATE OR REPLACE FUNCTION entitlement_audit_events_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'entitlement_audit_events is append-only (event % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_audit_events_append_only_trigger
  BEFORE UPDATE ON "entitlement_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_audit_events_append_only_fn();

-- Coherence: entitlement / milestone / actor all same org.
CREATE OR REPLACE FUNCTION entitlement_audit_events_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  entitlement_org_id TEXT;
  milestone_org_id TEXT;
  actor_org_id TEXT;
BEGIN
  IF NEW."entitlementId" IS NOT NULL THEN
    SELECT "organizationId" INTO entitlement_org_id
      FROM "entitlements" WHERE "id" = NEW."entitlementId";
    IF entitlement_org_id IS NULL THEN
      RAISE EXCEPTION 'entitlement_audit_events.entitlementId "%" does not resolve', NEW."entitlementId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF entitlement_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'entitlement_audit_events: entitlement "%" belongs to org "%" but event references org "%"',
        NEW."entitlementId", entitlement_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."milestoneId" IS NOT NULL THEN
    SELECT "organizationId" INTO milestone_org_id
      FROM "entitlement_ticket_milestones" WHERE "id" = NEW."milestoneId";
    IF milestone_org_id IS NULL THEN
      RAISE EXCEPTION 'entitlement_audit_events.milestoneId "%" does not resolve', NEW."milestoneId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF milestone_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'entitlement_audit_events: milestone "%" belongs to org "%" but event references org "%"',
        NEW."milestoneId", milestone_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."actorUserId" IS NOT NULL THEN
    SELECT "organizationId" INTO actor_org_id
      FROM "users" WHERE "id" = NEW."actorUserId";
    IF actor_org_id IS NULL THEN
      RAISE EXCEPTION 'entitlement_audit_events.actorUserId "%" does not resolve', NEW."actorUserId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF actor_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'entitlement_audit_events: actor "%" belongs to org "%" but event references org "%"',
        NEW."actorUserId", actor_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entitlement_audit_events_coherence_trigger
  BEFORE INSERT ON "entitlement_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION entitlement_audit_events_coherence_fn();
