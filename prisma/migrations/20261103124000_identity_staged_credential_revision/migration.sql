-- A reset of a still-legacy credential must invalidate an outstanding staged
-- invitation/setup, including a change away and back to the original hash.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE FUNCTION identity_staged_credential_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_id TEXT; changed RECORD; event_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('identity-registry:' || NEW."organizationId", 0));
  IF TG_TABLE_NAME = 'users' THEN subject_id := NEW.id;
  ELSE
    SELECT "userId" INTO subject_id FROM identity_actor_bindings
      WHERE "organizationId" = NEW."organizationId" AND "actorId" = NEW.id;
    IF NOT FOUND THEN subject_id := NEW."userId"; END IF;
  END IF;
  IF subject_id IS NULL THEN RETURN NEW; END IF;
  UPDATE identity_accounts SET version = version + 1, "credentialEpoch" = "credentialEpoch" + 1,
    "updatedAt" = clock_timestamp()
    WHERE "organizationId" = NEW."organizationId" AND "userId" = subject_id AND "cutoverAt" IS NULL
    RETURNING version, "credentialEpoch" INTO changed;
  IF FOUND THEN
    event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO identity_events (id,"organizationId","userId","actorUserId","requestId","requestHash",
      action,"accountVersion","credentialEpoch","createdAt")
      VALUES (event_id,NEW."organizationId",subject_id,NULL,'staged-credential:' || event_id,
        encode(sha256(convert_to(event_id,'UTF8')),'hex'),'PERSON_LIFECYCLE_CHANGED',
        changed.version,changed."credentialEpoch",clock_timestamp());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_user_staged_credential AFTER UPDATE OF "passwordHash", "passwordChangedAt" ON users
  FOR EACH ROW WHEN (OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash"
    OR OLD."passwordChangedAt" IS DISTINCT FROM NEW."passwordChangedAt")
  EXECUTE FUNCTION identity_staged_credential_changed();
CREATE TRIGGER identity_actor_staged_credential AFTER UPDATE OF "passwordHash" ON mtm_agents
  FOR EACH ROW WHEN (OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash")
  EXECUTE FUNCTION identity_staged_credential_changed();
COMMIT;
