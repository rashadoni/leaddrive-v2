-- A reply typed in the Instagram / Messenger app arrives as a webhook echo and is stored as an
-- outbound row marked `metadata.source = 'business_app'` (lib/inbox/meta-dm-app-echo). Meta
-- redelivers webhooks, and two concurrent redeliveries both pass the read-then-skip check; this
-- index turns the second insert into P2002, which the ingester treats as "already stored".
--
-- Scoped to echo rows by the marker, exactly like `channel_messages_business_app_echo_uniq` does
-- for WhatsApp: our own sends are not covered, so nothing existing can collide. No such rows exist
-- before this migration (both webhooks dropped echoes), so the build is instant.
--
-- Prisma's @@unique cannot express a partial (WHERE) index, so it is invisible in schema.prisma on
-- purpose. Do not "fix" the migrate-diff drift by dropping it.
CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_meta_dm_app_echo_uniq"
  ON "channel_messages" ("organizationId", "externalId")
  WHERE "direction" = 'outbound'
    AND "channelType" IN ('instagram', 'facebook')
    AND "externalId" IS NOT NULL
    AND ("metadata" ->> 'source') = 'business_app';
