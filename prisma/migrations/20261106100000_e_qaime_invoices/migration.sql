-- Finance → «E-qaimə» (owner, 2026-10-26: «Да, e-qaimə — вкладкой в
-- «Финансах»», after accountants told him they open and download every
-- electronic invoice from the tax portal one by one).
--
-- e_qaime_invoices holds the invoices the LeadDrive Chrome extension read from
-- new.e-taxes.gov.az in an accountant's browser. One row per invoice per
-- company it was read for (the same invoice is outgoing for its seller and
-- incoming for its buyer, and one organization may keep the books of both).
-- Amounts carry six decimals because the portal writes them so.
--
-- A new, empty table: nothing to backfill. The policy reads `app.org_id`, the
-- setting every tenant path in this codebase sets
-- (src/__tests__/migration-rls-setting-name.test.ts).

SET lock_timeout = '3s';

CREATE TABLE "e_qaime_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownVoen" TEXT NOT NULL,
    "ownName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "priorSystem" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT,
    "serialNumber" TEXT NOT NULL,
    "kind" TEXT,
    "docType" TEXT,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "counterpartyVoen" TEXT,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyCompanyId" TEXT,
    "netAmount" DECIMAL(20,6) NOT NULL,
    "vatAmount" DECIMAL(20,6) NOT NULL,
    "exciseAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "roadTaxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL,
    "comment" TEXT,
    "comment2" TEXT,
    "items" JSONB NOT NULL,
    "sourceSerials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pdfFile" TEXT,
    "pdfSize" INTEGER,
    "importedByUserId" TEXT,
    "portalSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "e_qaime_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "e_qaime_invoices_direction_check" CHECK ("direction" IN ('inbox', 'outbox'))
);

CREATE INDEX "e_qaime_invoices_organizationId_direction_issuedAt_idx" ON "e_qaime_invoices"("organizationId", "direction", "issuedAt");
CREATE INDEX "e_qaime_invoices_organizationId_serialNumber_idx" ON "e_qaime_invoices"("organizationId", "serialNumber");
CREATE INDEX "e_qaime_invoices_organizationId_counterpartyVoen_idx" ON "e_qaime_invoices"("organizationId", "counterpartyVoen");
CREATE UNIQUE INDEX "e_qaime_invoices_organizationId_ownVoen_direction_portalId__key" ON "e_qaime_invoices"("organizationId", "ownVoen", "direction", "portalId", "priorSystem");

ALTER TABLE "e_qaime_invoices" ADD CONSTRAINT "e_qaime_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "e_qaime_invoices" ADD CONSTRAINT "e_qaime_invoices_counterpartyCompanyId_fkey" FOREIGN KEY ("counterpartyCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "e_qaime_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "e_qaime_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "e_qaime_invoices"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
