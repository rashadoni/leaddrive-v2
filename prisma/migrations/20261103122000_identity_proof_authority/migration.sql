-- Add a frozen canonical issuer context; existing v1 proofs keep their strict
-- legacy issuer admission and cannot be upgraded or reinterpreted as v2.
ALTER TABLE identity_phone_proofs ADD COLUMN "contextVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "contactRevision" INTEGER, ADD COLUMN "issuerAuthority" JSONB;
ALTER TABLE identity_phone_proofs ADD CONSTRAINT identity_proof_authority_shape CHECK (
  ("contextVersion" = 1 AND "contactRevision" IS NULL AND "issuerAuthority" IS NULL)
  OR ("contextVersion" = 2 AND "contactRevision" > 0 AND "contactRevision" IS NOT NULL
    AND "issuerAuthority" IS NOT NULL AND jsonb_typeof("issuerAuthority") = 'object')
);
CREATE FUNCTION identity_guard_proof_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contextVersion" IS DISTINCT FROM OLD."contextVersion"
    OR NEW."contactRevision" IS DISTINCT FROM OLD."contactRevision"
    OR NEW."issuerAuthority" IS DISTINCT FROM OLD."issuerAuthority"
    OR (OLD."contextVersion" = 2 AND (
      NEW.id IS DISTINCT FROM OLD.id OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."issuedByUserId" IS DISTINCT FROM OLD."issuedByUserId"
      OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId" OR NEW."normalizedPhone" IS DISTINCT FROM OLD."normalizedPhone"
      OR NEW."accountVersion" IS DISTINCT FROM OLD."accountVersion" OR NEW."credentialEpoch" IS DISTINCT FROM OLD."credentialEpoch"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
      OR NEW."keyId" IS DISTINCT FROM OLD."keyId" OR NEW."codeHash" IS DISTINCT FROM OLD."codeHash"
    )) THEN RAISE EXCEPTION 'IDENTITY_PROOF_AUTHORITY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_proof_authority_immutable BEFORE UPDATE ON identity_phone_proofs
  FOR EACH ROW EXECUTE FUNCTION identity_guard_proof_authority();

-- A security policy changed away and back must not revive an invitation or
-- session. Reuse the account's monotonic lifecycle epoch and receipt writer.
-- These columns also cover direct writes that omit passwordChangedAt.
CREATE TRIGGER identity_person_security_lifecycle AFTER UPDATE OF "passwordHash", "require2fa", "totpEnabled", "totpSecret", "smsAuthEnabled", "verifiedPhone" ON users
  FOR EACH ROW WHEN (OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash"
    OR OLD."require2fa" IS DISTINCT FROM NEW."require2fa" OR OLD."totpEnabled" IS DISTINCT FROM NEW."totpEnabled"
    OR OLD."totpSecret" IS DISTINCT FROM NEW."totpSecret" OR OLD."smsAuthEnabled" IS DISTINCT FROM NEW."smsAuthEnabled"
    OR OLD."verifiedPhone" IS DISTINCT FROM NEW."verifiedPhone")
  EXECUTE FUNCTION identity_person_lifecycle_changed();
