BEGIN READ ONLY;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL app.rls_bypass = 'on';
SET LOCAL app.identity_release_require_drained = 'off';
SELECT to_regclass('public.identity_accounts') IS NOT NULL AS expanded \gset
\if :expanded
-- After process drain, an already-issued COMMIT can still finish. Wait for
-- every account writer before the following fresh READ COMMITTED snapshot.
SELECT current_setting('app.identity_release_require_drained', true) <> 'on'
  OR NOT EXISTS(SELECT 1 FROM pg_locks
    WHERE locktype='relation' AND relation='public.identity_accounts'::regclass
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND mode <> 'AccessShareLock' AND pid IS DISTINCT FROM pg_backend_pid()) AS drained \gset
\if :drained
SELECT json_build_object('expanded',true,
  'canonicalCount',(SELECT count(*) FROM public.identity_accounts WHERE "cutoverAt" IS NOT NULL),
  'readOnly',current_setting('transaction_read_only')='on',
  'rlsUnfiltered',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user));
\else
\echo IDENTITY_WRITERS_BUSY
\endif
\else
SELECT json_build_object('expanded',false,'canonicalCount',0,
  'readOnly',current_setting('transaction_read_only')='on',
  'rlsUnfiltered',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user));
\endif
COMMIT;
