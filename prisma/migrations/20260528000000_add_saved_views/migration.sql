-- Roadmap #20 — user-defined saved views on list pages.
--
-- One view per (org, user, entityType) can be marked isDefault to apply
-- automatically when the user lands on that entity's list page. Shared
-- views (isShared=true) are visible org-wide but still attributed to a
-- creator userId for accountability.
--
-- Migration is purely additive (new table with FKs) — safe to run on a
-- live database without downtime.

CREATE TABLE "saved_views" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "entityType"     TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "filters"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isDefault"      BOOLEAN NOT NULL DEFAULT false,
  "isShared"       BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "saved_views_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "saved_views_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Per-user lookup: "show me my views for /tasks"
CREATE INDEX "saved_views_organizationId_userId_entityType_idx"
  ON "saved_views"("organizationId", "userId", "entityType");

-- Shared-views lookup: "show me org-wide views for /tasks"
CREATE INDEX "saved_views_organizationId_entityType_isShared_idx"
  ON "saved_views"("organizationId", "entityType", "isShared");
