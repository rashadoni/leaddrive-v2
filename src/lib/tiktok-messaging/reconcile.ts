import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { lockTurns } from "@/lib/lock-turns"
import { record, TIKTOK_MESSAGING_PROVIDER } from "./config"

const turns = lockTurns("tiktok-messaging-reconcile", 1)
type Result = { kind: "missing" } | { kind: "conflict" } | { kind: "too_recent" } | { kind: "reconciled" | "replayed"; messageId: string; outcome: "delivered" | "not_delivered" }

/** Operator explicitly verifies the TikTok app conversation; no inferred non-delivery. */
export async function reconcileNativeMessaging(organizationId: string, userId: string, conversationId: string, attemptId: string, outcome: "delivered" | "not_delivered"): Promise<Result> {
  return turns.run(organizationId, () => runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<Result> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${organizationId}`}, 0))`
    const conversation = await tx.socialConversation.findFirst({ where: { id: conversationId, organizationId, platform: "tiktok", deletedAt: null } })
    if (!conversation || record(conversation.metadata).provider !== TIKTOK_MESSAGING_PROVIDER) return { kind: "missing" }
    const attempt = await tx.channelMessage.findFirst({ where: { id: attemptId, organizationId, conversationId, direction: "outbound", channelType: "tiktok" } })
    const metadata = record(attempt?.metadata)
    if (!attempt || metadata.provider !== TIKTOK_MESSAGING_PROVIDER) return { kind: "missing" }
    const prior = record(metadata.deliveryReconciliation)
    if (prior.outcome) return prior.outcome === outcome ? { kind: "replayed", messageId: attempt.id, outcome } : { kind: "conflict" }
    if (attempt.status !== "pending" && metadata.deliveryUnknown !== true) return { kind: "conflict" }
    // Token refresh + send are bounded below 90s. Leave a margin before a human
    // can resolve a pending lease that may still have a request in flight.
    if (Date.now() - attempt.createdAt.getTime() < 120_000) return { kind: "too_recent" }
    await tx.channelMessage.updateMany({ where: { id: attemptId, organizationId }, data: {
      status: outcome === "delivered" ? "sent" : "failed", metadata: {
        ...metadata, deliveryUnknown: false, deliveryReconciliation: { outcome, method: "operator_tiktok_check", verifiedBy: userId, verifiedAt: new Date().toISOString() },
      },
    } })
    if (outcome === "delivered") await tx.socialConversation.updateMany({ where: { id: conversationId, organizationId, lastMessageAt: { lte: attempt.createdAt } }, data: { lastMessage: attempt.body, lastMessageAt: attempt.createdAt } })
    return { kind: "reconciled", messageId: attemptId, outcome }
  })))
}
