-- Custom board columns — Phase 1a (DB layer only; no app reader change yet).
--
-- 100% ADDITIVE + render-identical:
--   * CREATE board_columns + a coherence trigger (mirrors board_permissions).
--   * tasks."boardColumnKey" is nullable, no default → existing rows untouched,
--     stay NULL. The board keeps folding by `status` for NULL-key tasks, so
--     rendering is unchanged. We deliberately DO NOT backfill boardColumnKey:
--     the read path is NULL-safe, and backfilling status→key would bake the
--     lossy legacy mapping (cancelled→done) into stored data. boardColumnKey
--     populates organically as tasks are moved (Phase 1b co-writes it).
--   * board_columns is SEEDED from divisions.columns so every existing board
--     gets exactly the lanes it shows today (empty columns = all six stages).
--     status stays the canonical, load-bearing state; mapsToStatus == key for
--     every seeded (canonical) column.

-- CreateTable
CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mapsToStatus" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "board_columns_sortOrder_check" CHECK ("sortOrder" >= 0)
);

-- AlterTable (additive, nullable — existing rows untouched, stay NULL)
ALTER TABLE "tasks" ADD COLUMN "boardColumnKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "board_columns_divisionId_key_key" ON "board_columns"("divisionId", "key");

-- CreateIndex
CREATE INDEX "board_columns_organizationId_idx" ON "board_columns"("organizationId");

-- CreateIndex
CREATE INDEX "board_columns_divisionId_sortOrder_idx" ON "board_columns"("divisionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- Multi-tenant coherence trigger for board_columns
-- ═══════════════════════════════════════════════════════════════════
-- Same defense-in-depth as board_permissions_coherence_trigger: reject any row
-- whose referenced division belongs to a different org than organizationId, so a
-- future app bug can never write a cross-tenant board column. (Prisma does not
-- manage triggers → invisible to `migrate diff`, adds no drift.)
CREATE OR REPLACE FUNCTION board_columns_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  division_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO division_org_id
    FROM "divisions" WHERE "id" = NEW."divisionId";
  IF division_org_id IS NULL THEN
    RAISE EXCEPTION 'board_columns.divisionId "%" does not resolve', NEW."divisionId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF division_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'board_columns: division "%" belongs to org "%" but column references org "%"',
      NEW."divisionId", division_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS board_columns_coherence_trigger ON "board_columns";
CREATE TRIGGER board_columns_coherence_trigger
  BEFORE INSERT OR UPDATE OF "divisionId", "organizationId" ON "board_columns"
  FOR EACH ROW
  EXECUTE FUNCTION board_columns_coherence_fn();

-- ═══════════════════════════════════════════════════════════════════
-- Seed board_columns from each division's current visible columns
-- ═══════════════════════════════════════════════════════════════════
-- For every division: one column per entry in divisions.columns (preserving
-- array order); an empty/unset columns array means "all six stages" (the app
-- default), so seed all six in canonical order. Only canonical keys are seeded
-- (non-canonical entries were already filtered out by the board UI, so they
-- never rendered). Deterministic id 'bc_<divisionId>_<key>' + ON CONFLICT makes
-- this re-runnable. status stays canonical; mapsToStatus == key here.
WITH canon(key, label, ord) AS (
  VALUES
    ('backlog', 'BACKLOG', 0),
    ('todo', 'TO DO', 1),
    ('in_progress', 'IN PROGRESS', 2),
    ('testing', 'TESTING', 3),
    ('review', 'REVIEW', 4),
    ('done', 'DONE', 5)
),
raw_cols AS (
  -- configured columns (non-empty): preserve array order via ordinality
  SELECT d."id" AS division_id, d."organizationId" AS org_id, u.col_key, u.arr_ord
  FROM "divisions" d
  CROSS JOIN LATERAL unnest(d."columns") WITH ORDINALITY AS u(col_key, arr_ord)
  WHERE array_length(d."columns", 1) IS NOT NULL
  UNION ALL
  -- empty/unset columns: seed all six canonical stages, in canon order
  SELECT d."id", d."organizationId", c.key, (c.ord + 1)::bigint
  FROM "divisions" d
  CROSS JOIN canon c
  WHERE array_length(d."columns", 1) IS NULL
),
-- keep only canonical keys; dedup per (division,key). Order by CANONICAL rank
-- (canon.ord), NOT array position: the live board renders columns in canonical
-- order regardless of Division.columns order — boards/[divisionId]/page.tsx:254 filters the canonical
-- COLUMNS list as a set — so sortOrder must follow canonical rank to render
-- identically in Phase 1b. arr_ord is only the DISTINCT-ON tiebreak for dup keys.
dedup AS (
  SELECT DISTINCT ON (rc.division_id, rc.col_key)
         rc.division_id, rc.org_id, rc.col_key, c.ord AS canon_ord
  FROM raw_cols rc
  JOIN canon c ON c.key = rc.col_key
  ORDER BY rc.division_id, rc.col_key, rc.arr_ord
),
ordered AS (
  SELECT d.division_id, d.org_id, d.col_key,
         (ROW_NUMBER() OVER (PARTITION BY d.division_id ORDER BY d.canon_ord) - 1) AS sort_order
  FROM dedup d
)
INSERT INTO "board_columns"
  ("id", "organizationId", "divisionId", "key", "label", "sortOrder", "mapsToStatus", "color", "createdAt", "updatedAt")
SELECT
  'bc_' || o.division_id || '_' || o.col_key,
  o.org_id, o.division_id, o.col_key, cn.label, o.sort_order, o.col_key, NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ordered o
JOIN canon cn ON cn.key = o.col_key
ON CONFLICT ("id") DO NOTHING;
