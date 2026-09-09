-- Additive S4 read-only pilots for active visits and active tasks.
--
-- These streams reuse the generic v2 journal/snapshot tables from the routes
-- foundation. Protocol v1 pull/push, idempotency rows and all mutations stay
-- untouched. The journal is deliberately written before any device cohort is
-- enabled: gating triggers on a mutable cohort would create a cursor gap at
-- enrollment/rollback boundaries.
--
-- Scope decision (documented in mobile-sync-v2-visits-tasks-contract.md):
-- primary agent only. Participant workspaces remain on the existing v1
-- on-demand route until their data/privacy contract is separately approved.
--
-- Rollback: disable the exact `visits`/`tasks` cohort rows. Keep the generic
-- journal and triggers until a later destructive review; they are harmless
-- without enrolled readers and v1 remains the sole mutation authority.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION mtm_mobile_sync_lock_visit(
  p_organization_id TEXT,
  p_visit_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mtm-mobile-sync-v2-visit:' || p_organization_id || ':' || p_visit_id, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_lock_task(
  p_organization_id TEXT,
  p_task_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mtm-mobile-sync-v2-task:' || p_organization_id || ':' || p_task_id, 0)
  );
END;
$$;

-- Active visits are primary-agent-only in this first comparison pilot. The
-- record contains no customer/contact/GPS/media payload; agent delivery is
-- still explicit so RLS alone is never the principal-scope authority.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_visit_upsert(
  p_organization_id TEXT,
  p_visit_id TEXT,
  p_agent_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "mtm_visits" v
    WHERE v."organizationId" = p_organization_id
      AND v."id" = p_visit_id
      AND v."agentId" = p_agent_id
      AND v."deletedAt" IS NULL
      AND v."status" = 'CHECKED_IN'
  ) THEN
    PERFORM mtm_mobile_sync_append_change(
      p_organization_id, 'visits', 'UPSERT', 'visit', p_visit_id, p_agent_id, NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_visit_tombstone(
  p_organization_id TEXT,
  p_visit_id TEXT,
  p_agent_id TEXT,
  p_reason TEXT,
  p_bump_scope BOOLEAN DEFAULT true
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_append_change(
    p_organization_id, 'visits', 'TOMBSTONE', 'visit', p_visit_id, p_agent_id, p_reason
  );
  IF p_bump_scope THEN
    PERFORM mtm_mobile_sync_bump_agent_scope(p_organization_id, 'visits', p_agent_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_visit_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_lock_visit(OLD."organizationId", OLD."id");
  IF OLD."deletedAt" IS NULL AND OLD."status" = 'CHECKED_IN' THEN
    -- BEFORE DELETE runs before related legacy children can cascade away.
    PERFORM mtm_mobile_sync_emit_visit_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId", 'DELETED', true
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_visit_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_active BOOLEAN := false;
  v_new_active BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm visit cannot move across tenants';
  END IF;

  PERFORM mtm_mobile_sync_lock_visit(NEW."organizationId", NEW."id");
  v_new_active := NEW."deletedAt" IS NULL AND NEW."status" = 'CHECKED_IN';

  IF TG_OP = 'INSERT' THEN
    IF v_new_active THEN
      PERFORM mtm_mobile_sync_emit_visit_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    END IF;
    RETURN NEW;
  END IF;

  v_old_active := OLD."deletedAt" IS NULL AND OLD."status" = 'CHECKED_IN';
  IF v_old_active AND (NOT v_new_active OR OLD."agentId" IS DISTINCT FROM NEW."agentId") THEN
    PERFORM mtm_mobile_sync_emit_visit_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId",
      CASE WHEN OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN 'SCOPE_REMOVED' ELSE 'HORIZON_EXIT' END,
      true
    );
  END IF;

  IF v_new_active THEN
    PERFORM mtm_mobile_sync_emit_visit_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    -- Entering the active horizon or changing primary actor invalidates only
    -- that actor's immutable snapshot pages; regular active updates use delta.
    IF NOT v_old_active OR OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN
      PERFORM mtm_mobile_sync_bump_agent_scope(NEW."organizationId", 'visits', NEW."agentId");
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtm_mobile_sync_visit_delete ON "mtm_visits";
DROP TRIGGER IF EXISTS mtm_mobile_sync_visit_change ON "mtm_visits";
CREATE TRIGGER mtm_mobile_sync_visit_delete
BEFORE DELETE ON "mtm_visits"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_visit_delete_trigger();
CREATE TRIGGER mtm_mobile_sync_visit_change
AFTER INSERT OR UPDATE ON "mtm_visits"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_visit_change_trigger();

-- Active task projection is schedule/state only. Its visibility is always
-- exactly `MtmTask.agentId`; events are intentionally excluded because their
-- free-form comments/evidence have no approved v2 projection.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_task_upsert(
  p_organization_id TEXT,
  p_task_id TEXT,
  p_agent_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "mtm_tasks" t
    WHERE t."organizationId" = p_organization_id
      AND t."id" = p_task_id
      AND t."agentId" = p_agent_id
      AND t."deletedAt" IS NULL
      AND t."status" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE')
  ) THEN
    PERFORM mtm_mobile_sync_append_change(
      p_organization_id, 'tasks', 'UPSERT', 'task', p_task_id, p_agent_id, NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_task_tombstone(
  p_organization_id TEXT,
  p_task_id TEXT,
  p_agent_id TEXT,
  p_reason TEXT,
  p_bump_scope BOOLEAN DEFAULT true
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_append_change(
    p_organization_id, 'tasks', 'TOMBSTONE', 'task', p_task_id, p_agent_id, p_reason
  );
  IF p_bump_scope THEN
    PERFORM mtm_mobile_sync_bump_agent_scope(p_organization_id, 'tasks', p_agent_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_task_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_lock_task(OLD."organizationId", OLD."id");
  IF OLD."deletedAt" IS NULL AND OLD."status" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE') THEN
    PERFORM mtm_mobile_sync_emit_task_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId", 'DELETED', true
    );
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_task_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_active BOOLEAN := false;
  v_new_active BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm task cannot move across tenants';
  END IF;

  PERFORM mtm_mobile_sync_lock_task(NEW."organizationId", NEW."id");
  v_new_active := NEW."deletedAt" IS NULL AND NEW."status" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE');

  IF TG_OP = 'INSERT' THEN
    IF v_new_active THEN
      PERFORM mtm_mobile_sync_emit_task_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    END IF;
    RETURN NEW;
  END IF;

  v_old_active := OLD."deletedAt" IS NULL AND OLD."status" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE');
  IF v_old_active AND (NOT v_new_active OR OLD."agentId" IS DISTINCT FROM NEW."agentId") THEN
    PERFORM mtm_mobile_sync_emit_task_tombstone(
      OLD."organizationId", OLD."id", OLD."agentId",
      CASE WHEN OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN 'SCOPE_REMOVED' ELSE 'HORIZON_EXIT' END,
      true
    );
  END IF;

  IF v_new_active THEN
    PERFORM mtm_mobile_sync_emit_task_upsert(NEW."organizationId", NEW."id", NEW."agentId");
    IF NOT v_old_active OR OLD."agentId" IS DISTINCT FROM NEW."agentId" THEN
      PERFORM mtm_mobile_sync_bump_agent_scope(NEW."organizationId", 'tasks', NEW."agentId");
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtm_mobile_sync_task_delete ON "mtm_tasks";
DROP TRIGGER IF EXISTS mtm_mobile_sync_task_change ON "mtm_tasks";
CREATE TRIGGER mtm_mobile_sync_task_delete
BEFORE DELETE ON "mtm_tasks"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_task_delete_trigger();
CREATE TRIGGER mtm_mobile_sync_task_change
AFTER INSERT OR UPDATE ON "mtm_tasks"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_task_change_trigger();
