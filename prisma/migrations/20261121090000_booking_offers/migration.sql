-- The times the WhatsApp booking agent offers a client, one row per button.
-- A row holds its slot for every other conversation and for the public page
-- until it expires, which is what stops two chats from being offered — and
-- then both tapping — the same chair. The exclusion constraint on bookings
-- remains the last word: a hold is courtesy, not the guarantee.
--
-- No phone number is kept here. A tap is matched to the conversation the
-- button went to, so this table holds no personal data of its own.
SET lock_timeout='3s';

CREATE TABLE booking_offers (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "conversationId" TEXT NOT NULL,
 "channelConfigId" TEXT,
 "bookingPageId" TEXT NOT NULL,
 "hostUserId" TEXT NOT NULL,
 "startsAt" TIMESTAMP(3) NOT NULL,
 "endsAt" TIMESTAMP(3) NOT NULL,
 "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 status TEXT NOT NULL DEFAULT 'offered',
 "bookingId" TEXT,
 request JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (status IN ('offered','booked','taken','expired','superseded')),
 CHECK ("endsAt" > "startsAt")
);

CREATE INDEX "booking_offers_organizationId_hostUserId_startsAt_idx" ON booking_offers("organizationId","hostUserId","startsAt");
CREATE INDEX "booking_offers_organizationId_conversationId_createdAt_idx" ON booking_offers("organizationId","conversationId","createdAt");

ALTER TABLE "booking_offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_offers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_offers"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
