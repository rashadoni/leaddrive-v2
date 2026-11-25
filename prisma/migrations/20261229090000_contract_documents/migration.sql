-- Documents that follow a contract (owner 2026-11-25, mock «Протокол цены и акт»):
--   price_protocol — «Qiymət razılaşdırma protokolu», an annex (Əlavə №N): goods and services with
--                    the agreed prices and the period they hold; invoices of the contract take them;
--   acceptance_act — «Təhvil-təslim aktı», made from an invoice: what was actually handed over.
-- Prices are without VAT and the document carries one VAT rate (a fraction, 0.18), as invoices do,
-- so a protocol and an invoice compare line by line.
CREATE TABLE "contract_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "documentDate" TIMESTAMP(3) NOT NULL,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "invoiceId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'AZN',
  "vatRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "signedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_documents_kind_check" CHECK ("kind" IN ('price_protocol', 'acceptance_act')),
  CONSTRAINT "contract_documents_status_check" CHECK ("status" IN ('draft', 'in_signing', 'signed', 'cancelled')),
  CONSTRAINT "contract_documents_number_check" CHECK ("number" > 0),
  CONSTRAINT "contract_documents_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contract_documents_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contract_documents_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contract_documents_contractId_kind_number_key" ON "contract_documents"("contractId", "kind", "number");
CREATE INDEX "contract_documents_organizationId_contractId_idx" ON "contract_documents"("organizationId", "contractId");
CREATE INDEX "contract_documents_invoiceId_idx" ON "contract_documents"("invoiceId");

CREATE TABLE "contract_document_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "productId" TEXT,
  "name" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(18,4),
  "unitPrice" DECIMAL(18,4) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_document_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_document_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contract_document_lines_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "contract_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contract_document_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "contract_document_lines_organizationId_documentId_idx" ON "contract_document_lines"("organizationId", "documentId");
CREATE INDEX "contract_document_lines_productId_idx" ON "contract_document_lines"("productId");

ALTER TABLE "contract_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_documents"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "contract_document_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_document_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_document_lines"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
