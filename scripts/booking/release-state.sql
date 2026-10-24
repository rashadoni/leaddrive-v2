BEGIN READ ONLY;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL app.booking_release_require_drained = 'off';
SET LOCAL app.rls_bypass = 'on';
SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='version') AS expanded \gset
\if :expanded
-- After PM2 stops, wait out every writer before taking a fresh MVCC snapshot.
-- A COMMIT can still finish after its Node process has already exited.
SELECT current_setting('app.booking_release_require_drained', true) IS DISTINCT FROM 'on'
  OR NOT EXISTS(SELECT 1 FROM pg_locks
    WHERE locktype='relation' AND relation='public.bookings'::regclass
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND mode <> 'AccessShareLock' AND pid IS DISTINCT FROM pg_backend_pid()) AS writers_drained \gset
\if :writers_drained
SELECT json_build_object(
 'expanded', true,
 'canonicalCount', (SELECT count(*) FROM public.bookings WHERE version>0),
 'enforced', (SELECT enforced FROM public.booking_workspace_release WHERE id=1),
 'readOnly', current_setting('transaction_read_only')='on',
 'rlsUnfiltered', (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
);
\else
\echo BOOKING_WRITERS_BUSY
\endif
\else
SELECT json_build_object('expanded',false,'canonicalCount',0,'enforced',false,
 'readOnly',current_setting('transaction_read_only')='on',
 'rlsUnfiltered',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user));
\endif
COMMIT;
