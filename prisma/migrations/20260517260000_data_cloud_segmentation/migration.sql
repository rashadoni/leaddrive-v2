-- G4: Data Cloud Segmentation (Phase 6 Block B slice 1).
-- Salesforce Segment Builder analogue. Query-tree builder over G1
-- UnifiedProfile fields + G3 ProfileInsight values + materialized
-- membership for fast activation by G5.
--
-- Distinct from the existing `segments` module (which targets
-- Contacts for marketing campaigns) because Data Cloud segments
-- aggregate identity ACROSS all sources (contact + lead + mtm +
-- portal + web-chat) via the UnifiedProfile, and they can filter
-- on calculated insights (LTV / churn / engagement) that don't
-- exist on Contact.
--
-- Slice 1 ships:
--   • DataCloudSegment — segment registry with JSON query tree
--   • DataCloudSegmentMembership — materialized (segment, profile) rows
--   • 2 pure helpers: query-validator + in-memory query-evaluator
--
-- Slice 2 wires:
--   • Query-translator (JSON tree → Prisma where-clause for bulk scan)
--   • Refresh cron (re-evaluates membership on schedule)
--   • API routes + builder UI
-- Slice 3 wires G5 activation (push membership → FB/Google audiences).

-- ── DataCloudSegment ───────────────────────────────────────────
-- Per-tenant segment definition. `query` is the validated JSON
-- query tree (see src/lib/data-cloud-segmentation/types.ts shape).
-- `refreshSchedule` is cron-style; slice-2 refresh worker re-walks
-- the membership graph against current UnifiedProfile + ProfileInsight
-- state and UPSERTs DataCloudSegmentMembership rows.
CREATE TABLE "data_cloud_segments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Human-readable slug — UNIQUE per tenant. URL path + activation tag. */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * JSON query tree — caller-validated via slice-1 helper before
     * insert. Shape:
     *   { op: 'and' | 'or' | 'not', children: [Condition | Subtree] }
     *   Condition = { field: {source, path}, op, value }
     * See `src/lib/data-cloud-segmentation/types.ts` for the canonical
     * TypeScript shape and the validator's allowed-ops-per-field rules.
     */
    "query" JSONB NOT NULL,
    /** Cron-style schedule; slice-2 refresh worker honors. */
    "refreshSchedule" TEXT NOT NULL DEFAULT '0 3 * * *',
    /** Last successful refresh timestamp. NULL until first refresh. */
    "lastRefreshedAt" TIMESTAMP(3),
    /** Member count snapshot at last refresh — denormalised for cheap list views. */
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    /** Per-segment activation hints (FB audience id, Google list id, etc.) — slice-3 G5 consumes. */
    "activationConfig" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_cloud_segments_pkey" PRIMARY KEY ("id")
);

-- Slug regex matches D2 storefront pattern: URL-safe, length≤64, no
-- consecutive separators. Single-char slug supported via OR branch.
ALTER TABLE "data_cloud_segments"
  ADD CONSTRAINT "data_cloud_segments_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "data_cloud_segments"
  ADD CONSTRAINT "data_cloud_segments_member_count_check"
  CHECK ("memberCount" >= 0);

CREATE UNIQUE INDEX "data_cloud_segments_org_slug_uniq" ON "data_cloud_segments"("organizationId", "slug");
CREATE INDEX "data_cloud_segments_org_active_idx" ON "data_cloud_segments"("organizationId", "isActive");
CREATE INDEX "data_cloud_segments_org_refreshed_idx" ON "data_cloud_segments"("organizationId", "lastRefreshedAt");

ALTER TABLE "data_cloud_segments"
  ADD CONSTRAINT "data_cloud_segments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DataCloudSegmentMembership ─────────────────────────────────
-- Materialized (segment, profile) → membership row. Refresh cron
-- UPSERTs as it re-evaluates. `addedAt` snapshots when the profile
-- first joined; `lastConfirmedAt` advances on every refresh while
-- the profile remains in the segment. When a profile drops out,
-- the row is DELETED (no soft-delete — slice-2 retention is via
-- audit log if needed).
CREATE TABLE "data_cloud_segment_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "unifiedProfileId" TEXT NOT NULL,
    /** When the profile first joined this segment. */
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /** Updated on every refresh pass where the profile still matches. */
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /**
     * Optional per-membership metadata snapshot — e.g. the matching
     * query result's computed values for activation payloads
     * (`{LTV: 1200, lastSeenDaysAgo: 3}`).
     */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "data_cloud_segment_memberships_pkey" PRIMARY KEY ("id")
);

-- One membership row per (segment, profile). Refresh cron's UPSERT
-- relies on this unique index.
CREATE UNIQUE INDEX "data_cloud_segment_memberships_seg_profile_uniq"
  ON "data_cloud_segment_memberships"("segmentId", "unifiedProfileId");

CREATE INDEX "data_cloud_segment_memberships_org_segment_idx" ON "data_cloud_segment_memberships"("organizationId", "segmentId");
CREATE INDEX "data_cloud_segment_memberships_profile_idx" ON "data_cloud_segment_memberships"("unifiedProfileId");
CREATE INDEX "data_cloud_segment_memberships_seg_added_idx" ON "data_cloud_segment_memberships"("segmentId", "addedAt");

ALTER TABLE "data_cloud_segment_memberships"
  ADD CONSTRAINT "data_cloud_segment_memberships_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_cloud_segment_memberships"
  ADD CONSTRAINT "data_cloud_segment_memberships_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "data_cloud_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_cloud_segment_memberships"
  ADD CONSTRAINT "data_cloud_segment_memberships_unifiedProfileId_fkey"
  FOREIGN KEY ("unifiedProfileId") REFERENCES "unified_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monotonicity guard for membership timestamps. Mirrors D8 loyalty's
-- lifetime-points monotonic trigger pattern. Rationale:
--   • `addedAt` is set on insert and MUST stay frozen — it's the
--     "first joined" cohort marker that activation pipelines / churn
--     analytics rely on. Any UPDATE that moves it is a bug.
--   • `lastConfirmedAt` MUST only advance forward — each refresh pass
--     reaffirms membership, and a backwards move would corrupt
--     "stale-membership age" computations downstream.
-- The slice-1 helper layer doesn't expose any path that violates
-- this, but the DB constraint is the backstop against manual
-- UPDATEs / bad slice-2 refresh code.
CREATE OR REPLACE FUNCTION data_cloud_segment_memberships_timestamps_monotonic_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."addedAt" <> OLD."addedAt" THEN
    RAISE EXCEPTION 'data_cloud_segment_memberships.addedAt is immutable; cannot change from % to % (id %)',
      OLD."addedAt", NEW."addedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lastConfirmedAt" < OLD."lastConfirmedAt" THEN
    RAISE EXCEPTION 'data_cloud_segment_memberships.lastConfirmedAt is monotonic forward; cannot decrease from % to % (id %)',
      OLD."lastConfirmedAt", NEW."lastConfirmedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_cloud_segment_memberships_timestamps_monotonic_trigger
  BEFORE UPDATE ON "data_cloud_segment_memberships"
  FOR EACH ROW
  EXECUTE FUNCTION data_cloud_segment_memberships_timestamps_monotonic_fn();
