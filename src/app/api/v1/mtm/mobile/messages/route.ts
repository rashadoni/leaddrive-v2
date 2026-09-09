import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"

type ThreadMembershipRow = {
  id: string
  lastReadAt: Date | null
  thread: {
    id: string
    type: string
    subject: string | null
    lastMessageAt: Date
    participants: Array<{
      agentId: string
      role: string
      agent: { id: string; name: string; role: string; avatar: string | null }
    }>
    messages: Array<{
      id: string
      senderAgentId: string | null
      senderName: string
      body: string | null
      sentAt: Date
      acknowledgementRequired: boolean
      attachmentDocument: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null
      receipts: Array<{ type: string; occurredAt: Date }>
    }>
  }
}

function threadTitle(thread: {
  type: string
  subject: string | null
  participants: Array<{ agentId: string; agent: { name: string } }>
}, currentAgentId: string): string {
  if (thread.subject) return thread.subject
  if (thread.type === "BROADCAST") return "Announcement"
  if (thread.type === "SYSTEM") return "System"
  return thread.participants
    .filter((participant) => participant.agentId !== currentAgentId)
    .map((participant) => participant.agent.name)
    .join(", ") || "Conversation"
}

export const GET = withMobileRls(async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50))

  try {
    const [memberships, currentAgent] = await Promise.all([
      prisma.mtmMessageParticipant.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          archivedAt: null,
        },
        orderBy: { thread: { lastMessageAt: "desc" } },
        take: limit,
        select: {
          id: true,
          lastReadAt: true,
          thread: {
            select: {
              id: true,
              type: true,
              subject: true,
              lastMessageAt: true,
              participants: {
                where: { archivedAt: null },
                orderBy: { joinedAt: "asc" },
                select: {
                  agentId: true,
                  role: true,
                  agent: { select: { id: true, name: true, role: true, avatar: true } },
                },
              },
              messages: {
                orderBy: { sentAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  senderAgentId: true,
                  senderName: true,
                  body: true,
                  sentAt: true,
                  acknowledgementRequired: true,
                  attachmentDocument: {
                    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
                  },
                  receipts: {
                    where: { agentId: auth.agentId },
                    select: { type: true, occurredAt: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.mtmAgent.findFirst({
        where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true, managerId: true, teamId: true },
      }),
    ])

    if (!currentAgent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    const recipientFilters = [
      ...(currentAgent.managerId ? [{ id: currentAgent.managerId }] : []),
      { managerId: auth.agentId },
      ...(currentAgent.teamId ? [{ teamId: currentAgent.teamId }] : []),
    ]
    const availableRecipients = recipientFilters.length > 0
      ? await prisma.mtmAgent.findMany({
          where: {
            organizationId: auth.orgId,
            id: { not: auth.agentId },
            status: "ACTIVE",
            OR: recipientFilters,
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
          take: 50,
          select: { id: true, name: true, role: true, avatar: true, teamId: true },
        })
      : []

    const threads = (memberships as ThreadMembershipRow[]).map((membership) => {
      const lastMessage = membership.thread.messages[0] ?? null
      const acknowledged = Boolean(lastMessage?.receipts.some((receipt) => receipt.type === "ACKNOWLEDGED"))
      const unread = Boolean(
        lastMessage
        && lastMessage.senderAgentId !== auth.agentId
        && (!membership.lastReadAt || lastMessage.sentAt > membership.lastReadAt),
      )
      return {
        id: membership.thread.id,
        type: membership.thread.type,
        subject: membership.thread.subject,
        title: threadTitle(membership.thread, auth.agentId),
        lastMessageAt: membership.thread.lastMessageAt,
        participants: membership.thread.participants.map((participant) => participant.agent),
        lastMessage: lastMessage ? { ...lastMessage, acknowledged } : null,
        unread,
        needsAcknowledgement: Boolean(lastMessage?.acknowledgementRequired && !acknowledged),
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        threads,
        unread: threads.filter((thread) => thread.unread).length,
        availableRecipients,
        capabilities: {
          startDirectConversation: availableRecipients.length > 0,
          sendAttachments: true,
          acknowledgeBroadcasts: true,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/messages GET]", error)
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 })
  }
})
