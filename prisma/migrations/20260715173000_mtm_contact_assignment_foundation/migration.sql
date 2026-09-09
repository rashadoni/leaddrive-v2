-- Agent Mobile v2 organization/contact/workplace/assignment foundation.
-- Existing mtm_customers remain organizations/outlets for route compatibility.

CREATE TYPE "MtmContactType" AS ENUM ('DOCTOR', 'PHARMACIST', 'OTHER');
CREATE TYPE "MtmContactStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PROSPECT');
CREATE TYPE "MtmEntityAssignmentRole" AS ENUM ('PRIMARY', 'SECONDARY', 'OBSERVER');

CREATE TABLE "mtm_contacts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalCode" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "middleName" TEXT,
  "displayName" TEXT NOT NULL,
  "type" "MtmContactType" NOT NULL DEFAULT 'DOCTOR',
  "specialtyCode" TEXT,
  "specialtyName" TEXT,
  "qualificationCategory" TEXT,
  "profile" TEXT,
  "category" "MtmCustomerCategory" NOT NULL DEFAULT 'B',
  "status" "MtmContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "birthDate" DATE,
  "gender" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "messengerPhone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_contact_workplaces" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "jobTitle" TEXT,
  "department" TEXT,
  "room" TEXT,
  "phone" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "startedOn" DATE,
  "endedOn" DATE,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_contact_workplaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_contact_workplaces_dates_check"
    CHECK ("startedOn" IS NULL OR "endedOn" IS NULL OR "startedOn" <= "endedOn")
);

CREATE TABLE "mtm_customer_agent_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "MtmEntityAssignmentRole" NOT NULL DEFAULT 'PRIMARY',
  "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" DATE,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "assignedBy" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_customer_agent_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_customer_agent_assignments_dates_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
);

CREATE TABLE "mtm_contact_agent_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "MtmEntityAssignmentRole" NOT NULL DEFAULT 'PRIMARY',
  "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" DATE,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "assignedBy" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_contact_agent_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_contact_agent_assignments_dates_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
);

CREATE TABLE "mtm_field_potentials" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT,
  "contactId" TEXT,
  "brandExternalId" TEXT,
  "productExternalId" TEXT,
  "category" "MtmCustomerCategory",
  "potentialValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "coverageValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "periodStart" DATE,
  "periodEnd" DATE,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "formulaVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_field_potentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_field_potentials_subject_check"
    CHECK (num_nonnulls("customerId", "contactId") = 1),
  CONSTRAINT "mtm_field_potentials_target_check"
    CHECK (num_nonnulls("brandExternalId", "productExternalId") >= 1),
  CONSTRAINT "mtm_field_potentials_values_check"
    CHECK ("potentialValue" >= 0 AND "coverageValue" >= 0),
  CONSTRAINT "mtm_field_potentials_dates_check"
    CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodStart" <= "periodEnd")
);

CREATE UNIQUE INDEX "mtm_contacts_organizationId_externalCode_key"
  ON "mtm_contacts"("organizationId", "externalCode");
CREATE INDEX "mtm_contacts_organizationId_displayName_idx"
  ON "mtm_contacts"("organizationId", "displayName");
CREATE INDEX "mtm_contacts_organizationId_status_type_idx"
  ON "mtm_contacts"("organizationId", "status", "type");
CREATE INDEX "mtm_contacts_organizationId_specialtyCode_idx"
  ON "mtm_contacts"("organizationId", "specialtyCode");
CREATE INDEX "mtm_contacts_organizationId_category_idx"
  ON "mtm_contacts"("organizationId", "category");

CREATE INDEX "mtm_contact_workplaces_org_contact_active_idx"
  ON "mtm_contact_workplaces"("organizationId", "contactId", "endedOn", "deletedAt");
CREATE INDEX "mtm_contact_workplaces_org_customer_active_idx"
  ON "mtm_contact_workplaces"("organizationId", "customerId", "endedOn", "deletedAt");
CREATE UNIQUE INDEX "mtm_contact_workplaces_active_pair_key"
  ON "mtm_contact_workplaces"("organizationId", "contactId", "customerId")
  WHERE "endedOn" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "mtm_contact_workplaces_active_primary_key"
  ON "mtm_contact_workplaces"("organizationId", "contactId")
  WHERE "isPrimary" AND "endedOn" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX "mtm_customer_agent_assignments_org_agent_dates_idx"
  ON "mtm_customer_agent_assignments"("organizationId", "agentId", "effectiveFrom", "effectiveTo");
CREATE INDEX "mtm_customer_agent_assignments_org_customer_dates_idx"
  ON "mtm_customer_agent_assignments"("organizationId", "customerId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "mtm_customer_agent_assignments_active_key"
  ON "mtm_customer_agent_assignments"("organizationId", "customerId", "agentId")
  WHERE "effectiveTo" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "mtm_customer_agent_assignments_active_primary_key"
  ON "mtm_customer_agent_assignments"("organizationId", "customerId")
  WHERE "role" = 'PRIMARY' AND "effectiveTo" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX "mtm_contact_agent_assignments_org_agent_dates_idx"
  ON "mtm_contact_agent_assignments"("organizationId", "agentId", "effectiveFrom", "effectiveTo");
CREATE INDEX "mtm_contact_agent_assignments_org_contact_dates_idx"
  ON "mtm_contact_agent_assignments"("organizationId", "contactId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "mtm_contact_agent_assignments_active_key"
  ON "mtm_contact_agent_assignments"("organizationId", "contactId", "agentId")
  WHERE "effectiveTo" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "mtm_contact_agent_assignments_active_primary_key"
  ON "mtm_contact_agent_assignments"("organizationId", "contactId")
  WHERE "role" = 'PRIMARY' AND "effectiveTo" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX "mtm_field_potentials_org_customer_period_idx"
  ON "mtm_field_potentials"("organizationId", "customerId", "periodStart", "periodEnd");
CREATE INDEX "mtm_field_potentials_org_contact_period_idx"
  ON "mtm_field_potentials"("organizationId", "contactId", "periodStart", "periodEnd");
CREATE INDEX "mtm_field_potentials_org_brand_product_idx"
  ON "mtm_field_potentials"("organizationId", "brandExternalId", "productExternalId");

ALTER TABLE "mtm_contacts"
  ADD CONSTRAINT "mtm_contacts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_workplaces"
  ADD CONSTRAINT "mtm_contact_workplaces_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_contact_workplaces_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_contact_workplaces_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_customer_agent_assignments"
  ADD CONSTRAINT "mtm_customer_agent_assignments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_customer_agent_assignments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_customer_agent_assignments_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_agent_assignments"
  ADD CONSTRAINT "mtm_contact_agent_assignments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_contact_agent_assignments_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_contact_agent_assignments_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_field_potentials"
  ADD CONSTRAINT "mtm_field_potentials_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_field_potentials_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_field_potentials_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_contacts_tenant_isolation" ON "mtm_contacts"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_contact_workplaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_workplaces" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_contact_workplaces_tenant_isolation" ON "mtm_contact_workplaces"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_customer_agent_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_agent_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_customer_agent_assignments_tenant_isolation" ON "mtm_customer_agent_assignments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_contact_agent_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_agent_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_contact_agent_assignments_tenant_isolation" ON "mtm_contact_agent_assignments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_field_potentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_field_potentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_field_potentials_tenant_isolation" ON "mtm_field_potentials"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
