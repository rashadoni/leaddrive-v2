-- GAP-003 / SwissMed contact master parity. Additive fields preserve existing
-- consumers while the reviewed-change envelope keeps agent proposals separate
-- from authoritative master data.

ALTER TYPE "MtmContactStatus" ADD VALUE IF NOT EXISTS 'DUPLICATE';
ALTER TYPE "MtmContactStatus" ADD VALUE IF NOT EXISTS 'MERGED';

CREATE TYPE "MtmContactChangeKind" AS ENUM (
  'CONTACT_UPDATE',
  'WORKPLACE_UPSERT',
  'WORKPLACE_END',
  'DUPLICATE_REPORT'
);

ALTER TABLE "mtm_contacts"
  ADD COLUMN "workPhone" TEXT,
  ADD COLUMN "homePhone" TEXT,
  ADD COLUMN "mobilePhone" TEXT,
  ADD COLUMN "viberPhone" TEXT,
  ADD COLUMN "whatsappPhone" TEXT,
  ADD COLUMN "telegramPhone" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressLocality" TEXT,
  ADD COLUMN "addressDistrict" TEXT,
  ADD COLUMN "addressStreet" TEXT,
  ADD COLUMN "productCategory" TEXT,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "consentStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "contactPreference" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedBy" TEXT,
  ADD COLUMN "duplicateOfContactId" TEXT;

CREATE TABLE "mtm_contact_change_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "kind" "MtmContactChangeKind" NOT NULL,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedContactUpdatedAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_contact_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_contact_change_requests_organizationId_idempotencyKey_key"
  ON "mtm_contact_change_requests"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_contact_change_requests_organizationId_status_submittedAt_idx"
  ON "mtm_contact_change_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_contact_change_requests_organizationId_contactId_submittedAt_idx"
  ON "mtm_contact_change_requests"("organizationId", "contactId", "submittedAt");
CREATE INDEX "mtm_contact_change_requests_requestedByAgentId_status_idx"
  ON "mtm_contact_change_requests"("requestedByAgentId", "status");
CREATE INDEX "mtm_contacts_organizationId_verificationStatus_idx"
  ON "mtm_contacts"("organizationId", "verificationStatus");
CREATE INDEX "mtm_contacts_organizationId_duplicateOfContactId_idx"
  ON "mtm_contacts"("organizationId", "duplicateOfContactId");

ALTER TABLE "mtm_contacts"
  ADD CONSTRAINT "mtm_contacts_duplicateOfContactId_fkey"
  FOREIGN KEY ("duplicateOfContactId") REFERENCES "mtm_contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_change_requests"
  ADD CONSTRAINT "mtm_contact_change_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_change_requests"
  ADD CONSTRAINT "mtm_contact_change_requests_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_contact_change_requests"
  ADD CONSTRAINT "mtm_contact_change_requests_requestedByAgentId_fkey"
  FOREIGN KEY ("requestedByAgentId") REFERENCES "mtm_agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_contacts"
  ADD CONSTRAINT "mtm_contacts_verification_status_check"
  CHECK ("verificationStatus" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
  ADD CONSTRAINT "mtm_contacts_consent_status_check"
  CHECK ("consentStatus" IN ('UNKNOWN', 'GRANTED', 'REVOKED')),
  ADD CONSTRAINT "mtm_contacts_contact_preference_check"
  CHECK (
    "contactPreference" IS NULL OR
    "contactPreference" IN ('PHONE', 'EMAIL', 'WHATSAPP', 'VIBER', 'TELEGRAM', 'DO_NOT_CONTACT')
  );
