-- Brings three production tables back to what schema.prisma declares. Found by
-- comparing a schema-only dump of production 13.140.132.245 (2026-10-21) with
-- `prisma migrate diff --to-schema-datamodel`; the owner approved this set on
-- 2026-10-22. Everything else in that diff is either cosmetic (constraint and
-- index names, ON UPDATE clauses on keys that never change) or raw SQL the
-- migrations created on purpose (tenant cascades, partial and vector indexes),
-- and is deliberately left alone.
--
-- Three more differences are fixed in schema.prisma only, because there the
-- database is right and the schema was not: loyalty_transactions expiry columns
-- are TIMESTAMPTZ, meter_readings corrections are ON DELETE RESTRICT, and
-- workforce_workday_schedule_snapshots defaults to schemaVersion 2.
--
-- Each step checks the current shape first, so the file is safe to re-run after
-- a lock_timeout (Prisma Migrate gives no per-file transaction guarantee) and on
-- a database that never had the drift.

SET lock_timeout = '5s';

-- 1. kb_embeddings.embedding: NOT NULL since 20260415070000_add_kb_embeddings,
--    and embedKbArticle() never writes a row without a vector, but production
--    had lost the constraint (no migration drops it). 13 rows, none NULL on
--    2026-10-21; if a NULL has appeared since, this fails loudly rather than
--    deleting anything. The file is idempotent, so recovery is
--    `npx prisma migrate resolve --rolled-back 20261027090000_prod_schema_drift_alignment`
--    on the server and a redeploy once the row is dealt with.
ALTER TABLE "kb_embeddings" ALTER COLUMN "embedding" SET NOT NULL;

-- 2. donors.tags: 20260517150000_nonprofit created it without the empty-array
--    default the schema declares, so a raw INSERT leaves NULL where Prisma
--    expects a list. Only the default changes; existing rows (none on
--    production) keep their value. The column stays nullable, as Prisma itself
--    renders scalar lists.
ALTER TABLE "donors" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];

-- 3. _ContractToContractTag: Prisma 6 gives implicit many-to-many tables a
--    primary key on (A, B) instead of a unique index. Same columns and the same
--    uniqueness, so the key is built from the existing index without a rescan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"_ContractToContractTag"'::regclass AND contype = 'p'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_class
       WHERE relname = '_ContractToContractTag_AB_unique' AND relkind = 'i'
    ) THEN
      -- The index is renamed to the constraint's name by Postgres itself.
      ALTER TABLE "_ContractToContractTag"
        ADD CONSTRAINT "_ContractToContractTag_AB_pkey"
        PRIMARY KEY USING INDEX "_ContractToContractTag_AB_unique";
    ELSE
      ALTER TABLE "_ContractToContractTag"
        ADD CONSTRAINT "_ContractToContractTag_AB_pkey" PRIMARY KEY ("A", "B");
    END IF;
  END IF;
END $$;
