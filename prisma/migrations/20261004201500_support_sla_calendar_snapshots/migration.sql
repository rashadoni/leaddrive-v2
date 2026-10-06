-- Prospective opt-in only. No backfill or recomputation of existing deadlines.
ALTER TABLE "sla_policies" ADD COLUMN "businessCalendar" JSONB;
ALTER TABLE "tickets" ADD COLUMN "slaCalendarSnapshot" JSONB;
