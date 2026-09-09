-- P8 No-Code Form Builder — slice-1.
--
-- Standalone reusable form definition. Distinct from
-- LandingPage.formConfig (P8+ pages embed forms inline; P8 forms
-- live independently and can render at a public slug URL or be
-- embedded by `<iframe>` / inline-script on any host).
--
-- The `fields` JSON shape is enforced at the route layer
-- (`src/lib/form-builder/validate-definition.ts`). The DB CHECK only
-- gates `status` to mirror the lifecycle enum.

CREATE TABLE "form_definitions" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "description"      TEXT,
  "fields"           JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'draft',
  "successMessage"   TEXT,
  "redirectUrl"      TEXT,
  "notifyEmails"     TEXT,
  "leadAutoCreate"   BOOLEAN NOT NULL DEFAULT false,
  "totalViews"       INTEGER NOT NULL DEFAULT 0,
  "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
  "publishedAt"      TIMESTAMP(3),
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "form_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "form_definitions_status_chk"
    CHECK ("status" IN ('draft', 'published', 'archived'))
);

-- Slug uniqueness scoped per-org. Different tenants can have a "/f/contact" each.
CREATE UNIQUE INDEX "form_definitions_org_slug_unique"
  ON "form_definitions"("organizationId", "slug");

-- Hot path: dashboard list filtered by status (published vs draft).
CREATE INDEX "form_definitions_org_status_idx"
  ON "form_definitions"("organizationId", "status");

ALTER TABLE "form_definitions"
  ADD CONSTRAINT "form_definitions_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the existing form_submissions table with an optional
-- pointer to a FormDefinition. SetNull on delete: deleting a form
-- definition preserves the submission history (rows orphaned but
-- still queryable for compliance / analytics).
ALTER TABLE "form_submissions"
  ADD COLUMN "formDefinitionId" TEXT;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_formDefinitionId_fkey"
  FOREIGN KEY ("formDefinitionId")
  REFERENCES "form_definitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "form_submissions_org_formDefinitionId_idx"
  ON "form_submissions"("organizationId", "formDefinitionId");

-- DB-level XOR guard: at most one of (landingPageId, formDefinitionId)
-- may be set on a single FormSubmission row. The route layer also
-- enforces this in slice-2; the constraint is defence-in-depth against
-- a misbehaving worker / hand-written SQL / admin-script accidentally
-- setting both. `num_nonnulls` is a PostgreSQL builtin that counts
-- non-NULL arguments, so <= 1 admits the three valid cases:
--   (none set,    standalone-form direct submission)  — currently unused
--   (landingPage only, embedded form on a landing page) — legacy
--   (formDef only, standalone P8 form)                  — new in slice-1
ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_source_xor_chk"
  CHECK (num_nonnulls("landingPageId", "formDefinitionId") <= 1);
