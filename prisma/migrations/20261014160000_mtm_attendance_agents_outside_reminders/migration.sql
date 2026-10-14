-- A field agent's day belongs to the field manager, not HR attendance (owner,
-- 2026-10-14). Reminders are an attendance feature, so a reminder subject must
-- be an enrolled non-agent card — the same rule as src/lib/mtm/attendance-tracking.ts.
-- Only the subject check changes; existing notices are untouched.
CREATE OR REPLACE FUNCTION mtm_attendance_reminder_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=NEW."agentId" AND status='ACTIVE' AND "attendanceParticipant" AND role<>'AGENT') THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_SUBJECT_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW."recipientUserId" IS NOT NULL AND EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=NEW."agentId" AND "userId"=NEW."recipientUserId") THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_SELF_RECIPIENT' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
