import { prisma } from "@/lib/prisma"
import type { ChatTicketMessage } from "@/lib/ticketing/chat-transcript"

/**
 * A ticket opened from a portal Da Vinci chat carries the chat twice, as the
 * escalation has always written it: in the description, for the agent's chat
 * card (`chatTicketDescription`), and as one public comment per message, the
 * ticket's conversation the customer reads in the portal (which withholds that
 * description). Both the escalation (portal-chat route) and the chat's
 * «create ticket» button (portal-tickets route) copy it through here.
 *
 * Called inside the organization's tenant scope.
 */

/** The chat's messages, oldest first. */
export async function assistantChatMessages(sessionId: string): Promise<ChatTicketMessage[]> {
  return prisma.aiChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  })
}

/** Every message as a public comment with the chat's sender prefix (chat-transcript.ts). */
export async function copyAssistantChatToComments(ticketId: string, messages: ReadonlyArray<ChatTicketMessage>): Promise<void> {
  for (const message of messages) {
    await prisma.ticketComment.create({
      data: {
        ticketId,
        userId: null,
        comment: `[${message.role === "user" ? "Клиент" : "Da Vinci Bot"}] ${message.content}`,
        isInternal: false,
      },
    })
  }
}
