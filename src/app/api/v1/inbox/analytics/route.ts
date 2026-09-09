import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  summarizeMessageAnalytics, summarizeConversationStats, summarizeConversationPlatforms,
  type MessageGroupRow, type ConversationStatusRow,
} from "@/lib/inbox-analytics"
import { conversationChannelOR, conversationChannelSql, RESOLVED_CHANNEL_SQL, SANE_MIN_DATE } from "@/lib/inbox-analytics-filters"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import { lostStageNames, wonStageNames } from "@/lib/marketing-attribution/won-stages"
import { CUSTOMER_STAGES } from "@/lib/inbox/customer-stage"

/**
 * Inbox analytics — org-scoped groupBy over ChannelMessage (message volume) +
 * SocialConversation status (resolution-rate, per-platform breakdown, avg lifetime).
 * Read-only; touches nothing the inbox writes.
 *
 * Conversation stats cover ALL channels incl. email/SMS — A2 persists a SocialConversation for
 * those too. They land under platform "inbox" with the real channel in metadata.channel
 * (ensureConversation), so the per-channel breakdown RESOLVES the channel via
 * COALESCE(NULLIF(platform,'inbox'), metadata->>'channel') rather than reading platform directly.
 * Filters: ?from=&to= window, ?channel= (channelType for messages; resolved channel for
 * conversations — see inbox-analytics-filters), ?agent= (assignedTo, conversations only).
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const createdAt: { gte?: Date; lte?: Date } = {}
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) createdAt.gte = d }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) createdAt.lte = d }
  const hasWindow = !!(createdAt.gte || createdAt.lte)
  const channel = searchParams.get("channel")?.trim() || null
  const agent = searchParams.get("agent")?.trim() || null
  const customerStage = searchParams.get("customerStage")?.trim() || null
  const messageStatus = searchParams.get("messageStatus")?.trim() || null
  if (customerStage && customerStage !== "unclassified" && !CUSTOMER_STAGES.includes(customerStage as typeof CUSTOMER_STAGES[number])) {
    return NextResponse.json({ error: "Invalid customerStage" }, { status: 400 })
  }

  // ── messages (volume) — channel filter maps to channelType ──
  const msgWhere: Prisma.ChannelMessageWhereInput = { organizationId: orgId }
  if (hasWindow) msgWhere.createdAt = createdAt
  if (channel) msgWhere.channelType = channel
  if (messageStatus) msgWhere.status = messageStatus
  if (customerStage === "unclassified") {
    msgWhere.conversation = { is: { customerStage: null, salesCallOutcomes: { isEmpty: true } } }
  } else if (customerStage) {
    msgWhere.conversation = {
      is: {
        OR: [
          { customerStage },
          { salesCallOutcomes: { has: customerStage } },
        ],
      },
    }
  }

  const rows = await prisma.channelMessage.groupBy({
    by: ["channelType", "direction"],
    where: msgWhere,
    _count: { _all: true },
  })
  const messages = summarizeMessageAnalytics(rows as MessageGroupRow[])
  const messageStatusRows = await prisma.channelMessage.groupBy({
    by: ["status", "direction"],
    where: msgWhere,
    _count: { _all: true },
  })
  type MessageStatusRow = { status: string; direction: string; _count: { _all: number } }
  const typedMessageStatusRows = messageStatusRows as MessageStatusRow[]
  const messageStatuses = Array.from(new Set(typedMessageStatusRows.map((row: MessageStatusRow) => row.status))).map((status) => ({
    status,
    inbound: typedMessageStatusRows.find((row: MessageStatusRow) => row.status === status && row.direction === "inbound")?._count._all ?? 0,
    outbound: typedMessageStatusRows.find((row: MessageStatusRow) => row.status === status && row.direction === "outbound")?._count._all ?? 0,
  })).map((row) => ({ ...row, total: row.inbound + row.outbound }))
    .sort((a, b) => b.total - a.total)

  // ── conversations — ?channel= resolves to the REAL channel (social=platform; email/sms/web-chat
  //    are platform "inbox" with the channel in metadata.channel); ?agent= → assignedTo ──
  const convWhere: Prisma.SocialConversationWhereInput = { organizationId: orgId }
  if (hasWindow) convWhere.createdAt = createdAt
  if (agent) convWhere.assignedTo = agent
  if (channel) convWhere.OR = conversationChannelOR(channel)
  if (customerStage === "unclassified") {
    convWhere.AND = [
      ...(Array.isArray(convWhere.AND) ? convWhere.AND : []),
      { customerStage: null, salesCallOutcomes: { isEmpty: true } },
    ]
  } else if (customerStage) {
    convWhere.AND = [
      ...(Array.isArray(convWhere.AND) ? convWhere.AND : []),
      {
        OR: [
          { customerStage },
          { salesCallOutcomes: { has: customerStage } },
        ],
      },
    ]
  }
  if (messageStatus) convWhere.messages = { some: { status: messageStatus } }

  const statusRows = await prisma.socialConversation.groupBy({
    by: ["status"],
    where: convWhere,
    _count: { _all: true },
  })
  const conversations = summarizeConversationStats(statusRows as ConversationStatusRow[])

  // Shared raw-SQL WHERE for the per-channel breakdown + lifetime (resolves the real channel).
  const convConds: Prisma.Sql[] = [Prisma.sql`"organizationId" = ${orgId}`]
  if (createdAt.gte) convConds.push(Prisma.sql`"createdAt" >= ${createdAt.gte}`)
  if (createdAt.lte) convConds.push(Prisma.sql`"createdAt" <= ${createdAt.lte}`)
  if (agent) convConds.push(Prisma.sql`"assignedTo" = ${agent}`)
  if (channel) convConds.push(conversationChannelSql(channel))
  if (customerStage === "unclassified") {
    convConds.push(Prisma.sql`"customerStage" IS NULL AND cardinality("salesCallOutcomes") = 0`)
  } else if (customerStage) {
    convConds.push(Prisma.sql`("customerStage" = ${customerStage} OR ${customerStage} = ANY("salesCallOutcomes"))`)
  }
  if (messageStatus) {
    convConds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM channel_messages sm
      WHERE sm."conversationId" = social_conversations.id
        AND sm."organizationId" = ${orgId}
        AND sm.status = ${messageStatus}
    )`)
  }

  // Per-channel breakdown — GROUP BY the resolved channel so email/SMS/web-chat are split out
  // instead of collapsing into one opaque "inbox" bucket.
  const channelRows = await prisma.$queryRaw<{ channel: string; status: string; count: number }[]>`
    SELECT ${RESOLVED_CHANNEL_SQL} AS channel, status, COUNT(*)::int AS count
    FROM social_conversations
    WHERE ${Prisma.join(convConds, " AND ")}
    GROUP BY channel, status`
  const byPlatform = summarizeConversationPlatforms(
    channelRows.map((r: { channel: string; status: string; count: number }) => ({
      platform: r.channel,
      status: r.status,
      _count: { _all: r.count },
    })),
  )

  // ── avg conversation lifetime (resolved): updatedAt - createdAt, hours.
  //    Date-hygiene ([P3] 2026-06-10): exclude epoch-dirt rows so one 1970 createdAt
  //    can't drag the average to absurd values.
  const lifeRows = await prisma.$queryRaw<{ avg_hours: number | null }[]>`
    SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 3600.0)::float AS avg_hours
    FROM social_conversations
    WHERE ${Prisma.join([...convConds, Prisma.sql`status = 'resolved'`, Prisma.sql`"createdAt" >= ${SANE_MIN_DATE}`], " AND ")}`
  const avgHours = lifeRows[0]?.avg_hours
  const avgLifetimeHours = avgHours != null ? Math.round(Number(avgHours) * 10) / 10 : null

  // ── close-outcome disposition (won/lost/none) across both backing tables.
  //    conversionRate = won / (won + lost); `none` (unclassified) is excluded
  //    from the denominator so it never dilutes the sales signal.
  const outcomeRows = await prisma.socialConversation.groupBy({
    by: ["closeOutcome"],
    where: { ...convWhere, closeOutcome: { not: null } },
    _count: { _all: true },
  })
  const outcome = { won: 0, lost: 0, none: 0 }
  for (const row of outcomeRows as Array<{ closeOutcome: string | null; _count: { _all: number } }>) {
    if (row.closeOutcome && row.closeOutcome in outcome) {
      outcome[row.closeOutcome as keyof typeof outcome] += row._count._all
    }
  }
  const decided = outcome.won + outcome.lost
  const closeConversionRate = decided > 0 ? Math.round((outcome.won / decided) * 1000) / 10 : null

  // Explicit customer lifecycle segmentation. Null is reported honestly as
  // unclassified; analytics never guesses an "interested" customer.
  const segmentRows = await prisma.$queryRaw<Array<{
    agent_id: string | null
    segment: string
    count: number
  }>>`
    SELECT
      CASE
        WHEN "customerStageSource" = 'lead'
          THEN COALESCE("customerStageUpdatedBy", "assignedTo")
        ELSE "assignedTo"
      END AS agent_id,
      segments.segment,
      COUNT(*)::int AS count
    FROM social_conversations
    CROSS JOIN LATERAL unnest(
      CASE
        WHEN cardinality("salesCallOutcomes") > 0 THEN "salesCallOutcomes"
        ELSE ARRAY[COALESCE("customerStage", 'unclassified')]::TEXT[]
      END
    ) AS segments(segment)
    WHERE ${Prisma.join(convConds, " AND ")}
    GROUP BY agent_id, segments.segment`

  // Actual CRM deal cohort by responsible agent. Conversation outcomes remain
  // separate: "sold" describes the inbox disposition, while these numbers
  // describe deals created in the selected date window.
  const dealWhere: Prisma.DealWhereInput = { organizationId: orgId }
  if (hasWindow) dealWhere.createdAt = createdAt
  if (agent) dealWhere.assignedTo = agent
  const [dealRows, configuredWonStages, configuredLostStages] = await Promise.all([
    prisma.deal.groupBy({
      by: ["assignedTo", "stage"],
      where: dealWhere,
      _count: { _all: true },
    }),
    wonStageNames(orgId),
    lostStageNames(orgId),
  ])
  const dealsByAgent = new Map<string, { createdDeals: number; wonDeals: number }>()
  for (const row of dealRows) {
    const key = row.assignedTo ?? "unassigned"
    const counts = dealsByAgent.get(key) ?? { createdDeals: 0, wonDeals: 0 }
    counts.createdDeals += row._count._all
    if (canonicalDealStage(row.stage, configuredWonStages, configuredLostStages) === "WON") {
      counts.wonDeals += row._count._all
    }
    dealsByAgent.set(key, counts)
  }

  const agentIds = Array.from(new Set(
    [
      ...segmentRows.map((row: { agent_id: string | null }) => row.agent_id),
      ...dealRows.map((row: { assignedTo: string | null }) => row.assignedTo),
    ]
      .filter((id: string | null): id is string => Boolean(id)),
  ))
  const agents = agentIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: agentIds }, organizationId: orgId },
        select: { id: true, name: true, email: true },
      })
    : []
  const agentNameById = new Map<string, string>(agents.map((user: { id: string; name: string | null; email: string }) => [
    user.id,
    user.name || user.email,
  ]))
  const segmentOrder = [
    "interested",
    "potential",
    "marketing_contacted",
    "sales_contacted",
    "unable_to_contact",
    "sold",
    "not_sold",
    "no_result",
    "unclassified",
  ]
  const segmentTotals = new Map<string, number>()
  const managerMap = new Map<string, {
    agentId: string | null
    agentName: string
    segments: Record<string, number>
    createdDeals: number
    wonDeals: number
  }>()
  for (const row of segmentRows) {
    segmentTotals.set(row.segment, (segmentTotals.get(row.segment) ?? 0) + row.count)
    const key = row.agent_id ?? "unassigned"
    const manager = managerMap.get(key) ?? {
      agentId: row.agent_id,
      agentName: row.agent_id ? (agentNameById.get(row.agent_id) || row.agent_id) : "unassigned",
      segments: {} as Record<string, number>,
      createdDeals: dealsByAgent.get(key)?.createdDeals ?? 0,
      wonDeals: dealsByAgent.get(key)?.wonDeals ?? 0,
    }
    manager.segments[row.segment] = (manager.segments[row.segment] ?? 0) + row.count
    managerMap.set(key, manager)
  }
  for (const [key, dealCounts] of dealsByAgent) {
    if (managerMap.has(key)) continue
    const agentId = key === "unassigned" ? null : key
    managerMap.set(key, {
      agentId,
      agentName: agentId ? (agentNameById.get(agentId) || agentId) : "unassigned",
      segments: {},
      ...dealCounts,
    })
  }
  const customerSegments = segmentOrder.map((key) => ({ key, count: segmentTotals.get(key) ?? 0 }))
  const managerSegments = Array.from(managerMap.values()).sort((a, b) => {
    const aTotal = Object.values(a.segments).reduce((sum, count) => sum + count, 0)
    const bTotal = Object.values(b.segments).reduce((sum, count) => sum + count, 0)
    return bTotal - aTotal
  })

  return NextResponse.json({
    success: true,
    data: {
      ...messages,
      messageStatuses,
      conversations,
      byPlatform,
      avgLifetimeHours,
      outcome: { ...outcome, closeConversionRate },
      customerSegments,
      managerSegments,
    },
  })
})
