import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import type { ConversationParticipant } from "@prisma/client"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

/**
 * Conversation collaborators (internal participants — visibility model B).
 *
 * Add internal colleagues to a conversation so it is surfaced to them + they get notified. This does
 * NOT restrict visibility (the team already sees all conversations); it surfaces + notifies. The
 * external customer never sees participants. No limit.
 *
 * `[id]` is the SocialConversation id (same id space as conversations/[id]). For non-social threads
 * (some sms/email/web-chat — socialConversationId === null) the UI sends id="new" + an identity payload,
 * and POST ensure-creates a SocialConversation (linking the thread's messages) before attaching. ([P3])
 */

// GET — list participants of a conversation, decorated with the user objects.
export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const conv = await prisma.socialConversation.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const participants: ConversationParticipant[] = await prisma.conversationParticipant.findMany({
    where: { socialConversationId: id },
    orderBy: { createdAt: "asc" },
  })
  const userIds = participants.map((p) => p.userId)
  const users: { id: string; name: string | null; email: string }[] = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, organizationId: orgId },
        select: { id: true, name: true, email: true },
      })
    : []
  const byId = new Map(users.map((u) => [u.id, u]))

  return NextResponse.json({
    success: true,
    data: participants.map((p) => ({ ...p, user: byId.get(p.userId) ?? null })),
  })
})

// POST — add a participant. Body: { userId }. Idempotent (upsert), no limit.
export const POST = withInboxSessionWrite(async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = session.orgId
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const userId = body?.userId
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  // The participant must be a real user in THIS org — same cross-tenant guard the assignedTo path
  // uses (the column is a bare String?, so without this a crafted body could add a cross-tenant user).
  // Validated BEFORE any ensure-create, so an invalid user never creates a conversation row.
  const member = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: "Invalid user" }, { status: 400 })

  // Resolve the conversation. Non-social threads (email/sms/web-chat) have no SocialConversation yet:
  // the UI sends id="new" + an identity payload, so ensure-create one (and link the thread's messages)
  // before attaching. ([P3]) Otherwise the conversation must already exist in this org.
  let convId = id
  if (id === "new") {
    try {
      const ensured = await ensureConversation(orgId, {
        channel: body?.channel,
        contactId: body?.contactId,
        contactName: body?.contactName,
        contactEmail: body?.contactEmail,
        contactPhone: body?.contactPhone,
        webChatSessionId: body?.webChatSessionId,
        messageIds: Array.isArray(body?.messageIds) ? body.messageIds : [],
      })
      convId = ensured.id
    } catch {
      return NextResponse.json({ error: "Could not create conversation for this thread" }, { status: 400 })
    }
  } else {
    const conv = await prisma.socialConversation.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const participant = await prisma.conversationParticipant.upsert({
    where: { socialConversationId_userId: { socialConversationId: convId, userId } },
    update: {},
    create: {
      organizationId: orgId,
      socialConversationId: convId,
      userId,
      addedBy: session.userId,
    },
  })

  return NextResponse.json({ success: true, data: participant, socialConversationId: convId })
})
