-- Move external page/profile watchlist sources out of inert manual mode.
-- They still require an approved search-index/provider setup before collection,
-- but "run now" should surface that setup gate instead of collector_not_configured.

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
