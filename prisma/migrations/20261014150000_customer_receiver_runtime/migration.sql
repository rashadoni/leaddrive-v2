-- Customer receiver runtime storage (AAC / receiving API integration).
--
-- Two tenant tables beside the existing, immutable effect ledger:
--
-- * customer_receiver_payloads — the ONLY place an outgoing personal payload
--   lives. Encrypted by the application (AES-256-GCM, tenant-derived key),
--   bounded by expiresAt (hard cap 14 days) and removable once expired unless
--   an incident hold is in force. effect_outbox keeps metadata only (hashes,
--   identities, frozen request shape), so purging a payload never touches the
--   append-only attempt/receipt evidence.
-- * customer_receiver_security_events — runtime security log (queue, attempts,
--   receipts, uncertain outcomes, retention purges, holds). Append-only except
--   for extending a hold; deletable only after its own retainUntil.
--
-- Neither table is written by any route in this migration's release: capture
-- and delivery stay disabled until an operator binding and both runtime
-- switches are configured.

CREATE TABLE "customer_receiver_payloads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "effectId" UUID NOT NULL,
  "integrationId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "cipherText" TEXT NOT NULL,
  "bodySha256" TEXT NOT NULL,
  "bodyBytes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "holdUntil" TIMESTAMP(3),
  "holdReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_receiver_payloads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receiver_payloads_environment" CHECK ("environment" IN ('TEST', 'PROD')),
  CONSTRAINT "customer_receiver_payloads_integration" CHECK ("integrationId" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
  CONSTRAINT "customer_receiver_payloads_body_hash" CHECK ("bodySha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customer_receiver_payloads_body_bytes" CHECK ("bodyBytes" BETWEEN 2 AND 1048576),
  CONSTRAINT "customer_receiver_payloads_cipher_size" CHECK (char_length("cipherText") BETWEEN 40 AND 1500000),
  CONSTRAINT "customer_receiver_payloads_ttl" CHECK (
    "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '14 days'
  ),
  CONSTRAINT "customer_receiver_payloads_hold" CHECK (
    ("holdUntil" IS NULL AND "holdReason" IS NULL)
    OR ("holdUntil" IS NOT NULL AND "holdReason" ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
        AND "holdUntil" <= "createdAt" + INTERVAL '400 days')
  )
);

CREATE TABLE "customer_receiver_security_events" (
  "id" UUID NOT NULL,
  "organizationId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "eventTime" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "service" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "targetType" TEXT,
  "targetId" TEXT,
  "correlationId" TEXT,
  "integrationEventId" UUID,
  "retainUntil" TIMESTAMP(3) NOT NULL,
  "holdUntil" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_receiver_security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_receiver_security_events_environment" CHECK ("environment" IN ('TEST', 'PROD')),
  CONSTRAINT "customer_receiver_security_events_category" CHECK ("category" IN (
    'authentication', 'authorization', 'administration', 'data_access', 'integration', 'infrastructure', 'logging')),
  CONSTRAINT "customer_receiver_security_events_outcome" CHECK ("outcome" IN ('success', 'failure', 'unknown')),
  CONSTRAINT "customer_receiver_security_events_severity" CHECK ("severity" IN ('info', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT "customer_receiver_security_events_action" CHECK ("action" ~ '^[a-z][a-z_]{1,63}$'),
  CONSTRAINT "customer_receiver_security_events_identifiers" CHECK (
    "service" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    AND "instanceId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    AND "version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    AND ("actorId" IS NULL OR "actorId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
    AND ("targetType" IS NULL OR "targetType" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
    AND ("targetId" IS NULL OR "targetId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
    AND ("correlationId" IS NULL OR "correlationId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
  ),
  CONSTRAINT "customer_receiver_security_events_actor" CHECK (
    ("actorType" = 'unknown' AND "actorId" IS NULL)
    OR ("actorType" IN ('user', 'service') AND "actorId" IS NOT NULL)
  ),
  CONSTRAINT "customer_receiver_security_events_target" CHECK (("targetType" IS NULL) = ("targetId" IS NULL)),
  CONSTRAINT "customer_receiver_security_events_distinct_ids" CHECK ("integrationEventId" IS DISTINCT FROM "id"),
  CONSTRAINT "customer_receiver_security_events_retention" CHECK (
    "retainUntil" >= "eventTime" + INTERVAL '30 days' AND "retainUntil" <= "eventTime" + INTERVAL '400 days'
  ),
  CONSTRAINT "customer_receiver_security_events_hold" CHECK (
    "holdUntil" IS NULL OR "holdUntil" <= "eventTime" + INTERVAL '800 days'
  )
);

CREATE UNIQUE INDEX "customer_receiver_payloads_effect_key"
  ON "customer_receiver_payloads"("organizationId", "effectId");
CREATE INDEX "customer_receiver_payloads_expiry_idx"
  ON "customer_receiver_payloads"("organizationId", "expiresAt");
CREATE INDEX "customer_receiver_payloads_integration_idx"
  ON "customer_receiver_payloads"("organizationId", "integrationId", "createdAt");
CREATE INDEX "customer_receiver_security_events_time_idx"
  ON "customer_receiver_security_events"("organizationId", "environment", "eventTime", "id");
CREATE INDEX "customer_receiver_security_events_retention_idx"
  ON "customer_receiver_security_events"("organizationId", "retainUntil");

ALTER TABLE "customer_receiver_payloads" ADD CONSTRAINT "customer_receiver_payloads_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_receiver_payloads" ADD CONSTRAINT "customer_receiver_payloads_effect_fkey"
  FOREIGN KEY ("organizationId", "effectId") REFERENCES "effect_outbox"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_receiver_security_events" ADD CONSTRAINT "customer_receiver_security_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Columns hold naive UTC (Prisma convention). Every comparison with "now"
-- converts explicitly, so a session TimeZone other than UTC cannot shift the
-- retention boundary.
--
-- Only an incident hold may change a stored row, and only by extending it.
-- Shortening a hold, rewriting ciphertext/hashes/expiry or log content is
-- rejected for every role, including the table owner.
CREATE OR REPLACE FUNCTION customer_receiver_payloads_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."effectId" IS DISTINCT FROM OLD."effectId"
       OR NEW."integrationId" IS DISTINCT FROM OLD."integrationId"
       OR NEW."environment" IS DISTINCT FROM OLD."environment"
       OR NEW."cipherText" IS DISTINCT FROM OLD."cipherText"
       OR NEW."bodySha256" IS DISTINCT FROM OLD."bodySha256"
       OR NEW."bodyBytes" IS DISTINCT FROM OLD."bodyBytes"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'customer receiver payload is immutable (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."holdUntil" IS NULL
       OR (OLD."holdUntil" IS NOT NULL AND NEW."holdUntil" < OLD."holdUntil") THEN
      RAISE EXCEPTION 'customer receiver payload hold can only be extended (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: expired and not held, or the cascade of a whole-tenant deletion.
  IF (OLD."expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      AND (OLD."holdUntil" IS NULL OR OLD."holdUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
     OR (pg_trigger_depth() > 1
         AND NOT EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId")) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'customer receiver payload is retained until expiry/hold (id=%)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION customer_receiver_security_events_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'holdUntil') IS DISTINCT FROM (to_jsonb(OLD) - 'holdUntil') THEN
      RAISE EXCEPTION 'customer receiver security event is append-only (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."holdUntil" IS NULL
       OR (OLD."holdUntil" IS NOT NULL AND NEW."holdUntil" < OLD."holdUntil") THEN
      RAISE EXCEPTION 'customer receiver security event hold can only be extended (id=%)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (OLD."retainUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      AND (OLD."holdUntil" IS NULL OR OLD."holdUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
     OR (pg_trigger_depth() > 1
         AND NOT EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId")) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'customer receiver security event is retained (id=%)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION customer_receiver_reject_truncate_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% keeps retention evidence; TRUNCATE rejected', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER customer_receiver_payloads_guard_trigger
  BEFORE UPDATE OR DELETE ON "customer_receiver_payloads"
  FOR EACH ROW EXECUTE FUNCTION customer_receiver_payloads_guard_fn();
CREATE TRIGGER customer_receiver_payloads_reject_truncate_trigger
  BEFORE TRUNCATE ON "customer_receiver_payloads"
  FOR EACH STATEMENT EXECUTE FUNCTION customer_receiver_reject_truncate_fn();
CREATE TRIGGER customer_receiver_security_events_guard_trigger
  BEFORE UPDATE OR DELETE ON "customer_receiver_security_events"
  FOR EACH ROW EXECUTE FUNCTION customer_receiver_security_events_guard_fn();
CREATE TRIGGER customer_receiver_security_events_reject_truncate_trigger
  BEFORE TRUNCATE ON "customer_receiver_security_events"
  FOR EACH STATEMENT EXECUTE FUNCTION customer_receiver_reject_truncate_fn();

-- Tenant isolation ships in the same migration as the tables.
ALTER TABLE "customer_receiver_payloads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_receiver_payloads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_receiver_security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_receiver_security_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_receiver_payloads"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON "customer_receiver_security_events"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

-- Same grant discovery as the event-platform foundation: the application role
-- is the owner of "funds"; nothing is granted to PUBLIC.
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'funds';

  REVOKE ALL ON TABLE "customer_receiver_payloads" FROM PUBLIC;
  REVOKE ALL ON TABLE "customer_receiver_security_events" FROM PUBLIC;

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('REVOKE ALL ON TABLE customer_receiver_payloads FROM %I', app_owner);
    EXECUTE format('REVOKE ALL ON TABLE customer_receiver_security_events FROM %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_receiver_payloads TO %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customer_receiver_security_events TO %I', app_owner);
  END IF;

  -- The reconciliation operator records its decision in the runtime log; it
  -- gets no access to payloads.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leaddrive_effect_operator') THEN
    EXECUTE 'GRANT INSERT ON TABLE customer_receiver_security_events TO leaddrive_effect_operator';
  END IF;
END $$;
