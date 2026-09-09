-- Slice 4a integrity: bind e-sign envelope to an immutable ContractVersion snapshot.
-- Additive (nullable) — backward-compat: existing envelopes keep contractVersionId = NULL
-- and the sign route falls back to Contract.renderedBody (legacy path).

ALTER TABLE "esign_envelopes"
  ADD COLUMN "contractVersionId" TEXT,
  ADD COLUMN "boundContentHash"  TEXT;

-- Foreign key: nullable reference to the version the envelope was pinned to at send.
-- ON DELETE SET NULL: if a version were ever deleted (shouldn't happen — immutable),
-- the envelope gracefully falls back to the legacy path.
ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_contractVersionId_fkey"
  FOREIGN KEY ("contractVersionId")
  REFERENCES "contract_versions"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Index for version-lookup (e.g. "find all envelopes bound to version X").
CREATE INDEX "esign_envelopes_contractVersionId_idx"
  ON "esign_envelopes"("contractVersionId");
