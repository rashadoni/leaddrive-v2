import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { shapeHeatmap, shapeTrend, type HeatmapRow, type TrendDayRow } from "@/lib/inbox-analytics"

/**
 * Expanded reporting — temporal patterns (section 2). The DB does the bucketing via
 * EXTRACT/date_trunc (no per-row fetch), org-scoped + parameterized. Returns:
 *  - heatmap: 7×24 INBOUND counts (dow 0=Sun..6=Sat, UTC hours) — "busiest hours"
 *  - trend: daily inbound/outbound series
 * Counts are cast ::int so Prisma returns JS numbers (COUNT() is bigint otherwise).
 * Hours are UTC (createdAt is stored UTC); the UI labels the axis accordingly.
 * Filters: ?from=&to= window, ?channel= (channelType).
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const conds: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`]
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) conds.push(Prisma.sql`"createdAt" >= ${d}`) }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) conds.push(Prisma.sql`"createdAt" <= ${d}`) }
  const channel = searchParams.get("channel")?.trim()
  if (channel) conds.push(Prisma.sql`"channelType" = ${channel}`)
  const where = Prisma.join(conds, " AND ")

  const heatRows = await prisma.$queryRaw<HeatmapRow[]>`
    SELECT EXTRACT(DOW FROM "createdAt")::int AS dow,
           EXTRACT(HOUR FROM "createdAt")::int AS hour,
           direction,
           COUNT(*)::int AS count
    FROM channel_messages
    WHERE ${where}
    GROUP BY dow, hour, direction`

  const trendRows = await prisma.$queryRaw<TrendDayRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           direction,
           COUNT(*)::int AS count
    FROM channel_messages
    WHERE ${where}
    GROUP BY day, direction
    ORDER BY day`

  return NextResponse.json({
    success: true,
    data: { heatmap: shapeHeatmap(heatRows), trend: shapeTrend(trendRows) },
  })
})
