-- N2: Lightning App Builder (Phase 6 Block D slice 1).
-- Salesforce Lightning App Builder analogue — drag-drop page layouts
-- per Object (Deal, Contact, Lead, Custom...) with per-Profile / per-
-- Role / per-User assignment overrides.
--
-- Slice 1 ships:
--   • Schema for page + regions + widgets + assignments.
--   • 5 pure helpers (state-machine + widget-validator + assignment-
--     resolver + layout-serializer + types).
--
-- Slice 2 wires:
--   • Drag-drop admin UI (`src/app/(dashboard)/settings/app-builder/`).
--   • Object-render layer that consumes layout JSON per request.
--   • Versioning + activation workflow (currently single-page status flip).
-- Slice 3 wires:
--   • OmniStudio FlexCard runtime (N16) — alternative widget engine
--     for Industry Clouds (Professional Services / Financial Services).

-- ── LightningPage ──────────────────────────────────────────────
-- A page binds to ONE object type (e.g. "deal", "contact"). Multiple
-- pages can exist per object — admin chooses via LightningPageAssignment
-- which page applies for a given (user/role/profile/default) scope.
CREATE TABLE "lightning_pages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug — UNIQUE per (tenant, objectType). */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Target object type. Allowlist controlled at application layer
     * (caller passes from a fixed UI dropdown). DB CHECK only enforces
     * the regex shape — slice-2 may pin via FIELD_TYPE_MAP-style enum.
     */
    "objectType" TEXT NOT NULL,
    /**
     * Status (DB CHECK):
     *   draft     — being edited; assignments may reference but UI
     *               renders a "preview" banner.
     *   published — active; assignments resolve to this page.
     *   archived  — kept for audit; assignments referencing it fall
     *               through to the default page.
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Bumped on every publish. Slice-2 audit trail consumes. */
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lightning_pages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived'));

ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_version_check"
  CHECK ("version" >= 1);

-- Slug regex matches the same pattern used by D2 storefront / G4 segments
-- / M5 templates — URL-safe, length ≤ 64, no consecutive separators.
ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_object_type_check"
  CHECK ("objectType" ~ '^[a-z][a-z0-9_]{0,63}$');

-- Publish/archive coherence: status='published' requires publishedAt;
-- status='archived' requires archivedAt.
ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_publish_coherence_check"
  CHECK ("status" <> 'published' OR "publishedAt" IS NOT NULL);

ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_archive_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "lightning_pages_org_object_slug_uniq"
  ON "lightning_pages"("organizationId", "objectType", "slug");
CREATE INDEX "lightning_pages_org_object_status_idx"
  ON "lightning_pages"("organizationId", "objectType", "status");
CREATE INDEX "lightning_pages_org_status_idx" ON "lightning_pages"("organizationId", "status");

ALTER TABLE "lightning_pages"
  ADD CONSTRAINT "lightning_pages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- publishedAt / archivedAt immutable once set. Uses `IS DISTINCT FROM`
-- (not `<>`) so that NULL → value AND value → NULL transitions both
-- raise. `<>` against NULL evaluates to NULL (not TRUE) and would let
-- a `published → draft` UPDATE silently clear publishedAt, losing the
-- audit timestamp. Architect-pass-1 caught this across M4/M5/M6/N2;
-- this slice retroactively fixes the earlier-shipped triggers via the
-- follow-up migration `20260517340500_fix_immutability_triggers`.
CREATE OR REPLACE FUNCTION lightning_pages_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'lightning_pages.publishedAt is immutable once set (page %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'lightning_pages.archivedAt is immutable once set (page %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lightning_pages_timestamps_immutable_trigger
  BEFORE UPDATE ON "lightning_pages"
  FOR EACH ROW
  EXECUTE FUNCTION lightning_pages_timestamps_immutable_fn();

-- ── LightningPageRegion ────────────────────────────────────────
-- Top-level layout regions within a page. Standard Salesforce-style
-- regions: header / main / sidebar / footer. Order is 1-based;
-- UNIQUE per page.
CREATE TABLE "lightning_page_regions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    /** Region kind (DB CHECK): header | main | sidebar | footer. */
    "regionType" TEXT NOT NULL,
    /** 1-based ordinal within page; UNIQUE per page. */
    "displayOrder" INTEGER NOT NULL,
    /** Width hint (1-12, Bootstrap-style). NULL = "auto". */
    "widthCols" INTEGER,
    /** Optional display label for admin UI. */
    "label" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lightning_page_regions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lightning_page_regions"
  ADD CONSTRAINT "lightning_page_regions_type_check"
  CHECK ("regionType" IN ('header', 'main', 'sidebar', 'footer'));

ALTER TABLE "lightning_page_regions"
  ADD CONSTRAINT "lightning_page_regions_order_check"
  CHECK ("displayOrder" >= 1);

ALTER TABLE "lightning_page_regions"
  ADD CONSTRAINT "lightning_page_regions_width_check"
  CHECK ("widthCols" IS NULL OR ("widthCols" >= 1 AND "widthCols" <= 12));

CREATE UNIQUE INDEX "lightning_page_regions_page_order_uniq"
  ON "lightning_page_regions"("pageId", "displayOrder");
CREATE INDEX "lightning_page_regions_org_page_idx"
  ON "lightning_page_regions"("organizationId", "pageId");

ALTER TABLE "lightning_page_regions"
  ADD CONSTRAINT "lightning_page_regions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lightning_page_regions"
  ADD CONSTRAINT "lightning_page_regions_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "lightning_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LightningPageWidget ────────────────────────────────────────
-- Widget instance within a region. `widgetType` selects renderer
-- (record_details, related_list, chart, ...); `config` JSONB carries
-- per-instance settings validated by widget-validator helper.
CREATE TABLE "lightning_page_widgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    /** Widget kind (DB CHECK pins the slice-1 set). */
    "widgetType" TEXT NOT NULL,
    /** 1-based ordinal within region; UNIQUE per region. */
    "displayOrder" INTEGER NOT NULL,
    /** Per-instance settings. Validator helper checks shape per type. */
    "config" JSONB NOT NULL DEFAULT '{}',
    /** Optional admin-only label. */
    "label" TEXT,
    /** Visibility — slice-2 may extend with conditional rules. */
    "isVisible" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lightning_page_widgets_pkey" PRIMARY KEY ("id")
);

