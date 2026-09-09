-- A2 idempotency hardening — partial UNIQUE index on inbound SMS/email ChannelMessages.
--
-- A2 (commit 4807c3af) ingests inbound SMS / email replies into the unified inbox.
-- Each handler does a read-then-write guard (findFirst by externalId → skip if found),
-- which closes the common SEQUENTIAL provider-retry case but leaves a TOCTOU window:
-- if the provider redelivers the same webhook CONCURRENTLY, both POSTs can miss the
-- findFirst and both create() → a duplicate inbound row in the thread.
--
-- This partial UNIQUE index closes that window at the DB layer. The two A2 handlers
-- catch the resulting unique-violation (Prisma P2002) and treat it as "already
-- ingested" (skip) — so the race-loser no longer produces a duplicate row, and the
-- code still degrades safely if this index is ever absent (no P2002 → today's behavior).
--
-- Scope is deliberately SURGICAL — only the rows A2 creates:
--   * direction = 'inbound'            → outbound sends are excluded
--   * channelType IN ('sms','email')   → social webhooks (telegram/whatsapp/facebook/
--                                         instagram/vkontakte) are UNTOUCHED, so their
--                                         existing create() behavior can't start failing
--                                         on a duplicate delivery
--   * externalId IS NOT NULL           → SMS/email without a provider id still ingest freely
--                                         (Postgres treats NULLs as distinct anyway, but the
--                                         predicate keeps the index small + intent explicit)
--
-- Safe to apply: the inbound-sms/email slice is brand-new (A2 shipped 2026-06-09), so this
-- predicate matches ~0 existing rows → no duplicate-conflict risk at index-create time.
--
-- Memory: memory/deferred_findings.md — A2 [P3] idempotency.

CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_inbound_external_uniq"
  ON "channel_messages" ("organizationId", "externalId")
  WHERE "direction" = 'inbound'
    AND "channelType" IN ('sms', 'email')
    AND "externalId" IS NOT NULL;
