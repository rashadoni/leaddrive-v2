-- M4: Revenue Recognition (Phase 6 Block C slice 1, closes Block C).
-- Salesforce Revenue Cloud — ASC 606 / IFRS 15 compliance.
--
-- The 5-step ASC 606 model:
--   1. Identify the contract            — Contract model (already exists)
--   2. Identify performance obligations  — PerformanceObligation (THIS SLICE)
--   3. Determine transaction price       — Contract.valueAmount (exists)
--   4. Allocate price to POs             — allocation-engine helper (THIS SLICE)
--   5. Recognize revenue                 — schedule-generator + calculator (THIS SLICE)
--
-- Slice 1 ships:
--   • Schema for steps 2/4/5.
--   • 5 pure helpers (no cron, no API, no posting workflow).
--   • All money columns are DECIMAL(18, 4) — Decimal-native from day one
--     (no Float→Decimal P0 follow-up needed for this module).
--
-- Slice 2 wires:
--   • Monthly recognition cron — generates RevenueRecognitionEntry rows
--     from schedule lines whose period intersects current month.
--   • Posting workflow — admin clicks "post entry" → write to GL (or
--     just mark entry as posted with timestamp + actor).
--   • Recognition adjustment workflow (PO value change mid-contract).
--   • Builder UI (admin) over performance_obligations.
-- Slice 3 wires:
--   • Multi-currency handling (Contract.currency carries forward;
--     slice-1 keeps PO currency mirrored, no FX translation).
--   • Variable-consideration handling (caps, refunds, contingencies).

-- ── PerformanceObligation ──────────────────────────────────────
-- ASC 606 step 2 + 4: identifies a distinct PO and carries its
-- allocated transaction price. Multi-PO contracts allocate the
-- contract total proportionally to standalone selling prices (SSP).
CREATE TABLE "performance_obligations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    /** Optional product reference — slice-2 admin UI defaults to product list. */
    "productId" TEXT,
    /** 1-based order within contract; UNIQUE per contract. */
    "displayOrder" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    /**
     * Standalone selling price (SSP) — used as the basis for allocation
     * when contract has multiple POs. NULL allowed for single-PO contracts
     * where contractValue == allocatedAmount directly.
     */
    "standaloneSellingPrice" DECIMAL(18, 4),
    /**
     * Allocated transaction price — what this PO "owns" of the contract
     * total. Allocation-engine helper computes this; slice-2 admin can
     * override with manual entry + reason.
     */
    "allocatedAmount" DECIMAL(18, 4) NOT NULL,
    /** Currency mirrors Contract.currency; helper enforces consistency. */
    "currency" TEXT NOT NULL,
    /**
     * Recognition method — drives schedule-generator's output shape:
     *   point_in_time        — single line, dueAt = periodEnd
     *   over_time_straight_line — N monthly lines, equal slices
     *   milestone            — caller supplies milestones in metadata
     *   usage_based          — slice-2 wires usage-event consumption
     */
    "recognitionMethod" TEXT NOT NULL,
    /** Service-period start (recognition window opens). */
    "periodStart" TIMESTAMP(3) NOT NULL,
    /** Service-period end (recognition fully amortised). */
    "periodEnd" TIMESTAMP(3) NOT NULL,
    /**
     * Lifecycle:
     *   draft       — created, schedule not generated
     *   scheduled   — schedule lines exist, no recognition yet
     *   in_progress — partial recognition posted
     *   completed   — fully recognized
     *   cancelled   — voided pre-completion (audit row remains)
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "performance_obligations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_method_check"
  CHECK ("recognitionMethod" IN (
    'point_in_time', 'over_time_straight_line', 'milestone', 'usage_based'
  ));

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_status_check"
  CHECK ("status" IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_amount_check"
  CHECK ("allocatedAmount" >= 0);

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_ssp_check"
  CHECK ("standaloneSellingPrice" IS NULL OR "standaloneSellingPrice" >= 0);

-- Period coherence: end >= start.
ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_period_check"
  CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_display_order_check"
  CHECK ("displayOrder" >= 1);

-- ISO-4217 currency code shape (3 uppercase letters).
ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX "performance_obligations_contract_order_uniq"
  ON "performance_obligations"("contractId", "displayOrder");
CREATE INDEX "performance_obligations_org_status_idx"
  ON "performance_obligations"("organizationId", "status");
CREATE INDEX "performance_obligations_contract_idx" ON "performance_obligations"("contractId");
CREATE INDEX "performance_obligations_product_idx" ON "performance_obligations"("productId");

ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_obligations"
  ADD CONSTRAINT "performance_obligations_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RevenueRecognitionSchedule ─────────────────────────────────
-- Schedule lines = "the plan". Generated by schedule-generator
-- helper at PO creation; UPSERTed if the PO is re-allocated. Each
-- line is one accounting-period (typically a calendar month) target.
CREATE TABLE "revenue_recognition_schedules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "performanceObligationId" TEXT NOT NULL,
    /** 1-based ordinal within the PO's schedule. UNIQUE per PO. */
    "lineNumber" INTEGER NOT NULL,
    /** Period this line covers (e.g. month start). */
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    /** Amount scheduled to recognize in this period. */
    "scheduledAmount" DECIMAL(18, 4) NOT NULL,
    "currency" TEXT NOT NULL,
    /**
     * Lifecycle:
     *   scheduled   — line exists, no recognition yet
     *   recognized  — entry posted, full amount recognized
     *   partially_recognized — slice-2 usage-based partial post
     *   cancelled   — voided (PO change)
     */
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    /** Set on transition to 'recognized'. */
    "recognizedAt" TIMESTAMP(3),
    /** Slice-2 milestone label / usage period label / etc. */
    "label" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "revenue_recognition_schedules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_status_check"
  CHECK ("status" IN ('scheduled', 'recognized', 'partially_recognized', 'cancelled'));

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_amount_check"
  CHECK ("scheduledAmount" >= 0);

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_period_check"
  CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_line_check"
  CHECK ("lineNumber" >= 1);

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Recognition timestamp coherence (symmetric):
--   • status = 'recognized'  ⇔ recognizedAt IS NOT NULL
--   • status <> 'recognized' ⇔ recognizedAt IS NULL
-- Both directions prevent the "scheduled row with a stale recognizedAt
-- left over from a slice-2 mid-flight bug" failure mode. architect-
-- pass-1 close-out (the original CHECK only enforced one direction).
ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_recognized_coherence_check"
  CHECK (
    ("status" = 'recognized' AND "recognizedAt" IS NOT NULL)
    OR ("status" <> 'recognized' AND "recognizedAt" IS NULL)
  );

