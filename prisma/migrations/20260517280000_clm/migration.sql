-- M5: Contract Lifecycle Management (Phase 6 Block C slice 1).
-- Salesforce CLM analogue. Extends the existing Contract model with:
--   • Templates (reusable boilerplate with variable substitution)
--   • Multi-stage approval chains (parallel to discount-approval pattern)
--   • Renewal-alert scheduler (90/60/30-day windows before endDate)
--
-- Existing `src/lib/ai/renewal.ts` already polls contracts in a 28-32-day
-- window for AI-drafted renewal emails. M5's scheduler is a more general
-- declarative replacement — alerts can also fire as Slack pings, in-app
-- notifications, etc. The legacy AI-email path stays put until slice 2
-- swings it over.
--
-- Slice 1 ships:
--   • ContractTemplate — reusable clause+variable boilerplate
--   • ContractApprovalStage — per-contract ordered approval chain
--   • ContractRenewalAlert — scheduled pre-expiry reminders
--   • Contract status CHECK widened to the full lifecycle enum
--   • 4 pure helpers (state-machine + clause-substituter +
--     approval-router + renewal-alert-scheduler)
--
-- Slice 2 wires:
--   • Approval workflow API + UI (request approval, approve/reject)
--   • Renewal-alert cron (fans out scheduled alerts to Slack/email/in-app)
--   • Template-driven contract drafting UI
-- Slice 3 wires:
--   • E-signature integration (M6) — `signedAt`, `signedBy` fields
--   • Revenue recognition hook (M4) — performance-obligations on activation

-- ── ContractTemplate ───────────────────────────────────────────
-- Per-tenant template registry. `clauses` is an ordered JSONB array
-- of `{ id, title, body, conditional? }` objects (body contains
-- `{{variable}}` substitution markers). `variables` is the JSONB
-- schema declaring `{ name, type, required, default? }` for each
-- variable a template consumer must provide.
--
-- A template is per-tenant; copies/forks/customisation between
-- tenants are out of scope for slice 1.
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Human-readable slug, UNIQUE per tenant. */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /** Bumped on every edit. Existing rendered contracts pin to a snapshot. */
    "version" INTEGER NOT NULL DEFAULT 1,
    /**
     * JSONB array: `[{ id, title, body, conditional?: { var, equals } }, ...]`
     * Order matters — clause-substituter emits in this order.
     */
    "clauses" JSONB NOT NULL,
    /**
     * JSONB array: `[{ name, type: 'string'|'number'|'date'|'boolean', required, default? }, ...]`
     * Validator + substituter consult this.
     */
    "variables" JSONB NOT NULL DEFAULT '[]',
    /** Default contract type to attach when used (mirrors Contract.type). */
    "defaultContractType" TEXT NOT NULL DEFAULT 'service_agreement',
    /** Default duration in months — substituter uses to compute endDate. */
    "defaultDurationMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_version_check"
  CHECK ("version" >= 1);

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_duration_check"
  CHECK ("defaultDurationMonths" IS NULL OR "defaultDurationMonths" >= 0);

CREATE UNIQUE INDEX "contract_templates_org_slug_uniq" ON "contract_templates"("organizationId", "slug");
CREATE INDEX "contract_templates_org_active_idx" ON "contract_templates"("organizationId", "isActive");

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ContractApprovalStage ──────────────────────────────────────
-- Ordered approval chain per contract. Each stage = one decision
-- point. `order` is 1-based; advancement is sequential (stage N+1
-- becomes actionable when stage N is approved). A single reject
-- shorts the chain.
--
-- Slice-1 ships the schema + the pure approval-router helper that
-- computes the next state given a decision. Slice-2 wires the API
-- endpoints + UI.
CREATE TABLE "contract_approval_stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    /** 1-based order. Sequential — stage 2 actionable only after stage 1 approved. */
    "order" INTEGER NOT NULL,
    /** Display label: "Sales Manager", "Finance Director", "Legal". */
    "label" TEXT NOT NULL,
    /**
     * Who can act on this stage. NULL = role-only (any user with the
     * stated role); non-null = a specific user must decide.
     */
    "assigneeUserId" TEXT,
    /** Optional role gate — e.g. "manager", "director". Resolution: helper consults caller's userRoles. */
    "assigneeRole" TEXT,
    /** pending | approved | rejected | skipped (later stage after rejection) | superseded (chain restarted) */
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_approval_stages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'skipped', 'superseded'));

ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_order_check"
  CHECK ("order" >= 1);

-- Decision metadata must be coherent: a terminal state requires
-- `decidedBy` + `decidedAt`. `pending` keeps both NULL.
ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_terminal_coherence_check"
  CHECK (
    (
      "status" = 'pending'
      AND "decidedBy" IS NULL
      AND "decidedAt" IS NULL
    )
    OR (
      "status" IN ('approved', 'rejected', 'skipped', 'superseded')
      AND "decidedAt" IS NOT NULL
    )
  );

-- One stage per (contract, order) — UI relies on this for the chain view.
CREATE UNIQUE INDEX "contract_approval_stages_contract_order_uniq"
  ON "contract_approval_stages"("contractId", "order");
CREATE INDEX "contract_approval_stages_org_status_idx"
  ON "contract_approval_stages"("organizationId", "status");
-- Full index (no WHERE) keeps schema.prisma `@@index` in sync — partial
-- indexes are not expressible in Prisma's @@index, and the drift was
-- flagged in slice-1 architect pass 1. Postgres still uses this index
-- for the "show my pending approvals" query (planner picks it via status
-- predicate selectivity).
CREATE INDEX "contract_approval_stages_assignee_idx"
  ON "contract_approval_stages"("assigneeUserId");

ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_approval_stages"
  ADD CONSTRAINT "contract_approval_stages_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- decidedAt monotonicity — once set, it must not move. Approvals
