-- D8 Loyalty — birthday auto-earn trigger.
-- A contact's birth date (month + day are matched daily by the
-- /api/cron/loyalty-birthday cron to award the "birthday" earn rule).
-- Additive + nullable: no default, no backfill, zero risk to existing rows.
ALTER TABLE "contacts" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
