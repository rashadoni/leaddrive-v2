import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { matchEscalationKeyword, notifyEscalationTeam } from "@/lib/inbox/escalation"
import { stopAutoReplyForBrokenDelivery } from "@/lib/inbox/chatwoot-delivery-health"
import { tiktokDmMetadata } from "@/lib/channels/platform-connections"
import {
  handleTikTokInboundAudio,
  INSTAGRAM_AUDIO_TEXT_FALLBACK,
} from "@/lib/social/instagram-inbound-audio"
import { chatwootSourceStillUnanswered } from "@/lib/inbox/chatwoot-source-guard"

export type ChatwootInboundPayload = Record<string, unknown>

export type ChatwootInboundChannelConfig = {
  id: string
  organizationId: string
  settings: Prisma.JsonValue | null
}

export type ChatwootInboundResult = {
  ok: true
  ignored?: string
  deduped?: true | "content" | "unique"
  escalated?: string
  ingested?: boolean
  automation?: ChatwootInboundAutomationContext
}

export type ChatwootInboundAutomationContext = {
  organizationId: string
  channelConfig: ChatwootInboundChannelConfig
  conversationId: string
  chatwootConversationId: string
  senderName: string
  contactId: string | null
  messageId: string
  text: string
  hasRealText: boolean
  messageType: string
  mediaUrl: string | null
  unsupportedMedia: boolean
  metadata: Prisma.InputJsonObject
  createdAt: Date
  origin: "webhook" | "poller"
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function isIncoming(messageType: unknown): boolean {
  return messageType === "incoming" || messageType === 0
}

function ignoredCustomerMessage(body: ChatwootInboundPayload): string | null {
  if (!isIncoming(body.message_type)) return "non-incoming"
  if (body.private === true) return "private"
  if (stringValue(body.content_type)?.toLowerCase() === "activity") return "activity"
  if (body.template_params != null || recordValue(body.content_attributes).template_params != null) {
    return "template"
  }
  const senderType = stringValue(recordValue(body.sender).type)?.toLowerCase().replace(/[^a-z]/g, "")
  if (senderType === "agentbot") return "agent-bot"
  return null
}

function attachmentUrl(attachments: unknown[]): string | null {
  for (const attachment of attachments) {
    const item = recordValue(attachment)
    const url = stringValue(item.data_url) ?? stringValue(item.file_url) ?? stringValue(item.url)
    if (url) return url
  }
  return null
}

function attachmentMessageType(attachments: unknown[]): string {
  const first = recordValue(attachments[0])
  const type = [
    stringValue(first.file_type),
    stringValue(first.content_type),
    stringValue(first.contentType),
  ].filter(Boolean).join(" ").toLowerCase()

  if (type.includes("image")) return "image"
  if (type.includes("video")) return "video"
  if (type.includes("audio")) return "audio"
  return "document"
}

function providerCreatedAt(value: unknown): Date {
  const numeric = typeof value === "number" ? value : Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const date = new Date(milliseconds)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

function configuredValue(settings: Prisma.JsonValue | null, key: string): string | null {
  return stringValue(recordValue(settings)[key])
}

async function clearDeferredWakeMarker(contexts: ChatwootInboundAutomationContext[]): Promise<void> {
  const latest = contexts.at(-1)
  if (!latest) return
  const ids = contexts.map((context) => context.messageId)
  if (!prisma.socialConversation?.updateMany) return
  await prisma.socialConversation.updateMany({
    where: {
      id: latest.conversationId,
      organizationId: latest.organizationId,
      aiReplyPendingMessageId: { in: ids },
    },
    data: { aiReplyPendingMessageId: null },
  }).catch(() => {})
}

/**
 * Run the one canonical keyword/escalation/AI path for one or more freshly
 * mirrored Chatwoot messages from the same conversation. Polling saves a
 * rapid batch first and calls this once, so the exact inbound ids are covered
 * by one durable AI attempt instead of producing one reply per missed turn.
 */
export async function runChatwootInboundAutomation(
  input: ChatwootInboundAutomationContext[],
): Promise<{ escalated?: string }> {
  const contexts = [...input].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latest = contexts.at(-1)
  if (!latest) return {}
  if (contexts.some((context) =>
    context.organizationId !== latest.organizationId
    || context.channelConfig.id !== latest.channelConfig.id
    || context.conversationId !== latest.conversationId
    || context.chatwootConversationId !== latest.chatwootConversationId
  )) {
    throw new Error("Chatwoot automation batch crossed a conversation boundary")
  }

  const settings = recordValue(latest.channelConfig.settings)
  const replyMode = stringValue(settings.replyMode) ?? "agent"
  const textContexts = contexts.filter((context) => context.hasRealText)
  const combinedText = textContexts.map((context) => context.text.trim()).filter(Boolean).join("\n\n")
  const inboundIds = textContexts.map((context) => context.messageId)

  // Polling is a delayed-recovery path. A webhook may have landed after the
  // source snapshot, or an operator may have taken ownership while we were
  // ingesting the batch. Recheck the local truth before any keyword/AI action.
  if (latest.origin === "poller") {
    const eligible = await prisma.socialConversation.findFirst({
      where: {
        id: latest.conversationId,
        organizationId: latest.organizationId,
        assignedTo: null,
        status: "open",
        aiReplyPendingMessageId: inboundIds.length ? { in: inboundIds } : undefined,
      },
      select: { id: true },
    })
    if (!eligible) {
      await clearDeferredWakeMarker(contexts)
      return {}
    }
  }

  const pollerSourceStillUnanswered = async (): Promise<boolean> => {
    if (latest.origin !== "poller") return true
    return chatwootSourceStillUnanswered({
      organizationId: latest.organizationId,
      channelConfigId: latest.channelConfig.id,
      channelSettings: latest.channelConfig.settings,
      chatwootConversationId: latest.chatwootConversationId,
      chatwootInboxId: latest.metadata.chatwootInboxId,
      inboundProviderMessageIds: contexts.map(
        (context) => context.metadata.chatwootProviderMessageId,
      ),
    })
  }

  if (combinedText) {
    const keywords = Array.isArray(settings.escalateKeywords)
      ? settings.escalateKeywords.filter((value): value is string => typeof value === "string")
      : undefined
    const matchedKeyword = matchEscalationKeyword(combinedText, keywords)
    if (matchedKeyword) {
      await notifyEscalationTeam({
        orgId: latest.organizationId,
        conversationId: latest.conversationId,
        platform: "tiktok",
        keyword: matchedKeyword,
        contactName: latest.senderName,
      })
      await clearDeferredWakeMarker(contexts)
      return { escalated: matchedKeyword }
    }

    // Same gate as the live webhook, for the same reason: the poller is the
    // path that MADE the loop visible. It treats a provider-refused reply as no
    // reply at all (outboundCoverageState returns null for "failed"), so left
    // alone it re-answers the same customer on every run — one tenant received
    // three identical price tables in a channel that was delivering none.
    if (await stopAutoReplyForBrokenDelivery({
      orgId: latest.organizationId,
      conversationId: latest.conversationId,
      contactName: latest.senderName,
    })) {
      await clearDeferredWakeMarker(contexts)
      return {}
    }

    try {
      const { maybeAutoReply, chatbotTookOwnership } = await import("@/lib/chatbot-autoreply")
      const keywordResult = await maybeAutoReply({
        orgId: latest.organizationId,
        channelType: "tiktok",
        conversationId: latest.conversationId,
        contactId: latest.contactId,
        channelConfigId: latest.channelConfig.id,
        preSend: pollerSourceStillUnanswered,
        // Singular, like the AI call below. maybeAutoReply reads
        // `inboundMessageId` and bails with "send-failed" without it, so
        // passing only the plural meant TikTok keyword replies never sent at
        // all — the rule matched and then stood down. tsc flagged this object
        // (TS2353), but the typecheck step is advisory.
        inboundMessageId: inboundIds.at(-1),
        inboundMessageIds: inboundIds,
        inboundText: combinedText,
        to: latest.chatwootConversationId,
      })
      if (chatbotTookOwnership(keywordResult)) {
        await clearDeferredWakeMarker(contexts)
        return {}
      }
      if (replyMode === "ai") {
        const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
        const { sendChatwootMessage } = await import("@/lib/chatwoot")
        const outcome = await maybeAiAutoReply({
          orgId: latest.organizationId,
          channelConfigId: latest.channelConfig.id,
          platform: "tiktok",
          conversationId: latest.conversationId,
          pageId: "chatwoot",
          externalId: latest.chatwootConversationId,
          userMessage: combinedText,
          senderName: latest.senderName,
          contactId: latest.contactId,
          inboundMessageId: inboundIds.at(-1),
          inboundMessageIds: inboundIds,
          preSend: pollerSourceStillUnanswered,
          send: async (reply) => {
            const result = await sendChatwootMessage({
              conversationId: latest.chatwootConversationId,
              content: reply,
              organizationId: latest.organizationId,
              channelConfigId: latest.channelConfig.id,
            })
            if (!result.success) return result.deliveryUnknown ? "unknown" : false
            return { ok: true as const, externalId: result.messageId ?? null }
          },
        })
        if (outcome.skipped) {
          console.info("[Chatwoot inbound] AI auto-reply outcome", {
            channel: "tiktok",
            outcome: outcome.skipped,
          })
        }
      }
    } catch (error) {
      console.error("[Chatwoot inbound] auto-reply failed:", error)
    }
  }

  // Preserve the existing media behavior. Text messages above are coalesced;
  // audio messages still need their individual attachment URL for transcription.
  if (replyMode === "ai") {
    const { sendChatwootMessage } = await import("@/lib/chatwoot")
    for (const context of contexts.filter((item) => !item.hasRealText)) {
      if (context.messageType === "audio" && context.mediaUrl) {
        await handleTikTokInboundAudio({
          organizationId: context.organizationId,
          messageId: context.messageId,
          audioUrl: context.mediaUrl,
          metadata: context.metadata,
          onTranscript: async (transcript) => {
            const transcriptContext = { ...context, text: transcript, hasRealText: true }
            await runChatwootInboundAutomation([transcriptContext])
          },
          sendFallback: (fallbackText) => sendChatwootMessage({
            conversationId: context.chatwootConversationId,
            content: fallbackText,
            organizationId: context.organizationId,
            channelConfigId: context.channelConfig.id,
          }),
        })
      } else if (context.unsupportedMedia) {
        await sendChatwootMessage({
          conversationId: context.chatwootConversationId,
          content: INSTAGRAM_AUDIO_TEXT_FALLBACK,
          organizationId: context.organizationId,
          channelConfigId: context.channelConfig.id,
        })
      }
    }
  }

  if (replyMode !== "ai" || (!combinedText && contexts.every((context) => context.messageType !== "audio"))) {
    await clearDeferredWakeMarker(contexts)
  }
  return {}
}

/**
 * Canonical Chatwoot customer-message ingestion shared by webhook and polling.
 * It owns tenant scoping, exact provider-id idempotency, conversation linking,
 * notifications and the downstream automation trigger.
 */
export async function ingestChatwootInbound(input: {
  payload: ChatwootInboundPayload
  channelConfig: ChatwootInboundChannelConfig
  expectedInboxId?: string | null
  deferAutomation?: boolean
  origin: "webhook" | "poller"
  sourceReplyCoverage?: {
    state: "covered" | "uncertain"
    sourceMessageId: string
  } | null
  suppressAutomationReason?: "source-too-old" | null
}): Promise<ChatwootInboundResult> {
  const body = input.payload
  if (body.event !== "message_created") {
    return { ok: true, ignored: stringValue(body.event) ?? "unknown" }
  }
  const ignored = ignoredCustomerMessage(body)
  if (ignored) return { ok: true, ignored }

  const conversation = recordValue(body.conversation)
  const chatwootConversationId = stringValue(conversation.id) ?? stringValue(conversation.display_id)
  if (!chatwootConversationId) return { ok: true, ignored: "missing-conversation" }

  const inbox = recordValue(body.inbox)
  const inboxId = stringValue(conversation.inbox_id) ?? stringValue(body.inbox_id) ?? stringValue(inbox.id)
  const account = recordValue(body.account)
  const accountId = stringValue(body.account_id)
    ?? stringValue(account.id)
    ?? stringValue(conversation.account_id)
  const configuredAccountId = configuredValue(input.channelConfig.settings, "accountId")
  if (configuredAccountId && (!accountId || configuredAccountId !== accountId)) {
    return { ok: true, ignored: "account-mismatch" }
  }
  const expectedInboxId = input.expectedInboxId
    ?? configuredValue(input.channelConfig.settings, "inboxId")
  if (expectedInboxId && (!inboxId || String(expectedInboxId) !== inboxId)) {
    return { ok: true, ignored: "inbox-mismatch" }
  }

  const externalMessageId = stringValue(body.id)
  if (!externalMessageId) return { ok: true, ignored: "missing-message-id" }
  const sender = recordValue(body.sender)
  const senderParts = [stringValue(sender.first_name), stringValue(sender.last_name)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
  const senderName = stringValue(sender.name) ?? (senderParts || "Unknown")
  const chatwootContactId = stringValue(sender.id) ?? stringValue(body.sender_id)
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  const mediaUrl = attachmentUrl(attachments)
  const messageType = mediaUrl ? attachmentMessageType(attachments) : "text"
  const unsupportedMedia = recordValue(body.content_attributes).is_unsupported === true
  const rawContent = stringValue(body.content) ?? ""
  const text = rawContent || (mediaUrl ? "[attachment]" : unsupportedMedia ? "[unsupported attachment]" : "")
  const createdAt = providerCreatedAt(body.created_at)
  const orgId = input.channelConfig.organizationId

  return runWithTenant(orgId, async () => {
    const applySourceCoverage = async (duplicate: {
      id: string
      metadata: unknown
      conversationId: string | null
    }): Promise<void> => {
      if (!input.sourceReplyCoverage && !input.suppressAutomationReason) return
      await prisma.channelMessage.update({
        where: { id: duplicate.id },
        data: {
          metadata: {
            ...recordValue(duplicate.metadata),
            ...(input.sourceReplyCoverage ? {
              chatwootSourceReplyState: input.sourceReplyCoverage.state,
              chatwootSourceReplyMessageId: input.sourceReplyCoverage.sourceMessageId,
            } : {}),
            ...(input.suppressAutomationReason ? {
              chatwootPollingAutomationSuppressed: input.suppressAutomationReason,
            } : {}),
          },
        },
      })
      if (duplicate.conversationId) {
        await prisma.socialConversation.updateMany({
          where: {
            id: duplicate.conversationId,
            organizationId: orgId,
            aiReplyPendingMessageId: duplicate.id,
          },
          data: { aiReplyPendingMessageId: null },
        }).catch(() => {})
      }
    }

    const duplicate = await prisma.channelMessage.findFirst({
      where: {
        organizationId: orgId,
        channelType: "tiktok",
        direction: "inbound",
        externalId: externalMessageId,
      },
      select: { id: true, metadata: true, conversationId: true },
    })
    if (duplicate) {
      await applySourceCoverage(duplicate)
      return { ok: true, deduped: true }
    }

    if (text && input.origin === "webhook") {
      const sameText = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          direction: "inbound",
          body: text,
          metadata: { path: ["chatwootConversationId"], equals: chatwootConversationId },
          createdAt: { gte: new Date(Date.now() - 5000) },
        },
        select: { id: true },
      })
      if (sameText) return { ok: true, deduped: "content" }
    }

    let contactId: string | null = null
    if (chatwootContactId) {
      const previous = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          contactId: { not: null },
          metadata: { path: ["chatwootContactId"], equals: chatwootContactId },
        },
        select: { contactId: true },
      })
      contactId = previous?.contactId ?? null
    }

    const metadata = tiktokDmMetadata({
      source: "chatwoot",
      chatwootIngestOrigin: input.origin,
      chatwootConversationId,
      chatwootInboxId: inboxId,
      chatwootContactId,
      chatwootAccountId: accountId,
      chatwootProviderMessageId: externalMessageId,
      chatwootCreatedAt: createdAt.toISOString(),
      ...(input.sourceReplyCoverage ? {
        chatwootSourceReplyState: input.sourceReplyCoverage.state,
        chatwootSourceReplyMessageId: input.sourceReplyCoverage.sourceMessageId,
      } : {}),
      ...(input.suppressAutomationReason ? {
        chatwootPollingAutomationSuppressed: input.suppressAutomationReason,
      } : {}),
    }) as Prisma.InputJsonObject

    let savedMessage: { id: string }
    try {
      savedMessage = await prisma.channelMessage.create({
        data: {
          organizationId: orgId,
          channelConfigId: input.channelConfig.id,
          direction: "inbound",
          channelType: "tiktok",
          contactId: contactId ?? undefined,
          from: senderName,
          to: "chatwoot",
          body: text,
          mediaUrl: mediaUrl ?? undefined,
          messageType,
          status: "delivered",
          externalId: externalMessageId,
          metadata,
        },
        select: { id: true },
      })
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        // A webhook and the polling backstop can race past the read-check. The
        // unique index selects one winner; if the poller observed a later human
        // reply, transfer that durable coverage to the winner before returning.
        if (input.sourceReplyCoverage || input.suppressAutomationReason) {
          const winner = await prisma.channelMessage.findFirst({
            where: {
              organizationId: orgId,
              channelType: "tiktok",
              direction: "inbound",
              externalId: externalMessageId,
            },
            select: { id: true, metadata: true, conversationId: true },
          })
          if (winner) await applySourceCoverage(winner)
        }
        return { ok: true, deduped: "unique" }
      }
      throw error
    }

    let conversationId: string | null = null
    try {
      const { upsertSocialConversation } = await import("@/lib/facebook")
      // A delayed recovery must never reopen or auto-answer a conversation a
      // human already owns or resolved locally. Capture eligibility before the
      // generic upsert (which intentionally reopens live customer turns).
      if (input.origin === "poller") {
        const existing = await prisma.socialConversation.findUnique({
          where: {
            organizationId_platform_externalId: {
              organizationId: orgId,
              platform: "tiktok",
              externalId: chatwootConversationId,
            },
          },
          select: { id: true, status: true, assignedTo: true },
        })
        if (existing && (existing.status !== "open" || existing.assignedTo)) {
          await prisma.channelMessage.update({
            where: { id: savedMessage.id },
            data: {
              conversationId: existing.id,
              metadata: {
                ...recordValue(metadata),
                chatwootSourceReplyState: "uncertain",
                chatwootSourceReplyMessageId: `local-state:${existing.id}`,
              },
            },
          })
          return { ok: true, ingested: true }
        }
      }
      const linked = await upsertSocialConversation(
        orgId,
        "tiktok",
        chatwootConversationId,
        senderName,
        text,
        input.channelConfig.id,
      )
      conversationId = linked.id
      await prisma.channelMessage.update({
        where: { id: savedMessage.id },
        data: { conversationId: linked.id },
      })
      notifyConversationRecipients(orgId, linked.id, linked.assignedTo, {
        type: "info",
        title: "New message",
        message: "New message in TikTok",
        entityType: "inbox_message",
        entityId: linked.id,
        kind: "inbox.message",
      }).catch(() => {})
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        await emitConversationIngestEvents({
          organizationId: orgId,
          conversationId: linked.id,
          wasCreated: linked.wasCreated,
        })
      } catch (error) {
        console.error("[Chatwoot inbound] conversation flow event failed:", error)
      }
    } catch (error) {
      console.error("[Chatwoot inbound] SocialConversation link failed:", error)
    }

    if (!conversationId) return { ok: true, ingested: true }
    const automation: ChatwootInboundAutomationContext = {
      organizationId: orgId,
      channelConfig: input.channelConfig,
      conversationId,
      chatwootConversationId,
      senderName,
      contactId,
      messageId: savedMessage.id,
      text,
      hasRealText: Boolean(rawContent),
      messageType,
      mediaUrl,
      unsupportedMedia,
      metadata,
      createdAt,
      origin: input.origin,
    }

    const replyMode = configuredValue(input.channelConfig.settings, "replyMode") ?? "agent"
    const sourceReplyBlocksAutomation = Boolean(
      input.sourceReplyCoverage || input.suppressAutomationReason,
    )
    if (input.deferAutomation && replyMode === "ai" && !sourceReplyBlocksAutomation) {
      const pending = await prisma.socialConversation.updateMany({
        where: { id: conversationId, organizationId: orgId, assignedTo: null, status: "open" },
        data: { aiReplyPendingMessageId: savedMessage.id },
      })
      // A human-owned/resolved local conversation must not be reactivated by
      // the polling backstop. Webhooks keep their existing direct behavior;
      // only deferred recovery is gated on the local source of truth here.
      if (pending.count === 0) return { ok: true, ingested: true }
    }
    if (input.deferAutomation) {
      if (sourceReplyBlocksAutomation || replyMode === "agent") {
        return { ok: true, ingested: true }
      }
      return { ok: true, ingested: true, automation }
    }

    if (sourceReplyBlocksAutomation) return { ok: true, ingested: true }

    const outcome = await runChatwootInboundAutomation([automation])
    if (contactId) {
      await prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: { lastContactAt: new Date() },
      }).catch(() => {})
    }
    return { ok: true, ingested: true, ...outcome }
  })
}
