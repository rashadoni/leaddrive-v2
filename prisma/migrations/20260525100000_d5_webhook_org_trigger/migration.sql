-- D5 Payments — soft blocker #4
-- Postgres trigger: assert payment_webhook_events.organizationId matches
-- the organizationId of the referenced payment_providers row on INSERT.
--
-- The application write-path already scopes correctly. This trigger is
-- defense-in-depth against raw-SQL imports, ETL scripts, or migration bugs
-- that could introduce cross-tenant orphan rows.
--
-- Design: BEFORE INSERT only — UPDATE is excluded because providerId
-- changes are blocked by schema FK constraints.

CREATE SCHEMA IF NOT EXISTS payments;

CREATE OR REPLACE FUNCTION payments.check_webhook_event_org()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  provider_org TEXT;
BEGIN
  SELECT "organizationId"
    INTO provider_org
    FROM payment_providers
   WHERE id = NEW."providerId";

  IF provider_org IS NULL THEN
    RAISE EXCEPTION
      'payment_webhook_events: providerId % not found in payment_providers',
      NEW."providerId";
  END IF;

  IF provider_org <> NEW."organizationId" THEN
    RAISE EXCEPTION
      'payment_webhook_events cross-tenant insert blocked: '
      'event.organizationId=% but provider.organizationId=% for providerId=%',
      NEW."organizationId", provider_org, NEW."providerId";
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER payment_webhook_org_consistency
  BEFORE INSERT ON payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION payments.check_webhook_event_org();
