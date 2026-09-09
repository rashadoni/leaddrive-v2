-- KPI Arena (Phase B): count how many times a ticket went terminal
-- (resolved/closed) → active again. Feeds the per-agent reopen-rate metric.
-- Additive NOT NULL DEFAULT 0 — existing rows backfill to 0, no data rewrite.
ALTER TABLE "tickets" ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0;
