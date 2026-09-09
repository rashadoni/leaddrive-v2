-- Tenant-scoped lifecycle for already-approved TikTok publications only.
-- No backfill: existing envelopes must be explicitly approved/reactivated before
-- they can enter a paid revisit queue.
SELECT set_config('app.rls_bypass', 'on', false);

CREATE TABLE "tiktok_publication_revisits" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ingestEnvelopeId" TEXT NOT NULL,
  "postExternalId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "lastCheckedAt" TIMESTAMP(3),
  "nextDueAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reactivationGeneration" INTEGER NOT NULL DEFAULT 0,
  "lastSeenCommentCount" INTEGER NOT NULL DEFAULT 0,
  "coverageClass" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tiktok_publication_revisits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tiktok_publication_revisits_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "tiktok_publication_revisits_comment_count_check" CHECK ("lastSeenCommentCount" >= 0),
  CONSTRAINT "tiktok_publication_revisits_generation_check" CHECK ("reactivationGeneration" >= 0)
);
CREATE UNIQUE INDEX "tiktok_publication_revisits_org_id_key" ON "tiktok_publication_revisits"("organizationId", "id");
CREATE UNIQUE INDEX "tiktok_publication_revisits_org_envelope_key" ON "tiktok_publication_revisits"("organizationId", "ingestEnvelopeId");
CREATE UNIQUE INDEX "tiktok_publication_revisits_org_post_key" ON "tiktok_publication_revisits"("organizationId", "postExternalId");
CREATE INDEX "tiktok_publication_revisits_org_due_idx" ON "tiktok_publication_revisits"("organizationId", "status", "nextDueAt");
ALTER TABLE "tiktok_publication_revisits" ADD CONSTRAINT "tiktok_publication_revisits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiktok_publication_revisits" ADD CONSTRAINT "tiktok_publication_revisits_organizationId_ingestEnvelopeId_fkey" FOREIGN KEY ("organizationId", "ingestEnvelopeId") REFERENCES "ingest_envelopes"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiktok_publication_revisits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_publication_revisits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tiktok_publication_revisits"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ingest_envelopes';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tiktok_publication_revisits TO %I', app_owner);
  END IF;
END $$;
SELECT set_config('app.rls_bypass', 'off', false);
