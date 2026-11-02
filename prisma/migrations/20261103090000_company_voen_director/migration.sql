-- Company card by VÖEN: the legal representative from the tax registry, and
-- an index for the «this VÖEN is already in your companies» warning.
ALTER TABLE "companies" ADD COLUMN "director" TEXT;
CREATE INDEX "companies_organizationId_voen_idx" ON "companies"("organizationId", "voen");
