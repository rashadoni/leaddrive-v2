import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { sendSms } from "@/lib/sms"
import { sendWhatsAppMessage, sendWhatsAppMedia } from "@/lib/whatsapp"
import { resolveTelegramSendTarget, sendTelegramText } from "@/lib/telegram"
import { sendTelegramMedia } from "@/lib/telegram-media"
import { sendChatwootMessage } from "@/lib/chatwoot"
import { sendFacebookMessage, sendInstagramMessage } from "@/lib/facebook"
import { sendVkMessage } from "@/lib/vkontakte"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { isImageMime } from "@/lib/inbox-attachment"
import { resolveChannelConnection } from "@/lib/channels/platform-connections"
import { resolveReplyRoute } from "@/lib/channels/reply-routing"

export type ConversationReplyChannel =
  | "email"
  | "telegram"
  | "sms"
  | "whatsapp"
  | "tiktok"
  | "facebook"
  | "instagram"
  | "vkontakte"

export interface ConversationReplyAttachment {
  buffer: Buffer
  mime: string
  filename: string
  url: string
}

export interface SendConversationReplyOptions {
  organizationId: string
  channel: ConversationReplyChannel
  to: string
  body: string
  subject?: string | null
  contactId?: string | null
  leadId?: string | null
  conversationId?: string | null
  channelConfigId?: string | null
  attachment?: ConversationReplyAttachment | null
  /** The live inbox composer historically sends Telegram as HTML; automated text stays plain. */
  telegramParseMode?: "HTML" | null
  /** Extra keys merged into the recorded ChannelMessage.metadata (e.g. aiQuality from the
   *  flow ai_reply action). Internal keys (error/chatId) win on collision. */
  extraMetadata?: Record<string, unknown>
  /** Stable identity for a Chatwoot transport operation. Manual callers use a
   *  client UUID; server-owned AI/flow callers use a deterministic SHA-256 key. */
  deliveryIdempotency?: {
    source: "manual" | "ai-draft" | "flow" | "action" | "chatbot"
    key: string
  }
  /** Keyword auto-replies need a stronger conversation-wide cooldown than
   *  ordinary per-operation idempotency. The inbound row is verified and the
   *  cooldown is evaluated while holding the Chatwoot conversation lock. */
  chatwootAutoReplyClaim?: {
    inboundMessageId: string
    cooldownMs: number
    nowMs?: number
  }
}

export type SendConversationReplyResult =
  | { success: true; statusCode: 201; data: { id: string; status: string } & Record<string, unknown> }
  | { success: false; statusCode: 400 | 409 | 500; error: string; internal?: boolean; deliveryUnknown?: boolean; attemptId?: string; autoReplyCooldown?: boolean }

function escHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_KEY = /^[0-9a-f]{64}$/
const CHATWOOT_DELIVERED_STATUSES = new Set(["delivered", "sent", "read"])

function chatwootIdempotencyKey(value: SendConversationReplyOptions["deliveryIdempotency"]): string | null {
  if (!value) return null
  const valid = value.source === "manual" || value.source === "action"
    ? UUID_KEY.test(value.key)
    : value.source === "ai-draft" || value.source === "flow" || value.source === "chatbot"
      ? SHA256_KEY.test(value.key)
      : false
  return valid ? `${value.source}:${value.key}` : null
}

