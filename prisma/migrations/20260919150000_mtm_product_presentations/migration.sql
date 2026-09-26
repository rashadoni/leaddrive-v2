-- Product presentation portfolios are independent from the HR team tree:
-- managers and agents can belong to several product groups. Presentation
-- sessions are durable field evidence and intentionally prove only that the
-- authenticated app opened/viewed a file.

SET lock_timeout = '3s';

CREATE TYPE "MtmProductGroupMemberRole" AS ENUM ('MANAGER', 'AGENT');

CREATE TABLE "mtm_product_groups" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_product_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_product_groups_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "mtm_product_groups_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_product_groups_parent_fkey"
    FOREIGN KEY ("organizationId", "parentId") REFERENCES "mtm_product_groups"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_product_groups_name_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 160)
);

CREATE UNIQUE INDEX "mtm_product_groups_organizationId_parentId_name_key"
  ON "mtm_product_groups"("organizationId", "parentId", "name");
CREATE UNIQUE INDEX "mtm_product_groups_root_name_key"
  ON "mtm_product_groups"("organizationId", "name") WHERE "parentId" IS NULL;
CREATE INDEX "mtm_product_groups_organizationId_parentId_isActive_sortOrder_idx"
  ON "mtm_product_groups"("organizationId", "parentId", "isActive", "sortOrder");

CREATE TABLE "mtm_product_group_members" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "MtmProductGroupMemberRole" NOT NULL,
  "assignedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_product_group_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_product_group_members_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_product_group_members_group_fkey"
    FOREIGN KEY ("organizationId", "groupId") REFERENCES "mtm_product_groups"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_product_group_members_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_product_group_members_organizationId_groupId_agentId_key"
  ON "mtm_product_group_members"("organizationId", "groupId", "agentId");
CREATE INDEX "mtm_product_group_members_organizationId_agentId_role_idx"
  ON "mtm_product_group_members"("organizationId", "agentId", "role");

CREATE TABLE "mtm_products" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "presentationVersion" TEXT,
  "documentId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_products_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_products_group_fkey"
    FOREIGN KEY ("organizationId", "groupId") REFERENCES "mtm_product_groups"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_products_document_fkey"
    FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_products_name_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX "mtm_products_organizationId_id_key"
  ON "mtm_products"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_products_organizationId_groupId_name_key"
  ON "mtm_products"("organizationId", "groupId", "name");
CREATE INDEX "mtm_products_organizationId_groupId_isActive_sortOrder_idx"
  ON "mtm_products"("organizationId", "groupId", "isActive", "sortOrder");
CREATE INDEX "mtm_products_organizationId_documentId_idx"
  ON "mtm_products"("organizationId", "documentId");

CREATE TABLE "mtm_presentation_sessions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientSessionId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "documentId" TEXT,
  "presentationVersion" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "lastViewedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "activeDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  "openLat" DOUBLE PRECISION,
  "openLng" DOUBLE PRECISION,
  "closeLat" DOUBLE PRECISION,
  "closeLng" DOUBLE PRECISION,
  "pageCount" INTEGER,
  "lastPage" INTEGER,
  "pagesViewed" JSONB,
  "pageEvents" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_presentation_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_presentation_sessions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_visit_fkey"
    FOREIGN KEY ("organizationId", "visitId") REFERENCES "mtm_visits"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_customer_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_product_fkey"
    FOREIGN KEY ("organizationId", "productId") REFERENCES "mtm_products"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_document_fkey"
    FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mtm_presentation_sessions_client_id_check"
    CHECK (char_length("clientSessionId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_presentation_sessions_duration_check"
    CHECK ("activeDurationSeconds" >= 0),
  CONSTRAINT "mtm_presentation_sessions_pages_check"
    CHECK (
      ("pageCount" IS NULL OR "pageCount" > 0)
      AND ("lastPage" IS NULL OR "lastPage" > 0)
      AND ("pageCount" IS NULL OR "lastPage" IS NULL OR "lastPage" <= "pageCount")
    ),
  CONSTRAINT "mtm_presentation_sessions_open_coordinates_check"
    CHECK (
      ("openLat" IS NULL AND "openLng" IS NULL)
      OR ("openLat" BETWEEN -90 AND 90 AND "openLng" BETWEEN -180 AND 180)
    ),
  CONSTRAINT "mtm_presentation_sessions_close_coordinates_check"
    CHECK (
      ("closeLat" IS NULL AND "closeLng" IS NULL)
      OR ("closeLat" BETWEEN -90 AND 90 AND "closeLng" BETWEEN -180 AND 180)
    ),
  CONSTRAINT "mtm_presentation_sessions_time_check"
    CHECK ("lastViewedAt" >= "openedAt" AND ("closedAt" IS NULL OR "closedAt" >= "openedAt"))
);

CREATE UNIQUE INDEX "mtm_presentation_sessions_organizationId_agentId_clientSessionId_key"
  ON "mtm_presentation_sessions"("organizationId", "agentId", "clientSessionId");
CREATE UNIQUE INDEX "mtm_presentation_sessions_organizationId_id_key"
  ON "mtm_presentation_sessions"("organizationId", "id");
CREATE INDEX "mtm_presentation_sessions_organizationId_visitId_openedAt_idx"
  ON "mtm_presentation_sessions"("organizationId", "visitId", "openedAt");
CREATE INDEX "mtm_presentation_sessions_organizationId_productId_openedAt_idx"
  ON "mtm_presentation_sessions"("organizationId", "productId", "openedAt");
CREATE INDEX "mtm_presentation_sessions_organizationId_agentId_openedAt_idx"
  ON "mtm_presentation_sessions"("organizationId", "agentId", "openedAt");

ALTER TABLE "mtm_product_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_product_groups" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_product_group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_product_group_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_products" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_presentation_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_presentation_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "mtm_product_groups"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY tenant_isolation ON "mtm_product_group_members"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY tenant_isolation ON "mtm_products"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY tenant_isolation ON "mtm_presentation_sessions"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
