/**
 * Sales group aggregator. Reuses the existing quota engine + the same won-deal
 * grouping the `/api/v1/sales-quotas/leaderboard` route uses, then maps the
 * result into the Arena's NormalizedAgent shape.
 *
 * volume       = sum of WON-deal value this quarter (currency)
 * attainmentPct = won / quota × 100  (the bubble colour + number)
 *
 * Quotas are quarterly, so any sub-quarter period (week/month) snaps to the
 * CURRENT quarter — surfaced to the user via meta.noteKey. Mirrors the known
 * `updatedAt`-bucketing caveat from the source route (slice-2 fix lives there).
 */
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { buildLeaderboard, quarterBoundaries, type AttainmentStatus } from "@/lib/quota-engine"
import type { AgentStatus, LeaderboardPeriod, NormalizedAgent } from "./types"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"

function mapStatus(s: AttainmentStatus): AgentStatus {
  switch (s) {
    case "exceeded":
      return "exceeding"
    case "not_started":
      return "critical"
    case "exceeding":
    case "on_track":
    case "behind":
    case "at_risk":
    case "critical":
      return s
  }
}

function currentQuarter(now: Date, timezone?: string): { year: number; quarter: number } {
  if (timezone) {
    const [yearText, monthText] = dateInputValueInTimezone(now, timezone).split("-")
    const year = Number(yearText)
    const month = Number(monthText)
    return { year, quarter: Math.floor((month - 1) / 3) + 1 }
  }
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 }
}

function quarterRange(year: number, quarter: number, timezone?: string): { start: Date; end?: Date; endExclusive?: Date } {
  if (!timezone) return quarterBoundaries(year, quarter)
  const startMonth = (quarter - 1) * 3 + 1
  const nextYear = quarter === 4 ? year + 1 : year
  const nextMonth = quarter === 4 ? 1 : startMonth + 3
  const startKey = `${year}-${String(startMonth).padStart(2, "0")}-01`
  const nextKey = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
  return {
    start: localDateTimeToUtc(`${startKey}T00:00`, timezone),
    endExclusive: localDateTimeToUtc(`${nextKey}T00:00`, timezone),
  }
}

function wallClockNow(now: Date, timezone?: string): Date {
  if (!timezone) return now
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ))
}

type QuotaWithUser = {
  id: string
  userId: string
  year: number
  quarter: number
  amount: number
  currency: string
  user: { id: string; name: string; isActive: boolean; avatar: string | null }
}

export async function computeSalesLeaderboard(
  orgId: string,
  _period: LeaderboardPeriod,
  now: Date = new Date(),
  timezone?: string,
): Promise<NormalizedAgent[]> {
  const { year, quarter } = currentQuarter(now, timezone)

  // NOTE: `user: { isActive: true }` is INTENTIONAL and deliberately STRICTER than
  // the source route `/api/v1/sales-quotas/leaderboard` (which has no isActive
  // filter). The Arena is a live, public-facing gamification board — a deactivated
  // rep must not appear among current competitors. Do NOT "sync" this back to match
  // the quota route; the divergence is by design.
  const quotas = (await prisma.salesQuota.findMany({
    where: { organizationId: orgId, year, quarter, user: { isActive: true } },
    include: { user: { select: { id: true, name: true, isActive: true, avatar: true } } },
  })) as QuotaWithUser[]
  if (quotas.length === 0) return []

  const { start, end, endExclusive } = quarterRange(year, quarter, timezone)
  /*
   * Written-down stage spellings, not the literal "WON": `Deal.stage` is a free
   * string and production holds `CLOSED_WON` beside `WON`, so a literal filter
   * credits that deal to nobody.
   */
  const { wonStages } = await orgStageVocabulary(orgId)
  const wonGroups = await prisma.deal.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      assignedTo: { in: quotas.map((q) => q.userId) },
      updatedAt: endExclusive ? { gte: start, lt: endExclusive } : { gte: start, lte: end },
    },
    _sum: { valueAmount: true },
  })
  const actualsByUser = new Map<string, number>()
  for (const g of wonGroups) {
    if (g.assignedTo) actualsByUser.set(g.assignedTo, decimalToNumber(g._sum.valueAmount))
  }

  const userMeta = new Map(quotas.map((q) => [q.userId, q.user]))
  const currencyByUser = new Map(quotas.map((q) => [q.userId, q.currency]))

  const leaderboard = buildLeaderboard(
    quotas.map((q) => ({
      quota: { id: q.id, userId: q.userId, year: q.year, quarter: q.quarter, amount: q.amount, currency: q.currency },
      actualAmount: actualsByUser.get(q.userId) ?? 0,
      userName: q.user.name,
    })),
    wallClockNow(now, timezone),
  )

  return leaderboard.map((e) => {
    const meta = userMeta.get(e.userId)
    return {
      id: e.userId,
      name: e.userName ?? meta?.name ?? "—",
      avatar: meta?.avatar ?? null,
      rank: e.rank,
      volume: e.actualAmount,
      volumeFormat: "currency" as const,
      currency: currencyByUser.get(e.userId) ?? "AZN",
      attainmentPct: e.attainmentPercent,
      status: mapStatus(e.status),
      metrics: [
        { key: "actualAmount", value: e.actualAmount, format: "currency" as const },
        { key: "quotaAmount", value: e.quotaAmount, format: "currency" as const },
        { key: "attainmentPct", value: e.attainmentPercent, format: "percent" as const },
      ],
    }
  })
}
