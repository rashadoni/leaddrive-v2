-- Stage B: installed only after a canonical-capable A artifact is healthy.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.bookings, public.tasks IN ACCESS EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION booking_managed_task_guard_fn() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.booking_task_writer', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId")
     AND EXISTS (SELECT 1 FROM bookings WHERE "organizationId" = OLD."organizationId" AND "taskId" = OLD.id)
  THEN
    RAISE EXCEPTION 'This task is managed by a booking; update the meeting instead' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Validate the final transaction state, not intermediate row versions while a
-- command appends its event. Existing version=0 rows remain readable; an old
-- writer cannot commit a new reservation or overwrite canonical fields after cutover.
CREATE OR REPLACE FUNCTION booking_event_head_guard_fn() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  current_booking public.bookings%ROWTYPE;
  head_version BIGINT;
  event_data JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."organizationId" ELSE NEW."organizationId" END) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A booking cannot be deleted by an ordinary writer' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO current_booking FROM public.bookings WHERE id = NEW.id AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking disappeared before its event guard' USING ERRCODE = 'check_violation';
  END IF;
  SELECT h."currentVersion", e.data INTO head_version, event_data
    FROM public.event_aggregate_heads h JOIN public.domain_events e
      ON e.id = h."lastEventId" AND e."organizationId" = h."organizationId"
    WHERE h."organizationId" = current_booking."organizationId"
      AND h."aggregateType" = 'booking' AND h."aggregateId" = current_booking.id;
  IF current_booking.version < 1 OR head_version IS DISTINCT FROM current_booking.version::bigint
     OR event_data->>'bookingId' IS DISTINCT FROM current_booking.id
     OR event_data->>'hostUserId' IS DISTINCT FROM current_booking."hostUserId"
     OR event_data->>'status' IS DISTINCT FROM current_booking.status
     OR (event_data->>'startsAt')::timestamptz AT TIME ZONE 'UTC' IS DISTINCT FROM current_booking."startsAt"
     OR (event_data->>'endsAt')::timestamptz AT TIME ZONE 'UTC' IS DISTINCT FROM current_booking."endsAt"
  THEN
    RAISE EXCEPTION 'Booking requires a matching canonical event and aggregate head' USING ERRCODE = 'check_violation';
  END IF;
  -- Keep legacy broken links readable/cancellable, but never attach a new
  -- foreign-tenant or missing CRM projection. Ordinary writers cannot rebind mirrors.
  IF (TG_OP = 'INSERT' OR current_booking."taskId" IS DISTINCT FROM OLD."taskId")
     AND current_booking."taskId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = current_booking."taskId" AND "organizationId" = current_booking."organizationId")
  THEN RAISE EXCEPTION 'Booking task must belong to its organization' USING ERRCODE = 'check_violation'; END IF;
  IF (TG_OP = 'INSERT' OR current_booking."leadId" IS DISTINCT FROM OLD."leadId")
     AND current_booking."leadId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = current_booking."leadId" AND "organizationId" = current_booking."organizationId")
  THEN RAISE EXCEPTION 'Booking lead must belong to its organization' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['taskId','leadId','googleEventId','updatedAt','version'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['taskId','leadId','googleEventId','updatedAt','version'])
     AND current_booking.version <= OLD.version
  THEN
    RAISE EXCEPTION 'Canonical booking changes require a new event version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
COMMIT;
