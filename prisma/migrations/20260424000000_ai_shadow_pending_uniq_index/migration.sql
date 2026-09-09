-- Partial unique index: at most one PENDING shadow action per (org, entity, feature).
--
-- Enforces the dedup invariant of the `runAutoFollowUp` / `runHotLeadEscalation`
-- family of cron handlers at the DB level, so a race between overlapping cron
-- runs can't produce duplicate pending rows (second create fails with P2002,
-- which handlers now swallow and move on).
--
-- Approved / rejected rows are intentionally out of scope — they form the
-- audit trail and multiple historical reviews per entity are expected.
--
-- Prisma schema.prisma doesn't support partial indexes natively (WHERE clause),
-- so this lives as a hand-written migration; do not let `prisma db pull` or
-- model-level @@unique overwrite it.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_shadow_actions_pending_uniq"
  ON "ai_shadow_actions" ("organizationId", "entityType", "entityId", "featureName")
  WHERE approved IS NULL;
