-- Personnel → Settings → Working hours (owner, 2026-10-16: «тут не указано
-- время обеденного перерыва»). The lunch's start time beside its length; the
-- planned norm still subtracts lunchMinutes. Nullable, no backfill: rules saved
-- before today keep a lunch of known length and unknown time.
SET lock_timeout = '3s';
ALTER TABLE "mtm_attendance_rules" ADD COLUMN "lunchStart" VARCHAR(5);
ALTER TABLE "mtm_attendance_rules" ADD CONSTRAINT "mtm_attendance_rules_lunch_window_check" CHECK (
  "lunchStart" IS NULL OR (
    "lunchStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "lunchMinutes" > 0
    AND "lunchStart" >= "startTime"
    AND "lunchStart"::time + make_interval(mins => "lunchMinutes") <= "endTime"::time
    AND "lunchStart"::time + make_interval(mins => "lunchMinutes") > "lunchStart"::time
  )
);
