-- G1: Unified Customer Profile (Phase 6 Block B slice 1).
-- Salesforce Data Cloud Customer 360 analogue. Aggregates identity
-- across Contact, Lead, MtmCustomer, PortalUser, WebChatSession into
-- a single UnifiedProfile per (org, primary identity) — drives the
-- 360-view UI, calculated insights (G3), and segmentation (G4).
--
-- Slice 1 ships schema + pure helpers (identity-key normalization,
-- profile merger, profile aggregator). Slice 2 wires:
--   • Cron-driven nightly refresh that walks all 5 source tables
--   • Real-time merge on Contact.create / Lead.update / etc.
--   • 360-view route + UI (src/app/(dashboard)/contacts/[id]/360/)
-- Slice 3 wires G2 (Identity Resolution — fuzzy matching across
-- sources) and the activation pipeline (G5).
--
-- ⚠️ SLICE-2 GDPR-erasure design item: this slice's identity-key
-- CHECK forbids both email AND phone NULL. GDPR right-to-erasure
-- typically REPLACES identity keys with NULL while keeping the
-- aggregate row for revenue/cohort reporting. Slice-2 must choose:
--   (a) DELETE the row entirely on erasure (loses analytics) OR
--   (b) Rewrite identity keys to deterministic pseudonyms
--       (emailNormalized = "erased:<sha256(orig)>") and either
--       relax the CHECK OR keep the pseudonym format compliant.
-- The choice belongs to slice-2 erasure flow design — flag explicitly
-- so the next session doesn't get blocked by the CHECK at write time.

-- ── UnifiedProfile ─────────────────────────────────────────────
-- One row per resolved identity within a tenant. Identity is the
-- email + phone + name triplet, normalized. The merger helper
-- decides which source records map to which profile; this table is
-- the read-side projection.
--
-- Aggregate fields (totalSpent, lifetimeOrderCount, lastSeenAt) are
-- computed by the slice-1 aggregator helper and refreshed by the
-- slice-2 nightly cron — they're materialized columns, not Prisma
-- relations, so a 360-view query is one row read, not a 5-table join.
CREATE TABLE "unified_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Normalized identity keys (matchable fields).
     * - emailNormalized: lowercased + trimmed; lookup-keyed
     * - phoneNormalized: E.164 format (e.g. "+994501234567"); lookup-keyed
     * - nameNormalized: lowercased + collapsed whitespace; SECONDARY signal only
     *
     * At least one of email or phone is required (CHECK). Anonymous
     * profiles (web-chat session with no contact info) are NOT stored
     * in this table — they live in WebChatSession until they convert.
     */
    "emailNormalized" TEXT,
    "phoneNormalized" TEXT,
    "nameNormalized" TEXT,
    /** Display fields (preserved as-supplied for UI; not used for matching). */
    "displayEmail" TEXT,
    "displayPhone" TEXT,
    "displayName" TEXT,
    /**
     * Primary source — the contact (if any) that "owns" this profile.
     * Loose FK (route validates same-tenant). On Contact delete, slice-2
     * route nullifies and triggers a re-merge from remaining sources.
     */
    "primaryContactId" TEXT,
    /** Optional B2B linkage. */
    "primaryCompanyId" TEXT,
    /* ─── Aggregate metrics (computed by slice-1 aggregator) ─────── */
    -- ⚠️ SLICE-2 P0 BLOCKER — Float→Decimal: `totalSpent` aggregates
    -- `Invoice.totalAmount` (also Float). IEEE-754 drift compounds
    -- across a rollup of hundreds of paid invoices; slice-2 G3 LTV
    -- math will inherit the drift. Migrate to Decimal alongside the
    -- D5 Payments migration (memory/project_payments_slice2_p0.md).
    /** Sum of paid invoices across all source records, in profile's primary currency. */
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    /** Count of invoices in 'paid' status. */
    "lifetimeOrderCount" INTEGER NOT NULL DEFAULT 0,
    /** Most recent timestamp across all source-record interactions (created/updated/event/message). */
    "lastSeenAt" TIMESTAMP(3),
    /** First-seen timestamp across all sources — never moves backward. */
    "firstSeenAt" TIMESTAMP(3),
    -- Channel tags Postgres array. Slice-2 G4 segmentation queries
    -- `WHERE 'web_chat_session' = ANY("channelsActive")` directly —
    -- a comma-separated TEXT would force LIKE-substring matching
    -- with false-positive risk.
    "channelsActive" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /** Currency code for `totalSpent` aggregation. Inherits from primary contact's invoices. */
    "primaryCurrency" TEXT,
    /** Free-form metadata bag (e.g. UTM source on first-touch, language preference). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    /**
     * Last refresh timestamp. NULL until slice-2 cron first runs;
     * stale-detection in the 360-view shows a "data ≥N hours old" badge.
     */
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "unified_profiles_pkey" PRIMARY KEY ("id")
);

