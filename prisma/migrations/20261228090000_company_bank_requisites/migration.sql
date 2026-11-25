-- A counterparty's bank requisites on its company card (contract wizard, owner 2026-11-25).
-- The tax registry gives name, address and director by VÖEN but no bank; the bank is typed in
-- once and saved here, so the next contract with the company fills it by itself. The names
-- mirror the organisation's own requisites in settings.invoice (bankName … bankCorrAccount).
-- Nullable text, no backfill: existing companies simply have no bank yet.
ALTER TABLE "companies"
    ADD COLUMN IF NOT EXISTS "bankName" TEXT,
    ADD COLUMN IF NOT EXISTS "bankCode" TEXT,
    ADD COLUMN IF NOT EXISTS "bankSwift" TEXT,
    ADD COLUMN IF NOT EXISTS "bankAccount" TEXT,
    ADD COLUMN IF NOT EXISTS "bankVoen" TEXT,
    ADD COLUMN IF NOT EXISTS "bankCorrAccount" TEXT;
