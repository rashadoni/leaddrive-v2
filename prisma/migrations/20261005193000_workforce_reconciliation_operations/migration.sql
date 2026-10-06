-- Dormant tenant-owned operational state. No grants, runtime registration or data backfill.
CREATE TABLE "workforce_reconciliation_tenant_states" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "attemptToken" UUID,
  "lastAttemptAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0 CHECK ("consecutiveFailures" BETWEEN 0 AND 1000),
  "lastOutcome" TEXT NOT NULL DEFAULT 'NEVER' CHECK ("lastOutcome" IN ('NEVER','RUNNING','MATCHED','MISMATCH','INCOMPLETE','FENCED_OUT','VERSION_EXHAUSTED','UNKNOWN')),
  "examinedCount" INTEGER NOT NULL DEFAULT 0 CHECK ("examinedCount" BETWEEN 0 AND 100000),
  "mismatchCount" INTEGER NOT NULL DEFAULT 0 CHECK ("mismatchCount" BETWEEN 0 AND 1000000),
  "durationMs" INTEGER NOT NULL DEFAULT 0 CHECK ("durationMs" BETWEEN 0 AND 3600000),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "wf_reconciliation_due_attempt_org_idx"
  ON "workforce_reconciliation_tenant_states" ("dueAt","lastAttemptAt","organizationId");
ALTER TABLE "workforce_reconciliation_tenant_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_reconciliation_tenant_states" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_reconciliation_tenant_states"
  USING ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on');

-- Match keyset predicates/order exactly; ordinary locale indexes cannot serve C order.
CREATE INDEX "wf_recon_workdays_c_idx" ON "mtm_agent_workdays" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_events_c_idx" ON "mtm_agent_workday_events" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_transitions_c_idx" ON "workforce_site_transitions" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_evidence_c_idx" ON "workforce_attendance_evidence" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_assessments_c_idx" ON "workforce_evidence_assessments" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_exceptions_c_idx" ON "workforce_exception_cases" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_approvals_c_idx" ON "workforce_timesheet_approvals" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_exports_c_idx" ON "mtm_audit_logs" ("organizationId", "id" COLLATE "C");
CREATE INDEX "wf_recon_approval_group_c_idx" ON "workforce_timesheet_approvals" ("organizationId", "agentId" COLLATE "C", "periodStart", "periodEnd", "id" COLLATE "C");
