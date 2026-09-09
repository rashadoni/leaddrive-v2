-- Normalize contract workflow invariants that were possible through legacy
-- status edits and old renewal-alert scheduling.
DO $$
DECLARE
  contracts_had_rls boolean;
  contracts_had_force_rls boolean;
  stages_had_rls boolean;
  stages_had_force_rls boolean;
  alerts_had_rls boolean;
  alerts_had_force_rls boolean;
  invalid_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO contracts_had_rls, contracts_had_force_rls
  FROM pg_class
  WHERE oid = 'contracts'::regclass;

  SELECT relrowsecurity, relforcerowsecurity
  INTO stages_had_rls, stages_had_force_rls
  FROM pg_class
  WHERE oid = 'contract_approval_stages'::regclass;

  SELECT relrowsecurity, relforcerowsecurity
  INTO alerts_had_rls, alerts_had_force_rls
  FROM pg_class
  WHERE oid = 'contract_renewal_alerts'::regclass;

  ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contract_approval_stages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contract_renewal_alerts" DISABLE ROW LEVEL SECURITY;

  UPDATE "contracts"
  SET "currentApprovalStage" = NULL
  WHERE "status" <> 'pending_approval'
    AND "currentApprovalStage" IS NOT NULL;

  UPDATE "contract_approval_stages" AS stage
  SET
    "status" = 'superseded',
    "decidedAt" = COALESCE(stage."decidedAt", NOW())
  FROM "contracts" AS contract
  WHERE stage."contractId" = contract."id"
    AND stage."organizationId" = contract."organizationId"
    AND stage."status" = 'pending'
    AND contract."status" <> 'pending_approval';

  UPDATE "contracts" AS contract
  SET "currentApprovalStage" = pending_stage."order"
  FROM (
    SELECT "contractId", "organizationId", MIN("order") AS "order"
    FROM "contract_approval_stages"
    WHERE "status" = 'pending'
    GROUP BY "contractId", "organizationId"
  ) AS pending_stage
  WHERE contract."id" = pending_stage."contractId"
    AND contract."organizationId" = pending_stage."organizationId"
    AND contract."status" = 'pending_approval'
    AND (
      contract."currentApprovalStage" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "contract_approval_stages" AS active_stage
        WHERE active_stage."contractId" = contract."id"
          AND active_stage."organizationId" = contract."organizationId"
          AND active_stage."order" = contract."currentApprovalStage"
          AND active_stage."status" = 'pending'
      )
    );

  UPDATE "contracts" AS contract
  SET
    "status" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "contract_approval_stages" AS rejected_stage
        WHERE rejected_stage."contractId" = contract."id"
          AND rejected_stage."organizationId" = contract."organizationId"
          AND rejected_stage."status" = 'rejected'
      ) THEN 'rejected'
      WHEN EXISTS (
        SELECT 1
        FROM "contract_approval_stages" AS decided_stage
        WHERE decided_stage."contractId" = contract."id"
          AND decided_stage."organizationId" = contract."organizationId"
          AND decided_stage."status" IN ('approved', 'skipped', 'superseded')
      ) THEN 'approved'
      ELSE 'draft'
    END,
    "currentApprovalStage" = NULL
  WHERE contract."status" = 'pending_approval'
    AND NOT EXISTS (
      SELECT 1
      FROM "contract_approval_stages" AS pending_stage
      WHERE pending_stage."contractId" = contract."id"
        AND pending_stage."organizationId" = contract."organizationId"
        AND pending_stage."status" = 'pending'
    );

  UPDATE "contract_renewal_alerts" AS alert
  SET "status" = 'superseded'
  FROM "contracts" AS contract
  WHERE alert."contractId" = contract."id"
    AND alert."organizationId" = contract."organizationId"
    AND alert."status" = 'pending'
    AND contract."status" NOT IN ('active', 'renewing');

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contracts"
  WHERE "currentApprovalStage" IS NOT NULL
    AND "status" <> 'pending_approval';
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Contracts with currentApprovalStage outside pending_approval remain: %', invalid_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contracts"
  WHERE "status" = 'pending_approval'
    AND "currentApprovalStage" IS NULL;
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Pending-approval contracts without currentApprovalStage remain: %', invalid_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contracts" AS contract
  WHERE contract."status" = 'pending_approval'
    AND NOT EXISTS (
      SELECT 1
      FROM "contract_approval_stages" AS stage
      WHERE stage."contractId" = contract."id"
        AND stage."organizationId" = contract."organizationId"
        AND stage."order" = contract."currentApprovalStage"
        AND stage."status" = 'pending'
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Pending-approval contracts without a pending stage at currentApprovalStage remain: %', invalid_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contracts" AS contract
  WHERE contract."status" <> 'pending_approval'
    AND EXISTS (
      SELECT 1
      FROM "contract_approval_stages" AS stage
      WHERE stage."contractId" = contract."id"
        AND stage."organizationId" = contract."organizationId"
        AND stage."status" = 'pending'
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Non-pending contracts with pending approval stages remain: %', invalid_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contract_renewal_alerts" AS alert
  JOIN "contracts" AS contract ON contract."id" = alert."contractId"
  WHERE alert."status" = 'pending'
    AND contract."status" NOT IN ('active', 'renewing');
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Pending renewal alerts for non-live contracts remain: %', invalid_count;
  END IF;

  IF contracts_had_rls THEN
    ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;
  END IF;
  IF contracts_had_force_rls THEN
    ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contracts" NO FORCE ROW LEVEL SECURITY;
  END IF;

  IF stages_had_rls THEN
    ALTER TABLE "contract_approval_stages" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contract_approval_stages" DISABLE ROW LEVEL SECURITY;
  END IF;
  IF stages_had_force_rls THEN
    ALTER TABLE "contract_approval_stages" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contract_approval_stages" NO FORCE ROW LEVEL SECURITY;
  END IF;

  IF alerts_had_rls THEN
    ALTER TABLE "contract_renewal_alerts" ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contract_renewal_alerts" DISABLE ROW LEVEL SECURITY;
  END IF;
  IF alerts_had_force_rls THEN
    ALTER TABLE "contract_renewal_alerts" FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE "contract_renewal_alerts" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