-- A profile must have at least ONE matchable identity key. A row
-- with no email AND no phone is dead data — no way to merge new
-- sources against it. Anonymous sessions stay in WebChatSession.
ALTER TABLE "unified_profiles"
  ADD CONSTRAINT "unified_profiles_identity_key_check"
  CHECK ("emailNormalized" IS NOT NULL OR "phoneNormalized" IS NOT NULL);

-- Aggregate metrics are non-negative.
ALTER TABLE "unified_profiles"
  ADD CONSTRAINT "unified_profiles_total_spent_check"
  CHECK ("totalSpent" >= 0);

ALTER TABLE "unified_profiles"
  ADD CONSTRAINT "unified_profiles_order_count_check"
  CHECK ("lifetimeOrderCount" >= 0);

-- Temporal-ordering: firstSeenAt <= lastSeenAt when both set.
ALTER TABLE "unified_profiles"
  ADD CONSTRAINT "unified_profiles_seen_order_check"
  CHECK (
    "firstSeenAt" IS NULL
    OR "lastSeenAt" IS NULL
    OR "firstSeenAt" <= "lastSeenAt"
  );

-- Per-tenant uniqueness on (email, phone). Two profiles with the
-- same normalized email in one tenant means the merger failed —
-- the partial UNIQUE prevents the bug from manifesting as duplicate
-- 360-view rows. NULL-tolerant (Postgres treats NULL as distinct,
-- so two profiles with phone-only-no-email don't collide).
CREATE UNIQUE INDEX "unified_profiles_org_email_uniq"
  ON "unified_profiles"("organizationId", "emailNormalized")
  WHERE "emailNormalized" IS NOT NULL;

CREATE UNIQUE INDEX "unified_profiles_org_phone_uniq"
  ON "unified_profiles"("organizationId", "phoneNormalized")
  WHERE "phoneNormalized" IS NOT NULL;

CREATE INDEX "unified_profiles_org_last_seen_idx" ON "unified_profiles"("organizationId", "lastSeenAt");
CREATE INDEX "unified_profiles_primary_contact_idx" ON "unified_profiles"("primaryContactId");
CREATE INDEX "unified_profiles_primary_company_idx" ON "unified_profiles"("primaryCompanyId");

ALTER TABLE "unified_profiles"
  ADD CONSTRAINT "unified_profiles_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ProfileSource ──────────────────────────────────────────────
-- Maps source records (Contact / Lead / MtmCustomer / PortalUser /
-- WebChatSession) → UnifiedProfile. One source can contribute to
-- one profile at a time; per-source uniqueness prevents a Contact
-- from being merged into two different profiles. Slice-2 merge
-- engine inserts/updates rows here as it walks the sources.
CREATE TABLE "profile_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unifiedProfileId" TEXT NOT NULL,
    /** CHECK enum below — keep in sync with slice-1 identity-keys.ts. */
    "sourceType" TEXT NOT NULL,
    /** App-level id of the source record (Contact.id / Lead.id / etc.). */
    "sourceId" TEXT NOT NULL,
    /**
     * Match-confidence score 0..1 — drives slice-3 G2 identity-
     * resolution scoring. Slice 1 always emits 1.0 (exact match
     * via email/phone); slice 3 may emit < 1.0 for fuzzy matches.
     */
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    /** When the source last contributed signal to the profile. */
    "lastContributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_sources_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "profile_sources"
  ADD CONSTRAINT "profile_sources_type_check"
  CHECK ("sourceType" IN (
    'contact', 'lead', 'mtm_customer', 'portal_user', 'web_chat_session'
  ));

ALTER TABLE "profile_sources"
  ADD CONSTRAINT "profile_sources_confidence_check"
  CHECK ("confidence" > 0 AND "confidence" <= 1);

-- One source can map to exactly one profile at a time. If the
-- merger needs to re-attach (e.g. customer creates a new account
-- and we link to the existing profile), the slice-2 merge logic
-- UPDATEs the existing row, not INSERTs a duplicate.
CREATE UNIQUE INDEX "profile_sources_source_uniq"
  ON "profile_sources"("organizationId", "sourceType", "sourceId");

CREATE INDEX "profile_sources_profile_idx" ON "profile_sources"("unifiedProfileId");
CREATE INDEX "profile_sources_org_type_idx" ON "profile_sources"("organizationId", "sourceType");

ALTER TABLE "profile_sources"
  ADD CONSTRAINT "profile_sources_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_sources"
  ADD CONSTRAINT "profile_sources_unifiedProfileId_fkey"
  FOREIGN KEY ("unifiedProfileId") REFERENCES "unified_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
