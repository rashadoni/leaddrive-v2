BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
WITH page AS (
 SELECT "organizationId", "hostIds" FROM public.booking_pages WHERE slug='BOOKING_DIAGNOSTIC_SLUG' AND "isActive"
), hosts AS (
 SELECT DISTINCT u.id FROM page p JOIN public.users u ON u."organizationId"=p."organizationId"
 AND u.id=ANY(p."hostIds") WHERE u."isActive"
), selected AS (
 SELECT h.id AS host, a.* FROM hosts h LEFT JOIN LATERAL (
  SELECT id, provider, access_token, refresh_token, expires_at, scope FROM public.accounts
  WHERE "userId"=h.id AND provider IN ('google-calendar','google') ORDER BY provider DESC LIMIT 1
 ) a ON true
)
SELECT json_build_object(
 'hostCount',(SELECT count(*) FROM hosts),
 'selectedAccountCount',(SELECT count(*) FROM selected WHERE id IS NOT NULL),
 'standaloneCount',(SELECT count(*) FROM selected WHERE provider='google-calendar'),
 'ssoCount',(SELECT count(*) FROM selected WHERE provider='google'),
 'noAccountCount',(SELECT count(*) FROM selected WHERE id IS NULL),
 'missingAccessTokenCount',(SELECT count(*) FROM selected WHERE id IS NOT NULL AND COALESCE(access_token,'')=''),
 'expiredCount',(SELECT count(*) FROM selected WHERE expires_at < extract(epoch FROM now())),
 'expiredWithoutRefreshCount',(SELECT count(*) FROM selected WHERE expires_at < extract(epoch FROM now()) AND COALESCE(refresh_token,'')=''),
 'refreshPresentCount',(SELECT count(*) FROM selected WHERE COALESCE(refresh_token,'')<>''),
 'identityOnlySsoCount',(SELECT count(*) FROM selected WHERE provider='google' AND btrim(COALESCE(scope,''))<>'' AND
   regexp_split_to_array(btrim(scope),'[[:space:]]+') <@ ARRAY['openid','email','profile','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile']),
 'unknownScopeCount',(SELECT count(*) FROM selected WHERE id IS NOT NULL AND COALESCE(scope,'')=''),
 'missingFreeBusyScopeCount',(SELECT count(*) FROM selected WHERE id IS NOT NULL AND NOT
   (regexp_split_to_array(COALESCE(scope,''),'[[:space:]]+') && ARRAY[
   'https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.readonly',
   'https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.freebusy'])),
 'pageFound',EXISTS(SELECT 1 FROM page),
 'appAccountSelectAllowed',has_table_privilege('hermes','public.accounts','SELECT'),
 'accountRlsEnabled',(SELECT relrowsecurity FROM pg_class WHERE oid='public.accounts'::regclass),
 'accountRlsForced',(SELECT relforcerowsecurity FROM pg_class WHERE oid='public.accounts'::regclass),
 'clientIdConfigured',GOOGLE_CLIENT_ID_PRESENT,
 'clientSecretConfigured',GOOGLE_CLIENT_SECRET_PRESENT,
 'readOnly',current_setting('transaction_read_only')='on',
 'rlsUnfiltered',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
);
COMMIT;
