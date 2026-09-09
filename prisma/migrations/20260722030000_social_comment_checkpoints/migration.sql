-- Per-parent scheduling for paid comment extraction. No backfill: a parent is
-- registered only when it appears in an accepted, source-scoped discovery set.
SELECT set_config('app.rls_bypass', 'on', false);

CREATE TABLE "social_comment_checkpoints" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "canonicalParentUrl" TEXT NOT NULL,
  "parentExternalId" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3),
  "nextDueAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "consecutiveNoChange" INTEGER NOT NULL DEFAULT 0,
  "lastSeenCommentCount" INTEGER NOT NULL DEFAULT 0,
  "lastSeenCommentExternalId" TEXT,
  "coverageClass" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastProviderRunId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_comment_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_comment_checkpoints_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "social_comment_checkpoints_no_change_check" CHECK ("consecutiveNoChange" >= 0),
  CONSTRAINT "social_comment_checkpoints_comment_count_check" CHECK ("lastSeenCommentCount" >= 0)
);

CREATE UNIQUE INDEX "social_comment_checkpoints_org_id_key" ON "social_comment_checkpoints"("organizationId", "id");
CREATE UNIQUE INDEX "social_comment_checkpoints_org_source_url_key" ON "social_comment_checkpoints"("organizationId", "sourceId", "canonicalParentUrl");
CREATE INDEX "social_comment_checkpoints_org_source_due_idx" ON "social_comment_checkpoints"("organizationId", "sourceId", "status", "nextDueAt");
CREATE INDEX "social_comment_checkpoints_org_platform_due_idx" ON "social_comment_checkpoints"("organizationId", "platform", "status", "nextDueAt");

ALTER TABLE "social_comment_checkpoints" ADD CONSTRAINT "social_comment_checkpoints_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_comment_checkpoints" ADD CONSTRAINT "social_comment_checkpoints_organizationId_sourceId_fkey"
  FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_comment_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_comment_checkpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "social_comment_checkpoints"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'monitoring_sources';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_comment_checkpoints TO %I', app_owner);
  END IF;
END $$;

SELECT set_config('app.rls_bypass', 'off', false);
