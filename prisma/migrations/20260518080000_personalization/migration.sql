-- C4: Personalization / Interaction Studio (Phase 6 Block G third slice, closes Block G).
--
-- Salesforce Interaction Studio analogue. Real-time web personalization:
-- show different content to different visitors based on profile +
-- segment + behavior signals. Builds on G1 UnifiedProfile + G4
-- DataCloudSegment for visitor identification + audience evaluation.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine, targeting-
-- evaluator, variant-selector, metrics-aggregator, types). NO admin
-- UI, NO real-time decision engine, NO JS snippet, NO cron.
--
-- Slice 2 wires:
--   • Admin UI for experience authoring + variant editing.
--   • `public/ld-personalize.js` JS snippet for client-site embed.
--   • `src/app/api/v1/personalize/decide` real-time decision endpoint.
--   • Impression / click / conversion tracking endpoints.
--   • Sticky-by-visitor assignment via cookie / localStorage.
-- Slice 3 wires:
--   • A/B variant testing with statistical significance (chi-square).
--   • Cross with C9 Marketing Attribution for funnel analytics.
--   • LLM-driven content generation (uses H8 BYO LLM).

-- ── PersonalizationExperience ──────────────────────────────────
-- The top-level "show X if Y" config. One experience targets a
-- specific surface (banner_top, product_card, modal, etc.) and
-- evaluates targeting rules against visitor profile to decide
-- which variant to show.
CREATE TABLE "personalization_experiences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug, UNIQUE per tenant. */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Surface — placement key the JS snippet references. Caller config
     * (slice-2 admin UI) picks from a fixed list per tenant. Free-form
     * here; helpers don't enforce a closed set.
     */
    "surface" TEXT NOT NULL,
    /**
     * Targeting rules (JSONB). Shape (see types.ts):
     *   {
     *     allOf?: TargetingPredicate[]  // every must match
     *     anyOf?: TargetingPredicate[]  // at least one
     *     noneOf?: TargetingPredicate[] // none may match
     *   }
     * Validator helper checks shape; evaluator walks it at decision time.
     */
    "targetingRules" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK):
     *   draft     — being authored; never served
     *   active    — live; decision engine evaluates
     *   paused    — temporarily off; decisions return no-match
     *   archived  — terminal; preserved for audit / metrics
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Tiebreaker when multiple experiences target same surface. Higher first. */
    "priority" INTEGER NOT NULL DEFAULT 0,
    /** Sticky-assignment policy: visitor (cookie) | contact (logged-in id) | none (always reroll). */
    "stickyMode" TEXT NOT NULL DEFAULT 'visitor',
    /** Slice-2: ISO-8601 cron-like activation window. NULL = always-on while active. */
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personalization_experiences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_status_check"
  CHECK ("status" IN ('draft', 'active', 'paused', 'archived'));

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_sticky_check"
  CHECK ("stickyMode" IN ('visitor', 'contact', 'none'));

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_priority_check"
  CHECK ("priority" >= 0 AND "priority" <= 1000);

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_window_check"
  CHECK (
    "activeFrom" IS NULL OR "activeUntil" IS NULL OR "activeUntil" >= "activeFrom"
  );

-- Status-timestamp coherence
ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_active_coherence_check"
  CHECK ("status" <> 'active' OR "activatedAt" IS NOT NULL);
ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_paused_coherence_check"
  CHECK ("status" <> 'paused' OR "pausedAt" IS NOT NULL);
ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "personalization_experiences_org_slug_uniq"
  ON "personalization_experiences"("organizationId", "slug");
CREATE INDEX "personalization_experiences_org_status_idx"
  ON "personalization_experiences"("organizationId", "status");
CREATE INDEX "personalization_experiences_surface_idx"
  ON "personalization_experiences"("organizationId", "surface", "priority");

ALTER TABLE "personalization_experiences"
  ADD CONSTRAINT "personalization_experiences_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- activatedAt + pausedAt + archivedAt immutable once set (IS DISTINCT FROM — N2 lesson).
