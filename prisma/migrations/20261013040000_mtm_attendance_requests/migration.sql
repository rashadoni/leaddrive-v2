ALTER TABLE "mtm_hrm_requests" ADD COLUMN "attendanceDetails" JSONB;
ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_attendance_request_details_check" CHECK (
  "attendanceDetails" IS NULL OR (
    jsonb_typeof("attendanceDetails") = 'object'
    AND "attendanceDetails"->>'version' = '1'
    AND "attendanceDetails"->>'unit' IN ('DAYS', 'HOURS')
    AND "attendanceDetails"->>'kind' IN ('ANNUAL_LEAVE', 'SICK_LEAVE', 'TIME_OFF', 'HOURLY_ABSENCE', 'BUSINESS_TRIP', 'REMOTE_WORK', 'OVERTIME')
    AND "attendanceDetails"->>'submissionHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("attendanceDetails"->'attachmentIds') = 'array'
    AND jsonb_array_length("attendanceDetails"->'attachmentIds') <= 3
  ) IS TRUE
);

CREATE TABLE "mtm_attendance_attachments" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agentId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "clientAttachmentId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE CHECK ("storageKey" ~ '^[a-f0-9]{48}$'),
  "sourceSha256" TEXT NOT NULL CHECK ("sourceSha256" ~ '^[a-f0-9]{64}$'),
  "checksumSha256" TEXT NOT NULL CHECK ("checksumSha256" ~ '^[a-f0-9]{64}$'),
  "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" BETWEEN 1 AND 5242880),
  "mimeType" TEXT NOT NULL CHECK ("mimeType" = 'image/jpeg'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_attendance_attachments_agent_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "mtm_attendance_attachments_client_key" UNIQUE ("organizationId", "agentId", "clientAttachmentId")
);
CREATE INDEX "mtm_attendance_attachments_request_idx" ON "mtm_attendance_attachments" ("organizationId", "agentId", "clientRequestId");
ALTER TABLE "mtm_attendance_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_attendance_attachments_tenant_isolation" ON "mtm_attendance_attachments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

CREATE FUNCTION "mtm_attendance_request_submission_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."attendanceDetails" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MTM attendance requests must be cancelled, not deleted'; END IF;
    IF (NEW."organizationId", NEW."agentId", NEW."clientRequestId", NEW."type", NEW."startDate", NEW."endDate", NEW."reason", NEW."attendanceDetails", NEW."submittedAt", NEW."correctionWorkdayId", NEW."requestedStartAt", NEW."requestedEndAt")
       IS DISTINCT FROM
       (OLD."organizationId", OLD."agentId", OLD."clientRequestId", OLD."type", OLD."startDate", OLD."endDate", OLD."reason", OLD."attendanceDetails", OLD."submittedAt", OLD."correctionWorkdayId", OLD."requestedStartAt", OLD."requestedEndAt") THEN
      RAISE EXCEPTION 'MTM attendance request submission is immutable';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW."attendanceDetails" IS NOT NULL THEN
    RAISE EXCEPTION 'Retained Workforce requests cannot be relabelled as MTM attendance';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "mtm_attendance_request_submission_immutable" BEFORE UPDATE OR DELETE ON "mtm_hrm_requests"
  FOR EACH ROW EXECUTE FUNCTION "mtm_attendance_request_submission_immutable"();
