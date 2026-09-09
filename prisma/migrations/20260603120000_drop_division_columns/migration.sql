-- Final retirement of the legacy Division.columns array, superseded by the
-- board_columns table (migration 20260602210000). The Prisma Client already
-- @ignore'd this field (custom columns Phase 3, commit 2e07ffbb) — so no running
-- code selects it and this DROP is window-free. The data was inert (board_columns
-- is the sole source of truth for board columns; this column was added by
-- 20260602190000 and superseded ~2h later).
ALTER TABLE "divisions" DROP COLUMN "columns";
