-- No backfill, enrollment or activation. Protect pending identity proofs from
-- contact edits, including change-away/return. A legacy writer cannot change
-- an authoritative identity's phone; that requires the verified claim service.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE identity_accounts ADD COLUMN "contactRevision" INTEGER NOT NULL DEFAULT 1
  CHECK ("contactRevision" > 0);
ALTER TABLE identity_events ADD COLUMN "contactRevision" INTEGER
  CHECK ("contactRevision" > 0);

CREATE FUNCTION identity_guard_contact_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contactRevision" < OLD."contactRevision" THEN
    RAISE EXCEPTION 'IDENTITY_CONTACT_REVISION_ROLLBACK' USING ERRCODE = '23514';
  END IF;
  IF NEW."contactRevision" IS DISTINCT FROM OLD."contactRevision"
    AND (NEW.version <= OLD.version OR NEW."credentialEpoch" <= OLD."credentialEpoch") THEN
    RAISE EXCEPTION 'IDENTITY_CONTACT_EPOCH_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_contact_revision_guard BEFORE UPDATE ON identity_accounts
  FOR EACH ROW EXECUTE FUNCTION identity_guard_contact_revision();

CREATE FUNCTION identity_legacy_contact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_id TEXT; changed RECORD; event_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    subject_id := NEW.id;
  ELSE
    subject_id := NEW."userId";
    -- An immutable reviewed binding remains the owner after a bad legacy relink.
    SELECT "userId" INTO subject_id FROM identity_actor_bindings
      WHERE "organizationId" = NEW."organizationId" AND "actorId" = NEW.id;
    IF NOT FOUND THEN subject_id := NEW."userId"; END IF;
  END IF;
  IF subject_id IS NULL THEN RETURN NEW; END IF;
  SELECT "cutoverAt" INTO changed FROM identity_accounts
    WHERE "organizationId" = NEW."organizationId" AND "userId" = subject_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF changed."cutoverAt" IS NOT NULL THEN
    RAISE EXCEPTION 'IDENTITY_VERIFIED_CONTACT_CHANGE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  UPDATE identity_accounts SET version = version + 1, "credentialEpoch" = "credentialEpoch" + 1,
    "contactRevision" = "contactRevision" + 1, "updatedAt" = clock_timestamp()
    WHERE "organizationId" = NEW."organizationId" AND "userId" = subject_id
    RETURNING version, "credentialEpoch", "contactRevision" INTO changed;
  -- Reuse the retained person-security event: no raw old/new phone in logs.
  event_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO identity_events (id,"organizationId","userId","actorUserId","requestId","requestHash",
    action,"accountVersion","credentialEpoch","contactRevision","createdAt")
    VALUES (event_id,NEW."organizationId",subject_id,NULL,'contact-state:' || event_id,
      encode(sha256(convert_to(event_id,'UTF8')),'hex'),'PERSON_LIFECYCLE_CHANGED',
      changed.version,changed."credentialEpoch",changed."contactRevision",clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER identity_user_contact AFTER UPDATE OF phone ON users
  FOR EACH ROW WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
  EXECUTE FUNCTION identity_legacy_contact_changed();
CREATE TRIGGER identity_actor_contact AFTER UPDATE OF phone ON mtm_agents
  FOR EACH ROW WHEN (OLD.phone IS DISTINCT FROM NEW.phone)
  EXECUTE FUNCTION identity_legacy_contact_changed();
COMMIT;
