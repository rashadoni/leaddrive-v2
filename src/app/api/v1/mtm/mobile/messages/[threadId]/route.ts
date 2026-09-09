import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"

type RouteContext = { params: Promise<{ threadId: string }> }

type ThreadMembershipRow = {
  lastReadAt: Date | null
  thread: {
    id: string
    type: string
    subject: string | null
    lastMessageAt: Date
    participants: Array<{
      role: string
      agent: { id: string; name: string; role: string; avatar: string | null }
    }>
    messages: Array<{
      id: string
      senderAgentId: string | null
      senderUserId: string | null
      senderName: string
      clientMessageId: string | null
      body: string | null
      sentAt: Date
      acknowledgementRequired: boolean
      attachmentDocument: {
        id: string
        title: string | null
        fileName: string
        mimeType: string
        sizeBytes: number
        checksumSha256: string | null
      } | null
      receipts: Array<{ id: string; type: string; occurredAt: Date }>
    }>
  }
}

export const GET = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const { threadId } = await params
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100))
  if (!threadId || threadId.length > 128) {
    return NextResponse.json({ error: "Invalid threadId" }, { status: 400 })
  }

  try {
    const membership = await prisma.mtmMessageParticipant.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        threadId,
        archivedAt: null,
      },
      select: {
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
                role: true,
                agent: { select: { id: true, name: true, role: true, avatar: true } },
              },
            },
            messages: {
              orderBy: { sentAt: "desc" },
              take: limit,
              select: {
                id: true,
                senderAgentId: true,
                senderUserId: true,
                senderName: true,
                clientMessageId: true,
                body: true,
                sentAt: true,
                acknowledgementRequired: true,
                attachmentDocument: {
                  select: {
                    id: true,
                    title: true,
                    fileName: true,
                    mimeType: true,
                    sizeBytes: true,
                    checksumSha256: true,
                  },
                },
                receipts: {
                  where: { agentId: auth.agentId },
                  select: { id: true, type: true, occurredAt: true },
                },
              },
            },
          },
        },
      },
    })
    if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const typedMembership = membership as ThreadMembershipRow

    return NextResponse.json({
      success: true,
      data: {
        thread: {
          id: typedMembership.thread.id,
          type: typedMembership.thread.type,
          subject: typedMembership.thread.subject,
          lastMessageAt: typedMembership.thread.lastMessageAt,
          participants: typedMembership.thread.participants.map((participant) => ({
            ...participant.agent,
            participantRole: participant.role,
          })),
          messages: typedMembership.thread.messages.reverse().map((message) => ({
            ...message,
            attachmentDocument: message.attachmentDocument
              ? {
                  ...message.attachmentDocument,
                  downloadUrl: `/api/v1/mtm/mobile/documents/${message.attachmentDocument.id}/download`,
                }
              : null,
            read: message.receipts.some((receipt) => receipt.type === "READ"),
            acknowledged: message.receipts.some((receipt) => receipt.type === "ACKNOWLEDGED"),
          })),
        },
        capabilities: {
          reply: typedMembership.thread.type === "DIRECT",
          sendAttachments: typedMembership.thread.type === "DIRECT",
          acknowledge: true,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/messages/thread GET]", error)
    return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 })
  }
})
