import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { extractPhoneNumber } from "@/lib/inbox/customer-phone"
import { maybeCreateQualifiedLeadTask } from "@/lib/inbox/lead-qualification"

export type QualificationRepairResult = {
  candidates: number
  repaired: number
  reopened: number
  skipped: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Repairs the historical bug where a TikTok phone acknowledgement could close
 * a conversation even when lead creation failed.
 *
 * The sweep is deliberately narrow and bounded:
 * - TikTok only, last seven days, no human close outcome;
 * - must contain a plausible inbound phone;
 * - must contain a later AI acknowledgement;
 * - at most 50 conversations per cron run.
 *
 * If qualification still cannot create/link a lead, the conversation is
 * reopened so it returns to the operator queue instead of remaining silently
 * closed.
 */
export async function repairClosedTikTokQualifications(
  now = new Date(),
): Promise<QualificationRepairResult> {
  const floor = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const rows = await prisma.socialConversation.findMany({
    where: {
      platform: "tiktok",
      status: "resolved",
      closeOutcome: null,
      closedAt: { gte: floor, lte: now },
    },
    orderBy: { closedAt: "asc" },
    take: 200,
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      contactName: true,
      metadata: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          direction: true,
          body: true,
          createdAt: true,
          metadata: true,
        },
      },
    },
  })

  const result: QualificationRepairResult = {
    candidates: 0,
    repaired: 0,
    reopened: 0,
    skipped: 0,
  }

  for (const conversation of rows) {
    if (result.candidates >= 50) break
    const metadata = asRecord(conversation.metadata)
    if (typeof metadata.qualificationLeadId === "string") {
      result.skipped++
      continue
    }
    const inbound = [...conversation.messages].reverse().find((message) =>
      message.direction === "inbound" && extractPhoneNumber(message.body) !== null,
    )
    if (!inbound) {
      result.skipped++
      continue
    }
    const acknowledged = conversation.messages.some((message) =>
      message.direction === "outbound"
      && message.createdAt >= inbound.createdAt
      && asRecord(message.metadata).aiAutoReply === true,
    )
    if (!acknowledged) {
      result.skipped++
      continue
    }

    result.candidates++
    await maybeCreateQualifiedLeadTask({
      orgId: conversation.organizationId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channelType: "tiktok",
      inboundText: inbound.body,
      senderName: conversation.contactName,
      now,
    }).catch((error: unknown) =>
      console.error(
        "[qualification-repair]",
        conversation.id,
        error instanceof Error ? error.message : error,
      ),
    )

    const refreshed = await prisma.socialConversation.findFirst({
      where: { id: conversation.id, organizationId: conversation.organizationId },
      select: { metadata: true },
    })
    if (typeof asRecord(refreshed?.metadata).qualificationLeadId === "string") {
      result.repaired++
      continue
    }

    await prisma.socialConversation.updateMany({
      where: {
        id: conversation.id,
        organizationId: conversation.organizationId,
        status: "resolved",
        closeOutcome: null,
      },
      data: {
        status: "open",
        closedAt: null,
        metadata: {
          ...metadata,
          qualificationRepairNeeded: true,
          qualificationRepairAttemptedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    })
    result.reopened++
  }

  return result
}
