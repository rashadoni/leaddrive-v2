BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
-- Module-specific removal. No history, credential of a linked person or Time state is deleted.
ALTER TABLE "mtm_agents" ADD COLUMN "fieldDeletedAt" TIMESTAMP(3);
CREATE INDEX "mtm_agents_organizationId_fieldDeletedAt_idx" ON "mtm_agents"("organizationId", "fieldDeletedAt");
-- Ordinary edits must not resurrect a removed Field identity or retarget it.
CREATE FUNCTION mtm_guard_field_removal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."fieldDeletedAt" IS NOT NULL AND
     (NEW."fieldDeletedAt" IS DISTINCT FROM OLD."fieldDeletedAt" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'MTM_FIELD_REMOVAL_RETAINED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_field_removal_guard BEFORE UPDATE ON "mtm_agents"
  FOR EACH ROW EXECUTE FUNCTION mtm_guard_field_removal();

-- Revoke only the Field membership, including on older compatible readers.
-- Account version is a planning CAS revision; credentialEpoch is unchanged,
-- so existing Time/CRM sessions and their membership versions remain valid.
CREATE FUNCTION mtm_revoke_removed_field_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed RECORD; event_id TEXT; account_version INTEGER;
BEGIN
  FOR changed IN
    UPDATE public.identity_application_memberships AS m
      SET status = 'REVOKED', version = m.version + 1, "updatedAt" = clock_timestamp()
    FROM public.identity_accounts AS a, public.identity_application_grants AS g
    WHERE m."organizationId" = NEW."organizationId" AND m."actorId" = NEW.id AND m.application = 'ROUTE_FIELD'
      AND a."organizationId" = m."organizationId" AND a."userId" = m."userId"
      AND g."organizationId" = m."organizationId" AND g."userId" = m."userId" AND g.application = m.application
    RETURNING m."organizationId" AS organization_id, m."userId" AS user_id, m.version AS membership_version,
      a."credentialEpoch" AS credential_epoch, g.version AS grant_version
  LOOP
    UPDATE public.identity_accounts SET version = version + 1, "updatedAt" = clock_timestamp()
      WHERE "organizationId" = changed.organization_id AND "userId" = changed.user_id
      RETURNING version INTO account_version;
    event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public.identity_events (id,"organizationId","userId","requestId","requestHash",action,"accountVersion",application,
      "actorId","membershipStatus","membershipVersion","grantVersion","credentialEpoch","createdAt")
      VALUES (event_id,changed.organization_id,changed.user_id,'field-remove:' || event_id,
        encode(sha256(convert_to(event_id,'UTF8')),'hex'),'ACTOR_LIFECYCLE_CHANGED',account_version,'ROUTE_FIELD',
        NEW.id,'REVOKED',changed.membership_version,changed.grant_version,changed.credential_epoch,clock_timestamp());
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_field_removal_membership AFTER UPDATE OF "fieldDeletedAt" ON "mtm_agents"
  FOR EACH ROW WHEN (OLD."fieldDeletedAt" IS NULL AND NEW."fieldDeletedAt" IS NOT NULL)
  EXECUTE FUNCTION mtm_revoke_removed_field_membership();

CREATE FUNCTION mtm_guard_removed_field_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.application = 'ROUTE_FIELD' AND NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM public.mtm_agents WHERE "organizationId" = NEW."organizationId" AND id = NEW."actorId" AND "fieldDeletedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'MTM_FIELD_ACTOR_REMOVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_removed_field_membership_guard BEFORE INSERT OR UPDATE ON identity_application_memberships
  FOR EACH ROW EXECUTE FUNCTION mtm_guard_removed_field_membership();

COMMIT;
