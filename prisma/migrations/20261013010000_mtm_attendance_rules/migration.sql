-- An opt-in MTM report, independent of the retired Workforce routes.
-- No existing row or workday is changed. Old application builds ignore this table.
SET lock_timeout = '3s';

CREATE TABLE "mtm_attendance_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "effectiveFrom" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "startTime" VARCHAR(5) NOT NULL,
  "endTime" VARCHAR(5) NOT NULL,
  "lunchMinutes" INTEGER NOT NULL,
  "lateGraceMinutes" INTEGER NOT NULL,
  "weekendDays" INTEGER[] NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_attendance_rules_hours_check" CHECK (
    "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" > "startTime"
    AND "lunchMinutes" >= 0
    AND "lunchMinutes" < EXTRACT(EPOCH FROM ("endTime"::time - "startTime"::time)) / 60
    AND "lateGraceMinutes" BETWEEN 0 AND 120
  ),
  CONSTRAINT "mtm_attendance_rules_weekends_check" CHECK (
    cardinality("weekendDays") <= 6
    AND "weekendDays" <@ ARRAY[0,1,2,3,4,5,6]
    AND array_position("weekendDays", NULL) IS NULL
  )
);
CREATE UNIQUE INDEX "mtm_attendance_rules_organizationId_effectiveFrom_key"
  ON "mtm_attendance_rules"("organizationId", "effectiveFrom");

ALTER TABLE "mtm_attendance_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mtm_attendance_rules"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

CREATE FUNCTION mtm_attendance_rules_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- PostgreSQL validates the timezone too. Even direct SQL cannot publish
    -- today's or yesterday's rule and silently change an existing report.
    IF NEW."effectiveFrom" <= (CURRENT_TIMESTAMP AT TIME ZONE NEW."timezone")::date THEN
      RAISE EXCEPTION 'MTM_ATTENDANCE_RULE_FUTURE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Keep the normal organization-deletion cascade; individual versions remain
  -- immutable while their organization exists.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_RULE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER mtm_attendance_rules_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_rules"
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_rules_immutable();

-- Rollback: keep the additive table and roll the application back. No data reset.
