-- N16: OmniStudio (FlexCards + OmniScript) — Phase 6 Block D slice 2,
-- closing Block D.
--
-- Salesforce OmniStudio analogue. No-code UI engine for Industry
-- Clouds (Professional Services / Financial Services / Health / etc.):
--   • FlexCard — declarative JSON config that renders a record view
--                with conditional sections + per-field type hints
--                (analogue to N2 LightningPageWidget but at a higher
--                level — designed for industry-vertical config).
--   • OmniScript — declarative workflow steps (input → API call →
--                  conditional branch → action), with session-level
--                  state tracking for in-flight executions.
--
-- Slice 1 ships schema + 5 pure helpers (no admin builder UI, no
-- script runtime, no FlexCard renderer hooked into actual page
-- requests). Slice 2 wires the runtime + builder UI.
--
-- Distinct from N2 Lightning App Builder because:
--   • N2 targets page-layout configuration (regions, widgets,
--     per-user assignment) — Salesforce Lightning App Builder.
--   • N16 targets DECLARATIVE WORKFLOW + record-view CONFIG, where
--     the same FlexCard/OmniScript JSON can be reused across
--     vertical industry templates without code changes.

-- ── OmniStudioFlexCard ─────────────────────────────────────────
-- FlexCard = configurable record view with conditional sections.
-- `config` carries the canonical JSON shape validated by the
-- flex-card-validator helper at INSERT/UPDATE time.
CREATE TABLE "omni_studio_flex_cards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug — UNIQUE per (tenant, objectType). */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /** Target object type — same shape as N2 lightning_pages.objectType. */
    "objectType" TEXT NOT NULL,
    /** Bumped on every publish. */
    "version" INTEGER NOT NULL DEFAULT 1,
    /**
     * Canonical FlexCard config — JSONB. Shape (see
     * src/lib/omnistudio/types.ts for the TypeScript types):
     *   { sections: [{ id, title, fields[], conditional?: { var, equals } }] }
     * Validator enforces shape before persist.
     */
    "config" JSONB NOT NULL,
    /**
     * Lifecycle (DB CHECK):
     *   draft | published | archived
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "omni_studio_flex_cards_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived'));

ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_version_check"
  CHECK ("version" >= 1);

ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_object_type_check"
  CHECK ("objectType" ~ '^[a-z][a-z0-9_]{0,63}$');

-- Publish/archive coherence — matches N2 + M5/M6 pattern.
ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_publish_coherence_check"
  CHECK ("status" <> 'published' OR "publishedAt" IS NOT NULL);
ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_archive_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "omni_studio_flex_cards_org_object_slug_uniq"
  ON "omni_studio_flex_cards"("organizationId", "objectType", "slug");
CREATE INDEX "omni_studio_flex_cards_org_status_idx"
  ON "omni_studio_flex_cards"("organizationId", "status");

ALTER TABLE "omni_studio_flex_cards"
  ADD CONSTRAINT "omni_studio_flex_cards_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- publishedAt / archivedAt immutable once set — uses IS DISTINCT FROM
-- (architect-pass close-out across the codebase).
CREATE OR REPLACE FUNCTION omni_studio_flex_cards_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'omni_studio_flex_cards.publishedAt is immutable once set (card %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'omni_studio_flex_cards.archivedAt is immutable once set (card %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER omni_studio_flex_cards_timestamps_immutable_trigger
  BEFORE UPDATE ON "omni_studio_flex_cards"
  FOR EACH ROW
  EXECUTE FUNCTION omni_studio_flex_cards_timestamps_immutable_fn();

-- ── OmniStudioOmniScript ───────────────────────────────────────
-- OmniScript = declarative workflow steps (input / api_call /
-- conditional / action). `steps` JSONB is a DAG validated by
-- omni-script-validator (no cycles, all step refs resolve).
CREATE TABLE "omni_studio_omni_scripts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /** Target object type — same shape as flex-cards. */
    "objectType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    /**
     * Steps JSONB. Shape:
     *   { startStepId, steps: [{ id, type, config, nextStepId?,
     *                            branches?: [{ condition, nextStepId }] }] }
     * Validator enforces DAG-shape + type-specific config presence.
     */
    "steps" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "omni_studio_omni_scripts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived'));

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_version_check"
  CHECK ("version" >= 1);

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_object_type_check"
  CHECK ("objectType" ~ '^[a-z][a-z0-9_]{0,63}$');

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_publish_coherence_check"
  CHECK ("status" <> 'published' OR "publishedAt" IS NOT NULL);
ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_archive_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "omni_studio_omni_scripts_org_object_slug_uniq"
  ON "omni_studio_omni_scripts"("organizationId", "objectType", "slug");
