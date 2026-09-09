-- Contract Editor Slice 1, Step 0.
-- Additive, nullable rich-HTML body columns. No backfill: legacy rows keep
-- renderedBody only and are seeded into bodyHtml lazily on first editor open.
-- bodyHtml is NEVER hashed — contentHash stays over renderedBody so existing
-- e-sign envelope -> ContractVersion bindings are untouched.

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "bodyHtml" TEXT;

-- AlterTable
ALTER TABLE "contract_versions" ADD COLUMN     "bodyHtml" TEXT;
