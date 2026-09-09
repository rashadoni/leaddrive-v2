-- Finding F-10 (docs/isms/ISMS-02-gap-analysis.md), decision recorded in
-- docs/isms/ISMS-12-retention.md §2.
--
-- `compliance_audit_log` records READ and EXPORT access to sensitive
-- categories. Its trigger rejects DELETE unconditionally, while the foreign key
-- to `organizations` was declared ON DELETE CASCADE. The two contradict each
-- other: deleting a tenant made the cascade attempt a DELETE the trigger then
-- refused, so `hardDeleteTenant` aborted with part of the cascade already
-- applied. Latent only because the routes writing this table are not wired yet.
--
-- Resolution: the compliance trail OUTLIVES the tenant. The value of an access
-- log is that it does not disappear together with the subject of the
-- investigation, so the foreign key is dropped rather than softened.
-- `organizationId` remains as a plain column for scoping; retention is three
-- years, enforced by schedule.
--
-- To make that schedule possible the trigger gains a narrow escape:
-- `app.compliance_audit_purge`. It is a DIFFERENT flag from
-- `app.audit_log_purge` (migration 20260825120000) on purpose — a tenant purge
-- must not silently acquire the right to erase the compliance trail as well.

ALTER TABLE "compliance_audit_log"
  DROP CONSTRAINT IF EXISTS "compliance_audit_log_organizationId_fkey";

CREATE OR REPLACE FUNCTION compliance_audit_log_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'compliance_audit_log is append-only — UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  -- TG_OP = 'DELETE' — permitted only for scheduled retention expiry.
  IF COALESCE(current_setting('app.compliance_audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'compliance_audit_log is append-only — DELETE rejected (id=%); only scheduled retention expiry may remove rows',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Recreated so the table is bound to the new function body even if the trigger
-- already existed with the old one.
DROP TRIGGER IF EXISTS compliance_audit_log_append_only_trigger ON "compliance_audit_log";
CREATE TRIGGER compliance_audit_log_append_only_trigger
  BEFORE UPDATE OR DELETE ON "compliance_audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION compliance_audit_log_append_only_fn();
