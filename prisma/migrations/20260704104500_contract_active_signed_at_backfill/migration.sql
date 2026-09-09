-- Demo/import cleanup: active contracts should have a signedAt marker so
-- lifecycle analytics and advisor signals do not treat them as unsigned.
--
-- This is intentionally scoped to already-active legacy rows. Real e-sign
-- completions continue to write signedBy = 'esign:<envelopeId>'.
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
    RAISE EXCEPTION 'Active contracts without signedAt remain: %', invalid_count;
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
END $$;
