-- «Агент едет к вам»: the bot sends the customer the agent is driving to a
-- link to where the agent is now, by SMS or WhatsApp
-- (src/lib/mtm/customer-eta-link.ts). It is a «ссылка на местоположение» of
-- its own kind, so it lives in the same table, with the same token, the same
-- public answer and the same rules of what a stranger may be shown.
--
-- New columns only. Every existing row is a manager's link and reads
-- `purpose = 'MANAGER'` from the default; the previous build never writes
-- these columns and never reads a bot's row as its own (it lists links by
-- employee, and the bot makes none until this build switches it on).

SET lock_timeout = '3s';

ALTER TABLE "mtm_location_share_links"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'MANAGER',
  ADD COLUMN "routePointId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "deliveryChannel" TEXT,
  ADD COLUMN "deliveryStatus" TEXT,
  ADD COLUMN "deliveryError" TEXT;

ALTER TABLE "mtm_location_share_links"
  ADD CONSTRAINT "mtm_location_share_links_purpose_check"
    CHECK ("purpose" IN ('MANAGER', 'CUSTOMER_ETA')),
  -- A bot's link always names the stop and the customer; a manager's never does.
  ADD CONSTRAINT "mtm_location_share_links_customer_eta_shape_check"
    CHECK (
      ("purpose" = 'CUSTOMER_ETA' AND "routePointId" IS NOT NULL AND "customerId" IS NOT NULL
        AND "deliveryChannel" IN ('sms', 'whatsapp') AND "deliveryStatus" IN ('PENDING', 'SENT', 'FAILED'))
      OR ("purpose" = 'MANAGER' AND "routePointId" IS NULL AND "customerId" IS NULL
        AND "deliveryChannel" IS NULL AND "deliveryStatus" IS NULL AND "deliveryError" IS NULL)
    ),
  ADD CONSTRAINT "mtm_location_share_links_routePointId_fkey"
    FOREIGN KEY ("routePointId") REFERENCES "mtm_route_points"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- With the organization in the key, as the employee's: a link can only
  -- point at a customer of its own organization.
  ADD CONSTRAINT "mtm_location_share_links_organizationId_customerId_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One message per stop, ever: two ticks of the job that reach the same stop
-- at once both try to insert, and the table lets one of them.
CREATE UNIQUE INDEX "mtm_location_share_links_routePointId_key" ON "mtm_location_share_links"("routePointId");

-- Rollback is forward-safe: roll back the code and keep the columns. The
-- previous build answers a bot's link like a manager's — only while the
-- organization's manager links are switched on, until the end of that day.
