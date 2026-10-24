BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='version') AS expanded \gset
\if :expanded
SELECT json_build_object(
 'expanded', true,
 'canonicalCount', (SELECT count(*) FROM public.bookings WHERE version>0),
 'enforced', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name='20261102110000_booking_workspace_enforcement' AND finished_at IS NOT NULL AND rolled_back_at IS NULL),
 'readOnly', current_setting('transaction_read_only')='on',
 'rlsUnfiltered', (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
);
\else
SELECT json_build_object('expanded',false,'canonicalCount',0,'enforced',false,
 'readOnly',current_setting('transaction_read_only')='on',
 'rlsUnfiltered',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user));
\endif
COMMIT;
