-- Old clients must not restore a second password or allocate an authoritative
-- phone to another login. No person is converted by this additive migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION identity_legacy_phone_conflicts(source_phone TEXT, canonical_phone TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE digits TEXT;
BEGIN
  digits := regexp_replace(source_phone, '[^0-9]', '', 'g');
  IF left(digits, 2) = '00' THEN digits := substr(digits, 3); END IF;
  RETURN digits = substr(canonical_phone, 2)
    OR (left(digits, 1) = '0' AND length(digits) BETWEEN 9 AND 15
      AND right(canonical_phone, length(digits) - 1) = substr(digits, 2));
END $$;

CREATE FUNCTION identity_guard_legacy_login_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_id TEXT; bound_id TEXT; contact_changed BOOLEAN;
BEGIN
  -- Includes password-only creation and relinking, which otherwise could race
  -- a cutover's final actor inventory even with no phone in the new row.
  PERFORM pg_advisory_xact_lock(hashtextextended('identity-registry:' || NEW."organizationId", 0));
  IF TG_TABLE_NAME = 'users' THEN subject_id := NEW.id;
  ELSE
    subject_id := NEW."userId";
    SELECT "userId" INTO bound_id FROM identity_actor_bindings
      WHERE "organizationId" = NEW."organizationId" AND "actorId" = NEW.id;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
    AND EXISTS (SELECT 1 FROM identity_accounts WHERE "organizationId" = NEW."organizationId"
      AND "userId" IN (subject_id, bound_id) AND "cutoverAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'IDENTITY_CANONICAL_CREDENTIAL_REQUIRED' USING ERRCODE = '23514';
  END IF;
  -- A new application card is credentialless. Possession of a linked User ID
  -- is not permission to introduce an independent password after conversion.
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'mtm_agents' AND NEW."passwordHash" IS NOT NULL
    AND EXISTS (SELECT 1 FROM identity_accounts WHERE "organizationId" = NEW."organizationId"
      AND "userId" = subject_id AND "cutoverAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'IDENTITY_CANONICAL_CREDENTIAL_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'mtm_agents' THEN
    IF NEW."userId" IS DISTINCT FROM OLD."userId" AND NEW."passwordHash" IS NOT NULL
      AND EXISTS (SELECT 1 FROM identity_accounts WHERE "organizationId" = NEW."organizationId"
        AND "userId" = subject_id AND "cutoverAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'IDENTITY_CANONICAL_CREDENTIAL_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;

  contact_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN contact_changed := NEW.phone IS DISTINCT FROM OLD.phone; END IF;
  IF contact_changed AND NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    -- Shared with proof/claim/cutover writers, including previously unfenced
    -- creation endpoints. A deadlock aborts the write rather than admitting it.
    IF EXISTS (
      SELECT 1 FROM identity_phone_claims c JOIN identity_accounts a
        ON a."organizationId" = c."organizationId" AND a."userId" = c."userId"
      WHERE c."organizationId" = NEW."organizationId" AND a."cutoverAt" IS NOT NULL
        AND identity_legacy_phone_conflicts(NEW.phone, c."normalizedPhone")
    ) THEN
      RAISE EXCEPTION 'IDENTITY_CANONICAL_PHONE_RESERVED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER identity_user_legacy_login_write BEFORE INSERT OR UPDATE OF phone, "passwordHash" ON users
  FOR EACH ROW EXECUTE FUNCTION identity_guard_legacy_login_write();
CREATE TRIGGER identity_actor_legacy_login_write BEFORE INSERT OR UPDATE OF phone, "passwordHash", "userId" ON mtm_agents
  FOR EACH ROW EXECUTE FUNCTION identity_guard_legacy_login_write();
COMMIT;
