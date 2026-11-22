-- «Настройки → ИИ и расходы»: a cost that was estimated from a call's length,
-- not counted by the provider, is marked as such (owner, 2026-11-22: the page
-- is reconciled with the Google bill, and an estimate must not read as a
-- measurement). Every row written before this is a counted one or one of the
-- two per-minute fallbacks, which cannot be told apart afterwards: they stay
-- unmarked. A constant default — no table rewrite, no backfill, and a build
-- that predates the column keeps inserting.
ALTER TABLE "ai_usage" ADD COLUMN "estimated" BOOLEAN NOT NULL DEFAULT false;
