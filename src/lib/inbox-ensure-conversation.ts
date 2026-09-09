import { prisma } from "@/lib/prisma"

export interface EnsureConversationInput {
  channel?: string | null // the thread's lastChannel ("email" | "sms" | "web-chat" | ...) — kept in metadata
  contactId?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  webChatSessionId?: string | null
  telegramChatId?: string | null // identity of last resort for contact-less Telegram threads
  messageIds?: string[] // the thread's ChannelMessage ids (the inbox already grouped them) to link
  reopenOnInbound?: boolean // caller just persisted a real customer message
}

function buildConversationMetadata(input: EnsureConversationInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = { channel: input.channel || null, ensured: true }
  if (input.contactEmail) metadata.contactEmail = input.contactEmail
  if (input.contactPhone) metadata.contactPhone = input.contactPhone
  if (input.webChatSessionId) metadata.webChatSessionId = input.webChatSessionId
  if (input.telegramChatId) metadata.telegramChatId = input.telegramChatId
  return metadata
}

/**
 * Ensure a SocialConversation exists for a NON-social inbox thread (email / sms / web-chat) so it can
 * carry collaborators (participants), assignment, snooze, etc. Social channels already create one in
 * their webhook; email/sms/web-chat threads are derived from grouped ChannelMessage and have
 * socialConversationId = null, so the add-participant control was disabled there ([P3]).
 *
 * Design:
 * - `platform = "inbox"` (FIXED) — a stable, channel-independent bucket for these rows. The social
 *   pollers query by their own platform ("vkontakte"/"telegram"/…), never "inbox", so an ensure-created
 *   row is invisible to them (no wrong-host poll like the IG-Login bug). The real channel is preserved
 *   in `metadata.channel`; the inbox still shows the channel from the messages, not from here.
 * - `externalId` prefers the STABLE contactId (survives an email/phone change), falling back to the
 *   web-chat session / email / phone. Idempotent via @@unique(organizationId, platform, externalId).
 * - LINKS the thread by stamping conversationId onto the CALLER-SUPPLIED message ids — the inbox already
 *   grouped them, so we trust that grouping instead of re-deriving the fragile resolveKey. The update is
 *   org-scoped AND only-if-null, so it can never steal another thread's (or an already-linked) message.
 */
export async function ensureConversation(
  organizationId: string,
  input: EnsureConversationInput,
): Promise<{ id: string; assignedTo: string | null; wasCreated: boolean }> {
  if (!organizationId) throw new Error("organizationId required")

  const externalId =
    input.contactId ? `c:${input.contactId}`
    : input.webChatSessionId ? `w:${input.webChatSessionId}`
    : input.contactEmail ? `e:${input.contactEmail.toLowerCase().trim()}`
    : input.contactPhone ? `p:${input.contactPhone.replace(/[^\d+]/g, "")}`
    : input.telegramChatId ? `t:${input.telegramChatId.trim()}`
    : null
  if (!externalId) throw new Error("no stable identity to ensure-create a conversation")

  const where = { organizationId_platform_externalId: { organizationId, platform: "inbox", externalId } }
  let wasCreated = false
  let sc = await prisma.socialConversation.findUnique({
    where,
    select: { id: true, assignedTo: true },
  })

  if (!sc) {
    try {
      sc = await prisma.socialConversation.create({
        data: {
          organizationId,
          platform: "inbox",
          externalId,
          contactId: input.contactId || null,
          contactName: input.contactName || "",
          metadata: buildConversationMetadata(input),
        },
        select: { id: true, assignedTo: true },
      })
      wasCreated = true
    } catch (error) {
      if (!error || typeof error !== "object" || (error as { code?: string }).code !== "P2002") {
        throw error
      }
      // Lost a first-message create race; the winning request owns conversation_opened.
      sc = await prisma.socialConversation.findUnique({
        where,
        select: { id: true, assignedTo: true },
      })
      if (!sc) throw error
    }
  }

  // Link only the thread's own messages (caller-supplied), org-scoped + only-if-unlinked.
  const ids = (input.messageIds || []).filter(Boolean)
  if (ids.length > 0) {
    await prisma.channelMessage.updateMany({
      where: { id: { in: ids }, organizationId, conversationId: null },
      data: { conversationId: sc.id },
    })
  }

  if (input.reopenOnInbound && !wasCreated) {
    await prisma.socialConversation.updateMany({
      where: {
        id: sc.id,
        organizationId,
        OR: [{ status: { in: ["resolved", "archived"] } }, { deletedAt: { not: null } }],
      },
      data: {
        status: "open",
        closedAt: null,
        snoozedUntil: null,
        // Same reasoning as reopening a resolved thread, and more urgent: a
        // deleted one is invisible in the inbox and in the trash alike, so the
        // customer's new message reaches nobody at all.
        deletedAt: null,
        deletedBy: null,
      },
    })
  }

  return { id: sc.id, assignedTo: sc.assignedTo ?? null, wasCreated }
}
