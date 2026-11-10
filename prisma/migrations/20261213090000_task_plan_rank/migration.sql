-- Each person's order of cards inside a day, as in Bordio (owner, 2026-11-10:
-- «Да, доведи»). See schema.prisma TaskPlan.rank.
ALTER TABLE "task_plans" ADD COLUMN "rank" DOUBLE PRECISION;
