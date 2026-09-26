-- Meta App Review security gate — replay/duplicate protection for inbound Meta webhooks.
--
-- Meta redelivers a webhook whenever the endpoint does not answer 2xx quickly, and a redelivery
-- carries the SAME provider message id. Before this migration the three Meta surfaces disagreed
-- about what happened next:
--
--   * facebook / instagram — a read-then-write guard in webhooks/facebook (findFirst by `mid` →
--     skip). It handles the ordinary sequential retry, but it is a TOCTOU: two concurrent
--     redeliveries can both miss the findFirst and both insert.
--   * whatsapp            — NO guard at all. Every redelivery created another inbound
--     ChannelMessage, another notification, and could fire the auto-reply again — i.e. send a
--     second real message to a real customer. That is the one duplicate with an outside effect.
--
-- This partial UNIQUE index settles it at the DB layer for all three. The handlers catch the
-- resulting unique violation (Prisma P2002) and treat it as "already ingested", so the race-loser
-- stops producing a row, and the code still degrades to today's behaviour if the index is absent.
--
-- Scope is surgical, matching the two existing inbound-idempotency indexes:
--   * direction = 'inbound'                              → outbound sends untouched
--   * channelType IN ('whatsapp','facebook','instagram') → other channels keep their own indexes
--   * externalId IS NOT NULL                             → id-less events still ingest freely
--
-- Safe to apply: production checked 2026-09-20 — 0 duplicate (organizationId, externalId) groups
-- across these three channels, and only 177 inbound rows carry an externalId, so the index builds
-- immediately and cannot fail on existing data.

CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_meta_inbound_external_uniq"
  ON "channel_messages" ("organizationId", "externalId")
  WHERE "direction" = 'inbound'
    AND "channelType" IN ('whatsapp', 'facebook', 'instagram')
    AND "externalId" IS NOT NULL;
