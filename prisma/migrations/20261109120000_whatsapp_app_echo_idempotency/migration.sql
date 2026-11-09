-- Replay protection for messages typed in the WhatsApp Business app (coexistence).
--
-- A number onboarded in coexistence mirrors every reply the team types on their phone back to us as
-- an `smb_message_echoes` webhook. Those rows are OUTBOUND, and the three existing partial unique
-- indexes on channel_messages all carry `direction = 'inbound'` — so a redelivery (Meta repeats a
-- delivery it did not get a prompt 2xx for) would insert the same reply twice. A duplicated reply is
-- not only noise in the thread: the AI reads these rows as "a human already answered", and the
-- inbox shows the customer's conversation twice over.
--
-- Scoped to echo rows by the `source` marker that lib/inbox/whatsapp-app-echo writes, NOT to every
-- outbound WhatsApp row: our own Cloud API sends have carried `external_id` for a long time and a
-- unique index over those could fail to build on existing data. `metadata ->> 'source'` is
-- immutable, so it is allowed in a partial index predicate.
--
-- Prisma's @@unique cannot express a partial (WHERE) index, so this index is invisible in
-- schema.prisma on purpose — see the NOTE on model ChannelMessage. Do not "fix" the migrate-diff
-- drift by dropping it.
CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_business_app_echo_uniq"
  ON "channel_messages" ("organizationId", "externalId")
  WHERE "direction" = 'outbound'
    AND "channelType" = 'whatsapp'
    AND "externalId" IS NOT NULL
    AND ("metadata" ->> 'source') = 'business_app';
