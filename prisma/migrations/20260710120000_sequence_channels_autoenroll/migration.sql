-- Cadence P2-5: auto-enroll sources on SalesSequence.
-- (SMS/WhatsApp step types need no schema — SequenceStep.type is a free-text
--  string with no CHECK constraint; the new values are enforced in zod only.)
--
-- sales_sequences runs FORCE ROW LEVEL SECURITY in production, but ADD COLUMN
-- with a constant default is a metadata-only change (no row rewrite, no data
-- scan), so it needs no RLS toggle.
ALTER TABLE "sales_sequences"
  ADD COLUMN IF NOT EXISTS "autoEnrollSources" TEXT[] NOT NULL DEFAULT '{}';
