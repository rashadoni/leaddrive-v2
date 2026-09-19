-- Tenant-configurable person categories. Existing enum-backed contact types
-- remain as compatibility metadata while the signed dictionary becomes the
-- editable SaaS vocabulary.
ALTER TYPE "MtmContactDictionaryKind" ADD VALUE IF NOT EXISTS 'CLIENT_TYPE';

ALTER TABLE "mtm_contacts"
  ADD COLUMN IF NOT EXISTS "categoryData" JSONB NOT NULL DEFAULT '{}'::jsonb;
