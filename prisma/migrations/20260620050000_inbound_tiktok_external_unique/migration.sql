-- G3: kill same-id duplicate inbound TikTok records at the DB level. The read-then-write
-- externalId dedup in the chatwoot webhook is a TOCTOU that two concurrent Chatwoot retries
-- can race past. This partial unique index makes a same-id duplicate INSERT fail (Postgres
-- 23505 → Prisma P2002), which the webhook catches and treats as a dedup. Scoped to tiktok
-- inbound rows WITH an externalId, so id-less media messages and other channels are unaffected.
-- Prod verified to have 0 existing duplicates, so the index builds cleanly. Partial unique
-- indexes aren't representable in schema.prisma → raw SQL only (like the followup partial index).
CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_tiktok_inbound_external_uniq"
  ON "channel_messages" ("organizationId", "externalId")
  WHERE "direction" = 'inbound' AND "channelType" = 'tiktok' AND "externalId" IS NOT NULL;
