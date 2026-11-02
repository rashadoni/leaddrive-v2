-- The shell event watcher (src/lib/shell-events/watcher.ts) asks every two
-- seconds which notifications arrived in the last ten minutes for the
-- organisations with a tab open. Without this index that reads every
-- notification those organisations ever had. 8 216 rows on production
-- (2026-10-27): the build takes milliseconds.
CREATE INDEX IF NOT EXISTS "notifications_organizationId_createdAt_idx" ON "notifications"("organizationId", "createdAt");
