BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
WITH booking AS (
  SELECT b.id, b."organizationId" FROM public.bookings b
  JOIN public.organizations o ON o.id = b."organizationId"
  WHERE o.slug = 'EFFECT_DIAGNOSTIC_TENANT' AND b.id = 'EFFECT_DIAGNOSTIC_BOOKING'
), effects AS (
  SELECT e.id, e.status, e."attemptCount", e."lastError", e."availableAt", e."createdAt", e."completedAt",
    CASE WHEN e.payload->>'version' ~ '^[0-9]{1,9}$' THEN (e.payload->>'version')::int END AS version
  FROM public.effect_outbox e JOIN booking b ON b."organizationId" = e."organizationId"
    AND e.payload->>'bookingId' = b.id
  WHERE e."effectType" = 'booking.project' AND e."executionMode" = 'live'
  ORDER BY e."createdAt", e.id LIMIT 21
)
SELECT json_build_object(
  'bookingFound', EXISTS(SELECT 1 FROM booking),
  'truncated', (SELECT count(*) > 20 FROM effects),
  'observedUTC', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'sessionTimezone', current_setting('TimeZone'),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'rlsUnfiltered', (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),
  'rows', COALESCE((SELECT json_agg(json_build_object(
    'id', id, 'status', status, 'attemptCount', "attemptCount", 'bookingVersion', version,
    'lastErrorCode', CASE WHEN "lastError" IS NULL THEN NULL
      WHEN "lastError" ~ '^LOCAL_FAILURE_([1-9]|1[0-9]|20)$' THEN "lastError"
      WHEN "lastError" = 'DELIVERY_UNCONFIRMED' THEN "lastError" ELSE 'REDACTED' END,
    'availableAtUTC', to_char("availableAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAtUTC', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAtUTC', to_char("completedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY "createdAt", id) FROM (SELECT * FROM effects ORDER BY "createdAt", id LIMIT 20) bounded), '[]'::json)
);
COMMIT;
