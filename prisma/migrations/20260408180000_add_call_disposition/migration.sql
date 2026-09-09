-- Add disposition field and status index to call_logs
ALTER TABLE "call_logs" ADD COLUMN "disposition" TEXT;
CREATE INDEX "call_logs_organizationId_status_idx" ON "call_logs"("organizationId", "status");
