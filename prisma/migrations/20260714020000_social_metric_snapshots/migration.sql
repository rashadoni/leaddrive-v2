-- Social Monitoring provider metrics are observations, not mutable counters.
-- Preserve every provider timestamp so historical views/likes/comments/shares
-- can be evaluated without overwriting the previous value.

SELECT set_config('app.rls_bypass', 'on', false);

CREATE TABLE "social_metric_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT,
  "providerRunId" TEXT,
  "platform" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "parentUrl" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "views" BIGINT,
  "likes" BIGINT,
  "comments" BIGINT,
  "shares" BIGINT,
  "reactions" BIGINT,
  "providerKey" TEXT NOT NULL,
  "adapterKey" TEXT NOT NULL,
  "providerItemId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "social_metric_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_metric_snapshots_nonnegative_check" CHECK (
    ("views" IS NULL OR "views" >= 0)
    AND ("likes" IS NULL OR "likes" >= 0)
    AND ("comments" IS NULL OR "comments" >= 0)
    AND ("shares" IS NULL OR "shares" >= 0)
    AND ("reactions" IS NULL OR "reactions" >= 0)
  ),
  CONSTRAINT "social_metric_snapshots_has_metric_check" CHECK (
    "views" IS NOT NULL OR "likes" IS NOT NULL OR "comments" IS NOT NULL
    OR "shares" IS NOT NULL OR "reactions" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "social_metric_snapshots_org_identity_observed_key"
  ON "social_metric_snapshots"(
    "organizationId", "platform", "externalId", "providerKey", "adapterKey", "observedAt"
  );
CREATE INDEX "social_metric_snapshots_mention_observed_idx"
  ON "social_metric_snapshots"("organizationId", "mentionId", "observedAt");
CREATE INDEX "social_metric_snapshots_platform_observed_idx"
  ON "social_metric_snapshots"("organizationId", "platform", "observedAt");
CREATE INDEX "social_metric_snapshots_provider_run_idx"
  ON "social_metric_snapshots"("organizationId", "providerRunId");

ALTER TABLE "social_metric_snapshots"
  ADD CONSTRAINT "social_metric_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_metric_snapshots"
  ADD CONSTRAINT "social_metric_snapshots_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_metric_snapshots"
  ADD CONSTRAINT "social_metric_snapshots_organizationId_providerRunId_fkey"
  FOREIGN KEY ("organizationId", "providerRunId")
  REFERENCES "social_provider_runs"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- Existing social_mentions.reach/engagement values have no trustworthy
-- provider observation timestamp or metric decomposition. Creating synthetic
-- history would make the evaluator lie, so this migration intentionally has
-- no data backfill; the first real provider observation starts each series.

ALTER TABLE "social_metric_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_metric_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "social_metric_snapshots"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Dedicated migration-role installs need explicit DML for the application
-- role. The role is derived from the long-lived social_mentions owner.
DO $$
DECLARE
  app_owner text;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'social_mentions';

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_metric_snapshots TO %I',
      app_owner
    );
  END IF;
END $$;

SELECT set_config('app.rls_bypass', 'off', false);
