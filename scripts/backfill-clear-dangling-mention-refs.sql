-- Backfill: clear dangling SocialMention back-references.
--
-- SocialMention.{leadId,ticketId,taskId} are plain String? columns with NO
-- foreign key. Deletes that predate the app-level cleanup
-- (src/lib/social/mention-refs.ts) left these pointing at rows that no longer
-- exist (leads/tickets — hard delete) or are soft-deleted (tasks — deletedAt).
-- Such a row keeps showing the green "view lead/ticket/task" link in Social
-- Monitoring and can never be re-converted (the convert routes 409 while the
-- ref is set).
--
-- This is idempotent and safe: it only touches rows whose reference is PROVABLY
-- dangling (target missing / soft-deleted). Running it twice is a no-op.
--   psql "$DATABASE_URL" -f scripts/backfill-clear-dangling-mention-refs.sql
-- On the server use -h localhost (peer auth fails otherwise).

BEGIN;

-- Leads (hard delete): ref points at a missing leads row.
UPDATE social_mentions sm
SET "leadId" = NULL,
    status = CASE WHEN sm.status = 'converted_to_lead' THEN 'reviewed' ELSE sm.status END
WHERE sm."leadId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = sm."leadId");

-- Tickets (hard delete): ref points at a missing tickets row.
UPDATE social_mentions sm
SET "ticketId" = NULL,
    status = CASE WHEN sm.status = 'converted_to_ticket' THEN 'reviewed' ELSE sm.status END
WHERE sm."ticketId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = sm."ticketId");

-- Tasks (soft delete): ref points at a missing OR soft-deleted tasks row.
UPDATE social_mentions sm
SET "taskId" = NULL,
    status = CASE WHEN sm.status = 'converted_to_task' THEN 'reviewed' ELSE sm.status END
WHERE sm."taskId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = sm."taskId" AND t."deletedAt" IS NULL);

COMMIT;
