-- The app closes a stale voice session as "superseded" when the user starts a
-- new one, but the check constraint never listed that value. Postgres rejected
-- every such write, so the cleanup failed once a minute and the abandoned
-- session kept its five-minute reservation forever -- which is how an
-- organisation reached 115 of 120 reserved minutes having spoken 60.
--
-- `never_connected` is the same defect and the worse half of it. The reaper
-- writes it for a session that reserved minutes and never said a word, and it
-- sweeps a batch of 200 in one loop, oldest first, with no per-row error
-- handling. So the first rejected row aborts the whole batch for every tenant,
-- the row stays `active`, and — being the oldest — it is picked first again on
-- the next run. One abandoned tab wedges the cleanup permanently.
--
-- Both values were listed by enumerating what the code actually writes rather
-- than by reading this constraint: `active`, `ended`, `abandoned`,
-- `never_connected`, `superseded`. Five written, three allowed.
--
-- Widening the constraint keeps the distinction the code intends: a session
-- replaced by a newer one is not the same event as one the user walked away
-- from, nor as one that never connected at all, and analytics should still be
-- able to tell them apart.
ALTER TABLE "voice_sessions" DROP CONSTRAINT IF EXISTS "voice_sessions_status_check";
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_status_check"
  CHECK (status IN ('active', 'ended', 'abandoned', 'never_connected', 'superseded'));