function chatwootPayloadHash(opts: SendConversationReplyOptions): string {
  return createHash("sha256").update(JSON.stringify({
    to: opts.to,
    body: opts.body,
    subject: opts.subject ?? null,
    attachment: opts.attachment
      ? { url: opts.attachment.url, mime: opts.attachment.mime, filename: opts.attachment.filename }
      : null,
  })).digest("hex")
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

type ChatwootDeliveryClaim =
  | { kind: "claimed"; message: { id: string; status: string } }
  | { kind: "replayed"; message: { id: string; status: string } }
  | { kind: "blocked"; error: string; deliveryUnknown?: boolean; attemptId?: string; autoReplyCooldown?: boolean; statusCode: 409 | 500 }

async function claimChatwootDelivery(
  opts: SendConversationReplyOptions,
  namespacedKey: string,
  payloadHash: string,
): Promise<ChatwootDeliveryClaim> {
  const conversationId = opts.conversationId
  if (!conversationId) {
    return { kind: "blocked", statusCode: 409, error: "A Chatwoot conversation is required for safe delivery.", deliveryUnknown: true }
  }

  return prisma.$transaction(async (tx) => {
    // Every Chatwoot sender path converges on this lock. It only protects the
    // durable claim; the transaction is deliberately released before network I/O.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chatwoot-delivery:${opts.organizationId}:${conversationId}`}, 0))`

    const autoReplyClaim = opts.chatwootAutoReplyClaim
    if (autoReplyClaim) {
      // Bind the outbound claim to the exact inbound event that triggered it.
      // Explicit org/conversation/channel predicates keep this safe even if a
      // caller accidentally supplies an ID from another tenant or thread.
      const inbound = await tx.channelMessage.findFirst({
        where: {
          id: autoReplyClaim.inboundMessageId,
          organizationId: opts.organizationId,
          conversationId,
          direction: "inbound",
          channelType: "tiktok",
        },
        select: { id: true },
      })
      if (!inbound) {
        return {
          kind: "blocked" as const,
          statusCode: 409 as const,
          error: "The Chatwoot auto-reply trigger is not bound to this conversation.",
        }
      }
    }

    const replay = await tx.channelMessage.findFirst({
      where: {
        organizationId: opts.organizationId,
        conversationId,
        direction: "outbound",
        channelType: "tiktok",
        metadata: { path: ["deliveryIdempotencyKey"], equals: namespacedKey },
      },
      select: { id: true, status: true, metadata: true },
    })
    if (replay) {
      const metadata = objectMetadata(replay.metadata)
      if (replay.status === "pending" || metadata.deliveryUnknown === true) {
        return {
          kind: "blocked" as const,
          statusCode: 409 as const,
          error: "A previous Chatwoot delivery is still unconfirmed. Verify it before retrying.",
          deliveryUnknown: true,
          attemptId: replay.id,
        }
      }
      if (metadata.deliveryPayloadHash !== payloadHash) {
        return {
          kind: "blocked" as const,
          statusCode: 409 as const,
          error: "This Chatwoot idempotency key was already used for a different message.",
        }
      }
      if (CHATWOOT_DELIVERED_STATUSES.has(replay.status)) {
        return { kind: "replayed" as const, message: { id: replay.id, status: replay.status } }
      }
      return {
        kind: "blocked" as const,
        statusCode: 500 as const,
        error: typeof metadata.error === "string" ? metadata.error : "The previous Chatwoot delivery failed.",
      }
    }

    const unresolvedAttempt = await tx.channelMessage.findFirst({
      where: {
        organizationId: opts.organizationId,
        conversationId,
        direction: "outbound",
        channelType: "tiktok",
        OR: [
          { status: "pending", metadata: { path: ["deliveryAttempted"], equals: true } },
          { status: "failed", metadata: { path: ["deliveryUnknown"], equals: true } },
        ],
      },
      select: { id: true },
    })
    if (unresolvedAttempt) {
      return {
        kind: "blocked" as const,
        statusCode: 409 as const,
        error: "A previous Chatwoot delivery is still unconfirmed. Verify it before retrying.",
        deliveryUnknown: true,
        attemptId: unresolvedAttempt.id,
      }
    }

    if (autoReplyClaim) {
      // The old read-before-send cooldown could be passed by two simultaneous
      // webhook deliveries with distinct Chatwoot IDs. Evaluate it again under
      // the same advisory lock that creates the pending outbound row. A
      // confirmed recent reply then prevents a second durable claim; pending or
      // unknown attempts were already stopped by unresolvedAttempt above.
      const recentAutoReply = await tx.channelMessage.findFirst({
        where: {
          organizationId: opts.organizationId,
          conversationId,
          direction: "outbound",
          channelType: "tiktok",
          status: { in: [...CHATWOOT_DELIVERED_STATUSES] },
          metadata: { path: ["autoReply"], equals: true },
          createdAt: {
            gte: new Date((autoReplyClaim.nowMs ?? Date.now()) - autoReplyClaim.cooldownMs),
          },
        },
        select: { id: true },
      })
      if (recentAutoReply) {
        return {
          kind: "blocked" as const,
          statusCode: 409 as const,
          error: "A recent auto-reply already owns this conversation cooldown.",
          autoReplyCooldown: true,
        }
      }
    }

    const message = await tx.channelMessage.create({
      data: {
        organizationId: opts.organizationId,
        channelConfigId: opts.channelConfigId || undefined,
        direction: "outbound",
        channelType: "tiktok",
        from: "system",
        to: opts.to,
        subject: opts.subject || undefined,
        body: opts.body,
        status: "pending",
        contactId: opts.contactId || undefined,
        leadId: opts.leadId || undefined,
        conversationId,
        metadata: {
          ...(opts.extraMetadata ?? {}),
          sentVia: "leaddrive_inbox",
          sentOnBehalfOfCompany: true,
          deliveryAttempted: true,
          deliveryIdempotencyKey: namespacedKey,
          deliveryPayloadHash: payloadHash,
          chatwootConversationId: opts.to,
        },
      },
      select: { id: true, status: true },
    })
    return { kind: "claimed" as const, message }
  })
}

async function finalizeChatwootDelivery(
  opts: SendConversationReplyOptions,
  messageId: string,
  status: string,
  metadata: Record<string, unknown>,
  providerMessageId: string | null = null,
): Promise<{ id: string; status: string }> {
  const conversationId = opts.conversationId
  if (!conversationId) throw new Error("Missing Chatwoot conversation during finalization")

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chatwoot-delivery:${opts.organizationId}:${conversationId}`}, 0))`
    // CAS prevents a late transport continuation from overwriting an explicit
    // operator reconciliation performed under the same lock.
    const updated = await tx.channelMessage.updateMany({
      where: {
        id: messageId,
        organizationId: opts.organizationId,
        conversationId,
        status: "pending",
      },
      data: {
        status,
        metadata,
        ...(providerMessageId ? { externalId: providerMessageId } : {}),
      },
    })
    if (updated.count !== 1) {
      throw new Error("Chatwoot attempt is no longer pending")
    }
    return { id: messageId, status }
  })
}

