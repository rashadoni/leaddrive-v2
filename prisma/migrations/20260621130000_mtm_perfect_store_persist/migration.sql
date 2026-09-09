-- G001b: persist the Perfect-Store composite score + grade on each shelf analysis so a cross-store
-- supervisor leaderboard can rank stores without recomputing per row. Both NULLABLE + no default →
-- instant ADD COLUMN (Postgres adds no table rewrite), no backfill: existing rows stay NULL and get
-- populated lazily the next time a COMPLETED scan is viewed/polled (the response shaper already computes
-- the exact value). The live persist-first finalize path is untouched.
ALTER TABLE "mtm_shelf_analyses" ADD COLUMN "perfectStoreScore" INTEGER;
ALTER TABLE "mtm_shelf_analyses" ADD COLUMN "perfectStoreGrade" TEXT;
