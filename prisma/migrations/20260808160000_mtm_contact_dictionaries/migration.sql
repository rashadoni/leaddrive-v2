-- SWM-03G / SWM-FND-02: tenant-owned signed and versioned contact
-- dictionaries. This is intentionally additive and creates no dictionary
-- data; tenants remain on their current free-text behavior until an approved
-- vocabulary is explicitly activated.

SET lock_timeout = '3s';

CREATE TYPE "MtmContactDictionaryKind" AS ENUM (
  'PSYCHOTYPE',
  'PRODUCT_CATEGORY',
  'BRAND_CATEGORY'
);
CREATE TYPE "MtmContactDictionaryStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "mtm_contact_dictionaries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" "MtmContactDictionaryKind" NOT NULL,
  "version" INTEGER NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "entries" JSONB NOT NULL,
  "entriesHash" VARCHAR(64) NOT NULL,
  "approvalReference" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "status" "MtmContactDictionaryStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_contact_dictionaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_contact_dict_org_id_key"
  ON "mtm_contact_dictionaries"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_contact_dict_org_kind_version_key"
  ON "mtm_contact_dictionaries"("organizationId", "kind", "version");
CREATE INDEX "mtm_contact_dict_org_kind_status_idx"
  ON "mtm_contact_dictionaries"("organizationId", "kind", "status", "effectiveFrom");
CREATE UNIQUE INDEX "mtm_contact_dict_one_active_kind_key"
  ON "mtm_contact_dictionaries"("organizationId", "kind") WHERE "status" = 'ACTIVE';

ALTER TABLE "mtm_contact_dictionaries"
  ADD CONSTRAINT "mtm_contact_dictionaries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_contact_dictionaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_dictionaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_contact_dictionaries"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_contact_dictionaries"
  ADD CONSTRAINT "mtm_contact_dict_signature_check" CHECK (
    ("status" = 'DRAFT' AND "approvalReference" IS NULL AND "signedByUserId" IS NULL AND "signedAt" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'ACTIVE' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'RETIRED' AND "approvalReference" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
  );
