-- Complete, append-only schedule context for every newly snapshotted
-- Workforce workday. Existing policy/shift snapshot pairs are deliberately
-- left untouched rather than reconstructed from mutable configuration.

SET lock_timeout = '3s';

CREATE TABLE "workforce_workday_schedule_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "policySnapshotId" TEXT NOT NULL,
  "shiftSnapshotId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "calendarState" VARCHAR(48) NOT NULL,
  "calendarSnapshot" JSONB NOT NULL,
  "segments" JSONB NOT NULL,
  "sites" JSONB NOT NULL,
  "snapshotHash" VARCHAR(64) NOT NULL,
  "resolvedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_workday_schedule_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_workday_schedule_snapshots_shape_check" CHECK (
    "schemaVersion" = 1
    AND NULLIF(btrim("calendarState"), '') IS NOT NULL
    AND jsonb_typeof("calendarSnapshot") = 'object'
    AND jsonb_typeof("segments") = 'array'
    AND jsonb_typeof("sites") = 'array'
    AND "snapshotHash" ~ '^[A-Fa-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "workforce_workday_schedule_snapshots_organizationId_id_key"
  ON "workforce_workday_schedule_snapshots"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_workday_schedule_snapshots_workday_key"
  ON "workforce_workday_schedule_snapshots"("organizationId", "workdayId");
CREATE INDEX "workforce_workday_schedule_snapshots_agent_date_idx"
  ON "workforce_workday_schedule_snapshots"("organizationId", "agentId", "workDate");
CREATE INDEX "workforce_workday_schedule_snapshots_policy_idx"
  ON "workforce_workday_schedule_snapshots"("organizationId", "policySnapshotId");
CREATE INDEX "workforce_workday_schedule_snapshots_shift_idx"
  ON "workforce_workday_schedule_snapshots"("organizationId", "shiftSnapshotId");

ALTER TABLE "workforce_workday_schedule_snapshots"
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_policy_fkey"
    FOREIGN KEY ("organizationId", "policySnapshotId") REFERENCES "workforce_policy_snapshots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_workday_schedule_snapshots_shift_fkey"
    FOREIGN KEY ("organizationId", "shiftSnapshotId") REFERENCES "workforce_shift_snapshots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_validate_workday_schedule_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row "mtm_agent_workdays"%ROWTYPE;
  policy_row "workforce_policy_snapshots"%ROWTYPE;
  shift_row "workforce_shift_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO workday_row
  FROM "mtm_agent_workdays"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
  IF NOT FOUND
     OR workday_row."agentId" <> NEW."agentId"
     OR workday_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce schedule snapshot must match its workday employee and date' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO policy_row
  FROM "workforce_policy_snapshots"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policySnapshotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce schedule snapshot policy snapshot is missing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO shift_row
  FROM "workforce_shift_snapshots"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."shiftSnapshotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce schedule snapshot shift snapshot is missing' USING ERRCODE = '23514';
  END IF;
  IF policy_row."workdayId" <> NEW."workdayId"
     OR policy_row."agentId" <> NEW."agentId"
     OR policy_row."workDate" <> NEW."workDate"
     OR shift_row."workdayId" <> NEW."workdayId"
     OR shift_row."agentId" <> NEW."agentId"
     OR shift_row."workDate" <> NEW."workDate" THEN
    RAISE EXCEPTION 'Workforce schedule snapshot must bind the matching policy and shift snapshots' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_workday_schedule_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce workday schedule snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_workday_schedule_snapshots_validate_insert
  BEFORE INSERT ON "workforce_workday_schedule_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_workday_schedule_snapshot();
CREATE TRIGGER workforce_workday_schedule_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "workforce_workday_schedule_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_workday_schedule_snapshot_mutation();

ALTER TABLE "workforce_workday_schedule_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_workday_schedule_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workforce_workday_schedule_snapshots_tenant_select"
  ON "workforce_workday_schedule_snapshots" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "workforce_workday_schedule_snapshots_tenant_insert"
  ON "workforce_workday_schedule_snapshots" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
