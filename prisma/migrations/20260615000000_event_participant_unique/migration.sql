-- C9 #14 — EventParticipant @@unique(eventId, email).
--
-- Kills duplicate-registration rows: the same person registering twice (via a
-- race past the app-level dedup, an admin re-add, or an import) created a second
-- EventParticipant, and each one with a campaign-linked event spawned its own
-- C9 attribution touchpoint (sourceKey `event:<participantId>:registered`),
-- double-counting that campaign's credit.
--
-- This migration is dedup-safe: it collapses existing (eventId, email)
-- duplicates BEFORE creating the unique index (which would otherwise fail), and
-- removes the orphaned touchpoints the losing rows produced. email is nullable,
-- so the unique index is NULLS DISTINCT (Postgres default) — email-less invited
-- / imported participants are never deduped and many per event stay legal.

-- 1. Capture the "loser" rows: for each (eventId, email) with a non-null email,
--    keep the best single row (prefer one carrying a contactId, then the
--    earliest registration, then lowest id) and mark the rest as losers.
--    Plain TEMP TABLE (no ON COMMIT DROP): it must survive across the steps
--    below, which holds whether or not Prisma wraps this file in one
--    transaction — a session-scoped temp table persists across autocommit
--    statements on the same connection, and ON COMMIT DROP would instead vanish
--    it after step 1 if the file ran statement-by-statement. Dropped explicitly
--    at step 6. Prisma Migrate does NOT guarantee a per-file transaction on
--    Postgres, so every step here is idempotent/re-runnable (DROP/CREATE IF NOT
--    EXISTS, dedup deletes are no-ops once losers are gone) — a partial failure
--    can be safely re-applied. Verified by running this file against Postgres 16
--    in BOTH single-transaction and autocommit modes.
DROP TABLE IF EXISTS _ep_dedup_losers;
CREATE TEMP TABLE _ep_dedup_losers AS
SELECT id, "eventId"
FROM (
  SELECT
    id,
    "eventId",
    ROW_NUMBER() OVER (
      PARTITION BY "eventId", email
      ORDER BY ("contactId" IS NULL) ASC, "registeredAt" ASC, id ASC
    ) AS rn
  FROM "event_participants"
  WHERE email IS NOT NULL
) ranked
WHERE rn > 1;

-- 2. Delete the attribution touchpoints the losing participants spawned, so
--    duplicate event credit goes away. The ':registered' key is the live one;
--    ':attended' is defensive — no prod path records an attended touchpoint yet
--    (the touchpointSourceKey.eventAttended builder exists but has no writer),
--    so that arm is a no-op today and future-proofs an attended-touchpoint
--    feature without a follow-up migration.
DELETE FROM "campaign_touchpoints"
WHERE "sourceKey" IN (
  SELECT 'event:' || id || ':registered' FROM _ep_dedup_losers
  UNION ALL
  SELECT 'event:' || id || ':attended' FROM _ep_dedup_losers
);

-- 3. Delete the losing participants themselves.
DELETE FROM "event_participants"
WHERE id IN (SELECT id FROM _ep_dedup_losers);

-- 4. Repair registeredCount on the events that lost rows (the register routes
--    derive it from the live participant count, so dedup must too).
UPDATE "events" e
SET "registeredCount" = (
  SELECT COUNT(*) FROM "event_participants" ep WHERE ep."eventId" = e.id
)
WHERE e.id IN (SELECT DISTINCT "eventId" FROM _ep_dedup_losers);

-- 5. Repair attendedCount the same way — a deleted duplicate may have carried
--    status='attended', which would otherwise leave the counter over-stated
--    (participants routes recompute it identically: COUNT WHERE status='attended').
UPDATE "events" e
SET "attendedCount" = (
  SELECT COUNT(*) FROM "event_participants" ep
  WHERE ep."eventId" = e.id AND ep.status = 'attended'
)
WHERE e.id IN (SELECT DISTINCT "eventId" FROM _ep_dedup_losers);

-- 6. Done with the loser set.
DROP TABLE _ep_dedup_losers;

-- 7. Enforce it going forward (matches Prisma @@unique([eventId, email])).
--    IF NOT EXISTS so a re-applied partial run doesn't error on an already-built
--    index (Prisma's per-file atomicity isn't guaranteed — see step-1 note).
CREATE UNIQUE INDEX IF NOT EXISTS "event_participants_eventId_email_key"
  ON "event_participants"("eventId", "email");
