-- Retry the external social page/profile backfill through forced RLS.
-- The first backfill is kept for new databases; this one fixes existing
-- production rows that are hidden from normal migration UPDATEs by tenant RLS.
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  remaining_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'monitoring_sources'::regclass;

  ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;

  UPDATE "monitoring_sources" AS ms
  SET
    "collectionMode" = 'search_index',
    "cadenceMinutes" = GREATEST(ms."cadenceMinutes", 360),
    "riskLevel" = CASE
      WHEN ms."platform" IN ('instagram', 'facebook', 'tiktok') THEN 'high'
      ELSE 'medium'
    END,
    "status" = CASE
      WHEN ms."status" IN ('active', 'limited') THEN 'needs_setup'
      ELSE ms."status"
    END,
    "lastError" = CASE
      WHEN ms."lastError" = 'collector_not_configured' THEN NULL
      ELSE ms."lastError"
    END,
    "settings" = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(ms."settings", '{}'::jsonb),
          '{blockedReasons}',
          '["external_page_monitoring_requires_approved_provider_or_search_index"]'::jsonb,
          true
        ),
        '{searchIndex}',
        COALESCE(
          CASE
            WHEN jsonb_typeof(ms."settings"->'searchIndex') = 'object' THEN ms."settings"->'searchIndex'
            ELSE NULL
          END,
          '{}'::jsonb
        ),
        true
      ),
      '{searchIndex,domain}',
      to_jsonb(
        CASE
          WHEN ms."url" IS NOT NULL THEN regexp_replace(lower(ms."url"), '^https?://(www\.)?([^/:?#]+).*$', '\2')
          WHEN ms."platform" = 'instagram' THEN 'instagram.com'
          WHEN ms."platform" = 'facebook' THEN 'facebook.com'
          WHEN ms."platform" = 'tiktok' THEN 'tiktok.com'
          WHEN ms."platform" = 'youtube' THEN 'youtube.com'
          WHEN ms."platform" = 'linkedin' THEN 'linkedin.com'
          WHEN ms."platform" = 'twitter' THEN 'x.com'
          WHEN ms."platform" = 'telegram' THEN 't.me'
          WHEN ms."platform" = 'vkontakte' THEN 'vk.com'
          ELSE 'web'
        END
      ),
      true
    ),
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE
    ms."collectionMode" = 'manual'
    AND ms."sourceType" IN ('profile', 'page', 'competitor', 'influencer', 'campaign')
    AND ms."ownership" IN ('external', 'unknown')
    AND NOT (
      ms."url" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "monitoring_sources" AS existing
        WHERE existing."id" <> ms."id"
          AND existing."organizationId" = ms."organizationId"
          AND existing."platform" = ms."platform"
          AND existing."sourceType" = ms."sourceType"
          AND existing."collectionMode" = 'search_index'
          AND existing."url" = ms."url"
      )
    );

  SELECT COUNT(*)
  INTO remaining_count
  FROM "monitoring_sources" AS ms
  WHERE
    ms."collectionMode" = 'manual'
    AND ms."sourceType" IN ('profile', 'page', 'competitor', 'influencer', 'campaign')
    AND ms."ownership" IN ('external', 'unknown')
    AND NOT (
      ms."url" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "monitoring_sources" AS existing
        WHERE existing."id" <> ms."id"
          AND existing."organizationId" = ms."organizationId"
          AND existing."platform" = ms."platform"
          AND existing."sourceType" = ms."sourceType"
          AND existing."collectionMode" = 'search_index'
          AND existing."url" = ms."url"
      )
    );

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Manual external monitoring sources remain after RLS-safe backfill: %', remaining_count;
  END IF;

  IF had_rls THEN
    ALTER TABLE "monitoring_sources" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "monitoring_sources" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "monitoring_sources" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
