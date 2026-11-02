import type { Prisma } from "@prisma/client"
import { directMessageThreadKey } from "@/lib/mtm/mobile-message"

/**
 * Writes a message from a manager to field employees: the thread, the message
 * and one in-app notification per recipient, in the caller's transaction.
 *
 * Two entries send through it — the web operations workspace
 * (POST /api/v1/mtm/operations/messages) and, since 2026-10-17, the manager's
 * phone (POST /api/v1/mtm/mobile/manager/messages). Who may write to whom is
 * decided by each entry before it gets here; this only writes.
 *
 * A direct message from someone with a field card goes to the same thread as
 * the employees' own direct messages (the pair's `directKey`), so a reply
 * from either side lands in one conversation. A web user without a card gets
 * a thread of their own, titled with their name.
 */
export type FieldMessageInput = {
  organizationId: string
  type: "DIRECT" | "BROADCAST"
  /** A broadcast's title; required for a broadcast, unused for a direct message. */
  subject: string | null
  body: string
  /** ACTIVE cards the sender may reach — checked by the caller. Exactly one for DIRECT. */
  recipients: Array<{ id: string }>
  sender: { agentId: string | null; userId: string | null; name: string }
  acknowledgementRequired: boolean
  /** The phone's own id for the message, so a resend after a lost answer is not a second message. */
  clientMessageId?: string | null
  /** What each recipient's notification row is titled. */
  notificationTitle: string
  /** Extra notification metadata (the web's key messages carry their period here). */
  notificationMetadata?: Record<string, unknown>
  sentAt: Date
}

export type FieldMessageResult = {
  threadId: string
  message: { id: string; threadId: string; body: string | null; sentAt: Date; acknowledgementRequired: boolean }
}

export async function createFieldMessage(
  tx: Prisma.TransactionClient,
  input: FieldMessageInput,
): Promise<FieldMessageResult> {
  const { organizationId, recipients, sender, sentAt } = input
  let thread: { id: string }
  if (input.type === "BROADCAST") {
    thread = await tx.mtmMessageThread.create({
      data: {
        organizationId,
        type: "BROADCAST",
        subject: input.subject,
        createdByAgentId: sender.agentId,
        createdByUserId: sender.userId,
        lastMessageAt: sentAt,
        participants: {
          create: recipients.map((recipient) => ({
            organizationId,
            agentId: recipient.id,
            role: "MEMBER",
          })),
        },
      },
      select: { id: true },
    })
  } else {
    const recipient = recipients[0]
    const directKey = sender.agentId
      ? directMessageThreadKey(sender.agentId, recipient.id)
      : `web:${sender.userId}:${recipient.id}`
    thread = await tx.mtmMessageThread.upsert({
      where: { organizationId_directKey: { organizationId, directKey } },
      update: { subject: sender.agentId ? undefined : sender.name },
      create: {
        organizationId,
        type: "DIRECT",
        subject: sender.agentId ? null : sender.name,
        directKey,
        createdByAgentId: sender.agentId,
        createdByUserId: sender.userId,
        lastMessageAt: sentAt,
      },
      select: { id: true },
    })
    for (const participantId of [...new Set([recipient.id, ...(sender.agentId ? [sender.agentId] : [])])]) {
      await tx.mtmMessageParticipant.upsert({
        where: { threadId_agentId: { threadId: thread.id, agentId: participantId } },
        create: {
          organizationId,
          threadId: thread.id,
          agentId: participantId,
          role: participantId === sender.agentId ? "OWNER" : "MEMBER",
        },
        update: { archivedAt: null },
      })
    }
  }

  const message = await tx.mtmMessage.create({
    data: {
      organizationId,
      threadId: thread.id,
      senderAgentId: sender.agentId,
      senderUserId: sender.userId,
      senderName: sender.name,
      clientMessageId: input.clientMessageId ?? null,
      body: input.body,
      acknowledgementRequired: input.acknowledgementRequired,
      sentAt,
    },
    select: { id: true, threadId: true, body: true, sentAt: true, acknowledgementRequired: true },
  })
  await tx.mtmMessageThread.update({ where: { id: thread.id }, data: { lastMessageAt: sentAt } })
  await tx.mtmNotification.createMany({
    data: recipients.map((recipient) => ({
      organizationId,
      agentId: recipient.id,
      title: input.notificationTitle,
      body: input.body.slice(0, 500),
      type: input.type === "BROADCAST" ? "announcement" : "message",
      metadata: {
        threadId: thread.id,
        messageId: message.id,
        ...(input.notificationMetadata ?? {}),
      } as Prisma.InputJsonValue,
    })),
  })
  return { threadId: thread.id, message }
}
