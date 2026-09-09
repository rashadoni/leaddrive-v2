-- Hard invariant: a contract may not be active without a signature marker.
-- E-sign completion writes status='active' and signedAt in the same CAS update.
DO $$
DECLARE
  contracts_had_rls boolean;
  contracts_had_force_rls boolean;
  invalid_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO contracts_had_rls, contracts_had_force_rls
  FROM pg_class
  WHERE oid = 'contracts'::regclass;

  ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;

  UPDATE "contracts"
  SET
    "signedAt" = COALESCE("updatedAt", "createdAt", NOW()),
    "signedBy" = COALESCE("signedBy", 'legacy:active-backfill')
  WHERE "status" = 'active'
    AND "signedAt" IS NULL;

  SELECT COUNT(*)
  INTO invalid_count
  FROM "contracts"
  WHERE "status" = 'active'
    AND "signedAt" IS NULL;
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce contracts_active_signed_at_check; active contracts without signedAt remain: %', invalid_count;
  END IF;

  ALTER TABLE "contracts"
    ADD CONSTRAINT "contracts_active_signed_at_check"
    CHECK ("status" <> 'active' OR "signedAt" IS NOT NULL);

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
END $$;
