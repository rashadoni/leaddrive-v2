-- L1/L2 App marketplace (Phase 5 slice 1).
-- Global App catalog + per-tenant AppInstallation.

CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "summary" TEXT,
    "vendor" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "isFirstParty" BOOLEAN NOT NULL DEFAULT FALSE,
    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
    "category" TEXT,
    "iconUrl" TEXT,
    "docsUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "apps_slug_key" ON "apps"("slug");

CREATE INDEX "apps_category_isPublic_idx" ON "apps"("category", "isPublic");

CREATE TABLE "app_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "installedBy" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uninstalledAt" TIMESTAMP(3),
    CONSTRAINT "app_installations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "app_installations"
  ADD CONSTRAINT "app_installations_status_check"
  CHECK ("status" IN ('active', 'disabled'));

CREATE UNIQUE INDEX "app_installations_org_app_uniq"
  ON "app_installations"("organizationId", "appId");

CREATE INDEX "app_installations_org_idx" ON "app_installations"("organizationId");
CREATE INDEX "app_installations_app_idx" ON "app_installations"("appId");

ALTER TABLE "app_installations"
  ADD CONSTRAINT "app_installations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_installations"
  ADD CONSTRAINT "app_installations_appId_fkey"
  FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
