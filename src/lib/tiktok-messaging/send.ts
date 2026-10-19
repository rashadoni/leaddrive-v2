import type { Prisma } from "@prisma/client"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { lockTurns } from "@/lib/lock-turns"
import type { SendConversationReplyOptions, SendConversationReplyResult } from "@/lib/inbox/send-conversation-reply"
import { record, TIKTOK_MESSAGING_PROVIDER } from "./config"
import { dispatchMessagingText } from "./store"
import { TikTokMessagingError } from "./api"
import { messagingConversationKey } from "./webhook"

const turns = lockTurns("tiktok-messaging-send", 1)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const completed = new Set(["sent", "delivered", "read"])
const fail = (error: string, statusCode: 400 | 409 | 500 = 409, unknown = false, attemptId?: string): SendConversationReplyResult => ({ success: false, statusCode, error, deliveryUnknown: unknown, ...(attemptId ? { attemptId } : {}) })
type MessagingAttempt = { id: string; metadata: Record<string, string>; connectionId: string; businessId: string; recipient: string; channelConfigId: string }

export function messagingDeliveryKey(value: SendConversationReplyOptions["deliveryIdempotency"]): string | null {
  if (!value) return null
  const valid = ["manual", "action"].includes(value.source) ? UUID.test(value.key)
    : ["flow", "ai-draft", "chatbot"].includes(value.source) && HASH.test(value.key)
  return valid ? `tiktok-messaging:${value.source}:${value.key}` : null
}

