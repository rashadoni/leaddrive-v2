/**
 * E4 (Creatio 10X roadmap) — daily send limit for cadence emails.
 *
 * All sequence emails go out through the touch queue's send route. A per-org
 * daily cap (Organization.settings.sequenceDailyEmailLimit) protects the
 * sending domain from spam-list flags: once the cap is hit, further sends are
 * refused for the rest of the (UTC) day — the touch simply stays due, so the
 * excess naturally rolls to tomorrow.
 *
 * The count is EmailLog rows tagged with a sequenceId, created since the UTC
 * day start, that actually went out (a failed/suppressed attempt did not
 * consume the domain's reputation, so it doesn't consume quota either). Pure
 * over an injected client; caller owns the RLS scope.
 */
import type { PrismaClient } from "@prisma/client"

/** Statuses that mean the message actually left our infra (consumed quota). */
const SENT_STATUSES = ["sent", "delivered", "opened", "clicked", "pending"]

/** Read the org's daily limit from settings; null/absent/≤0 = unlimited. */
export function readDailyEmailLimit(settings: unknown): number | null {
  if (!settings || typeof settings !== "object") return null
  const raw = (settings as Record<string, unknown>).sequenceDailyEmailLimit
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Start of the current UTC day. */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function countSequenceEmailsSentToday(
  client: Pick<PrismaClient, "emailLog">,
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  return client.emailLog.count({
    where: {
      organizationId,
      sequenceId: { not: null },
      direction: "outbound",
      status: { in: SENT_STATUSES },
      createdAt: { gte: utcDayStart(now) },
    },
  })
}

export interface DailyLimitStatus {
  limit: number | null
  sentToday: number
  remaining: number | null
  reached: boolean
}

/**
 * Where the org stands against its daily cap right now. `reached` is true only
 * when a finite limit is configured AND today's count is at/over it.
 */
export async function getDailyLimitStatus(
  client: Pick<PrismaClient, "emailLog">,
  organizationId: string,
  settings: unknown,
  now: Date = new Date(),
): Promise<DailyLimitStatus> {
  const limit = readDailyEmailLimit(settings)
  if (limit === null) {
    return { limit: null, sentToday: 0, remaining: null, reached: false }
  }
  const sentToday = await countSequenceEmailsSentToday(client, organizationId, now)
  return {
    limit,
    sentToday,
    remaining: Math.max(0, limit - sentToday),
    reached: sentToday >= limit,
  }
}
