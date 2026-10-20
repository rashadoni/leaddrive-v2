-- Presentations: who sees each one, and deleting one (owner, 2026-10-21:
-- «нет удаления презентации и ещё нет выбора презентации… я хочу выбрать
-- несколько презентаций и указать, для какого агента будут видны»).
--
-- * mtm_product_viewers — the field agents who get a presentation in the app.
--   Until now a field agent got every presentation of a group he was ticked
--   in (and of its subgroups); from now on each presentation has its own list.
-- * mtm_products.deletedAt / deletedByUserId — a deleted presentation keeps
--   its row: its showings (mtm_presentation_sessions) reference it with
--   ON DELETE RESTRICT, and the visit history reads its name from it.
-- * A presentation's name is unique among the live presentations of its group
--   only, so «Forlaks» can be uploaded again after the old one was deleted.
--
-- The backfill copies today's visibility exactly: each live presentation gets
-- the field agents ticked in its group or in any group above it, along the same
-- active groups `expandVisibleProductGroupIds` walks. Nobody gains or loses a
-- presentation on the day this runs.
--
-- The policies read `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts).

SET lock_timeout = '3s';

ALTER TABLE "mtm_products" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_products" ADD COLUMN "deletedByUserId" TEXT;

DROP INDEX "mtm_products_organizationId_groupId_name_key";
CREATE UNIQUE INDEX "mtm_products_live_name_key"
  ON "mtm_products"("organizationId", "groupId", "name")
  WHERE "deletedAt" IS NULL;

CREATE TABLE "mtm_product_viewers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "assignedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_product_viewers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_product_viewers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a row joins a presentation and an agent
  -- of one organization only.
  CONSTRAINT "mtm_product_viewers_product_fkey"
    FOREIGN KEY ("organizationId", "productId") REFERENCES "mtm_products"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_product_viewers_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_product_viewers_organizationId_productId_agentId_key"
  ON "mtm_product_viewers"("organizationId", "productId", "agentId");
CREATE INDEX "mtm_product_viewers_organizationId_agentId_idx"
  ON "mtm_product_viewers"("organizationId", "agentId");

ALTER TABLE "mtm_product_viewers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_product_viewers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_product_viewers"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- The product tables are under FORCE ROW LEVEL SECURITY and a migration runs
-- without `app.org_id`: without the bypass the backfill would read no rows and
-- succeed having copied nothing.
SELECT set_config('app.rls_bypass', 'on', false);

INSERT INTO "mtm_product_viewers" ("id", "organizationId", "productId", "agentId", "createdAt")
WITH RECURSIVE "chain" ("organizationId", "groupId", "ancestorId", "parentId", "depth") AS (
  SELECT g."organizationId", g."id", g."id", g."parentId", 0
    FROM "mtm_product_groups" g
   WHERE g."isActive"
  UNION ALL
  SELECT c."organizationId", c."groupId", p."id", p."parentId", c."depth" + 1
    FROM "chain" c
    JOIN "mtm_product_groups" p
      ON p."organizationId" = c."organizationId" AND p."id" = c."parentId" AND p."isActive"
   WHERE c."depth" < 64
)
SELECT 'mpv_' || md5(v."organizationId" || ':' || v."productId" || ':' || v."agentId"),
       v."organizationId", v."productId", v."agentId", CURRENT_TIMESTAMP
  FROM (
    SELECT DISTINCT pr."organizationId", pr."id" AS "productId", m."agentId"
      FROM "mtm_products" pr
      JOIN "chain" c
        ON c."organizationId" = pr."organizationId" AND c."groupId" = pr."groupId"
      JOIN "mtm_product_group_members" m
        ON m."organizationId" = c."organizationId" AND m."groupId" = c."ancestorId" AND m."role" = 'AGENT'
     WHERE pr."isActive" AND pr."deletedAt" IS NULL
  ) v
ON CONFLICT DO NOTHING;

SELECT set_config('app.rls_bypass', 'off', false);

-- Rollback is forward-safe: the group memberships are left as they were, so
-- the previous build, which reads only them, shows every agent what it showed
-- before. A presentation deleted by the new build is also set inactive, which
-- the previous build already hides from the app.
