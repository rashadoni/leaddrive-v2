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

CREATE TABLE identity_events (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestId" VARCHAR(128) NOT NULL CHECK (length("requestId") > 0),
  "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  action VARCHAR(40) NOT NULL CHECK (action IN ('ACCOUNT_STAGED', 'GRANT_CHANGED', 'PHONE_RESERVED', 'PHONE_CONFIRMED', 'PHONE_RELEASED', 'RESERVATION_EXPIRED')),
  "accountVersion" INTEGER NOT NULL CHECK ("accountVersion" > 0),
  application VARCHAR(16) CHECK (application IN ('CRM', 'TIME', 'ROUTE_FIELD')),
  "normalizedPhone" VARCHAR(16) CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
  "previousClaimId" TEXT,
  "claimId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "userId") REFERENCES identity_accounts("organizationId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES users("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "identity_events_organizationId_requestId_key" ON identity_events("organizationId", "requestId");
CREATE INDEX "identity_events_organizationId_userId_createdAt_id_idx" ON identity_events("organizationId", "userId", "createdAt", id);

DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['identity_accounts', 'identity_application_grants', 'identity_phone_claims', 'identity_phone_reservations', 'identity_events'] LOOP
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
