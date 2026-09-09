import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * Notify everyone who should hear about activity on an inbox conversation: the assignee PLUS every
 * internal participant (collaborators — model B), de-duplicated. Fire-and-forget + fail-soft so it
 * never blocks the webhook's 200 owed to the provider.
 *
 * Replaces the per-webhook `if (conv.assignedTo) createNotification(...)` so PARTICIPANTS also get
 * inbound notifications — delivering the collaborators feature's promise ("they get notified"). When
 * the conversation has no SocialConversation row (socialConversationId null/absent — e.g. some
 * sms/email/web-chat threads), there are no participants, so it gracefully degrades to assignee-only.
 */
export async function notifyConversationRecipients(
  organizationId: string,
  socialConversationId: string | null | undefined,
  assignedTo: string | null | undefined,
  notif: { type: "info" | "warning" | "error" | "success"; title: string; message: string; entityType: string; entityId: string; kind: string },
  excludeUserId?: string | null, // e.g. the note's author — never self-notify the person who just acted
  extraUserIds?: string[], // e.g. @-mentioned colleagues — ping them even if they aren't a participant
): Promise<void> {
  const recipients = new Set<string>()
  if (assignedTo) recipients.add(assignedTo)
  for (const u of extraUserIds ?? []) recipients.add(u)
  if (socialConversationId) {
    try {
      const parts = await prisma.conversationParticipant.findMany({
        where: { socialConversationId, organizationId },
        select: { userId: true },
      })
      for (const p of parts) recipients.add(p.userId)
    } catch {
      // fail-soft: a participant-lookup failure must not drop the assignee notification
    }
  }
  if (excludeUserId) recipients.delete(excludeUserId)
  for (const userId of recipients) {
    createNotification({ organizationId, userId, push: true, ...notif }).catch(() => {})
  }
}