CREATE OR REPLACE FUNCTION personalization_experiences_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'personalization_experiences.activatedAt is immutable (experience %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."pausedAt" IS NOT NULL AND NEW."pausedAt" IS DISTINCT FROM OLD."pausedAt" THEN
    RAISE EXCEPTION 'personalization_experiences.pausedAt is immutable (experience %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'personalization_experiences.archivedAt is immutable (experience %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personalization_experiences_timestamps_immutable_trigger
  BEFORE UPDATE ON "personalization_experiences"
  FOR EACH ROW
  EXECUTE FUNCTION personalization_experiences_timestamps_immutable_fn();

-- ── PersonalizationVariant ─────────────────────────────────────
-- Per-experience content variants. The variant-selector helper picks
-- one based on weights + sticky-assignment policy. JSONB content is
-- the payload the JS snippet renders (HTML, image URL, CTA copy).
CREATE TABLE "personalization_variants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    /** URL-safe slug, UNIQUE per experience. */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /**
     * Content payload (JSONB). Shape is surface-dependent and slice-2
     * caller decides. Slice-1 helpers don't introspect — variant-selector
     * just returns the chosen variant's row including this blob.
     */
    "content" JSONB NOT NULL DEFAULT '{}',
    /**
     * Selection weight (0..1000). Variant-selector picks weighted-random
     * within an experience. Weight=0 disables a variant without deleting.
     */
    "weight" INTEGER NOT NULL DEFAULT 100,
    /**
     * Flag for control / hold-out variants — variant-selector reports
     * `isControl` so caller-side metrics can compute lift correctly.
     */
    "isControl" BOOLEAN NOT NULL DEFAULT FALSE,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personalization_variants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "personalization_variants"
  ADD CONSTRAINT "personalization_variants_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "personalization_variants"
  ADD CONSTRAINT "personalization_variants_weight_check"
  CHECK ("weight" >= 0 AND "weight" <= 1000);

CREATE UNIQUE INDEX "personalization_variants_experience_slug_uniq"
  ON "personalization_variants"("experienceId", "slug");
CREATE INDEX "personalization_variants_org_experience_idx"
  ON "personalization_variants"("organizationId", "experienceId");
CREATE INDEX "personalization_variants_experience_active_idx"
  ON "personalization_variants"("experienceId", "isActive");

ALTER TABLE "personalization_variants"
  ADD CONSTRAINT "personalization_variants_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personalization_variants"
  ADD CONSTRAINT "personalization_variants_experienceId_fkey"
  FOREIGN KEY ("experienceId") REFERENCES "personalization_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PersonalizationDecision ────────────────────────────────────
-- Per-decision audit. Slice-2 decision endpoint inserts; slice-2
-- metrics aggregator reads. Surface event (impression / click /
-- conversion) timestamps logged inline.
--
-- Append-only on the decision metadata: experienceId, variantId,
-- visitorId, contactId, decidedAt — these MUST NOT change once
-- recorded (data-integrity for experiment analysis). Trigger
-- enforces.
CREATE TABLE "personalization_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    /**
     * Visitor ID — pseudonymous cookie / localStorage value. Soft FK
     * (no table). Slice-2 JS snippet manages allocation.
     */
    "visitorId" TEXT NOT NULL,
    /** Optional logged-in Contact link — soft FK. */
    "contactId" TEXT,
    /** Optional UnifiedProfile link — soft FK. */
    "unifiedProfileId" TEXT,
    /** When the decision was made (engine returned variant). */
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /** When the variant was actually rendered (impression). */
    "surfacedAt" TIMESTAMP(3),
    /** When visitor clicked the variant content. */
    "clickedAt" TIMESTAMP(3),
    /** When the conversion event fired (slice-2: cross-tab via attribution). */
    "convertedAt" TIMESTAMP(3),
    /** Captured for context — page URL, referrer, etc. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personalization_decisions_pkey" PRIMARY KEY ("id")
);

-- Sticky-by-visitor invariant: at most one decision per (experience,
-- visitor) row. Re-decisions on same visitor pull the existing row.
-- Slice-2 endpoint UPSERTs on conflict.
CREATE UNIQUE INDEX "personalization_decisions_experience_visitor_uniq"
  ON "personalization_decisions"("experienceId", "visitorId");

CREATE INDEX "personalization_decisions_org_experience_idx"
  ON "personalization_decisions"("organizationId", "experienceId");
CREATE INDEX "personalization_decisions_org_decided_idx"
  ON "personalization_decisions"("organizationId", "decidedAt");
CREATE INDEX "personalization_decisions_variant_idx"
  ON "personalization_decisions"("variantId");
CREATE INDEX "personalization_decisions_contact_idx"
  ON "personalization_decisions"("contactId");
CREATE INDEX "personalization_decisions_unified_profile_idx"
  ON "personalization_decisions"("unifiedProfileId");

ALTER TABLE "personalization_decisions"
  ADD CONSTRAINT "personalization_decisions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personalization_decisions"
  ADD CONSTRAINT "personalization_decisions_experienceId_fkey"
  FOREIGN KEY ("experienceId") REFERENCES "personalization_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personalization_decisions"
  ADD CONSTRAINT "personalization_decisions_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "personalization_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Decision-core fields immutable; event timestamps (surfaced/clicked/
-- converted) advance forward only. IS DISTINCT FROM throughout (N2 lesson).
CREATE OR REPLACE FUNCTION personalization_decisions_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."experienceId" IS DISTINCT FROM OLD."experienceId" THEN
    RAISE EXCEPTION 'personalization_decisions.experienceId is immutable (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."variantId" IS DISTINCT FROM OLD."variantId" THEN
    RAISE EXCEPTION 'personalization_decisions.variantId is immutable (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."visitorId" IS DISTINCT FROM OLD."visitorId" THEN
    RAISE EXCEPTION 'personalization_decisions.visitorId is immutable (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" THEN
    RAISE EXCEPTION 'personalization_decisions.decidedAt is immutable (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Event timestamps: once set, immutable.
  IF OLD."surfacedAt" IS NOT NULL AND NEW."surfacedAt" IS DISTINCT FROM OLD."surfacedAt" THEN
    RAISE EXCEPTION 'personalization_decisions.surfacedAt is immutable once set (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."clickedAt" IS NOT NULL AND NEW."clickedAt" IS DISTINCT FROM OLD."clickedAt" THEN
    RAISE EXCEPTION 'personalization_decisions.clickedAt is immutable once set (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."convertedAt" IS NOT NULL AND NEW."convertedAt" IS DISTINCT FROM OLD."convertedAt" THEN
    RAISE EXCEPTION 'personalization_decisions.convertedAt is immutable once set (decision %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personalization_decisions_immutable_trigger
  BEFORE UPDATE ON "personalization_decisions"
  FOR EACH ROW
  EXECUTE FUNCTION personalization_decisions_immutable_fn();

-- Cross-table coherence: a Decision's variant MUST belong to the
-- same Experience the Decision references AND share the same org.
-- Without this, a buggy slice-2 endpoint could insert decisions
-- where variant.experienceId ≠ decision.experienceId (data
-- corruption affecting experiment analysis) OR cross-tenant
-- (multi-tenant leakage if endpoint mis-scopes the org filter).
--
-- Mirrors C2 mobile_campaigns_template_channel_match_fn pattern.
-- Architect-pass-1 close-out (slice-2 problem promoted to slice-1
-- DB-level defense — same lesson as C2).
CREATE OR REPLACE FUNCTION personalization_decisions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  variant_experience_id TEXT;
  variant_org_id TEXT;
  experience_org_id TEXT;
BEGIN
  -- Variant must belong to the declared experience.
  SELECT "experienceId", "organizationId" INTO variant_experience_id, variant_org_id
    FROM "personalization_variants"
    WHERE "id" = NEW."variantId";
  IF variant_experience_id IS NULL THEN
    -- Variant row missing (shouldn't reach because of FK, but defensive).
    RAISE EXCEPTION 'personalization_decisions.variantId "%" does not resolve to a variant',
      NEW."variantId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF variant_experience_id <> NEW."experienceId" THEN
    RAISE EXCEPTION 'personalization_decisions: variant "%" belongs to experience "%" but decision references experience "%"',
      NEW."variantId", variant_experience_id, NEW."experienceId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF variant_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'personalization_decisions: variant "%" belongs to org "%" but decision references org "%"',
      NEW."variantId", variant_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  -- Experience must also share the same org (multi-tenant safety).
  SELECT "organizationId" INTO experience_org_id
    FROM "personalization_experiences"
    WHERE "id" = NEW."experienceId";
  IF experience_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'personalization_decisions: experience "%" belongs to org "%" but decision references org "%"',
      NEW."experienceId", experience_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personalization_decisions_coherence_trigger
  BEFORE INSERT OR UPDATE ON "personalization_decisions"
  FOR EACH ROW
  EXECUTE FUNCTION personalization_decisions_coherence_fn();
