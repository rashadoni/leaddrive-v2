-- Campaign bounce and spam counters, from the email logs that already hold them.
--
-- Until 2026-09-21 nothing wrote Campaign.totalBounced / totalSpam or
-- CampaignVariant.totalBounced: the Resend webhook marked the email_logs row
-- «bounced» / «complained» and stopped there. From this release the webhook
-- adds one per log on its first such event; this backfill brings the counters
-- up to what the logs recorded before it.
--
-- GREATEST, not +=: running it twice changes nothing, and a counter is never
-- lowered — the demo tenant's seeded campaigns carry bounces without logs.
--
-- Migrations run without app.org_id, and these tables are under FORCE RLS, so
-- a plain UPDATE would see no rows. Snapshot / disable / restore, as in
-- 20260705152500_monitoring_external_sources_rls_backfill.
DO $$
DECLARE
  t text;
  rls_state jsonb := '{}'::jsonb;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_logs', 'campaigns', 'campaign_variants'] LOOP
    rls_state := rls_state || jsonb_build_object(t, (
      SELECT jsonb_build_object('rls', relrowsecurity, 'force', relforcerowsecurity)
      FROM pg_class WHERE oid = t::regclass
    ));
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;

  UPDATE "campaigns" AS c
  SET "totalBounced" = GREATEST(c."totalBounced", l.bounced),
      "totalSpam"    = GREATEST(c."totalSpam", l.complained)
  FROM (
    SELECT "organizationId", "campaignId",
           COUNT(*) FILTER (WHERE "status" = 'bounced')    AS bounced,
           COUNT(*) FILTER (WHERE "status" = 'complained') AS complained
    FROM "email_logs"
    WHERE "campaignId" IS NOT NULL AND "status" IN ('bounced', 'complained')
    GROUP BY 1, 2
  ) AS l
  WHERE c."id" = l."campaignId" AND c."organizationId" = l."organizationId";

  UPDATE "campaign_variants" AS v
  SET "totalBounced" = GREATEST(v."totalBounced", l.bounced)
  FROM (
    SELECT "campaignId", "variantId", COUNT(*) AS bounced
    FROM "email_logs"
    WHERE "variantId" IS NOT NULL AND "campaignId" IS NOT NULL AND "status" = 'bounced'
    GROUP BY 1, 2
  ) AS l
  WHERE v."id" = l."variantId" AND v."campaignId" = l."campaignId";

  FOREACH t IN ARRAY ARRAY['email_logs', 'campaigns', 'campaign_variants'] LOOP
    IF (rls_state->t->>'rls')::boolean THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END IF;
    IF (rls_state->t->>'force')::boolean THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    ELSE
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