/** Shared outbound pipeline for the inbox composer and conversation automation actions. */
export async function sendConversationReply(opts: SendConversationReplyOptions): Promise<SendConversationReplyResult> {
  const { organizationId: orgId, channel, to, body, subject, contactId, leadId, conversationId, channelConfigId, attachment } = opts
  let status = "delivered"
  let errorMsg = ""
  let resolvedChatId: string | undefined
  let deliveryUnknown = false
  let chatwootDeliveryConfirmed = false
  let chatwootDeliveryAttempted = false
  let chatwootLedgerKey: string | null = null
  let chatwootPayloadDigest: string | null = null
  // Chatwoot's id for the message it created. `delivered` below only means
  // Chatwoot took the text; the provider behind the inbox still gets to refuse
  // it, and this id is how the poller later says which row that was.
  let chatwootMessageId: string | null = null
  let recordedMessage: ({ id: string; status: string } & Record<string, unknown>) | null = null

  try {
    switch (channel) {
      case "email": {
        if (!to.includes("@")) return { success: false, statusCode: 400, error: "Для email нужен корректный адрес" }
        const result = await sendEmail({
          to,
          subject: subject || "Сообщение из LeadDrive CRM",
          html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${escHtml(body).replace(/\n/g, "<br>")}</div>`,
          organizationId: orgId,
          contactId: contactId || undefined,
        })
        status = result.success ? "delivered" : "failed"
        if (!result.success) errorMsg = result.error || "Email send failed"
        break
      }

      case "telegram": {
        if (attachment) {
          const target = await resolveTelegramSendTarget({ organizationId: orgId, to, channelConfigId })
          if (!target.success) return { success: false, statusCode: 400, error: target.error }
          resolvedChatId = target.metadataChatId
          const result = await sendTelegramMedia(target.botToken, target.chatId, attachment.buffer, attachment.mime, attachment.filename, body.trim() || undefined)
          status = result.success ? "delivered" : "failed"
          if (!result.success) errorMsg = result.error || "Telegram media send failed"
          break
        }
        const result = await sendTelegramText({
          organizationId: orgId,
          to,
          body,
          channelConfigId,
          parseMode: opts.telegramParseMode,
        })
        resolvedChatId = result.metadataChatId
        status = result.success ? "delivered" : "failed"
        if (!result.success) errorMsg = result.error || "Telegram error"
        break
      }

      case "sms": {
        const result = await sendSms({ to, message: body, organizationId: orgId })
        status = result.success ? "delivered" : "failed"
        if (!result.success) errorMsg = result.error || "SMS send failed"
        break
      }

      case "whatsapp": {
        if (attachment) {
          const result = await sendWhatsAppMedia({
            to,
            buffer: attachment.buffer,
            mime: attachment.mime,
            filename: attachment.filename,
            caption: body.trim() || undefined,
            organizationId: orgId,
          })
          status = result.success ? "delivered" : "failed"
          if (!result.success) errorMsg = result.error || "WhatsApp media send failed"
          break
        }
        console.log(`[Inbox WA] Sending to: "${to}" | body: "${body.slice(0, 50)}" | contactId: ${contactId}`)
        const result = await sendWhatsAppMessage({
          to,
          message: body,
          organizationId: orgId,
          contactId: contactId || undefined,
          leadId: leadId || undefined,
          // The live composer keeps the historical self-logging behavior. Flow actions need
          // one conversation-linked canonical row, so they suppress the transport log below.
          ...(conversationId ? { skipLog: true } : {}),
        })
        if (!result.success) return { success: false, statusCode: 500, error: result.error || "WhatsApp send failed" }
        if (!conversationId) {
          if (contactId) {
            await prisma.contact.updateMany({ where: { id: contactId, organizationId: orgId }, data: { lastContactAt: new Date() } }).catch(() => {})
          }
          return { success: true, statusCode: 201, data: { id: "wa-sent", status: "delivered" } }
        }
        break
      }

      case "tiktok": {
        // Defense in depth for every caller (manual UI, AI draft, flow, action):
        // the external Chatwoot recipient must be the one bound to this exact
        // tenant-local SocialConversation. Otherwise the durable ledger could
        // claim conversation A while the network POST targets conversation B.
        if (!conversationId) {
          return { success: false, statusCode: 400, error: "A Chatwoot conversation is required for safe delivery." }
        }
        const boundConversation = await prisma.socialConversation.findFirst({
          where: {
            id: conversationId,
            organizationId: orgId,
            platform: "tiktok",
            deletedAt: null,
          },
          select: { externalId: true },
        })
        if (!boundConversation || boundConversation.externalId !== to) {
          return { success: false, statusCode: 400, error: "Chatwoot conversation binding mismatch." }
        }
        const connection = await resolveChannelConnection({
          organizationId: orgId,
          platform: "tiktok",
          surface: "dm",
          provider: "chatwoot",
        })
        const route = resolveReplyRoute({
          platform: "tiktok",
          surface: "dm",
          provider: "chatwoot",
          connection,
        })
        if (!route.available) return { success: false, statusCode: 400, error: route.message }

        if (opts.chatwootAutoReplyClaim) {
          const { inboundMessageId, cooldownMs, nowMs } = opts.chatwootAutoReplyClaim
          if (
            typeof inboundMessageId !== "string"
            || !inboundMessageId.trim()
            || !Number.isSafeInteger(cooldownMs)
            || cooldownMs <= 0
            || cooldownMs > 24 * 60 * 60_000
            || (nowMs !== undefined && (!Number.isFinite(nowMs) || nowMs <= 0))
          ) {
            return { success: false, statusCode: 400, error: "Invalid Chatwoot auto-reply claim." }
          }
        }

        chatwootLedgerKey = chatwootIdempotencyKey(opts.deliveryIdempotency)
        if (!chatwootLedgerKey) {
          return { success: false, statusCode: 400, error: "A valid Chatwoot idempotency key is required." }
        }
        chatwootPayloadDigest = chatwootPayloadHash(opts)
        const claim = await claimChatwootDelivery(opts, chatwootLedgerKey, chatwootPayloadDigest)
        if (claim.kind === "blocked") {
          return {
            success: false,
            statusCode: claim.statusCode,
            error: claim.error,
            ...(claim.deliveryUnknown ? { deliveryUnknown: true } : {}),
            ...(claim.attemptId ? { attemptId: claim.attemptId } : {}),
            ...(claim.autoReplyCooldown ? { autoReplyCooldown: true } : {}),
          }
        }
        if (claim.kind === "replayed") {
          // The durable row is authoritative. Retry the local projections that
          // may have failed after the original confirmed delivery, but never
          // turn a delivered replay into another external POST.
          if (contactId) {
            await prisma.contact.updateMany({
              where: { id: contactId, organizationId: orgId },
              data: { lastContactAt: new Date() },
            }).catch(() => {})
          }
          if (conversationId) {
            await prisma.socialConversation.updateMany({
              where: { id: conversationId, organizationId: orgId },
              data: { lastMessage: body, lastMessageAt: new Date() },
            }).catch(() => {})
          }
          return {
            success: true,
            statusCode: 201,
            data: { id: claim.message.id, status: claim.message.status, replayed: true },
          }
        }
        recordedMessage = claim.message as typeof recordedMessage
        chatwootDeliveryAttempted = true
        const result = await sendChatwootMessage({ conversationId: to, content: body, organizationId: orgId, channelConfigId })
        status = result.success ? "delivered" : "failed"
        chatwootMessageId = result.messageId ?? null
        if (result.success) chatwootDeliveryConfirmed = true
        if (!result.success) {
          errorMsg = result.error || "Chatwoot send failed"
          deliveryUnknown = result.deliveryUnknown === true
        }
        break
      }

      case "facebook":
      case "instagram": {
        const config = channelConfigId
          ? await prisma.channelConfig.findFirst({ where: { id: channelConfigId, organizationId: orgId, channelType: channel, isActive: true }, select: { apiKey: true } })
          : await prisma.channelConfig.findFirst({ where: { organizationId: orgId, channelType: channel, isActive: true }, select: { apiKey: true } })
        if (!config?.apiKey) return { success: false, statusCode: 400, error: `${channel} не настроен` }
        const ok = channel === "facebook"
          ? await sendFacebookMessage(to, body, config.apiKey, orgId)
          : await sendInstagramMessage(to, body, config.apiKey, orgId)
        status = ok ? "delivered" : "failed"
        if (!ok) errorMsg = `${channel} send failed`
        break
      }

      case "vkontakte": {
        const config = channelConfigId
          ? await prisma.channelConfig.findFirst({ where: { id: channelConfigId, organizationId: orgId, channelType: "vkontakte", isActive: true }, select: { apiKey: true } })
          : await prisma.channelConfig.findFirst({ where: { organizationId: orgId, channelType: "vkontakte", isActive: true }, select: { apiKey: true } })
        if (!config?.apiKey) return { success: false, statusCode: 400, error: "VKontakte не настроен" }
        const ok = await sendVkMessage(to, body, config.apiKey)
        status = ok ? "delivered" : "failed"
        if (!ok) errorMsg = "VKontakte send failed"
        break
      }

      default:
        return { success: false, statusCode: 400, error: `Unsupported conversation channel: ${channel}` }
    }

    const metadata: Record<string, unknown> = {
      sentVia: "leaddrive_inbox",
      sentOnBehalfOfCompany: true,
      ...(opts.extraMetadata ?? {}),
    }
    if (metadata.aiAutoReply === true || metadata.aiGenerated === true) {
      metadata.authorType = "ai"
    }
    if (errorMsg) metadata.error = errorMsg
    if (deliveryUnknown) metadata.deliveryUnknown = true
    if (resolvedChatId) metadata.chatId = resolvedChatId
    if (channel === "tiktok") {
      metadata.chatwootConversationId = to
      metadata.deliveryAttempted = true
      metadata.deliveryConfirmed = chatwootDeliveryConfirmed
      if (chatwootLedgerKey) metadata.deliveryIdempotencyKey = chatwootLedgerKey
      if (chatwootPayloadDigest) metadata.deliveryPayloadHash = chatwootPayloadDigest
    }

    const message = recordedMessage
      ? channel === "tiktok"
        ? await finalizeChatwootDelivery(opts, recordedMessage.id, status, metadata, chatwootMessageId)
        : await prisma.channelMessage.update({
            where: { id: recordedMessage.id },
            data: { status, metadata },
          })
      : await prisma.channelMessage.create({
          data: {
        organizationId: orgId,
        channelConfigId: channelConfigId || undefined,
        direction: "outbound",
        channelType: channel,
        from: "system",
        to,
        subject: subject || undefined,
        body,
        mediaUrl: attachment?.url,
        messageType: attachment ? (isImageMime(attachment.mime) ? "image" : "document") : undefined,
        status,
        contactId: contactId || undefined,
        leadId: leadId || undefined,
        conversationId: conversationId || undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
          },
        })

    if ((channel === "email" || channel === "sms") && (contactId || to)) {
      ensureConversation(orgId, {
        channel,
        contactId: contactId || null,
        contactEmail: channel === "email" ? to : null,
        contactPhone: channel === "sms" ? to : null,
        messageIds: [message.id],
      }).catch((error) => console.error("[inbox ensure email/sms]", error))
    }

    if (contactId && status === "delivered") {
      await prisma.contact.updateMany({ where: { id: contactId, organizationId: orgId }, data: { lastContactAt: new Date() } }).catch(() => {})
    }
    if (conversationId && status === "delivered") {
      await prisma.socialConversation.updateMany({
        where: { id: conversationId, organizationId: orgId },
        data: { lastMessage: body, lastMessageAt: new Date() },
      })
    }

    if (status === "failed") {
      if (deliveryUnknown) {
        return {
          success: false,
          statusCode: 409,
          error: `${errorMsg || "Chatwoot delivery result unknown"}. Do not retry until the conversation is checked in Chatwoot.`,
          deliveryUnknown: true,
          ...(recordedMessage?.id ? { attemptId: recordedMessage.id } : {}),
        }
      }
      return { success: false, statusCode: 500, error: errorMsg || "Ошибка отправки" }
    }
    return { success: true, statusCode: 201, data: message as unknown as { id: string; status: string } & Record<string, unknown> }
  } catch (error) {
    console.error("[sendConversationReply]", error)
    if (deliveryUnknown || chatwootDeliveryConfirmed || chatwootDeliveryAttempted) {
      return {
        success: false,
        statusCode: 409,
        error: "Chatwoot may already contain this message, but the local result could not be recorded. Verify it before retrying.",
        deliveryUnknown: true,
        internal: true,
        ...(recordedMessage?.id ? { attemptId: recordedMessage.id } : {}),
      }
    }
    return { success: false, statusCode: 500, error: "Internal server error", internal: true }
  }
}
