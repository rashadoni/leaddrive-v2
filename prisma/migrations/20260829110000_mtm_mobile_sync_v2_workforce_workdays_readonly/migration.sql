-- Additive S4 workforce read-only pilot: authenticated agent active workday.
--
-- This intentionally does not alter protocol-v1 workforce pull/push,
-- mtm_sync_operations, the workday state machine or HRM request writes. The
-- v2 stream holds no GPS coordinates, event notes, completed history, calendar
-- policy, HRM reason or decision data. Its sole purpose is a cohort-gated,
-- read-only comparison of the existing active workday state.
--
-- The journal is written before a device cohort exists. Tying triggers to a
-- mutable cohort would create an unrecoverable cursor gap at enrollment or
-- rollback. Rollback therefore disables the exact `workforce` cohort only;
-- this payload-free journal/trigger remains harmless while no reader is
-- enrolled and v1 retains all write authority.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION mtm_mobile_sync_lock_workday(
  p_organization_id TEXT,
  p_workday_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Workday's regular transition path already holds an agent-scoped advisory
  -- lock. This v2 trigger additionally serializes every mutation of one row,
  -- including HRM time-correction updates that originate outside that path.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mtm-mobile-sync-v2-workday:' || p_organization_id || ':' || p_workday_id, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_workday_is_visible(
  p_status "MtmWorkdayStatus"
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('STARTED'::"MtmWorkdayStatus", 'PAUSED'::"MtmWorkdayStatus");
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_workday_upsert(
  p_organization_id TEXT,
  p_workday_id TEXT,
  p_agent_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Re-check row visibility in the writer transaction so a direct/bypass
  -- maintenance write cannot turn a stale trigger invocation into an active
  -- workday disclosure. The public endpoint repeats the same own-agent scope.
  IF EXISTS (
    SELECT 1
    FROM "mtm_agent_workdays" w
    WHERE w."organizationId" = p_organization_id
      AND w."id" = p_workday_id
      AND w."agentId" = p_agent_id
      AND mtm_mobile_sync_workday_is_visible(w."status")
  ) THEN
    PERFORM mtm_mobile_sync_append_change(
      p_organization_id, 'workforce', 'UPSERT', 'workday', p_workday_id, p_agent_id, NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_workday_tombstone(
  p_organization_id TEXT,
  p_workday_id TEXT,
  p_agent_id TEXT,
  p_reason TEXT,
  p_bump_scope BOOLEAN DEFAULT true
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_append_change(
    p_organization_id, 'workforce', 'TOMBSTONE', 'workday', p_workday_id, p_agent_id, p_reason
  );
  IF p_bump_scope THEN
    -- Snapshot and delta pages lock this exact fence before they read. A
    -- committed close, deletion or actor move cannot therefore reveal an
    -- immutable stale active-shift page to an already-enrolled device.
    PERFORM mtm_mobile_sync_bump_agent_scope(p_organization_id, 'workforce', p_agent_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_workday_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_lock_workday(OLD."organizationId", OLD."id");
  IF mtm_mobile_sync_workday_is_visible(OLD."status") THEN
    -- BEFORE DELETE runs while the old authorisation target is still present.
    PERFORM mtm_mobile_sync_emit_workday_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId", 'DELETED', true
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_workday_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_visible BOOLEAN := false;
  v_new_visible BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm workday cannot move across tenants';
  END IF;

  PERFORM mtm_mobile_sync_lock_workday(NEW."organizationId", NEW."id");
  v_new_visible := mtm_mobile_sync_workday_is_visible(NEW."status");

  IF TG_OP = 'INSERT' THEN
    IF v_new_visible THEN
      PERFORM mtm_mobile_sync_emit_workday_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    END IF;
    RETURN NEW;
  END IF;

  v_old_visible := mtm_mobile_sync_workday_is_visible(OLD."status");
  IF v_old_visible AND (NOT v_new_visible OR OLD."agentId" IS DISTINCT FROM NEW."agentId") THEN
    PERFORM mtm_mobile_sync_emit_workday_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId",
      CASE WHEN OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN 'SCOPE_REMOVED' ELSE 'ACTIVE_STATE_EXIT' END,
      true
    );
  END IF;

  IF v_new_visible THEN
    PERFORM mtm_mobile_sync_emit_workday_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    -- The new actor may have been using a snapshot taken before a reassigned
    -- active workday became visible. Advance only that actor's scope fence.
    IF NOT v_old_visible OR OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN
      PERFORM mtm_mobile_sync_bump_agent_scope(NEW."organizationId", 'workforce', NEW."agentId");
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtm_mobile_sync_workday_delete ON "mtm_agent_workdays";
DROP TRIGGER IF EXISTS mtm_mobile_sync_workday_change ON "mtm_agent_workdays";
CREATE TRIGGER mtm_mobile_sync_workday_delete
BEFORE DELETE ON "mtm_agent_workdays"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_workday_delete_trigger();
CREATE TRIGGER mtm_mobile_sync_workday_change
AFTER INSERT OR UPDATE ON "mtm_agent_workdays"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_workday_change_trigger();

-- Existing workday indexes already cover the tiny own-agent active-state
-- read (`organizationId, agentId, status`); no legacy-table index is built in
-- this transactional migration. Reassess with EXPLAIN on staging before any
-- cohort expansion rather than adding a speculative production index.