CREATE UNIQUE INDEX "revenue_recognition_schedules_po_line_uniq"
  ON "revenue_recognition_schedules"("performanceObligationId", "lineNumber");
CREATE INDEX "revenue_recognition_schedules_org_status_idx"
  ON "revenue_recognition_schedules"("organizationId", "status");
CREATE INDEX "revenue_recognition_schedules_po_idx"
  ON "revenue_recognition_schedules"("performanceObligationId");
CREATE INDEX "revenue_recognition_schedules_period_idx"
  ON "revenue_recognition_schedules"("organizationId", "periodStart");

ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_recognition_schedules"
  ADD CONSTRAINT "revenue_recognition_schedules_performanceObligationId_fkey"
  FOREIGN KEY ("performanceObligationId") REFERENCES "performance_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- recognizedAt immutable once set — mirrors M5/M6 immutability pattern.
CREATE OR REPLACE FUNCTION revenue_recognition_schedules_recognized_at_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."recognizedAt" IS NOT NULL AND NEW."recognizedAt" <> OLD."recognizedAt" THEN
    RAISE EXCEPTION 'revenue_recognition_schedules.recognizedAt is immutable once set (line %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_recognition_schedules_recognized_at_immutable_trigger
  BEFORE UPDATE ON "revenue_recognition_schedules"
  FOR EACH ROW
  EXECUTE FUNCTION revenue_recognition_schedules_recognized_at_immutable_fn();

-- ── RevenueRecognitionEntry ────────────────────────────────────
-- Entries = "the actuals". Append-only audit of recognition events.
-- Each row records an amount posted against a schedule line at a
-- specific time. For point_in_time and over_time_straight_line, one
-- entry per schedule line. For partial usage-based, multiple entries
-- per line are legal. DB trigger blocks UPDATE — corrections via
-- new reversing entries (slice 2).
CREATE TABLE "revenue_recognition_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    /** Signed amount: positive for normal recognition, negative for reversals (slice 2). */
    "recognizedAmount" DECIMAL(18, 4) NOT NULL,
    "currency" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "postedBy" TEXT,
    /** Slice-2 GL integration: external reference (journal entry id). */
    "journalRef" TEXT,
    /** Reason / note — required for negative (reversal) entries by slice-2 helper. */
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "revenue_recognition_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "revenue_recognition_entries"
  ADD CONSTRAINT "revenue_recognition_entries_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE INDEX "revenue_recognition_entries_schedule_idx"
  ON "revenue_recognition_entries"("scheduleId", "postedAt");
CREATE INDEX "revenue_recognition_entries_org_posted_idx"
  ON "revenue_recognition_entries"("organizationId", "postedAt");

ALTER TABLE "revenue_recognition_entries"
  ADD CONSTRAINT "revenue_recognition_entries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_recognition_entries"
  ADD CONSTRAINT "revenue_recognition_entries_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "revenue_recognition_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only enforcement: NO UPDATE allowed (corrections via new
-- reversing entries; slice-2 helper enforces "negative entry must
-- reference an existing positive entry").
CREATE OR REPLACE FUNCTION revenue_recognition_entries_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'revenue_recognition_entries is append-only; UPDATE not allowed (entry %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_recognition_entries_no_update_trigger
  BEFORE UPDATE ON "revenue_recognition_entries"
  FOR EACH ROW
  EXECUTE FUNCTION revenue_recognition_entries_no_update_fn();
