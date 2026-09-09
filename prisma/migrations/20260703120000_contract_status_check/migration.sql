-- Normalize legacy Contract.status values before enforcing the lifecycle
-- vocabulary at the database boundary.
UPDATE "contracts"
SET "status" = CASE
  WHEN "status" = 'sent' THEN 'pending_approval'
  WHEN "status" = 'signed' THEN 'approved'
  WHEN "status" = 'executed' THEN 'active'
  WHEN "status" = 'expiring' AND "endDate" IS NOT NULL AND "endDate" < NOW() THEN 'expired'
  WHEN "status" = 'expiring' THEN 'active'
  ELSE "status"
END
WHERE "status" IN ('sent', 'signed', 'executed', 'expiring');

DO $$
DECLARE
  unknown_statuses text;
BEGIN
  SELECT string_agg(status, ', ' ORDER BY status)
  INTO unknown_statuses
  FROM (
    SELECT DISTINCT "status" AS status
    FROM "contracts"
    WHERE "status" NOT IN (
      'draft',
      'pending_approval',
      'approved',
      'active',
      'renewing',
      'renewed',
      'expired',
      'terminated',
      'rejected',
      'cancelled'
    )
  ) AS invalid_statuses;

  IF unknown_statuses IS NOT NULL THEN
    RAISE EXCEPTION 'Contract.status contains unknown values: %', unknown_statuses;
  END IF;
END $$;

-- Enforce the Contract.status lifecycle vocabulary at the database boundary.
-- NOT VALID avoids blocking deploy on any legacy rows; PostgreSQL still checks
-- new inserts and updates. A later data cleanup can VALIDATE this constraint.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_status_check"
  CHECK (
    "status" IN (
      'draft',
      'pending_approval',
      'approved',
      'active',
      'renewing',
      'renewed',
      'expired',
      'terminated',
      'rejected',
      'cancelled'
    )
  ) NOT VALID;
