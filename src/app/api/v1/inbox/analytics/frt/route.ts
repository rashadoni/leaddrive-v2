import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { conversationChannelSql, SANE_MIN_DATE } from "@/lib/inbox-analytics-filters"

/**
 * First Response Time + SLA + backlog aging — fully SQL-aggregated (slice 3).
 *
 * The old per-conversation JS scan was bounded by FRT_CONV_CAP=500 ("last 500" disclosure on every
 * report). Slice 3 removes the cap by pushing the whole computation into Postgres:
 *   fi = first inbound per in-scope conversation; fr = first outbound at/after it;
 *   one aggregate row: conversations, answered, median (percentile_cont), avg, SLA-met, FRT buckets.
 * Backlog aging is likewise one aggregate over CURRENT open conversations (now-snapshot — no date
 * window on aging; channel/agent filters still apply).
 *
 * Date hygiene ([P3] 2026-06-10): timestamps before SANE_MIN_DATE (epoch-1970 dirt) are excluded
 * from both aggregates; the excluded open-conversation count is returned as
 * `aging.excludedBadDates` so the data-quality issue stays visible instead of silently eaten.
 *
 * Filters: ?from=&to= window (conversation createdAt), ?sla= (minutes, default 30, clamped
 * 1..1440), ?channel= (resolved channel — see inbox-analytics-filters), ?agent= (assignedTo).
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const channel = searchParams.get("channel")?.trim() || null
  const agent = searchParams.get("agent")?.trim() || null
  const slaThreshold = Math.min(Math.max(Number(searchParams.get("sla")) || 30, 1), 1440)

  // Conversation scope (org + window + channel + agent) as raw conds — feeds the FRT CTE.
  const convConds: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`]
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) convConds.push(Prisma.sql`"createdAt" >= ${d}`) }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) convConds.push(Prisma.sql`"createdAt" <= ${d}`) }
  if (agent) convConds.push(Prisma.sql`"assignedTo" = ${agent}`)
  if (channel) convConds.push(conversationChannelSql(channel))
  const convWhere = Prisma.join(convConds, " AND ")

  const frtRows = await prisma.$queryRaw<{
    conversations: number
    answered: number
    median_min: number | null
    avg_min: number | null
    sla_met: number
    b1: number; b2: number; b3: number; b4: number; b5: number
  }[]>`
    WITH convs AS (
      SELECT id FROM social_conversations WHERE ${convWhere}
    ),
    fi AS (
      SELECT m."conversationId" AS cid, MIN(m."createdAt") AS first_in
      FROM channel_messages m
      JOIN convs c ON c.id = m."conversationId"
      WHERE m.direction = 'inbound' AND m."createdAt" >= ${SANE_MIN_DATE}
      GROUP BY m."conversationId"
    ),
    fr AS (
      SELECT m."conversationId" AS cid, MIN(m."createdAt") AS first_reply
      FROM channel_messages m
      JOIN fi ON fi.cid = m."conversationId"
      WHERE m.direction = 'outbound' AND m."createdAt" >= fi.first_in
      GROUP BY m."conversationId"
    ),
    j AS (
      SELECT fi.cid,
             EXTRACT(EPOCH FROM (fr.first_reply - fi.first_in)) / 60.0 AS frt_min
      FROM fi LEFT JOIN fr ON fr.cid = fi.cid
    )
    SELECT COUNT(*)::int AS conversations,
           COUNT(frt_min)::int AS answered,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY frt_min))::float AS median_min,
           AVG(frt_min)::float AS avg_min,
           COUNT(*) FILTER (WHERE frt_min IS NOT NULL AND frt_min <= ${slaThreshold})::int AS sla_met,
           COUNT(*) FILTER (WHERE frt_min IS NOT NULL AND frt_min < 5)::int AS b1,
           COUNT(*) FILTER (WHERE frt_min >= 5  AND frt_min < 15)::int AS b2,
           COUNT(*) FILTER (WHERE frt_min >= 15 AND frt_min < 30)::int AS b3,
           COUNT(*) FILTER (WHERE frt_min >= 30 AND frt_min < 60)::int AS b4,
           COUNT(*) FILTER (WHERE frt_min >= 60)::int AS b5
    FROM j`

  const f = frtRows[0] ?? {
    conversations: 0, answered: 0, median_min: null, avg_min: null, sla_met: 0,
    b1: 0, b2: 0, b3: 0, b4: 0, b5: 0,
  }
  const round1 = (n: number | null) => (n == null ? null : Math.round(Number(n) * 10) / 10)

  // Backlog aging — CURRENT open conversations (now-snapshot): same channel/agent scope, NO window.
  const agingConds: Prisma.Sql[] = [
    Prisma.sql`"organizationId" = ${orgId}`,
    Prisma.sql`status = 'open'`,
  ]
  if (agent) agingConds.push(Prisma.sql`"assignedTo" = ${agent}`)
  if (channel) agingConds.push(conversationChannelSql(channel))
  const agingWhere = Prisma.join(agingConds, " AND ")

  const agingRows = await prisma.$queryRaw<{
    a1: number; a2: number; a3: number; a4: number
    total: number
    oldest_h: number | null
    excluded: number
  }[]>`
    SELECT COUNT(*) FILTER (WHERE ok AND age_h < 1)::int AS a1,
           COUNT(*) FILTER (WHERE ok AND age_h >= 1 AND age_h < 4)::int AS a2,
           COUNT(*) FILTER (WHERE ok AND age_h >= 4 AND age_h < 24)::int AS a3,
           COUNT(*) FILTER (WHERE ok AND age_h >= 24)::int AS a4,
           COUNT(*) FILTER (WHERE ok)::int AS total,
           (MAX(age_h) FILTER (WHERE ok))::float AS oldest_h,
           COUNT(*) FILTER (WHERE NOT ok)::int AS excluded
    FROM (
      SELECT GREATEST(EXTRACT(EPOCH FROM (NOW() - "lastMessageAt")) / 3600.0, 0) AS age_h,
             ("lastMessageAt" >= ${SANE_MIN_DATE}) AS ok
      FROM social_conversations
      WHERE ${agingWhere}
    ) t`

  const a = agingRows[0] ?? { a1: 0, a2: 0, a3: 0, a4: 0, total: 0, oldest_h: null, excluded: 0 }

  return NextResponse.json({
    success: true,
    data: {
      conversations: f.conversations,
      answered: f.answered,
      unanswered: f.conversations - f.answered,
      medianMinutes: round1(f.median_min),
      avgMinutes: round1(f.avg_min),
      sla: {
        threshold: slaThreshold,
        slaMetPct: f.answered > 0 ? Math.round((f.sla_met / f.answered) * 100) : 0,
        answered: f.answered,
        distribution: [
          { label: "<5m", count: f.b1 },
          { label: "5–15m", count: f.b2 },
          { label: "15–30m", count: f.b3 },
          { label: "30–60m", count: f.b4 },
          { label: ">60m", count: f.b5 },
        ],
      },
      aging: {
        buckets: [
          { label: "<1h", count: a.a1 },
          { label: "1–4h", count: a.a2 },
          { label: "4–24h", count: a.a3 },
          { label: ">24h", count: a.a4 },
        ],
        total: a.total,
        oldestHours: a.oldest_h != null ? Math.round(Number(a.oldest_h) * 10) / 10 : null,
        excludedBadDates: a.excluded,
      },
    },
  })
})
