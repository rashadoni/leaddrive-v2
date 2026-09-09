-- Persist a canonical external-party identity on CallLog so call-history
-- policy never depends on fuzzy suffix matching. This migration does not
-- enable queues or dispatch any calls.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE "call_logs"
  ADD COLUMN "targetPhoneE164" TEXT;

-- Backfill only representations already accepted by the sales-call policy:
-- explicit E.164, explicit Azerbaijani country code, or Azerbaijani national
-- form. Other bare national numbers stay NULL; the migration never guesses a
-- country from length or a suffix.
WITH compacted AS (
  SELECT
    "id",
    regexp_replace(
      CASE
        WHEN "direction" = 'outbound' THEN "toNumber"
        WHEN "direction" = 'inbound' THEN "fromNumber"
        ELSE ''
      END,
      '[[:space:]().-]',
      '',
      'g'
    ) AS "compact"
  FROM "call_logs"
), canonical AS (
  SELECT
    "id",
    CASE
      WHEN "compact" ~ '^\+[1-9][0-9]{6,14}$' THEN "compact"
      WHEN "compact" ~ '^994[0-9]{9}$' THEN '+' || "compact"
      WHEN "compact" ~ '^0[0-9]{9}$' THEN '+994' || substring("compact" FROM 2)
      ELSE NULL
    END AS "phoneE164"
  FROM compacted
)
UPDATE "call_logs" AS call_log
SET "targetPhoneE164" = canonical."phoneE164"
FROM canonical
WHERE call_log."id" = canonical."id"
  AND canonical."phoneE164" IS NOT NULL;

ALTER TABLE "call_logs"
  ADD CONSTRAINT "call_logs_target_phone_e164_check"
  CHECK (
    "targetPhoneE164" IS NULL
    OR "targetPhoneE164" ~ '^\+[1-9][0-9]{6,14}$'
  ) NOT VALID;

ALTER TABLE "call_logs"
  VALIDATE CONSTRAINT "call_logs_target_phone_e164_check";

-- The production migration runner executed the first attempt inside a
-- transaction, where PostgreSQL rejects concurrent index creation. The deploy
-- preflight enforces a quiet window and a bounded call_logs size. The lock and
-- statement timeouts bound both acquisition and execution fail-closed.
CREATE INDEX "call_logs_org_target_phone_e164_idx"
  ON "call_logs" ("organizationId", "targetPhoneE164");
