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
 * ?tz=<IANA zone> (2026-11-15, the inbox «Bu gün» card): the trend's days are that zone's
 * calendar days instead of UTC ones — Baku's day starts at 20:00 UTC, so a UTC «today» would
 * count last night's messages into today and drop the first four hours of it. The heatmap is
 * unchanged (the analytics page labels its axis UTC). An unknown zone is ignored, not a 500.
 *
 * The website chat (2026-11-15): its messages live in their own table (web_chat_messages) and
 * are never copied into channel_messages, so both series read the two tables together — the
 * visitor's messages as inbound, the bot's and the operators' as outbound. ?channel= keeps the
 * website chat only with no filter or with channel=web-chat.
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const tz = validTimeZone(searchParams.get("tz"))
  // The two tables share the column names the window needs ("organizationId", "createdAt").
  const shared: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`]
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) shared.push(Prisma.sql`"createdAt" >= ${d}`) }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) shared.push(Prisma.sql`"createdAt" <= ${d}`) }
  const channel = searchParams.get("channel")?.trim()
  const conds = [...shared]
  if (channel) conds.push(Prisma.sql`"channelType" = ${channel}`)
  const webConds = [...shared, Prisma.sql`"fromRole" IN ('visitor', 'bot', 'agent')`]
  // Another channel asked for: the website chat contributes nothing (Postgres folds FALSE away).
  if (channel && channel !== "web-chat") webConds.push(Prisma.sql`FALSE`)
  const messages = Prisma.sql`
    SELECT "createdAt", direction
    FROM channel_messages
    WHERE ${Prisma.join(conds, " AND ")}
    UNION ALL
    SELECT "createdAt", CASE WHEN "fromRole" = 'visitor' THEN 'inbound' ELSE 'outbound' END
    FROM web_chat_messages
    WHERE ${Prisma.join(webConds, " AND ")}`

  const heatRows = await prisma.$queryRaw<HeatmapRow[]>`
    SELECT EXTRACT(DOW FROM "createdAt")::int AS dow,
           EXTRACT(HOUR FROM "createdAt")::int AS hour,
           direction,
           COUNT(*)::int AS count
    FROM (${messages}) m
    GROUP BY dow, hour, direction`

  // "createdAt" is a UTC wall clock without a zone; AT TIME ZONE 'UTC' gives it one, the second
  // AT TIME ZONE reads it on the requested zone's clock.
  const dayExpr = tz
    ? Prisma.sql`date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`
    : Prisma.sql`date_trunc('day', "createdAt")`
  const trendRows = await prisma.$queryRaw<TrendDayRow[]>`
    SELECT to_char(${dayExpr}, 'YYYY-MM-DD') AS day,
           direction,
           COUNT(*)::int AS count
    FROM (${messages}) m
    GROUP BY day, direction
    ORDER BY day`

  return NextResponse.json({
    success: true,
    data: { heatmap: shapeHeatmap(heatRows), trend: shapeTrend(trendRows) },
  })
})

/** An IANA zone name the runtime knows (and so, in practice, Postgres does), or null. */
function validTimeZone(raw: string | null): string | null {
  const tz = raw?.trim()
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return null
  }
}