CREATE INDEX "omni_studio_omni_scripts_org_status_idx"
  ON "omni_studio_omni_scripts"("organizationId", "status");

ALTER TABLE "omni_studio_omni_scripts"
  ADD CONSTRAINT "omni_studio_omni_scripts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION omni_studio_omni_scripts_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'omni_studio_omni_scripts.publishedAt is immutable once set (script %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'omni_studio_omni_scripts.archivedAt is immutable once set (script %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER omni_studio_omni_scripts_timestamps_immutable_trigger
  BEFORE UPDATE ON "omni_studio_omni_scripts"
  FOR EACH ROW
  EXECUTE FUNCTION omni_studio_omni_scripts_timestamps_immutable_fn();

-- ── OmniStudioRunSession ───────────────────────────────────────
-- Execution-tracking row for an in-flight OmniScript run. Slice 1
-- ships schema only; slice 2 wires the runtime that advances
-- `currentStepId` based on user input / API responses.
--
-- Session state (`state` JSONB) carries variables accumulated as the
-- script progresses — slice-2 runtime reads/writes per step.
CREATE TABLE "omni_studio_run_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    /**
     * Snapshot of script.version at session-start — keeps run
     * reproducible across edits.
     *
     * INTEGRITY GAP (slice 1 → slice 2): scriptVersion has NO FK link
     * to a "versioned script" table — currently the script table holds
     * only the LATEST version (with `version` bumped in place on every
     * publish). The FK on `scriptId` guarantees the script EXISTS, but
     * not that any specific version row was ever persisted. Slice-2
     * runtime MUST validate scriptVersion <= script.version on session
     * create, AND slice-2/3 may add an immutable `omni_studio_script_versions`
     * table to capture every publish snapshot for true reproducibility.
     */
    "scriptVersion" INTEGER NOT NULL,
    /** Optional object reference the script is acting on. */
    "contextObjectType" TEXT,
    "contextObjectId" TEXT,
    /** User running the script (NULL for system-triggered runs). */
    "userId" TEXT,
    /**
     * Lifecycle:
     *   in_progress | completed | abandoned | failed
     * Failed = runtime error (validator passed but step ran into
     * external API failure that's non-recoverable).
     */
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    /** ID of the step currently awaiting input / API completion. */
    "currentStepId" TEXT,
    /** Accumulated variables across the run — slice-2 runtime mutates. */
    "state" JSONB NOT NULL DEFAULT '{}',
    /** Set on transition to completed/abandoned/failed. */
    "endedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "omni_studio_run_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "omni_studio_run_sessions"
  ADD CONSTRAINT "omni_studio_run_sessions_status_check"
  CHECK ("status" IN ('in_progress', 'completed', 'abandoned', 'failed'));

ALTER TABLE "omni_studio_run_sessions"
  ADD CONSTRAINT "omni_studio_run_sessions_version_check"
  CHECK ("scriptVersion" >= 1);

-- Terminal-status coherence: non-in_progress requires endedAt.
ALTER TABLE "omni_studio_run_sessions"
  ADD CONSTRAINT "omni_studio_run_sessions_end_coherence_check"
  CHECK (
    "status" = 'in_progress' OR "endedAt" IS NOT NULL
  );

CREATE INDEX "omni_studio_run_sessions_org_status_idx"
  ON "omni_studio_run_sessions"("organizationId", "status");
CREATE INDEX "omni_studio_run_sessions_script_idx"
  ON "omni_studio_run_sessions"("scriptId");
CREATE INDEX "omni_studio_run_sessions_user_idx"
  ON "omni_studio_run_sessions"("userId");
CREATE INDEX "omni_studio_run_sessions_context_idx"
  ON "omni_studio_run_sessions"("contextObjectType", "contextObjectId");

ALTER TABLE "omni_studio_run_sessions"
  ADD CONSTRAINT "omni_studio_run_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "omni_studio_run_sessions"
  ADD CONSTRAINT "omni_studio_run_sessions_scriptId_fkey"
  FOREIGN KEY ("scriptId") REFERENCES "omni_studio_omni_scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- endedAt + startedAt immutable once set (using IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION omni_studio_run_sessions_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'omni_studio_run_sessions.startedAt is immutable (session %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'omni_studio_run_sessions.endedAt is immutable once set (session %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER omni_studio_run_sessions_timestamps_immutable_trigger
  BEFORE UPDATE ON "omni_studio_run_sessions"
  FOR EACH ROW
  EXECUTE FUNCTION omni_studio_run_sessions_timestamps_immutable_fn();
