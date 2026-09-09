-- Add brand/category segmentation fields (TT §3.3)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "category" TEXT;

CREATE INDEX IF NOT EXISTS "contacts_orgId_brand_idx" ON "contacts"("organizationId", "brand");
CREATE INDEX IF NOT EXISTS "contacts_orgId_category_idx" ON "contacts"("organizationId", "category");
CREATE INDEX IF NOT EXISTS "leads_orgId_brand_idx" ON "leads"("organizationId", "brand");
CREATE INDEX IF NOT EXISTS "leads_orgId_category_idx" ON "leads"("organizationId", "category");