-- are append-only timeline events; backdating would invalidate
-- audit/SLA-against-approval reports. Mirrors D8's lifetime
-- monotonic trigger pattern.
CREATE OR REPLACE FUNCTION contract_approval_stages_decided_at_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."decidedAt" IS NOT NULL AND NEW."decidedAt" <> OLD."decidedAt" THEN
    RAISE EXCEPTION 'contract_approval_stages.decidedAt is immutable once set; cannot change from % to % (stage %)',
      OLD."decidedAt", NEW."decidedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Terminal status can't be revoked back to pending.
  IF OLD."status" <> 'pending' AND NEW."status" = 'pending' THEN
    RAISE EXCEPTION 'contract_approval_stages.status cannot revert from % to pending (stage %)',
      OLD."status", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_approval_stages_decided_at_immutable_trigger
  BEFORE UPDATE ON "contract_approval_stages"
  FOR EACH ROW
  EXECUTE FUNCTION contract_approval_stages_decided_at_immutable_fn();

-- ── ContractRenewalAlert ───────────────────────────────────────
-- Scheduled pre-expiry alerts. Slice-1 ships the scheduler helper
-- that computes the alert calendar (90/60/30/14/7 day windows
-- relative to Contract.endDate); slice-2 cron actually fans these
-- out to delivery channels.
--
-- `dueAt` is the wall-clock fire time. `daysBeforeExpiry` is the
-- offset that produced it (denormalised so listing UIs can show
-- "90-day reminder for Acme" without recomputing the math).
--
-- Lifecycle:
--   pending → sent  (delivery channel acked)
--          → dismissed (user closed without action)
--          → superseded (contract renewed/terminated before fire)
CREATE TABLE "contract_renewal_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    /** Wall-clock time when the alert should fire — slice-2 cron polls by `dueAt <= now()`. */
    "dueAt" TIMESTAMP(3) NOT NULL,
    /** Window the alert is for: 90 / 60 / 30 / 14 / 7. Constants enforced by helper. */
    "daysBeforeExpiry" INTEGER NOT NULL,
    /** pending | sent | dismissed | superseded */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Slice-2 delivery channel: in_app | slack | email. NULL until fired. */
    "deliveredVia" TEXT,
    "deliveredAt" TIMESTAMP(3),
    /** Optional pointer to the renewal-flow contract that supersedes this alert. */
    "supersededByContractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_renewal_alerts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_days_check"
  CHECK ("daysBeforeExpiry" IN (90, 60, 30, 14, 7));

ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_status_check"
  CHECK ("status" IN ('pending', 'sent', 'dismissed', 'superseded'));

-- Delivery metadata coherence: `sent` requires deliveredAt + deliveredVia.
ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_delivery_coherence_check"
  CHECK (
    (
      "status" <> 'sent'
    )
    OR (
      "status" = 'sent'
      AND "deliveredAt" IS NOT NULL
      AND "deliveredVia" IS NOT NULL
    )
  );

-- One alert per (contract, window) — re-running the scheduler
-- UPSERTs rather than dupes.
CREATE UNIQUE INDEX "contract_renewal_alerts_contract_window_uniq"
  ON "contract_renewal_alerts"("contractId", "daysBeforeExpiry");
-- Full index (no WHERE) to match schema.prisma `@@index([organizationId, dueAt])`
-- declaration — partial indexes aren't expressible in Prisma. Postgres
-- still uses this for the slice-2 cron query `WHERE dueAt <= now() AND status = 'pending'`.
CREATE INDEX "contract_renewal_alerts_org_due_idx"
  ON "contract_renewal_alerts"("organizationId", "dueAt");

ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_renewal_alerts"
  ADD CONSTRAINT "contract_renewal_alerts_supersededByContractId_fkey"
  FOREIGN KEY ("supersededByContractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Contract column additions ──────────────────────────────────
-- Slice 1 leaves the existing `status TEXT` column free-form (no
-- CHECK constraint added yet) because legacy rows on production may
-- carry non-canonical values from earlier free-text usage. The
-- state-machine helper enforces the allowed transitions in
-- application code.
--
-- TODO(slice-2): backfill legacy contracts.status values to the
-- canonical 10-value enum, then add:
--   ALTER TABLE "contracts" ADD CONSTRAINT "contracts_status_check"
--     CHECK ("status" IN ('draft','pending_approval','approved','active',
--                         'renewing','renewed','expired','terminated',
--                         'rejected','cancelled'));
-- See `src/lib/contract-lifecycle/types.ts` CONTRACT_STATUSES for the
-- canonical enum (drift-guard test pins length=10).
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "templateId" TEXT,
  ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "renderedBody" TEXT,
  ADD COLUMN IF NOT EXISTS "currentApprovalStage" INTEGER,
  ADD COLUMN IF NOT EXISTS "renewalSourceContractId" TEXT;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_renewalSourceContractId_fkey"
  FOREIGN KEY ("renewalSourceContractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Full indexes (no WHERE x IS NOT NULL) to match schema.prisma's
-- `@@index([templateId])` and `@@index([renewalSourceContractId])`
-- declarations — Prisma can't express partial indexes via @@index,
-- and pass-1 architect flagged the same drift pattern on the new
-- tables. Keeping schema/migration aligned across the board.
CREATE INDEX IF NOT EXISTS "contracts_template_idx" ON "contracts"("templateId");
CREATE INDEX IF NOT EXISTS "contracts_renewal_source_idx" ON "contracts"("renewalSourceContractId");
