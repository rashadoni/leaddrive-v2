-- Cadence: workdays-only scheduling flag on SalesSequence.
-- Metadata-only ADD COLUMN with a constant default (no row rewrite / data scan),
-- so it needs no RLS toggle on the FORCE-RLS sales_sequences table.
ALTER TABLE "sales_sequences"
  ADD COLUMN IF NOT EXISTS "workdaysOnly" BOOLEAN NOT NULL DEFAULT false;