-- Widget-type allowlist. Adding a new type requires extending both
-- this CHECK and the widget-validator helper's switch (slice-1 drift-
-- guard test pins both).
ALTER TABLE "lightning_page_widgets"
  ADD CONSTRAINT "lightning_page_widgets_type_check"
  CHECK ("widgetType" IN (
    'record_details', 'related_list', 'chart', 'quick_actions',
    'activity_timeline', 'html', 'embed_external'
  ));

ALTER TABLE "lightning_page_widgets"
  ADD CONSTRAINT "lightning_page_widgets_order_check"
  CHECK ("displayOrder" >= 1);

CREATE UNIQUE INDEX "lightning_page_widgets_region_order_uniq"
  ON "lightning_page_widgets"("regionId", "displayOrder");
CREATE INDEX "lightning_page_widgets_org_region_idx"
  ON "lightning_page_widgets"("organizationId", "regionId");

ALTER TABLE "lightning_page_widgets"
  ADD CONSTRAINT "lightning_page_widgets_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lightning_page_widgets"
  ADD CONSTRAINT "lightning_page_widgets_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "lightning_page_regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LightningPageAssignment ────────────────────────────────────
-- Resolution mapping: which page applies for a given scope. Precedence
-- order (highest → lowest): user > profile > role > default.
--
-- Exactly one (pageId, scopeType, scopeId) tuple is unique per
-- (org, objectType). `scopeId` is NULL for scopeType='default'.
CREATE TABLE "lightning_page_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    /** Mirrored from page.objectType — denormalised for cheap lookup. */
    "objectType" TEXT NOT NULL,
    /** Scope kind (DB CHECK): default | role | profile | user. */
    "scopeType" TEXT NOT NULL,
    /**
     * Scope value. NULL when scopeType='default'.
     * Role: a Role enum value (admin / manager / sales / support / viewer).
     * Profile: ContractApprovalStage-style placeholder (slice-2 wires
     *          N13 Profile model — for now caller passes free-form profile id).
     * User: a User.id.
     */
    "scopeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lightning_page_assignments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lightning_page_assignments"
  ADD CONSTRAINT "lightning_page_assignments_scope_check"
  CHECK ("scopeType" IN ('default', 'role', 'profile', 'user'));

-- Coherence: scopeType='default' MUST have scopeId NULL; non-default
-- MUST have non-null scopeId.
ALTER TABLE "lightning_page_assignments"
  ADD CONSTRAINT "lightning_page_assignments_scope_coherence_check"
  CHECK (
    ("scopeType" = 'default' AND "scopeId" IS NULL)
    OR ("scopeType" <> 'default' AND "scopeId" IS NOT NULL)
  );

-- Mirror objectType regex from lightning_pages.
ALTER TABLE "lightning_page_assignments"
  ADD CONSTRAINT "lightning_page_assignments_object_type_check"
  CHECK ("objectType" ~ '^[a-z][a-z0-9_]{0,63}$');

-- Uniqueness: at most one active assignment per (org, objectType,
-- scopeType, scopeId). Slice 1 enforces this at the application layer
-- (assignment-resolver.ts validates before insert/update) because
-- Prisma's `@@unique` cannot express a partial index with WHERE
-- isActive=TRUE — and full uniqueness would prevent deactivated
-- assignments from coexisting as audit history.
--
-- The full @@index([organizationId, objectType, scopeType, scopeId])
-- below makes the resolver's lookup fast; slice-2 may revisit to add
-- the partial unique if we standardise on raw-SQL-managed indexes for
-- this table.
CREATE INDEX "lightning_page_assignments_scope_idx"
  ON "lightning_page_assignments"("organizationId", "objectType", "scopeType", "scopeId");
CREATE INDEX "lightning_page_assignments_org_object_idx"
  ON "lightning_page_assignments"("organizationId", "objectType");
CREATE INDEX "lightning_page_assignments_page_idx"
  ON "lightning_page_assignments"("pageId");

ALTER TABLE "lightning_page_assignments"
  ADD CONSTRAINT "lightning_page_assignments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lightning_page_assignments"
  ADD CONSTRAINT "lightning_page_assignments_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "lightning_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
