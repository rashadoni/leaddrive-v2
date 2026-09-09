-- Bind Zapier subscriptions to the API key that created them. New generic/admin
-- webhooks use explicit generic provenance with a NULL creator and remain
-- independent of API-key lifecycle.
ALTER TABLE "webhooks"
  ADD COLUMN "createdByApiKeyId" TEXT,
  ADD COLUMN "provenance" TEXT NOT NULL DEFAULT 'legacy_unclassified';

CREATE INDEX "webhooks_createdByApiKeyId_idx"
  ON "webhooks"("createdByApiKeyId");

ALTER TABLE "webhooks"
  ADD CONSTRAINT "webhooks_createdByApiKeyId_fkey"
  FOREIGN KEY ("createdByApiKeyId") REFERENCES "api_keys"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The old Zapier subscribe endpoint accepted arbitrary public target URLs and
-- did not persist creator provenance. It is therefore impossible to distinguish
-- a legacy custom-domain Zapier subscription from a generic/admin webhook by
-- URL. Fail closed for every pre-provenance row. Operators may review and
-- re-enable intentional generic hooks; Zapier hooks must reconnect so they are
-- recreated with createdByApiKeyId and inherit key revoke/expiry lifecycle.
UPDATE "webhooks"
SET "isActive" = false
WHERE "provenance" = 'legacy_unclassified'
  AND "isActive" = true;

ALTER TABLE "webhooks"
  ADD CONSTRAINT "webhooks_provenance_check"
  CHECK ("provenance" IN ('legacy_unclassified', 'generic', 'zapier'));

-- Compatibility fence for online cutover and rollback. The pre-migration app
-- does not know the provenance column, so PostgreSQL supplies the
-- legacy_unclassified default. Such rows must never become active. New code
-- explicitly writes generic or zapier, and the trigger enforces the matching
-- creator-key shape at the database authority.
CREATE FUNCTION "enforce_webhook_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."provenance" = 'legacy_unclassified' THEN
      IF NEW."provenance" NOT IN ('legacy_unclassified', 'generic') THEN
        RAISE EXCEPTION 'legacy webhook may only be reviewed as generic';
      END IF;
    ELSIF NEW."provenance" IS DISTINCT FROM OLD."provenance" THEN
      RAISE EXCEPTION 'webhook provenance is immutable';
    END IF;

    IF NEW."createdByApiKeyId" IS DISTINCT FROM OLD."createdByApiKeyId" THEN
      RAISE EXCEPTION 'webhook creator provenance is immutable';
    END IF;
  END IF;

  IF NEW."provenance" = 'legacy_unclassified' THEN
    NEW."createdByApiKeyId" := NULL;
    NEW."isActive" := false;
  ELSIF NEW."provenance" = 'generic' AND NEW."createdByApiKeyId" IS NOT NULL THEN
    RAISE EXCEPTION 'generic webhook cannot have API-key provenance';
  ELSIF NEW."provenance" = 'zapier' AND NEW."createdByApiKeyId" IS NULL THEN
    RAISE EXCEPTION 'Zapier webhook requires API-key provenance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "webhooks_enforce_provenance"
BEFORE INSERT OR UPDATE OF "provenance", "createdByApiKeyId", "isActive"
ON "webhooks"
FOR EACH ROW
EXECUTE FUNCTION "enforce_webhook_provenance"();

-- Close the small non-transactional DDL window between the first sweep and
-- trigger installation. Future old-bundle writes are caught by the trigger.
UPDATE "webhooks"
SET "isActive" = false
WHERE "provenance" = 'legacy_unclassified'
  AND "isActive" = true;

-- Prevent concurrent subscribe retries from creating duplicate active
-- deliveries. The partial predicate still permits a new subscription after
-- an earlier one was explicitly deactivated.
CREATE UNIQUE INDEX "webhooks_active_zapier_subscription_key"
  ON "webhooks"(
    "organizationId",
    "createdByApiKeyId",
    (digest("url", 'sha256')),
    "events"
  )
  WHERE "provenance" = 'zapier'
    AND "createdByApiKeyId" IS NOT NULL
    AND "isActive" = true;
