-- Stage 1: empty, additive registry. No backfill, legacy writes, grants or cutover.
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
  CHECK (status <> 'PENDING' OR "deliveryCiphertext" IS NOT NULL),
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
  action VARCHAR(40) NOT NULL CHECK (action IN ('ACCOUNT_STAGED', 'GRANT_CHANGED', 'PHONE_RESERVED', 'PHONE_CONFIRMED', 'PHONE_RELEASED', 'RESERVATION_EXPIRED', 'PHONE_PROOF_ISSUED', 'PHONE_PROOF_REJECTED', 'PHONE_DELIVERY_LEASED', 'PHONE_DELIVERY_RECORDED')),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  application VARCHAR(16) CHECK (application IN ('CRM', 'TIME', 'ROUTE_FIELD')),
  "grantStatus" VARCHAR(16) CHECK ("grantStatus" IN ('ACTIVE', 'REVOKED')),
  "grantRole" VARCHAR(50),
  "grantVersion" INTEGER CHECK ("grantVersion" > 0),
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
  CHECK ("actorUserId" IS NOT NULL OR action IN ('PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED')),
  CHECK (action NOT IN ('PHONE_PROOF_ISSUED','PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PHONE_CONFIRMED')
    OR ("proofId" IS NOT NULL AND "credentialEpoch" IS NOT NULL)),
  CHECK (action <> 'PHONE_PROOF_ISSUED' OR ("reservationId" IS NOT NULL AND "normalizedPhone" IS NOT NULL AND "proofExpiresAt" IS NOT NULL
    AND "proofExpiresAt" > "createdAt" AND "proofExpiresAt" <= "createdAt" + interval '10 minutes')),
  CHECK (action <> 'PHONE_PROOF_REJECTED' OR ("proofAttempt" IS NOT NULL AND "proofOutcome" IS NOT NULL)),
  CHECK (action <> 'PHONE_CONFIRMED' OR ("claimId" IS NOT NULL AND "normalizedPhone" IS NOT NULL)),
  CHECK (action <> 'PHONE_RESERVED' OR ("normalizedPhone" IS NOT NULL AND "reservationId" IS NOT NULL AND length("reservationId") > 0 AND "reservationExpiresAt" IS NOT NULL AND "reservationExpiresAt" > "createdAt" AND "reservationExpiresAt" <= "createdAt" + interval '15 minutes')),
  CHECK (action <> 'GRANT_CHANGED' OR (application IS NOT NULL AND "grantStatus" IS NOT NULL AND "grantVersion" IS NOT NULL AND ("grantStatus" <> 'ACTIVE' OR ("grantRole" IS NOT NULL AND length(btrim("grantRole")) > 0))))
);
CREATE UNIQUE INDEX "identity_events_organizationId_requestId_key" ON identity_events("organizationId", "requestId");
CREATE INDEX "identity_events_organizationId_userId_createdAt_id_idx" ON identity_events("organizationId", "userId", "createdAt", id);

DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['identity_accounts', 'identity_application_grants', 'identity_phone_claims', 'identity_phone_reservations', 'identity_phone_proofs', 'identity_phone_proof_outbox', 'identity_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')', target);
    IF target <> 'identity_events' THEN
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
COMMIT;
