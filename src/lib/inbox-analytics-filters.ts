import { Prisma } from "@prisma/client"

/**
 * Channel-filter helpers for conversation analytics. Centralized so the multi-tenant-sensitive
 * channel logic can't drift across the 4 analytics routes.
 *
 * WHY this isn't just `platform = channel`: social channels (whatsapp/telegram/facebook/instagram/
 * vkontakte) store their channel as `platform`, but email/sms/web-chat threads are bucketed under
 * platform "inbox" with the real channel in `metadata.channel` (see ensureConversation). So a filter
 * on "email" must match inbox-bucketed rows whose metadata.channel = "email" — `platform = "email"`
 * never exists. The COALESCE expression below is the canonical "resolved channel" for grouping.
 */

/** Prisma typed `where.OR` matching a conversation to a real channel (for groupBy/findMany). */
export function conversationChannelOR(channel: string): Prisma.SocialConversationWhereInput["OR"] {
  return [
    { platform: channel },
    { platform: "inbox", metadata: { path: ["channel"], equals: channel } },
  ]
}

/** Raw-SQL condition matching a conversation to a real channel (for $queryRaw aggregation). */
export function conversationChannelSql(channel: string): Prisma.Sql {
  return Prisma.sql`(platform = ${channel} OR (platform = 'inbox' AND metadata->>'channel' = ${channel}))`
}

/** Raw-SQL expression resolving a conversation row to its real channel (for GROUP BY). */
export const RESOLVED_CHANNEL_SQL = Prisma.sql`COALESCE(NULLIF(platform, 'inbox'), metadata->>'channel', 'unknown')`

/**
 * Date-hygiene floor for analytics ([P3] 2026-06-10): prod has rows with epoch-1970-ish timestamps
 * (dirty migrated data) that poison age/FRT/lifetime aggregates ("oldest 20614d", avg FRT 4361h).
 * Analytics queries exclude timestamps before this floor and surface the excluded count as a
 * data-quality figure instead of letting outliers pollute the headline numbers.
 */
export const SANE_MIN_DATE = new Date("2000-01-01T00:00:00Z")
