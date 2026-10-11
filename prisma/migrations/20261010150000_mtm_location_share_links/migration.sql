-- «Ссылка на местоположение»: a link a manager makes on the live map so that
-- somebody outside the organization can see, without signing in, where one
-- employee is right now. One row per link.
--
-- The link itself is never stored — only the SHA-256 of its token. Whoever
-- reads this table (a dump, a query that went wrong) holds no link that opens.
--
-- The policy reads `app.org_id`, the setting every tenant path in this
-- codebase sets (src/__tests__/migration-rls-setting-name.test.ts). Its
-- `app.rls_bypass` clause is not a convenience here: the public page knows
-- nothing but the token, so the one lookup by hash runs under the bypass, and
-- without the clause every link would answer «не работает».
--
-- A new table and nothing else: no existing row is touched, and the previous
-- build, which does not know the table, never reads it.

SET lock_timeout = '3s';

CREATE TABLE "mtm_location_share_links" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  CONSTRAINT "mtm_location_share_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_location_share_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key: a link can only point at an employee of
  -- its own organization, and it leaves with him.
  CONSTRAINT "mtm_location_share_links_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A SHA-256 in lowercase hex and nothing else: a token written here by
  -- mistake (it is 64 hex characters too) cannot be told from a hash by the
  -- database, but anything of another shape — a whole link, an empty string —
  -- is refused.
  CONSTRAINT "mtm_location_share_links_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mtm_location_share_links_expiresAt_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "mtm_location_share_links_viewCount_check" CHECK ("viewCount" >= 0)
);

-- Across every organization, not per organization: the public lookup has the
-- token and nothing else, and one hash must lead to one row.
CREATE UNIQUE INDEX "mtm_location_share_links_tokenHash_key" ON "mtm_location_share_links"("tokenHash");
CREATE UNIQUE INDEX "mtm_location_share_links_organizationId_id_key" ON "mtm_location_share_links"("organizationId", "id");
CREATE INDEX "mtm_location_share_links_organizationId_agentId_expiresAt_idx" ON "mtm_location_share_links"("organizationId", "agentId", "expiresAt");

ALTER TABLE "mtm_location_share_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_location_share_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_location_share_links"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Rollback is forward-safe: roll back the application code and keep the
-- table. Without the code nothing answers by a link, so every link is dead.
