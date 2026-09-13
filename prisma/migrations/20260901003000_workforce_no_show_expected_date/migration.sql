-- C6: a no-show has no accepted workday to identify its day. Preserve the
-- additive immutable case ledger, but add the exact published expected date
-- to a segment-only case subject so recurring template segments cannot
-- deduplicate separate days together.

SET lock_timeout = '3s';

ALTER TABLE "workforce_exception_cases"
  ADD COLUMN "expectedWorkDate" DATE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workforce_exception_cases"
    WHERE "kind" = 'NO_SHOW'
      AND "segmentId" IS NOT NULL
      AND "workdayId" IS NULL
      AND "workdayEventId" IS NULL
      AND "evidenceId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing schedule-only NO_SHOW cases need an explicit expected work date before this migration can continue';
  END IF;
END;
$$;

ALTER TABLE "workforce_exception_cases"
  ADD CONSTRAINT "workforce_exception_cases_expected_date_segment_check"
    CHECK (
      ("expectedWorkDate" IS NOT NULL) = (
        "kind" = 'NO_SHOW'
        AND "segmentId" IS NOT NULL
        AND "workdayId" IS NULL
        AND "workdayEventId" IS NULL
        AND "evidenceId" IS NULL
      )
    );

CREATE INDEX "workforce_exception_cases_org_expected_date_idx"
  ON "workforce_exception_cases"("organizationId", "expectedWorkDate");

-- The original subject checks remain in force. A date can identify only a
-- schedule-only segment case; it must not rewrite or supplement an accepted
-- workday/event subject.
CREATE OR REPLACE FUNCTION workforce_validate_exception_case_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_agent_id TEXT;
  linked_workday_id TEXT;
  evidence_agent_id TEXT;
  evidence_workday_id TEXT;
  subject_workday_id TEXT;
BEGIN
  IF NEW."workdayId" IS NOT NULL THEN
    SELECT "agentId" INTO linked_agent_id
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce exception case workday must belong to its tenant employee' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."workdayEventId" IS NOT NULL THEN
    SELECT "agentId", "workdayId" INTO linked_agent_id, linked_workday_id
    FROM "mtm_agent_workday_events"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayEventId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId"
       OR (NEW."workdayId" IS NOT NULL AND linked_workday_id <> NEW."workdayId") THEN
      RAISE EXCEPTION 'Workforce exception case event must match its tenant employee/workday' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."evidenceId" IS NOT NULL THEN
    SELECT
      COALESCE(event."agentId", transition."agentId"),
      COALESCE(event."workdayId", transition."workdayId")
    INTO evidence_agent_id, evidence_workday_id
    FROM "workforce_attendance_evidence" AS evidence
    LEFT JOIN "mtm_agent_workday_events" AS event
      ON event."organizationId" = evidence."organizationId"
      AND event."id" = evidence."workdayEventId"
    LEFT JOIN "workforce_site_transitions" AS transition
      ON transition."organizationId" = evidence."organizationId"
      AND transition."id" = evidence."siteTransitionId"
    WHERE evidence."organizationId" = NEW."organizationId"
      AND evidence."id" = NEW."evidenceId";
    IF NOT FOUND OR evidence_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce exception case evidence must belong to its tenant employee' USING ERRCODE = '23514';
    END IF;
  END IF;

  subject_workday_id := COALESCE(NEW."workdayId", linked_workday_id, evidence_workday_id);
  IF NEW."workdayId" IS NOT NULL
     AND evidence_workday_id IS NOT NULL
     AND evidence_workday_id <> NEW."workdayId" THEN
    RAISE EXCEPTION 'Workforce exception case evidence must match its linked workday' USING ERRCODE = '23514';
  END IF;

  IF NEW."segmentId" IS NOT NULL AND subject_workday_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "workforce_workday_schedule_snapshots" AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot."segments"::jsonb) AS segment(value)
    WHERE snapshot."organizationId" = NEW."organizationId"
      AND snapshot."workdayId" = subject_workday_id
      AND segment.value ->> 'id' = NEW."segmentId"
  ) THEN
    RAISE EXCEPTION 'Workforce exception case segment must be pinned in its employee workday snapshot' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- No row is created or updated by this migration. The existing append-only
-- trigger and RLS policies remain the write fence; scheduled detection and
-- outbound delivery are deliberately separate C6 activation work.
