-- The counterparty's cabinet (owner 2026-11-25, mock «Кабинет контрагента»): a portal contact sees
-- «Sənədlər» — its company's contracts, price protocols, invoices and acceptance acts — only with this
-- switch on, next to the portal access switch in «Settings → Portal users». Off by default: access to
-- tickets is not access to contract amounts.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "portalDocumentsEnabled" BOOLEAN NOT NULL DEFAULT false;
