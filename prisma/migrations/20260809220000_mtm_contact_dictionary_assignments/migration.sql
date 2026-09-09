-- SWM-03: version-bound psychotype, product-category, and brand-category
-- assignments for contacts. No values are inferred or seeded from the
-- SwissMed screenshot; only tenant-approved signed dictionaries may be used.

SET lock_timeout = '3s';

ALTER TYPE "MtmContactChangeKind" ADD VALUE IF NOT EXISTS 'DICTIONARY_ASSIGNMENTS';

CREATE TABLE "mtm_contact_dictionary_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "dictionaryId" TEXT NOT NULL,
  "kind" "MtmContactDictionaryKind" NOT NULL,
  "entryCode" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "createdByUserId" TEXT,
  "requestedByAgentId" TEXT,
  "approvedByUserId" TEXT,
  "sourceRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_contact_dictionary_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_contact_dict_assignment_period_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "mtm_contact_dict_assignment_code_check"
    CHECK ("entryCode" ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'),
  CONSTRAINT "mtm_contact_dict_assignment_kind_check"
    CHECK ("kind" IN ('PSYCHOTYPE', 'PRODUCT_CATEGORY', 'BRAND_CATEGORY'))
);

CREATE UNIQUE INDEX "mtm_contact_dict_assignment_org_id_key"
  ON "mtm_contact_dictionary_assignments"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_contact_dict_assignment_history_key"
  ON "mtm_contact_dictionary_assignments"("organizationId", "contactId", "dictionaryId", "entryCode", "effectiveFrom");
CREATE UNIQUE INDEX "mtm_contact_dict_assignment_active_code_key"
  ON "mtm_contact_dictionary_assignments"("organizationId", "contactId", "kind", "entryCode")
  WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "mtm_contact_dict_assignment_active_psychotype_key"
  ON "mtm_contact_dictionary_assignments"("organizationId", "contactId")
  WHERE "effectiveTo" IS NULL AND "kind" = 'PSYCHOTYPE';
CREATE INDEX "mtm_contact_dict_assignment_contact_idx"
  ON "mtm_contact_dictionary_assignments"("organizationId", "contactId", "effectiveTo", "effectiveFrom");
CREATE INDEX "mtm_contact_dict_assignment_dictionary_idx"
  ON "mtm_contact_dictionary_assignments"("organizationId", "dictionaryId", "entryCode");
CREATE INDEX "mtm_contact_dict_assignment_updated_idx"
  ON "mtm_contact_dictionary_assignments"("organizationId", "updatedAt");

ALTER TABLE "mtm_contact_dictionary_assignments"
  ADD CONSTRAINT "mtm_contact_dict_assignment_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_dictionary_assignments"
  ADD CONSTRAINT "mtm_contact_dict_assignment_contact_fkey"
  FOREIGN KEY ("organizationId", "contactId") REFERENCES "mtm_contacts"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_dictionary_assignments"
  ADD CONSTRAINT "mtm_contact_dict_assignment_dictionary_fkey"
  FOREIGN KEY ("organizationId", "dictionaryId") REFERENCES "mtm_contact_dictionaries"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_contact_dictionary_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_dictionary_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_contact_dictionary_assignments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- The dictionary kind is duplicated for efficient filtering and uniqueness.
-- Guard it at the database boundary so direct SQL cannot attach a code to the
-- wrong vocabulary.
CREATE OR REPLACE FUNCTION mtm_contact_dictionary_assignment_guard()
RETURNS trigger AS $$
DECLARE dictionary_kind "MtmContactDictionaryKind";
DECLARE dictionary_status "MtmContactDictionaryStatus";
DECLARE dictionary_entries JSONB;
BEGIN
  SELECT "kind", "status", "entries"
    INTO dictionary_kind, dictionary_status, dictionary_entries
    FROM "mtm_contact_dictionaries"
   WHERE "organizationId" = NEW."organizationId"
     AND "id" = NEW."dictionaryId";

  IF dictionary_kind IS NULL OR dictionary_kind <> NEW."kind" THEN
    RAISE EXCEPTION 'contact dictionary assignment kind mismatch';
  END IF;
  IF TG_OP = 'INSERT' AND dictionary_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'new contact dictionary assignments require an active dictionary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(dictionary_entries) AS item
     WHERE item->>'code' = NEW."entryCode"
  ) THEN
    RAISE EXCEPTION 'contact dictionary assignment entry is not in the signed dictionary';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mtm_contact_dictionary_assignment_guard_trigger"
  BEFORE INSERT OR UPDATE OF "dictionaryId", "kind"
  ON "mtm_contact_dictionary_assignments"
  FOR EACH ROW EXECUTE FUNCTION mtm_contact_dictionary_assignment_guard();
