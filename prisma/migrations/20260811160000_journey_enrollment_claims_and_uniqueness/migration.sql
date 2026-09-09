-- Prisma does not wrap PostgreSQL migrations in a transaction by default.
-- Install nullable compatibility columns in a short, idempotent DDL phase.
-- ACCESS EXCLUSIVE is therefore released before the longer cleanup/index
-- phase and cannot block readers for that whole window. Fail quickly instead
-- of leaving a deploy waiting indefinitely behind an existing transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- `invoiceId` reached schema.prisma without a matching historical migration.
-- Repair migrations-only databases while remaining compatible with production
-- databases where the column was created through an earlier schema sync.
ALTER TABLE "journey_enrollments"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "processingToken" TEXT,
  ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3);

COMMIT;

-- The data/index phase blocks enrollment writes so an old application bundle
-- cannot insert a duplicate between cleanup and unique-index installation.
-- ACCESS SHARE remains compatible, so ordinary reads continue during this
-- phase. A failure rolls this whole phase back; the DDL above is retry-safe.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE "journey_enrollments" IN SHARE ROW EXCLUSIVE MODE;

CREATE INDEX IF NOT EXISTS "journey_enrollments_invoiceId_idx"
  ON "journey_enrollments"("invoiceId");

CREATE INDEX "journey_enrollments_status_nextActionAt_idx"
  ON "journey_enrollments"("status", "nextActionAt");

CREATE INDEX "journey_enrollments_processingLeaseUntil_idx"
  ON "journey_enrollments"("processingLeaseUntil");

-- Preserve the oldest deterministic winner and terminalize duplicate
-- non-invoice lead enrollments before installing the partial unique index.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "journeyId", "leadId"
      ORDER BY "enrolledAt" ASC, "id" ASC
    ) AS row_number
  FROM "journey_enrollments"
  WHERE "invoiceId" IS NULL
    AND "leadId" IS NOT NULL
    AND "status" IN ('active', 'paused')
)
UPDATE "journey_enrollments" AS enrollment
SET
  "status" = 'failed',
  "nextActionAt" = NULL,
  "processingToken" = NULL,
  "processingLeaseUntil" = NULL,
  "completedAt" = COALESCE(enrollment."completedAt", CURRENT_TIMESTAMP),
  "exitReason" = 'duplicate_enrollment_migration'
FROM ranked
WHERE enrollment."id" = ranked."id"
  AND ranked.row_number > 1;

-- Invoice communication chains are also single-active per invoice. Two
-- parallel `start` requests previously passed the read-before-create check and
-- could schedule duplicate reminders. Preserve one deterministic winner before
-- installing the database authority used by the API's P2002 -> 409 path.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "invoiceId"
      ORDER BY "enrolledAt" ASC, "id" ASC
    ) AS row_number
  FROM "journey_enrollments"
  WHERE "invoiceId" IS NOT NULL
    AND "status" IN ('active', 'paused')
)
UPDATE "journey_enrollments" AS enrollment
SET
  "status" = 'failed',
  "nextActionAt" = NULL,
  "processingToken" = NULL,
  "processingLeaseUntil" = NULL,
  "completedAt" = COALESCE(enrollment."completedAt", CURRENT_TIMESTAMP),
  "exitReason" = 'duplicate_enrollment_migration'
FROM ranked
WHERE enrollment."id" = ranked."id"
  AND ranked.row_number > 1;

-- Repeat for contacts. Rows with both target columns populated are protected
-- by both indexes; valid API-created rows have exactly one target.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "journeyId", "contactId"
      ORDER BY "enrolledAt" ASC, "id" ASC
    ) AS row_number
  FROM "journey_enrollments"
  WHERE "invoiceId" IS NULL
    AND "contactId" IS NOT NULL
    AND "status" IN ('active', 'paused')
)
UPDATE "journey_enrollments" AS enrollment
SET
  "status" = 'failed',
  "nextActionAt" = NULL,
  "processingToken" = NULL,
  "processingLeaseUntil" = NULL,
  "completedAt" = COALESCE(enrollment."completedAt", CURRENT_TIMESTAMP),
  "exitReason" = 'duplicate_enrollment_migration'
FROM ranked
WHERE enrollment."id" = ranked."id"
  AND ranked.row_number > 1;

-- Paused rows are still included in Journey.activeCount by the application.
-- Reconcile only journeys touched by this migration so terminalized duplicates
-- do not leave inflated counters.
UPDATE "journeys" AS journey
SET "activeCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "journey_enrollments" AS enrollment
  WHERE enrollment."journeyId" = journey."id"
    AND enrollment."status" IN ('active', 'paused')
)
WHERE EXISTS (
  SELECT 1
  FROM "journey_enrollments" AS duplicate
  WHERE duplicate."journeyId" = journey."id"
    AND duplicate."exitReason" = 'duplicate_enrollment_migration'
);

CREATE UNIQUE INDEX "journey_enrollments_active_lead_unique"
  ON "journey_enrollments"("organizationId", "journeyId", "leadId")
  WHERE "invoiceId" IS NULL
    AND "leadId" IS NOT NULL
    AND "status" IN ('active', 'paused');

CREATE UNIQUE INDEX "journey_enrollments_active_contact_unique"
  ON "journey_enrollments"("organizationId", "journeyId", "contactId")
  WHERE "invoiceId" IS NULL
    AND "contactId" IS NOT NULL
    AND "status" IN ('active', 'paused');

CREATE UNIQUE INDEX "journey_enrollments_active_invoice_unique"
  ON "journey_enrollments"("organizationId", "invoiceId")
  WHERE "invoiceId" IS NOT NULL
    AND "status" IN ('active', 'paused');

COMMIT;
