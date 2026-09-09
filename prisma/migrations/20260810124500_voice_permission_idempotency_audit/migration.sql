-- Voice-permission audit rows double as the cookie UI's replay ledger.
-- Keep request keys unique per tenant without constraining unrelated audit
-- entities, which legitimately reuse entity ids across multiple actions.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Voice-permission decisions are compliance events, not editable business
-- notes. Protect only this reserved namespace so existing generic audit rows
-- keep their historical behavior.
CREATE FUNCTION "protect_voice_permission_audit_row"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."entityType" = 'lead_voice_permission' THEN
    RAISE EXCEPTION 'lead_voice_permission audit rows are append-only (id=%)', OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_voice_permission_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "protect_voice_permission_audit_row"();

-- Create the compliance guard before taking the stronger index-build lock.
-- The deploy preflight proves this reserved namespace and all three objects
-- are absent, bounds the table size, and waits for a quiet window.
CREATE UNIQUE INDEX "audit_logs_voice_permission_request_key"
  ON "audit_logs" ("organizationId", "entityType", "entityId")
  WHERE "entityType" = 'lead_voice_permission' AND "entityId" IS NOT NULL;
