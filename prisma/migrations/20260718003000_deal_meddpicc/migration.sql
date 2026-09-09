-- D1 (Creatio 10X roadmap): MEDDPICC qualification JSON on deals.
-- Expand-only: nullable column, no backfill, no RLS interaction.
SET lock_timeout = '3s';
ALTER TABLE "deals" ADD COLUMN "meddpicc" JSONB;
