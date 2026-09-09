import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { conversationChannelSql, RESOLVED_CHANNEL_SQL, SANE_MIN_DATE } from "@/lib/inbox-analytics-filters"
import { CUSTOMER_STAGES } from "@/lib/inbox/customer-stage"

/**
 * Drill-down list for the analytics page (slice 3): "which conversations are behind this number?"
 * Returns the conversations matching an analytics segment — an aging bucket, a channel row, an
 * agent row, or a status pill — newest-activity first. Read-only, org-scoped.
 *
 * Filters (all optional, AND-combined):
 *   ?status=open|resolved|archived
 *   ?ageBucket=lt1h|h1to4|h4to24|gt24h   (age of lastMessageAt vs NOW; implies status=open —
 *                                         aging is defined over the open backlog)
 *   ?frtBucket=lt5m|m5to15|m15to30|m30to60|gt60m  (slice 4 — conversations whose first-response
 *                                         time falls in the clicked /frt histogram bar)
 *   ?channel=<resolved channel>          (social platform or inbox-bucket metadata.channel)
 *   ?agent=<userId> | "unassigned"
 *   ?from=&to=                           (conversation createdAt window)
 *   ?limit=                              (default 50, clamped 1..200 — declared in the response)
 *
 * Rows whose lastMessageAt predates SANE_MIN_DATE are excluded from age buckets (date hygiene,
 * same rule as the aging aggregate) but still listed for non-age queries.
 */
const AGE_BUCKETS: Record<string, Prisma.Sql> = {
  lt1h: Prisma.sql`age_h < 1`,
  h1to4: Prisma.sql`age_h >= 1 AND age_h < 4`,
  h4to24: Prisma.sql`age_h >= 4 AND age_h < 24`,
  gt24h: Prisma.sql`age_h >= 24`,
}

/** FRT buckets — same edges as the /frt distribution, so a click on a histogram bar lists exactly
 *  the conversations that bar counted. frt_min = first outbound at/after first inbound, minutes. */
const FRT_BUCKETS: Record<string, Prisma.Sql> = {
  lt5m: Prisma.sql`frt_min < 5`,
  m5to15: Prisma.sql`frt_min >= 5 AND frt_min < 15`,
  m15to30: Prisma.sql`frt_min >= 15 AND frt_min < 30`,
  m30to60: Prisma.sql`frt_min >= 30 AND frt_min < 60`,
  gt60m: Prisma.sql`frt_min >= 60`,
}

