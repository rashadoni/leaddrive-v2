-- R9 Nonprofit Cloud (Phase 5 slice 1).
-- Donor / Program / Donation / Grant / VolunteerActivity.

CREATE TABLE "donors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "donorType" TEXT NOT NULL DEFAULT 'individual',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "contactId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT FALSE,
    "tags" TEXT[],
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "donors"
  ADD CONSTRAINT "donors_donorType_check"
  CHECK ("donorType" IN ('individual', 'organization'));

-- Partial unique index — allows multiple no-email donors per tenant.
-- IMPORTANT: do not add @@unique([organizationId, email]) to the
-- Donor model in prisma/schema.prisma. Prisma can't model partial
-- indexes; declaring @@unique there would cause `prisma migrate dev`
-- to overwrite this with a FULL unique index and silently break the
-- "multiple no-email donors" invariant. Pattern mirrors:
--   prisma/migrations/20260424000000_ai_shadow_pending_uniq_index/
CREATE UNIQUE INDEX "donors_org_email_uniq"
  ON "donors"("organizationId", "email") WHERE "email" IS NOT NULL;

CREATE INDEX "donors_org_type_idx" ON "donors"("organizationId", "donorType");
CREATE INDEX "donors_contact_idx" ON "donors"("contactId");

ALTER TABLE "donors"
  ADD CONSTRAINT "donors_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "goalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalCurrency" TEXT NOT NULL DEFAULT 'USD',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_status_check"
  CHECK ("status" IN ('planning', 'active', 'completed', 'paused'));

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_goalAmount_check"
  CHECK ("goalAmount" >= 0);

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_dates_check"
  CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");

CREATE UNIQUE INDEX "programs_org_name_uniq" ON "programs"("organizationId", "name");
CREATE INDEX "programs_org_status_idx" ON "programs"("organizationId", "status");

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "programId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "donationType" TEXT NOT NULL DEFAULT 'one_time',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT FALSE,
    "pledgedAmount" DOUBLE PRECISION,
    "channel" TEXT,
    "taxDeductibleAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "donations"
  ADD CONSTRAINT "donations_amount_check"
  CHECK ("amount" >= 0);

ALTER TABLE "donations"
  ADD CONSTRAINT "donations_donationType_check"
  CHECK ("donationType" IN ('one_time', 'recurring'));

ALTER TABLE "donations"
  ADD CONSTRAINT "donations_taxDeductible_check"
  CHECK ("taxDeductibleAmount" IS NULL OR ("taxDeductibleAmount" >= 0 AND "taxDeductibleAmount" <= "amount"));

CREATE INDEX "donations_org_received_idx" ON "donations"("organizationId", "receivedAt");
CREATE INDEX "donations_donor_received_idx" ON "donations"("donorId", "receivedAt");
CREATE INDEX "donations_program_received_idx" ON "donations"("programId", "receivedAt");

ALTER TABLE "donations"
  ADD CONSTRAINT "donations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "donations"
  ADD CONSTRAINT "donations_donorId_fkey"
  FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "donations"
  ADD CONSTRAINT "donations_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT,
    "granterName" TEXT NOT NULL,
    "grantNumber" TEXT,
    "awardedAmount" DOUBLE PRECISION NOT NULL,
    "disbursedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'awarded',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_amounts_check"
  CHECK ("awardedAmount" >= 0 AND "disbursedAmount" >= 0 AND "spentAmount" >= 0);

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_disbursed_cap_check"
  CHECK ("disbursedAmount" <= "awardedAmount");

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_spent_cap_check"
  CHECK ("spentAmount" <= "disbursedAmount");

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_status_check"
  CHECK ("status" IN ('applied', 'awarded', 'active', 'reporting', 'closed', 'declined'));

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_period_check"
  CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" > "periodStart");

CREATE UNIQUE INDEX "grants_org_granter_number_uniq"
  ON "grants"("organizationId", "granterName", "grantNumber");

CREATE INDEX "grants_org_status_idx" ON "grants"("organizationId", "status");
CREATE INDEX "grants_program_idx" ON "grants"("programId");

ALTER TABLE "grants"
  ADD CONSTRAINT "grants_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grants"
  ADD CONSTRAINT "grants_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "volunteer_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT,
    "contactId" TEXT,
    "volunteerName" TEXT NOT NULL,
    "hoursLogged" DOUBLE PRECISION NOT NULL,
    "activityType" TEXT NOT NULL DEFAULT 'other',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "volunteer_activities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "volunteer_activities"
  ADD CONSTRAINT "volunteer_activities_hours_check"
  CHECK ("hoursLogged" >= 0 AND "hoursLogged" <= 24);

ALTER TABLE "volunteer_activities"
  ADD CONSTRAINT "volunteer_activities_type_check"
  CHECK ("activityType" IN ('event', 'office', 'fundraising', 'outreach', 'other'));

CREATE INDEX "volunteer_activities_org_occurred_idx" ON "volunteer_activities"("organizationId", "occurredAt");
CREATE INDEX "volunteer_activities_program_occurred_idx" ON "volunteer_activities"("programId", "occurredAt");
CREATE INDEX "volunteer_activities_contact_idx" ON "volunteer_activities"("contactId");

ALTER TABLE "volunteer_activities"
  ADD CONSTRAINT "volunteer_activities_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "volunteer_activities"
  ADD CONSTRAINT "volunteer_activities_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
