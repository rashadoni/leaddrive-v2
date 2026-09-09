-- Phase 7 slice-2 P0 #3 — compliance audit log for PHI / PII / FOIA reads.
--
-- Background: R2 Health (PHI under HIPAA minimum-necessary), R7
-- Insurance (claim-file reads under state DOI rules), and R8 Public
-- Sector (citizen data reads under FOIA) all require append-only
-- per-read audit trails. Slice-1 ships zero read instrumentation.
-- This migration ships the storage layer; the helper module
-- `src/lib/audit/compliance-audit.ts` adds the typed write API; route
-- wrapping happens when R2/R7/R8 slice-2-mini ships their API routes.
--
-- Append-only by trigger (UPDATE + DELETE both rejected). The audit
-- log MUST survive operator data corrections — compliance evidence is
-- the row, not the source-of-truth record.
--
-- Per-tenant scoped: organizationId NOT NULL. Cross-tenant audit
-- queries impossible without superadmin SQL access.

CREATE TABLE IF NOT EXISTS "compliance_audit_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Operator who performed the read. NULL only for system-cron paths. */
    "userId" TEXT,
    /** "read" | "write" | "export" | "delete" — broad enough to log
        every kind of compliance-touchpoint, not just reads. */
    "action" TEXT NOT NULL,
    /** "phi" (R2 Health protected-health-info)
        | "pii" (R7 Insurance / R8 Public Sector personally-identifiable)
        | "foia" (R8 freedom-of-information / records-request reads) */
    "recordType" TEXT NOT NULL,
    /** Physical table the record lives in (e.g. "health_patients",
        "claims", "citizens"). Free-form so future modules can append. */
    "recordTable" TEXT NOT NULL,
    /** ID of the audited row. Optional for "list" reads that don't
        identify a single record (e.g. patient roster page). */
    "recordId" TEXT,
    /** Optional request metadata for forensics. */
    "ipAddress" TEXT,
    "userAgent" TEXT,
    /** Free-form context (query filters, export format, etc.). */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_audit_log_pkey" PRIMARY KEY ("id")
);

-- CHECK: action allow-list. Append-only audit semantics — additions
-- to this list require a follow-up migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_audit_log_action_check') THEN
    ALTER TABLE "compliance_audit_log"
      ADD CONSTRAINT "compliance_audit_log_action_check"
      CHECK ("action" IN ('read', 'write', 'export', 'delete'));
  END IF;
END $$;

-- CHECK: recordType allow-list. Adding a new compliance category
-- (e.g. PCI) requires migration + slice-2 helper update.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_audit_log_record_type_check') THEN
    ALTER TABLE "compliance_audit_log"
      ADD CONSTRAINT "compliance_audit_log_record_type_check"
      CHECK ("recordType" IN ('phi', 'pii', 'foia'));
  END IF;
END $$;

-- Indexes
-- Hot path: "who read patient X's records over the last 30 days?"
CREATE INDEX IF NOT EXISTS "compliance_audit_log_org_record_idx"
  ON "compliance_audit_log"("organizationId", "recordTable", "recordId", "occurredAt");
-- Hot path: "what did user Y access this quarter?"
CREATE INDEX IF NOT EXISTS "compliance_audit_log_org_user_idx"
  ON "compliance_audit_log"("organizationId", "userId", "occurredAt");
-- Hot path: "all FOIA-able reads in date range" (for records-request response)
CREATE INDEX IF NOT EXISTS "compliance_audit_log_org_type_idx"
  ON "compliance_audit_log"("organizationId", "recordType", "occurredAt");

-- FK to Organization (Cascade so dropping a tenant clears its audit
-- log — explicit choice; alternative is RESTRICT for permanent
-- retention. Tenants own their compliance evidence; loss-on-delete
-- is acceptable here because tenant-delete is a deliberate operator
-- action.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_audit_log_organizationId_fkey') THEN
    ALTER TABLE "compliance_audit_log"
      ADD CONSTRAINT "compliance_audit_log_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK to User (SET NULL so deleting a user keeps the audit trail
-- intact — compliance evidence outlives the user record).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_audit_log_userId_fkey') THEN
    ALTER TABLE "compliance_audit_log"
      ADD CONSTRAINT "compliance_audit_log_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Append-only enforcement: UPDATE + DELETE both raise.
CREATE OR REPLACE FUNCTION compliance_audit_log_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'compliance_audit_log is append-only — UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance_audit_log is append-only — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS compliance_audit_log_append_only_trigger ON "compliance_audit_log";
CREATE TRIGGER compliance_audit_log_append_only_trigger
  BEFORE UPDATE OR DELETE ON "compliance_audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION compliance_audit_log_append_only_fn();
