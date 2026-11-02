-- Empty additive registry; no backfill, legacy data rewrite or cutover.
-- Lifecycle guards affect only explicitly authoritative identities.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE identity_accounts (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "credentialEpoch" INTEGER NOT NULL DEFAULT 1 CHECK ("credentialEpoch" > 0),
  "passwordHash" TEXT,
  "cutoverAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("organizationId", "userId"),
  FOREIGN KEY ("organizationId", "userId") REFERENCES users("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("cutoverAt" IS NULL OR "passwordHash" IS NOT NULL)
);

CREATE TABLE identity_application_grants (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  application VARCHAR(16) NOT NULL CHECK (application IN ('CRM', 'TIME', 'ROUTE_FIELD')),
  status VARCHAR(16) NOT NULL DEFAULT 'REVOKED' CHECK (status IN ('ACTIVE', 'REVOKED')),
  role VARCHAR(50),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("organizationId", "userId", application),
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status <> 'ACTIVE' OR (role IS NOT NULL AND length(btrim(role)) > 0))
);

-- An explicit administrator review fixes historical actor ownership. It does
-- not change the legacy user link or authorize an app by itself.
CREATE TABLE identity_actor_bindings (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reviewedByUserId" TEXT NOT NULL,
  "reviewReference" VARCHAR(128) NOT NULL CHECK (length("reviewReference") BETWEEN 1 AND 128),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  "reviewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId", "actorId"),
  CONSTRAINT identity_actor_bindings_subject_key UNIQUE ("organizationId", "userId", "actorId"),
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "actorId") REFERENCES mtm_agents("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "reviewedByUserId") REFERENCES users("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE identity_application_memberships (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  application VARCHAR(16) NOT NULL CHECK (application IN ('TIME','ROUTE_FIELD')),
  "actorId" TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'REVOKED' CHECK (status IN ('ACTIVE','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("organizationId", "userId", application),
  CONSTRAINT identity_application_memberships_actor_key UNIQUE ("organizationId", application, "actorId"),
  FOREIGN KEY ("organizationId", "userId", application) REFERENCES identity_application_grants("organizationId", "userId", application) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "userId", "actorId") REFERENCES identity_actor_bindings("organizationId", "userId", "actorId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE identity_phone_claims (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "normalizedPhone" VARCHAR(16) NOT NULL CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "identity_phone_claims_organizationId_normalizedPhone_key" ON identity_phone_claims("organizationId", "normalizedPhone");
CREATE UNIQUE INDEX "identity_phone_claims_organizationId_userId_key" ON identity_phone_claims("organizationId", "userId");

CREATE TABLE identity_phone_reservations (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "normalizedPhone" VARCHAR(16) NOT NULL CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  "expectedAccountVersion" INTEGER NOT NULL CHECK ("expectedAccountVersion" > 0),
  "expectedCredentialEpoch" INTEGER NOT NULL CHECK ("expectedCredentialEpoch" > 0),
  "requestId" VARCHAR(128) NOT NULL CHECK (length("requestId") > 0),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '15 minutes')
);
CREATE UNIQUE INDEX "identity_phone_reservations_organizationId_normalizedPhone_key" ON identity_phone_reservations("organizationId", "normalizedPhone");
CREATE UNIQUE INDEX "identity_phone_reservations_organizationId_userId_key" ON identity_phone_reservations("organizationId", "userId");
CREATE UNIQUE INDEX "identity_phone_reservations_organizationId_requestId_key" ON identity_phone_reservations("organizationId", "requestId");
CREATE INDEX "identity_phone_reservations_expiresAt_idx" ON identity_phone_reservations("expiresAt");

CREATE TABLE identity_phone_proofs (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "issuedByUserId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL CHECK (length("reservationId") BETWEEN 1 AND 128),
  "normalizedPhone" VARCHAR(16) NOT NULL CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  "credentialEpoch" INTEGER NOT NULL CHECK ("credentialEpoch" > 0),
  "keyId" VARCHAR(40) NOT NULL CHECK (length("keyId") > 0 AND "keyId" !~ '[^A-Za-z0-9_-]'),
  "codeHash" VARCHAR(64) NOT NULL CHECK (length("codeHash") = 64 AND "codeHash" !~ '[^a-f0-9]'),
  "deliveryCiphertext" VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','LOCKED','EXPIRED','SUPERSEDED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "issuedByUserId") REFERENCES users("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT identity_phone_proofs_subject_key UNIQUE ("organizationId", "userId", id),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '10 minutes'),
  CHECK ((status = 'CONFIRMED') = ("usedAt" IS NOT NULL)),
  CHECK (status NOT IN ('PENDING','CONFIRMED') OR attempts < 5),
  CHECK (status <> 'LOCKED' OR attempts = 5),
  CHECK ((status = 'PENDING') = ("deliveryCiphertext" IS NOT NULL)),
  CHECK ("deliveryCiphertext" IS NULL OR ("deliveryCiphertext" ~ '^v1[.][A-Za-z0-9_-]{1,40}[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{8}[.][A-Za-z0-9_-]{22}$'
    AND split_part("deliveryCiphertext", '.', 2) = "keyId"))
);
CREATE UNIQUE INDEX identity_phone_proofs_one_pending_per_reservation ON identity_phone_proofs("organizationId", "reservationId") WHERE status = 'PENDING';
CREATE INDEX identity_phone_proofs_reservation_created_idx ON identity_phone_proofs("organizationId", "reservationId", "createdAt");
CREATE INDEX identity_phone_proofs_expiry_idx ON identity_phone_proofs("organizationId", "expiresAt");

CREATE TABLE identity_phone_proof_outbox (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "proofId" TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','LEASED','SENT','FAILED','UNCERTAIN','EXPIRED','SUPERSEDED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID,
  "leaseUntil" TIMESTAMPTZ(3),
  "providerMessageId" VARCHAR(300),
  outcome VARCHAR(32),
  "settledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("organizationId", "proofId"),
  CONSTRAINT identity_phone_proof_outbox_subject_key UNIQUE ("organizationId", "userId", "proofId"),
  FOREIGN KEY ("organizationId", "userId", "proofId") REFERENCES identity_phone_proofs("organizationId", "userId", id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CHECK (status <> 'PENDING' OR (attempts = 0 AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)),
  CHECK (status NOT IN ('LEASED','SENT','FAILED','UNCERTAIN') OR (attempts = 1 AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)),
  CHECK (status <> 'SENT' OR ("providerMessageId" IS NOT NULL AND length("providerMessageId") > 0 AND "settledAt" IS NOT NULL))
);
CREATE INDEX identity_phone_proof_outbox_due_idx ON identity_phone_proof_outbox("organizationId", status, "availableAt");

CREATE TABLE identity_events (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "requestId" VARCHAR(128) NOT NULL CHECK (length("requestId") > 0),
  "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  action VARCHAR(40) NOT NULL CHECK (action IN ('ACCOUNT_STAGED', 'GRANT_CHANGED', 'PHONE_RESERVED', 'PHONE_CONFIRMED', 'PHONE_RELEASED', 'RESERVATION_EXPIRED', 'PHONE_PROOF_ISSUED', 'PHONE_PROOF_REJECTED', 'PHONE_DELIVERY_LEASED', 'PHONE_DELIVERY_RECORDED', 'PHONE_RESERVATION_CANCELLED', 'CREDENTIAL_STAGED', 'ACTOR_BINDING_REVIEWED', 'MEMBERSHIP_CHANGED', 'PERSON_LIFECYCLE_CHANGED', 'ACTOR_LIFECYCLE_CHANGED')),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  application VARCHAR(16) CHECK (application IN ('CRM', 'TIME', 'ROUTE_FIELD')),
  "grantStatus" VARCHAR(16) CHECK ("grantStatus" IN ('ACTIVE', 'REVOKED')),
  "grantRole" VARCHAR(50),
  "grantVersion" INTEGER CHECK ("grantVersion" > 0),
  "actorId" TEXT CHECK ("actorId" IS NULL OR length("actorId") BETWEEN 1 AND 128),
  "membershipStatus" VARCHAR(16) CHECK ("membershipStatus" IN ('ACTIVE','REVOKED')),
  "membershipVersion" INTEGER CHECK ("membershipVersion" > 0),
  "reviewReference" VARCHAR(128) CHECK ("reviewReference" IS NULL OR length("reviewReference") BETWEEN 1 AND 128),
  "normalizedPhone" VARCHAR(16) CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  "reservationId" TEXT,
  "reservationExpiresAt" TIMESTAMPTZ(3),
  "proofId" TEXT,
  "proofExpiresAt" TIMESTAMPTZ(3),
  "proofAttempt" INTEGER CHECK ("proofAttempt" BETWEEN 0 AND 5),
  "proofOutcome" VARCHAR(32),
  "credentialEpoch" INTEGER CHECK ("credentialEpoch" > 0),
  "previousClaimId" TEXT,
  "claimId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES users("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("actorUserId" IS NOT NULL OR action IN ('PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED')),
  CHECK (action NOT IN ('PHONE_PROOF_ISSUED','PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PHONE_CONFIRMED','CREDENTIAL_STAGED')
    OR ("proofId" IS NOT NULL AND "credentialEpoch" IS NOT NULL)),
  CHECK (action <> 'PHONE_PROOF_ISSUED' OR ("reservationId" IS NOT NULL AND "normalizedPhone" IS NOT NULL AND "proofExpiresAt" IS NOT NULL
    AND "proofExpiresAt" > "createdAt" AND "proofExpiresAt" <= "createdAt" + interval '10 minutes')),
  CHECK (action <> 'PHONE_PROOF_REJECTED' OR ("proofAttempt" IS NOT NULL AND "proofOutcome" IS NOT NULL)),
  CHECK (action <> 'ACTOR_BINDING_REVIEWED' OR ("actorId" IS NOT NULL AND "reviewReference" IS NOT NULL)),
  CHECK (action NOT IN ('MEMBERSHIP_CHANGED','ACTOR_LIFECYCLE_CHANGED') OR (application IS NOT NULL AND application IN ('TIME','ROUTE_FIELD') AND "actorId" IS NOT NULL AND "membershipStatus" IS NOT NULL AND "membershipVersion" IS NOT NULL AND "grantVersion" IS NOT NULL)),
  CHECK (action NOT IN ('PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED') OR "credentialEpoch" IS NOT NULL),
  CHECK (action <> 'CREDENTIAL_STAGED' OR "claimId" IS NOT NULL),
  CHECK (action <> 'PHONE_CONFIRMED' OR ("claimId" IS NOT NULL AND "normalizedPhone" IS NOT NULL)),
  CHECK (action <> 'PHONE_RESERVED' OR ("normalizedPhone" IS NOT NULL AND "reservationId" IS NOT NULL AND length("reservationId") > 0 AND "reservationExpiresAt" IS NOT NULL AND "reservationExpiresAt" > "createdAt" AND "reservationExpiresAt" <= "createdAt" + interval '15 minutes')),
  CHECK (action <> 'GRANT_CHANGED' OR (application IS NOT NULL AND "grantStatus" IS NOT NULL AND "grantVersion" IS NOT NULL AND ("grantStatus" <> 'ACTIVE' OR ("grantRole" IS NOT NULL AND length(btrim("grantRole")) > 0))))
);
CREATE UNIQUE INDEX "identity_events_organizationId_requestId_key" ON identity_events("organizationId", "requestId");
-- A proof may confirm one phone and set one credential, even if a future
-- writer accidentally omits the transaction service's status/version guard.
CREATE UNIQUE INDEX identity_events_one_proof_effect ON identity_events("organizationId", "proofId", action)
  WHERE action IN ('PHONE_CONFIRMED', 'CREDENTIAL_STAGED');
CREATE INDEX "identity_events_organizationId_userId_createdAt_id_idx" ON identity_events("organizationId", "userId", "createdAt", id);

DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['identity_accounts', 'identity_application_grants', 'identity_actor_bindings', 'identity_application_memberships', 'identity_phone_claims', 'identity_phone_reservations', 'identity_phone_proofs', 'identity_phone_proof_outbox', 'identity_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
    IF target NOT IN ('identity_events', 'identity_actor_bindings') THEN
      EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
      EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION identity_reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IDENTITY_EVENT_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER identity_event_immutable BEFORE UPDATE OR DELETE ON identity_events
  FOR EACH ROW EXECUTE FUNCTION identity_reject_event_mutation();
CREATE TRIGGER identity_event_no_truncate BEFORE TRUNCATE ON identity_events
  FOR EACH STATEMENT EXECUTE FUNCTION identity_reject_event_mutation();
CREATE FUNCTION identity_reject_binding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IDENTITY_ACTOR_BINDING_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER identity_actor_binding_immutable BEFORE UPDATE OR DELETE ON identity_actor_bindings
  FOR EACH ROW EXECUTE FUNCTION identity_reject_binding_mutation();
CREATE TRIGGER identity_actor_binding_no_truncate BEFORE TRUNCATE ON identity_actor_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION identity_reject_binding_mutation();
-- Security revisions never roll back, and an authoritative record cannot
-- silently resume legacy credentials after an application rollback.
CREATE FUNCTION identity_guard_account_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_STATE_RETAINED' USING ERRCODE = '23514';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_SCOPE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.version < OLD.version OR NEW."credentialEpoch" < OLD."credentialEpoch" THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_REVISION_ROLLBACK' USING ERRCODE = '23514';
  END IF;
  IF OLD."cutoverAt" IS NOT NULL AND NEW."cutoverAt" IS DISTINCT FROM OLD."cutoverAt" THEN
    RAISE EXCEPTION 'IDENTITY_AUTHORITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF (NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" OR NEW."cutoverAt" IS DISTINCT FROM OLD."cutoverAt")
      AND NEW."credentialEpoch" <= OLD."credentialEpoch" THEN
    RAISE EXCEPTION 'IDENTITY_CREDENTIAL_EPOCH_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_account_revision_guard BEFORE UPDATE OR DELETE ON identity_accounts
  FOR EACH ROW EXECUTE FUNCTION identity_guard_account_revision();
CREATE TRIGGER identity_account_truncate_guard BEFORE TRUNCATE ON identity_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION identity_guard_account_revision();

-- App security state is retained and monotonic, including under future
-- writers. Delete/recreate or a same-version reactivation must never revive
-- an old JWT. Historical actor changes require a separately reviewed migration.
CREATE FUNCTION identity_guard_application_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'IDENTITY_APPLICATION_STATE_RETAINED' USING ERRCODE = '23514';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW.application IS DISTINCT FROM OLD.application THEN
    RAISE EXCEPTION 'IDENTITY_APPLICATION_SCOPE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'IDENTITY_APPLICATION_REVISION_ROLLBACK' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'IDENTITY_APPLICATION_REVISION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'identity_application_grants' THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND NEW.version <= OLD.version THEN
      RAISE EXCEPTION 'IDENTITY_APPLICATION_REVISION_REQUIRED' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."actorId" IS DISTINCT FROM OLD."actorId" THEN
      RAISE EXCEPTION 'IDENTITY_MEMBERSHIP_ACTOR_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_grant_revision_guard BEFORE UPDATE OR DELETE ON identity_application_grants
  FOR EACH ROW EXECUTE FUNCTION identity_guard_application_revision();
CREATE TRIGGER identity_grant_truncate_guard BEFORE TRUNCATE ON identity_application_grants
  FOR EACH STATEMENT EXECUTE FUNCTION identity_guard_application_revision();
CREATE TRIGGER identity_membership_revision_guard BEFORE UPDATE OR DELETE ON identity_application_memberships
  FOR EACH ROW EXECUTE FUNCTION identity_guard_application_revision();
CREATE TRIGGER identity_membership_truncate_guard BEFORE TRUNCATE ON identity_application_memberships
  FOR EACH STATEMENT EXECUTE FUNCTION identity_guard_application_revision();

-- Only reviewed authoritative identities are affected. Do not lock proofs or
-- outboxes here: normal writers lock User before account and recheck epochs.
CREATE FUNCTION identity_person_lifecycle_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed RECORD; event_id TEXT;
BEGIN
  UPDATE public.identity_accounts SET version = version + 1, "credentialEpoch" = "credentialEpoch" + 1, "updatedAt" = clock_timestamp()
    WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW.id AND "cutoverAt" IS NOT NULL
    RETURNING "organizationId" AS organization_id, "userId" AS user_id, version, "credentialEpoch" AS credential_epoch INTO changed;
  IF FOUND THEN
    event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public.identity_events (id,"organizationId","userId","actorUserId","requestId","requestHash",action,"accountVersion","credentialEpoch","createdAt")
      VALUES (event_id,changed.organization_id,changed.user_id,NULL,'person-state:' || event_id,
        encode(sha256(convert_to(event_id,'UTF8')),'hex'),'PERSON_LIFECYCLE_CHANGED',changed.version,changed.credential_epoch,clock_timestamp());
  END IF;
  RETURN NEW;
END $$;
-- The existing logout-all marker is also used by password/MFA security actions.
-- Any actual transition, including clearing/backdating it, revokes shared mobile
-- sessions monotonically; a repeated identical timestamp is a no-op.
CREATE TRIGGER identity_person_lifecycle AFTER UPDATE OF "isActive", "anonymizedAt", "passwordChangedAt" ON users
  FOR EACH ROW WHEN (OLD."isActive" IS DISTINCT FROM NEW."isActive" OR OLD."anonymizedAt" IS DISTINCT FROM NEW."anonymizedAt"
    OR OLD."passwordChangedAt" IS DISTINCT FROM NEW."passwordChangedAt")
  EXECUTE FUNCTION identity_person_lifecycle_changed();

-- A technical actor's global lifecycle is not an application grant switch.
-- App-only revocation must use its grant/membership; legacy writes must be
-- fenced/adapted before cutover. Each transition invalidates old member tokens.
CREATE FUNCTION identity_actor_lifecycle_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed RECORD; event_id TEXT;
BEGIN
  FOR changed IN
    UPDATE public.identity_application_memberships AS m SET version = m.version + 1, "updatedAt" = clock_timestamp()
    FROM public.identity_accounts AS a, public.identity_application_grants AS g
    WHERE m."organizationId" = NEW."organizationId" AND m."actorId" = NEW.id
      AND a."organizationId" = m."organizationId" AND a."userId" = m."userId" AND a."cutoverAt" IS NOT NULL
      AND g."organizationId" = m."organizationId" AND g."userId" = m."userId" AND g.application = m.application
    RETURNING m."organizationId" AS organization_id,m."userId" AS user_id,m.application,m."actorId" AS actor_id,m.status,m.version,
      a.version AS account_version,a."credentialEpoch" AS credential_epoch,g.version AS grant_version
  LOOP
    event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public.identity_events (id,"organizationId","userId","actorUserId","requestId","requestHash",action,"accountVersion",application,
      "actorId","membershipStatus","membershipVersion","grantVersion","credentialEpoch","createdAt")
      VALUES (event_id,changed.organization_id,changed.user_id,NULL,'actor-state:' || event_id,encode(sha256(convert_to(event_id,'UTF8')),'hex'),
        'ACTOR_LIFECYCLE_CHANGED',changed.account_version,changed.application,changed.actor_id,changed.status,changed.version,
        changed.grant_version,changed.credential_epoch,clock_timestamp());
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_actor_lifecycle AFTER UPDATE OF "userId",status ON mtm_agents
  FOR EACH ROW WHEN (OLD."userId" IS DISTINCT FROM NEW."userId" OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION identity_actor_lifecycle_changed();
COMMIT;
