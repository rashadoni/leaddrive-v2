-- Follow-up cleanup for production rows hidden from the previous migration by
-- forced RLS. Keep this scoped to Contract.status normalization, then validate
-- the existing database check.
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  invalid_statuses text;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'contracts'::regclass;

  ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;

  UPDATE "contracts"
  SET "status" = CASE
    WHEN "status" = 'sent' THEN 'pending_approval'
    WHEN "status" = 'pending' THEN 'pending_approval'
    WHEN "status" = 'signed' THEN 'approved'
    WHEN "status" = 'executed' THEN 'active'
    WHEN "status" = 'approved' AND "signedAt" IS NOT NULL THEN 'active'
    WHEN "status" = 'expiring' AND "endDate" IS NOT NULL AND "endDate" < NOW() THEN 'expired'
    WHEN "status" = 'expiring' THEN 'active'
    WHEN "status" = 'negotiation' AND "currentApprovalStage" IS NOT NULL THEN 'pending_approval'
    WHEN "status" = 'negotiation' AND "signedAt" IS NOT NULL THEN 'active'
    WHEN "status" = 'negotiation' THEN 'draft'
    ELSE "status"
  END
  WHERE
    "status" IN ('sent', 'pending', 'signed', 'executed', 'expiring', 'negotiation')
    OR ("status" = 'approved' AND "signedAt" IS NOT NULL);

  SELECT string_agg(status, ', ' ORDER BY status)
  INTO invalid_statuses
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
  ) AS invalid_rows;

  IF invalid_statuses IS NOT NULL THEN
    RAISE EXCEPTION 'Contract.status contains unknown values: %', invalid_statuses;
  END IF;

  ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_status_check";

  IF had_rls THEN
    ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;
  END IF;

  IF had_force_rls THEN
    ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contracts" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
