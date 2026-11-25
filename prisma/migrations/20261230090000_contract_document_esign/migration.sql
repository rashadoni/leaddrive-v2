-- A price protocol or an acceptance act is signed the way a contract is (owner 2026-11-25,
-- mock «Протокол цены и акт»): through an e-sign envelope of the contract that names the
-- document. At send the document's text is frozen in "signedBody" with its SHA-256 in
-- "contentHash"; the envelope carries the same hash as "boundContentHash", and the signing page
-- shows — and the completion signs — only that frozen text, failing closed on any mismatch.
ALTER TABLE "contract_documents"
    ADD COLUMN IF NOT EXISTS "signedBody" TEXT,
    ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

ALTER TABLE "esign_envelopes"
    ADD COLUMN IF NOT EXISTS "documentId" TEXT;
ALTER TABLE "esign_envelopes"
    ADD CONSTRAINT "esign_envelopes_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "contract_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "esign_envelopes_documentId_idx" ON "esign_envelopes"("documentId");
