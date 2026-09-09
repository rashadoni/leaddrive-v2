import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { summarizeAgentPerformance, type AgentConvRow, type FrtMessageRow } from "@/lib/inbox-analytics"
import { conversationChannelOR, SANE_MIN_DATE } from "@/lib/inbox-analytics-filters"

/**
 * Expanded reporting — per-agent performance (section 1). Org-scoped; rolls
 * SocialConversation up by `assignedTo` (load / resolution / unread) joined with
 * per-conversation FRT for a median per agent. Read-only.
 *
 * Bounded + NOT silent: scans at most CONV_CAP most-recent conversations in the window
 * (one per-conversation message scan, like /frt) and returns `{ cap, capped }`.
 * Filters: ?from=&to= window, ?channel= (resolved channel — see inbox-analytics-filters),
 * ?agent= (assignedTo).
 */
const CONV_CAP = 1000

export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const createdAt: { gte?: Date; lte?: Date } = {}
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) createdAt.gte = d }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) createdAt.lte = d }
  const channel = searchParams.get("channel")?.trim() || null
  const agent = searchParams.get("agent")?.trim() || null

  const convWhere: Prisma.SocialConversationWhereInput = { organizationId: orgId }
  if (createdAt.gte || createdAt.lte) convWhere.createdAt = createdAt
  if (agent) convWhere.assignedTo = agent
  if (channel) convWhere.OR = conversationChannelOR(channel)

  const convs = await prisma.socialConversation.findMany({
    where: convWhere,
    select: { id: true, assignedTo: true, status: true, unreadCount: true },
    orderBy: { createdAt: "desc" },
    take: CONV_CAP,
  })
  const ids = convs.map((c: { id: string }) => c.id)

  // Date-hygiene ([P3] 2026-06-10): floor message timestamps so an epoch-1970 dirt row can't
  // produce a multi-decade per-agent median FRT.
  const msgs = ids.length
    ? await prisma.channelMessage.findMany({
        where: { conversationId: { in: ids }, createdAt: { gte: SANE_MIN_DATE } },
        select: { conversationId: true, direction: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : []

  // Resolve assignee ids → display names (org-scoped so a name can't leak cross-org).
  const agentIds = [
    ...new Set(convs.map((c: { assignedTo: string | null }) => c.assignedTo).filter((x: string | null): x is string => !!x)),
  ]
  const users = agentIds.length
    ? await prisma.user.findMany({ where: { id: { in: agentIds }, organizationId: orgId }, select: { id: true, name: true } })
    : []
  const names: Record<string, string> = Object.fromEntries(
    users.map((u: { id: string; name: string }) => [u.id, u.name]),
  )

  const convRows: AgentConvRow[] = convs.map(
    (c: { id: string; assignedTo: string | null; status: string; unreadCount: number }) => ({
      conversationId: c.id,
      assignedTo: c.assignedTo,
      status: c.status,
      unreadCount: c.unreadCount,
    }),
  )
  const agents = summarizeAgentPerformance(convRows, msgs as FrtMessageRow[], names)

  return NextResponse.json({
    success: true,
    data: { agents, cap: CONV_CAP, capped: convs.length >= CONV_CAP },
  })
})
