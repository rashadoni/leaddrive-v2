-- T8 Cobrowse slice-3c — `lastSeenAt` SSE liveness column +
-- reaper-hot-path index.
--
-- Closes the slice-3c-architect P1 bug: `updatedAt` only bumps on
-- row mutations, so a long-running `active` session with no state
-- transitions has stale `updatedAt` from the moment it went active.
-- The reaper would force-end healthy active sessions at the
-- 15-minute threshold.
--
-- Fix: nullable `lastSeenAt` poked by the SSE heartbeat (~25s).
-- Reaper predicate becomes `lastSeenAt < cutoff` (with `updatedAt`
-- fallback for never-subscribed sessions). The `(status,
-- lastSeenAt)` index serves the reaper scan.

ALTER TABLE "cobrowse_sessions"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "cobrowse_sessions_status_lastSeenAt_idx"
  ON "cobrowse_sessions"("status", "lastSeenAt");