/** All native callers converge here; this adapter never falls back to Chatwoot. */
export async function sendNativeMessagingReply(opts: SendConversationReplyOptions): Promise<SendConversationReplyResult> {
  const key = messagingDeliveryKey(opts.deliveryIdempotency)
  if (opts.deliveryIdempotency?.source !== "manual") return fail("Automated native TikTok replies are not enabled.", 400)
  if (!opts.conversationId || !key) return fail("A conversation and valid idempotency key are required.", 400)
  if (opts.attachment) return fail("TikTok native replies currently support text only.", 400)
  if (!opts.body.trim() || opts.body.length > 6000) return fail("TikTok replies must contain 1–6000 characters.", 400)
  if (opts.chatwootAutoReplyClaim) return fail("This automation belongs to the legacy TikTok connection.", 400)
  const digest = createHash("sha256").update(JSON.stringify({ conversationId: opts.conversationId, body: opts.body })).digest("hex")
  let attempt: MessagingAttempt | null = null
  let networkStarted = false
  try {
    const claim = await turns.run(opts.organizationId, () => runWithTenant(opts.organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-messaging-connection:${opts.organizationId}`}, 0))`
      const conversation = await tx.socialConversation.findFirst({ where: { id: opts.conversationId!, organizationId: opts.organizationId, platform: "tiktok", deletedAt: null } })
      const binding = record(conversation?.metadata)
      if (!conversation || binding.provider !== TIKTOK_MESSAGING_PROVIDER
        || typeof binding.businessId !== "string" || typeof binding.providerConversationId !== "string" || typeof binding.connectionId !== "string"
        || conversation.externalId !== opts.to || conversation.externalId !== messagingConversationKey(binding.businessId, binding.providerConversationId)
        || (opts.channelConfigId && conversation.channelConfigId !== opts.channelConfigId)) return { result: fail("TikTok conversation binding mismatch.", 400) }
      const existing = await tx.channelMessage.findFirst({ where: {
        organizationId: opts.organizationId, conversationId: conversation.id, channelType: "tiktok", direction: "outbound",
        metadata: { path: ["deliveryIdempotencyKey"], equals: key },
      } })
      if (existing) {
        const metadata = record(existing.metadata)
        if (metadata.deliveryPayloadHash !== digest) return { result: fail("This operation key was already used for another message.") }
        if (completed.has(existing.status)) return { result: { success: true, statusCode: 201, data: { id: existing.id, status: existing.status, replayed: true } } as SendConversationReplyResult }
        return { result: fail("The previous TikTok attempt must be checked before retrying.", 409, existing.status === "pending" || metadata.deliveryUnknown === true, existing.id) }
      }
      const connection = await tx.channelConnection.findFirst({ where: {
        id: binding.connectionId, organizationId: opts.organizationId, provider: TIKTOK_MESSAGING_PROVIDER,
        platform: "tiktok", surface: "dm", status: "connected", channelConfigId: conversation.channelConfigId,
      } })
      if (!connection?.channelConfigId || record(connection.settings).openId !== binding.businessId || record(connection.capabilities).reply !== true) return { result: fail("Connect this TikTok account before replying.", 400) }
      const unresolved = await tx.channelMessage.findFirst({ where: {
        organizationId: opts.organizationId, conversationId: conversation.id, direction: "outbound", channelType: "tiktok",
        OR: [{ status: "pending" }, { metadata: { path: ["deliveryUnknown"], equals: true } }],
      }, select: { id: true } })
      if (unresolved) return { result: fail("A TikTok delivery is unconfirmed. Verify it before sending another reply.", 409, true, unresolved.id) }
      const inbound = await tx.channelMessage.findFirst({ where: {
        organizationId: opts.organizationId, conversationId: conversation.id, direction: "inbound", channelType: "tiktok",
        metadata: { path: ["provider"], equals: TIKTOK_MESSAGING_PROVIDER },
      }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
      if (!inbound || Date.now() - inbound.createdAt.getTime() > 48 * 60 * 60_000) return { result: fail("The TikTok reply window has closed. Wait for a new incoming message.", 400) }
      const sent = await tx.channelMessage.count({ where: {
        organizationId: opts.organizationId, conversationId: conversation.id, direction: "outbound", channelType: "tiktok",
        createdAt: { gte: inbound.createdAt }, status: { in: ["pending", "sent", "delivered", "read"] },
      } })
      if (sent >= 10) return { result: fail("Wait for the next incoming TikTok message before sending more replies.", 400) }
      const metadata = { provider: TIKTOK_MESSAGING_PROVIDER, platform: "tiktok", surface: "dm", connectionId: connection.id,
        businessId: binding.businessId, providerConversationId: binding.providerConversationId,
        deliveryIdempotencyKey: key, deliveryPayloadHash: digest }
      const message = await tx.channelMessage.create({ data: {
        organizationId: opts.organizationId, conversationId: conversation.id, channelConfigId: connection.channelConfigId,
        channelType: "tiktok", direction: "outbound", from: binding.businessId, to: conversation.externalId,
        body: opts.body, status: "pending", messageType: "text", contactId: conversation.contactId, metadata,
      } })
      return { attempt: { id: message.id, metadata, connectionId: connection.id, businessId: binding.businessId, recipient: binding.providerConversationId, channelConfigId: connection.channelConfigId } }
    })))
    if (claim.result) return claim.result
    const claimedAttempt: MessagingAttempt | undefined = claim.attempt
    if (!claimedAttempt) return fail("tiktok_delivery_claim_failed", 500)
    attempt = claimedAttempt
    networkStarted = true
    await dispatchMessagingText(opts.organizationId, claimedAttempt.connectionId, claimedAttempt.businessId, claimedAttempt.channelConfigId, claimedAttempt.recipient, opts.body, claimedAttempt.id)
    return { success: true, statusCode: 201, data: { id: claimedAttempt.id, status: "sent" } }
  } catch (error) {
    const unknown = error instanceof TikTokMessagingError ? error.deliveryUnknown : networkStarted
    const reason = error instanceof TikTokMessagingError ? error.reason : "tiktok_delivery_failed"
    if (attempt) {
      try {
        await runWithTenant(opts.organizationId, () => prisma.channelMessage.updateMany({ where: { id: attempt!.id, organizationId: opts.organizationId, status: "pending" }, data: {
          status: "failed", metadata: { ...attempt!.metadata, error: reason, deliveryUnknown: unknown },
        } }))
      } catch { /* The pending durable claim remains blocked for reconciliation. */ }
    }
    return fail(unknown ? "TikTok delivery is unconfirmed. Verify it before retrying." : reason, unknown ? 409 : 500, unknown, attempt?.id)
  }
}
