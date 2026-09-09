-- Service Desk foundation:
-- 1) structured ticket categories with parent/subcategory support,
-- 2) requester snapshot columns for ticket list/detail/reporting,
-- 3) pending customer-confirmation closure requests,
-- 4) additive report-friendly indexes.

CREATE TABLE "ticket_categories" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'ticket',
  "defaultPriority" TEXT,
  "defaultQueueId" TEXT,
  "isPortalVisible" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_categories_scope_check" CHECK ("scope" IN ('ticket', 'complaint', 'both')),
  CONSTRAINT "ticket_categories_defaultPriority_check" CHECK (
    "defaultPriority" IS NULL OR "defaultPriority" IN ('low', 'medium', 'high', 'critical')
  )
);

ALTER TABLE "tickets" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "requesterName" TEXT;
ALTER TABLE "tickets" ADD COLUMN "requesterEmail" TEXT;
ALTER TABLE "tickets" ADD COLUMN "requesterPhone" TEXT;
ALTER TABLE "tickets" ADD COLUMN "requesterExternalId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "requesterMeta" JSONB;

CREATE TABLE "ticket_closure_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "channel" TEXT,
  "recipient" TEXT,
  "tokenHash" TEXT,
  "requestedBy" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_closure_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_closure_requests_status_check" CHECK (
    "status" IN ('pending', 'confirmed', 'rejected', 'expired', 'canceled')
  )
);

CREATE UNIQUE INDEX "ticket_categories_organizationId_slug_key"
  ON "ticket_categories"("organizationId", "slug");
CREATE INDEX "ticket_categories_organizationId_parentId_idx"
  ON "ticket_categories"("organizationId", "parentId");
CREATE INDEX "ticket_categories_organizationId_scope_idx"
  ON "ticket_categories"("organizationId", "scope");
CREATE INDEX "ticket_categories_organizationId_isActive_idx"
  ON "ticket_categories"("organizationId", "isActive");
CREATE INDEX "ticket_categories_defaultQueueId_idx"
  ON "ticket_categories"("defaultQueueId");

CREATE UNIQUE INDEX "ticket_closure_requests_tokenHash_key"
  ON "ticket_closure_requests"("tokenHash");
CREATE INDEX "ticket_closure_requests_organizationId_status_dueAt_idx"
  ON "ticket_closure_requests"("organizationId", "status", "dueAt");
CREATE INDEX "ticket_closure_requests_organizationId_ticketId_idx"
  ON "ticket_closure_requests"("organizationId", "ticketId");
CREATE INDEX "ticket_closure_requests_ticketId_status_idx"
  ON "ticket_closure_requests"("ticketId", "status");
-- Prisma cannot express partial unique indexes. This prevents two simultaneous
-- pending closure confirmations for one ticket while preserving history.
CREATE UNIQUE INDEX "ticket_closure_requests_ticket_pending_unique_idx"
  ON "ticket_closure_requests"("ticketId")
  WHERE "status" = 'pending';

CREATE INDEX "tickets_organizationId_categoryId_idx"
  ON "tickets"("organizationId", "categoryId");
CREATE INDEX "tickets_organizationId_source_idx"
  ON "tickets"("organizationId", "source");
CREATE INDEX "tickets_organizationId_createdAt_idx"
  ON "tickets"("organizationId", "createdAt");
CREATE INDEX "tickets_organizationId_resolvedAt_idx"
  ON "tickets"("organizationId", "resolvedAt");
CREATE INDEX "tickets_organizationId_closedAt_idx"
  ON "tickets"("organizationId", "closedAt");
CREATE INDEX "tickets_organizationId_slaDueAt_idx"
  ON "tickets"("organizationId", "slaDueAt");

ALTER TABLE "ticket_categories"
  ADD CONSTRAINT "ticket_categories_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_categories"
  ADD CONSTRAINT "ticket_categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_categories"
  ADD CONSTRAINT "ticket_categories_defaultQueueId_fkey"
  FOREIGN KEY ("defaultQueueId") REFERENCES "ticket_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_closure_requests"
  ADD CONSTRAINT "ticket_closure_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_closure_requests"
  ADD CONSTRAINT "ticket_closure_requests_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the legacy categories for every tenant so existing forms and reports
-- have stable targets before the category builder UI exists.
INSERT INTO "ticket_categories" (
  "id", "organizationId", "name", "slug", "scope", "defaultPriority",
  "isPortalVisible", "isActive", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  seed."name",
  seed."slug",
  seed."scope",
  seed."defaultPriority",
  seed."isPortalVisible",
  true,
  seed."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (
  VALUES
    ('General', 'general', 'ticket', 'medium', true, 10),
    ('Technical', 'technical', 'ticket', 'medium', true, 20),
    ('Billing', 'billing', 'ticket', 'medium', true, 30),
    ('Feature Request', 'feature_request', 'ticket', 'low', true, 40),
    ('Complaint', 'complaint', 'complaint', 'high', true, 50)
) AS seed("name", "slug", "scope", "defaultPriority", "isPortalVisible", "sortOrder")
ON CONFLICT ("organizationId", "slug") DO NOTHING;

-- Preserve any tenant-specific free-form category values that may have already
-- been written despite the current UI/API enums.
INSERT INTO "ticket_categories" (
  "id", "organizationId", "name", "slug", "scope", "isPortalVisible",
  "isActive", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  distinct_categories."organizationId",
  initcap(replace(distinct_categories."category", '_', ' ')),
  distinct_categories."slug",
  CASE WHEN distinct_categories."category" = 'complaint' THEN 'complaint' ELSE 'ticket' END,
  true,
  true,
  100,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    t."organizationId",
    t."category",
    left(
      nullif(regexp_replace(lower(trim(t."category")), '[^a-z0-9]+', '_', 'g'), ''),
      96
    ) AS "slug"
  FROM "tickets" t
  WHERE t."category" IS NOT NULL AND trim(t."category") <> ''
) AS distinct_categories
WHERE distinct_categories."slug" IS NOT NULL
ON CONFLICT ("organizationId", "slug") DO NOTHING;

UPDATE "tickets" t
SET "categoryId" = c."id"
FROM "ticket_categories" c
WHERE c."organizationId" = t."organizationId"
  AND c."slug" = left(
    nullif(regexp_replace(lower(trim(t."category")), '[^a-z0-9]+', '_', 'g'), ''),
    96
  )
  AND t."categoryId" IS NULL;

UPDATE "tickets" t
SET
  "requesterName" = COALESCE(c."fullName", c."email", c."phone"),
  "requesterEmail" = c."email",
  "requesterPhone" = c."phone"
FROM "contacts" c
WHERE c."id" = t."contactId"
  AND c."organizationId" = t."organizationId";
