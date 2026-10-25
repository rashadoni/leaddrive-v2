-- Run only through the protected deployment migration identity, after exact
-- predecessor admission. This is a monotonic data transition, not new DDL.
DO $$ BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Booking activation requires migration authority';
  END IF;
END $$;
LOCK TABLE public.bookings, public.tasks IN ACCESS EXCLUSIVE MODE;
UPDATE public.booking_workspace_release
SET enforced=true, "activatedArtifactSha"=current_setting('app.booking_workspace_artifact_sha'), "activatedAt"=CURRENT_TIMESTAMP
WHERE id=1 AND NOT enforced;
