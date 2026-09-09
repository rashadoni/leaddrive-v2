-- Drop `mtm_orders`, the last surviving table of the LeadShelf domain.
--
-- WHY IT IS STILL HERE. 20260712060000_drop_leadshelf_orphan_tables dropped the
-- 22 orphaned LeadShelf tables (owner decision 2026-07-12: clean slate, no data
-- export). It ran on production at 2026-07-12 06:59 UTC and did drop this table.
-- Then 20260521145000_create_legacy_mtm_orders — added the SAME day by
-- b9ddbcb46 to repair fresh-install replay — ran at 16:50 UTC, ~10h AFTER the
-- drop, because Prisma applies pending migrations in name order regardless of
-- when they were authored. Its timestamp is May, so on production it landed
-- last and re-created the table it was written to be dropped by.
--
-- WHAT SURVIVED is therefore the two-column shim, not the real table:
--   id TEXT, "totalAmount" DOUBLE PRECISION
-- The May migrations that add "warehouseId"/"deletedAt"/DECIMAL had already run
-- in May, so they never touched this copy. Verified on production 2026-08-06:
-- 0 rows; pg_stat_all_tables n_tup_ins/upd/del all 0 (never written to, ever);
-- never autovacuumed; 0 foreign keys referencing it; owned by
-- leaddrive_migrator with NO grant to the app role `hermes` (a SELECT as hermes
-- returns "permission denied"). Every sibling table and every LeadShelf enum is
-- already gone. No application code references it.
--
-- WHY IT HAS NO RLS. scripts/rls/enable-batch-3.sql lists it, but its policy is
-- keyed on "organizationId" — a column the shim does not have. That CREATE
-- POLICY could never have succeeded, which is why the rollout left it behind
-- rather than any oversight in the rollout itself.
--
-- IDEMPOTENT AND ORDER-SAFE. On a fresh database the replay order is
-- create-shim → alter → alter → 20260712060000 (drops it) → this file (no-op).
-- On production this file does the real work. IF EXISTS covers both, and covers
-- a mid-file retry: Prisma Migrate does not guarantee a per-file transaction on
-- Postgres. The two 2026-05-21 migrations are deliberately left in place — they
-- are already applied everywhere, and a fresh install still needs the shim so
-- that mtm_soft_delete and mtm_promotions have a table to ALTER.
--
-- RUNBOOK if this fails on deploy (e.g. lock_timeout): the failed row wedges
-- every later `prisma migrate deploy` with P3009. The file is idempotent, so:
--   npx prisma migrate resolve --rolled-back 20260806140000_drop_resurrected_mtm_orders
-- then redeploy.

SET lock_timeout = '3s';

-- CASCADE is defensive only: production has 0 inbound foreign keys today. It
-- also removes any policy/index along with the table.
DROP TABLE IF EXISTS "mtm_orders" CASCADE;

-- lock_timeout is session-scoped and `migrate deploy` reuses one connection
-- across pending migrations — don't leak the 3s budget into a later migration.
RESET lock_timeout;
