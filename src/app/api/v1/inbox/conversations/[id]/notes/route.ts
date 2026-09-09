import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"

/**
 * Phase 3b — internal agent notes on an inbox conversation. Private notes, NOT
 * sent to the customer; keyed to the persisted SocialConversation (Option-D).
 *
 * GET  /api/v1/inbox/conversations/[id]/notes  → list (newest first)
 * POST /api/v1/inbox/conversations/[id]/notes  → add  { body }
 */

export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const notes = await prisma.conversationNote.findMany({
      where: { organizationId: orgId, socialConversationId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return NextResponse.json({ success: true, data: notes })
  } catch (e) {
    console.error("[conversation notes GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withInboxSessionWrite(async (req, session, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = session.orgId
  const { id } = await params
  const body = await req.json()

  const text = typeof body.body === "string" ? body.body.trim() : ""
  if (!text) return NextResponse.json({ error: "Note body required" }, { status: 400 })
  // @-mentioned colleague ids to ping (validated org-scoped below; capped to avoid abuse).
  const mentionedIds: string[] = Array.isArray(body.mentionedUserIds)
    ? body.mentionedUserIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 20)
    : []

  try {
    // Resolve the conversation. id="new" → ensure-create from the thread identity (email/sms/web-chat with
    // no SocialConversation yet), mirroring the participants route, so «Команда» works on an old/idle
    // thread without waiting for an inbound. Otherwise it must exist + belong to THIS org (cross-tenant).
    let convId = id
    let assignedTo: string | null = null
    if (id === "new") {
      const ensured = await ensureConversation(orgId, {
        channel: typeof body.channel === "string" ? body.channel : null,
        contactId: typeof body.contactId === "string" ? body.contactId : null,
        contactName: typeof body.contactName === "string" ? body.contactName : null,
        contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : null,
        contactPhone: typeof body.contactPhone === "string" ? body.contactPhone : null,
        webChatSessionId: typeof body.webChatSessionId === "string" ? body.webChatSessionId : null,
        messageIds: Array.isArray(body.messageIds) ? body.messageIds.filter((x: unknown): x is string => typeof x === "string") : [],
      }).catch(() => null)
      if (!ensured) return NextResponse.json({ error: "Could not resolve conversation" }, { status: 400 })
      convId = ensured.id
      assignedTo = ensured.assignedTo
    } else {
      const conv = await prisma.socialConversation.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, assignedTo: true },
      })
      if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      assignedTo = conv.assignedTo
    }

    const note = await prisma.conversationNote.create({
      data: {
        organizationId: orgId,
        socialConversationId: convId,
        authorId: session.userId,
        authorName: session.name || "",
        body: text,
      },
    })

    // Internal collaboration — ping the OTHER participants + the assignee that a colleague left an
    // internal note, so the 3-way internal thread is live. Excludes the author (no self-notify). Stays
    // internal (kind inbox.note → in-app/bell only, never the customer's channel). Fail-soft; never blocks the 201.
    // Validate the @-mentions are real users in THIS org (cross-tenant guard) before pinging them.
    let validMentions: string[] = []
    if (mentionedIds.length) {
      const users: { id: string }[] = await prisma.user.findMany({
        where: { id: { in: mentionedIds }, organizationId: orgId },
        select: { id: true },
      })
      validMentions = users.map((u) => u.id)
    }

    notifyConversationRecipients(orgId, convId, assignedTo, {
      type: "info",
      title: "New note",
      message: `${session.name || "A teammate"} added an internal note`,
      entityType: "inbox_message",
      entityId: convId,
      kind: "inbox.note",
    }, session.userId, validMentions).catch(() => {})

    return NextResponse.json({ success: true, data: note }, { status: 201 })
  } catch (e) {
    console.error("[conversation notes POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
