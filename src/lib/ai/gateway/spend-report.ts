/**
 * The organization's AI spend report («Настройки → ИИ и расходы»): what each
 * service, each AI agent and each provider cost, by day, week or month.
 *
 * One source — the gateway's journal `ai_usage`. Periods are counted in the
 * viewer's time zone (production runs in UTC, a Baku day starts at 20:00 UTC),
 * and every period of the window is returned, an empty one as zero, so a
 * chart never closes a gap by itself.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { checkAiBudget } from "@/lib/ai/budget"

export const SPEND_GRANULARITIES = ["day", "week", "month"] as const
export type SpendGranularity = (typeof SPEND_GRANULARITIES)[number]

export const SPEND_RANGES = ["7d", "30d", "90d", "12m"] as const
export type SpendRange = (typeof SPEND_RANGES)[number]

/** Which windows each granularity offers: never more than ~90 bars, never one. */
export const RANGES_FOR: Record<SpendGranularity, readonly SpendRange[]> = {
  day: ["7d", "30d", "90d"],
  week: ["30d", "90d", "12m"],
  month: ["90d", "12m"],
}

/** How far back the window starts, counting the current day or month in it. */
const LOOKBACK: Record<SpendRange, string> = {
  "7d": "6 days",
  "30d": "29 days",
  "90d": "89 days",
  "12m": "11 months",
}

export function isSpendGranularity(value: unknown): value is SpendGranularity {
  return typeof value === "string" && (SPEND_GRANULARITIES as readonly string[]).includes(value)
}

export function isSpendRange(value: unknown): value is SpendRange {
  return typeof value === "string" && (SPEND_RANGES as readonly string[]).includes(value)
}

/** An IANA zone the runtime knows, or UTC. */
export function spendTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) return "UTC"
  try {
    new Intl.DateTimeFormat("en", { timeZone: value })
    return value
  } catch {
    return "UTC"
  }
}

export type SpendPeriod = {
  /** First local day of the period, YYYY-MM-DD. */
  period: string
  costUsd: number
  calls: number
  byFeature: Record<string, number>
}

export type SpendRow = {
  feature: string
  agentId: string | null
  agentName: string | null
  provider: string
  model: string | null
  keySource: string
  calls: number
  /** Everything read: fresh input, cache read and cache write. */
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export type SpendReport = {
  granularity: SpendGranularity
  range: SpendRange
  timeZone: string
  /** The window's first instant (UTC ISO) and the first and last local days. */
  start: string
  firstDay: string
  lastDay: string
  periods: SpendPeriod[]
  rows: SpendRow[]
  totals: { calls: number; costUsd: number }
  /** First journaled call in the window (UTC ISO), or null when there is none. */
  firstCallAt: string | null
  /** Today's spend on the platform key against the daily limit (UTC day). */
  today: { spent: number; limit: number; remaining: number }
}

const money = (value: number) => Math.round(value * 1e6) / 1e6

export async function aiSpendReport(
  orgId: string,
  options: { granularity: SpendGranularity; range: SpendRange; timeZone?: string },
): Promise<SpendReport> {
  const { granularity, range } = options
  if (!RANGES_FOR[granularity].includes(range)) throw new Error(`aiSpendReport: ${granularity} over ${range} is not offered`)
  const tz = spendTimeZone(options.timeZone)
  const lookback = LOOKBACK[range]

  return runWithTenant(orgId, async () => {
    // The window: from the start of the period that holds (now − lookback),
    // in the viewer's zone, to now.
    const [bounds] = await prisma.$queryRaw<{ start: Date; first_day: string; last_day: string }[]>(Prisma.sql`
      SELECT (date_trunc(${granularity}, (now() - ${lookback}::interval) AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS start,
             to_char(date_trunc(${granularity}, (now() - ${lookback}::interval) AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS first_day,
             to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS last_day
    `)
    const start = new Date(bounds.start)

    const [buckets, groups, firstCall, today] = await Promise.all([
      prisma.$queryRaw<{ period: string; feature: string | null; cost: number | null; calls: number | null }[]>(Prisma.sql`
        WITH periods AS (
          SELECT generate_series(
            date_trunc(${granularity}, ${start.toISOString()}::timestamptz AT TIME ZONE ${tz}),
            date_trunc(${granularity}, now() AT TIME ZONE ${tz}),
            ('1 ' || ${granularity})::interval
          ) AS period
        ), used AS (
          SELECT date_trunc(${granularity}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) AS period,
                 feature,
                 SUM("costUsd")::float8 AS cost,
                 COUNT(*)::int AS calls
          FROM ai_usage
          WHERE "organizationId" = ${orgId}
            AND "createdAt" >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          GROUP BY 1, 2
        )
        SELECT to_char(p.period, 'YYYY-MM-DD') AS period, u.feature, u.cost, u.calls
        FROM periods p LEFT JOIN used u ON u.period = p.period
        ORDER BY p.period, u.feature
      `),
      prisma.aiUsage.groupBy({
        by: ["feature", "agentId", "provider", "model", "keySource"],
        where: { organizationId: orgId, createdAt: { gte: start } },
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.aiUsage.aggregate({
        where: { organizationId: orgId, createdAt: { gte: start } },
        _min: { createdAt: true },
      }),
      checkAiBudget(orgId),
    ])

    const periods: SpendPeriod[] = []
    for (const bucket of buckets) {
      let period = periods[periods.length - 1]
      if (!period || period.period !== bucket.period) {
        period = { period: bucket.period, costUsd: 0, calls: 0, byFeature: {} }
        periods.push(period)
      }
      if (!bucket.feature) continue
      const cost = Number(bucket.cost ?? 0)
      period.byFeature[bucket.feature] = money((period.byFeature[bucket.feature] ?? 0) + cost)
      period.costUsd = money(period.costUsd + cost)
      period.calls += Number(bucket.calls ?? 0)
    }

    const agentIds = [...new Set(groups.map((g) => g.agentId).filter((id): id is string => Boolean(id)))]
    const agents = agentIds.length
      ? await prisma.aiAgentConfig.findMany({ where: { organizationId: orgId, id: { in: agentIds } }, select: { id: true, configName: true } })
      : []
    const agentName = new Map(agents.map((a) => [a.id, a.configName]))

    const rows: SpendRow[] = groups
      .map((g) => ({
        feature: g.feature,
        agentId: g.agentId,
        agentName: g.agentId ? agentName.get(g.agentId) ?? null : null,
        provider: g.provider,
        model: g.model,
        keySource: g.keySource,
        calls: g._count._all,
        inputTokens: (g._sum.inputTokens ?? 0) + (g._sum.cacheReadTokens ?? 0) + (g._sum.cacheWriteTokens ?? 0),
        outputTokens: g._sum.outputTokens ?? 0,
        costUsd: money(g._sum.costUsd ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)

    return {
      granularity,
      range,
      timeZone: tz,
      start: start.toISOString(),
      firstDay: bounds.first_day,
      lastDay: bounds.last_day,
      periods,
      rows,
      totals: {
        calls: rows.reduce((sum, r) => sum + r.calls, 0),
        costUsd: money(rows.reduce((sum, r) => sum + r.costUsd, 0)),
      },
      firstCallAt: firstCall._min.createdAt ? firstCall._min.createdAt.toISOString() : null,
      today,
    }
  })
}