export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")?.trim() || null
  const ageBucket = searchParams.get("ageBucket")?.trim() || null
  const frtBucket = searchParams.get("frtBucket")?.trim() || null
  const channel = searchParams.get("channel")?.trim() || null
  const agent = searchParams.get("agent")?.trim() || null
  const customerStage = searchParams.get("customerStage")?.trim() || null
  const messageStatus = searchParams.get("messageStatus")?.trim() || null
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200)

  if (ageBucket && !AGE_BUCKETS[ageBucket]) {
    return NextResponse.json({ error: "Invalid ageBucket" }, { status: 400 })
  }
  if (frtBucket && !FRT_BUCKETS[frtBucket]) {
    return NextResponse.json({ error: "Invalid frtBucket" }, { status: 400 })
  }
  if (customerStage && customerStage !== "unclassified" && !CUSTOMER_STAGES.includes(customerStage as typeof CUSTOMER_STAGES[number])) {
    return NextResponse.json({ error: "Invalid customerStage" }, { status: 400 })
  }

  const conds: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`]
  // ageBucket implies the open backlog (aging is defined over open conversations).
  const effectiveStatus = ageBucket ? "open" : status
  if (effectiveStatus) conds.push(Prisma.sql`status = ${effectiveStatus}`)
  if (channel) conds.push(conversationChannelSql(channel))
  if (agent === "unassigned") conds.push(Prisma.sql`"assignedTo" IS NULL`)
  else if (agent) conds.push(Prisma.sql`"assignedTo" = ${agent}`)
  if (customerStage === "unclassified") {
    conds.push(Prisma.sql`"customerStage" IS NULL AND cardinality("salesCallOutcomes") = 0`)
  } else if (customerStage) {
    conds.push(Prisma.sql`("customerStage" = ${customerStage} OR ${customerStage} = ANY("salesCallOutcomes"))`)
  }
  if (messageStatus) {
    conds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM channel_messages sm
      WHERE sm."conversationId" = social_conversations.id
        AND sm."organizationId" = ${orgId}
        AND sm.status = ${messageStatus}
    )`)
  }
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) conds.push(Prisma.sql`"createdAt" >= ${d}`) }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) conds.push(Prisma.sql`"createdAt" <= ${d}`) }
  if (ageBucket) {
    conds.push(Prisma.sql`"lastMessageAt" >= ${SANE_MIN_DATE}`) // hygiene: same rule as the aggregate
  }
  const where = Prisma.join(conds, " AND ")

  // age_h computed in a subquery so the bucket predicate can reference it.
  const ageCond = ageBucket ? Prisma.sql`WHERE ${AGE_BUCKETS[ageBucket]}` : Prisma.empty

  // frtBucket drill: restrict to conversations whose FRT (same CTE as /frt: first outbound at/after
  // the first inbound, SANE_MIN_DATE floor) falls in the clicked histogram bar.
  const frtJoin = frtBucket
    ? Prisma.sql`
      JOIN (
        SELECT fi.cid,
               EXTRACT(EPOCH FROM (MIN(m2."createdAt") - fi.first_in)) / 60.0 AS frt_min
        FROM (
          SELECT m."conversationId" AS cid, MIN(m."createdAt") AS first_in
          FROM channel_messages m
          WHERE m."organizationId" = ${orgId} AND m.direction = 'inbound' AND m."createdAt" >= ${SANE_MIN_DATE}
          GROUP BY m."conversationId"
        ) fi
        JOIN channel_messages m2
          ON m2."conversationId" = fi.cid AND m2.direction = 'outbound' AND m2."createdAt" >= fi.first_in
        GROUP BY fi.cid, fi.first_in
      ) f ON f.cid = t.id AND ${FRT_BUCKETS[frtBucket]}`
    : Prisma.empty

  const rows = await prisma.$queryRaw<{
    id: string
    contactName: string
    channel: string
    status: string
    lastMessageAt: Date
    age_h: number
    assignedTo: string | null
    unreadCount: number
    customerStage: string | null
  }[]>`
    SELECT t.* FROM (
      SELECT id,
             "contactName",
             ${RESOLVED_CHANNEL_SQL} AS channel,
             status,
             "lastMessageAt",
             GREATEST(EXTRACT(EPOCH FROM (NOW() - "lastMessageAt")) / 3600.0, 0)::float AS age_h,
             "assignedTo",
             "unreadCount",
             "customerStage"
      FROM social_conversations
      WHERE ${where}
    ) t
    ${frtJoin}
    ${ageCond}
    ORDER BY "lastMessageAt" DESC
    LIMIT ${limit}`

  // Resolve assignee names org-scoped (cross-org name leak guard, same as /team).
  const agentIds = [
    ...new Set(rows.map((r: { assignedTo: string | null }) => r.assignedTo).filter((x: string | null): x is string => !!x)),
  ]
  const users = agentIds.length
    ? await prisma.user.findMany({ where: { id: { in: agentIds }, organizationId: orgId }, select: { id: true, name: true } })
    : []
  const names: Record<string, string> = Object.fromEntries(
    users.map((u: { id: string; name: string }) => [u.id, u.name]),
  )

  return NextResponse.json({
    success: true,
    data: {
      conversations: rows.map((r: typeof rows[number]) => ({
        id: r.id,
        contactName: r.contactName,
        channel: r.channel,
        status: r.status,
        lastMessageAt: r.lastMessageAt,
        ageHours: Math.round(Number(r.age_h) * 10) / 10,
        agentName: r.assignedTo ? (names[r.assignedTo] ?? null) : null,
        unreadCount: r.unreadCount,
        customerStage: r.customerStage,
      })),
      limit,
      truncated: rows.length >= limit,
    },
  })
})
