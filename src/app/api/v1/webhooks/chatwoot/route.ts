import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sanitizeLog } from "@/lib/sanitize"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { matchEscalationKeyword, notifyEscalationTeam } from "@/lib/inbox/escalation"
import { stopAutoReplyForBrokenDelivery } from "@/lib/inbox/chatwoot-delivery-health"
import { tiktokDmMetadata } from "@/lib/channels/platform-connections"
import {
  handleTikTokInboundAudio,
  INSTAGRAM_AUDIO_TEXT_FALLBACK,
} from "@/lib/social/instagram-inbound-audio"
import type { Prisma } from "@prisma/client"

/**
 * Chatwoot Webhook — bridges TikTok (and any other channel Chatwoot ingests) into
 * the LeadDrive omnichannel inbox. Chatwoot is the TRANSPORT for TikTok DMs
 * and DM video shares. Public comments must enter via the TikTok Organic
 * provider boundary, not from Chatwoot context labels. We mirror inbound events into our
 * own inbox under the existing "tiktok" channel (the user sees "TikTok", not
 * "Chatwoot"). Replies flow back out via Chatwoot's REST API — Phase 2.
 *
 * Register in Chatwoot → Settings → Integrations → Webhooks, event `message_created`,
 * URL: https://app.leaddrivecrm.org/api/v1/webhooks/chatwoot?token=<secret>
 * where <secret> matches ChannelConfig(channelType:"chatwoot").settings.webhookSecret.
 *
 * Chatwoot does NOT sign its webhooks (no HMAC), so the URL secret token IS the
 * authentication. The org is resolved from that token, then cross-checked against
 * the payload's account.id.
 *
 * NOTE (Phase 1 bring-up): the exact `message_created` payload shape could not be
 * verified against live docs while building. Parsing here is defensive — it tolerates
 * `message_type` as either the string "incoming"/"outgoing" or the integer 0/1, and
 * reads the conversation id from `conversation.id` or `conversation.display_id`. Set
 * env CHATWOOT_WEBHOOK_DEBUG=1 to log the first real payloads in full and finalize.
 */

/** Chatwoot marks inbound (customer→us) messages as "incoming" (string) or 0 (int). */
function isIncoming(messageType: unknown): boolean {
  return messageType === "incoming" || messageType === 0
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function chatwootAttachmentUrl(attachments: unknown[]): string | null {
  for (const attachment of attachments) {
    const item = recordValue(attachment)
    const url =
      stringValue(item.data_url) ??
      stringValue(item.file_url) ??
      stringValue(item.url)
    if (url) return url
  }
  return null
}

function chatwootAttachmentMessageType(attachments: unknown[]): string {
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

export async function POST(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    const body = await req.json()
    // Phase 1 bring-up: capture the real payload shape once (env-gated so we never
    // dump customer PII into prod logs by default). sanitizeLog redacts known secrets.
    if (process.env.CHATWOOT_WEBHOOK_DEBUG) {
      console.log("[Chatwoot Webhook] RAW:", sanitizeLog(JSON.stringify(body)))
    }

    const event = body?.event
    // We only mirror new messages. conversation_created / status_changed / typing /
    // contact_* are acknowledged with 200 and ignored (Phase 1 = message mirror only).
    if (event !== "message_created") {
      return NextResponse.json({ ok: true, ignored: event ?? "unknown" })
    }

    // Skip our own outgoing replies (Chatwoot re-emits them as message_created with
    // message_type "outgoing"/1) and activity/template rows — only customer messages.
    if (!isIncoming(body?.message_type)) {
      return NextResponse.json({ ok: true, ignored: "non-incoming" })
    }

    const conversation = body?.conversation ?? {}
    const convExternalId = String(conversation?.id ?? conversation?.display_id ?? "")
    if (!convExternalId) {
      console.error("[Chatwoot Webhook] message_created without a conversation id — skipping")
      return NextResponse.json({ ok: true })
    }
    const inboxId = conversation?.inbox_id ?? body?.inbox?.id ?? null
    const accountId = body?.account?.id ?? conversation?.account_id ?? null
    const externalMessageId = body?.id != null ? String(body.id) : null

    const sender = body?.sender ?? {}
    const senderName =
      sender?.name ||
      [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") ||
      "Unknown"
    const chatwootContactId = sender?.id != null ? String(sender.id) : null

    // Attachment-only messages arrive with empty `content`; keep a neutral storage
    // placeholder while the UI renders the actual media from mediaUrl.
    const attachments = Array.isArray(body?.attachments) ? body.attachments : []
    const mediaUrl = chatwootAttachmentUrl(attachments)
    const messageType = mediaUrl ? chatwootAttachmentMessageType(attachments) : "text"
    const unsupportedMedia = recordValue(body?.content_attributes).is_unsupported === true
    const text =
      (body?.content || "").trim() ||
      (mediaUrl ? "[attachment]" : unsupportedMedia ? "[unsupported attachment]" : "")

    // Resolve org from the URL secret token. RLS: this lookup IS the org resolution
    // (the token is an external identifier) → bypass scope. Tolerate accountId stored
    // as either a number or a string in settings.
    // findMany + "exactly one", NOT findFirst. The token IS the tenant
    // identifier here, so if two active configs answer to the same secret,
    // findFirst picks one arbitrarily and a customer's message is ingested into
    // whichever organisation sorted first. Refusing to guess is the only safe
    // answer: `take: 2` is enough to tell "one" from "more than one".
    // This guard existed until b5a7dedc7 replaced it with findFirst.
    const channelConfigs = await runWithRlsBypass(() =>
      prisma.channelConfig.findMany({
        where: {
          channelType: "chatwoot",
          isActive: true,
          settings: { path: ["webhookSecret"], equals: token },
        },
        take: 2,
      })
    )

    if (channelConfigs.length !== 1) {
      console.log(
        `[Chatwoot Webhook] Expected exactly one active config for token ...${sanitizeLog(token.slice(-6))}; found ${channelConfigs.length}`,
      )
      return NextResponse.json({ ok: true })
    }
    const channelConfig = channelConfigs[0]

    // Cross-check the payload's account against the configured account (defence in
    // depth: a leaked token still can't push events for a different Chatwoot account).
    const cfgAccountId = (channelConfig.settings as { accountId?: unknown } | null)?.accountId
    if (cfgAccountId != null && accountId != null && String(cfgAccountId) !== String(accountId)) {
      console.error(
        `[Chatwoot Webhook] account mismatch: payload ${sanitizeLog(String(accountId))} vs config ${sanitizeLog(String(cfgAccountId))} — rejecting`
      )
      return NextResponse.json({ ok: true })
    }

    const orgId = channelConfig.organizationId

    // RLS: org resolved — ALL remaining handler work runs tenant-scoped.
    return await runWithTenant(orgId, async () => {

    // Idempotency: Chatwoot retries webhooks. Skip a message we already mirrored.
    if (externalMessageId) {
      const dup = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          direction: "inbound",
          externalId: externalMessageId,
        },
        select: { id: true },
      })
      if (dup) return NextResponse.json({ ok: true, deduped: true })
    }

    // Connector duplicate guard: some TikTok→Chatwoot button taps deliver the SAME message
    // TWICE with DIFFERENT message ids, so the externalId dedup above misses them — and BOTH
    // would fire an AI auto-reply (observed: customer got two replies). Skip an identical
    // inbound body for the same conversation within a short window. The duplicate arrives
    // <1s apart, so 5s is plenty while barely affecting a legit fast re-send. (Best-effort:
    // truly-simultaneous duplicates can still race — see deferred_findings [P3] for the
    // DB-unique hardening.)
    if (text) {
      const sameText = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          direction: "inbound",
          body: text,
          metadata: { path: ["chatwootConversationId"], equals: convExternalId },
          createdAt: { gte: new Date(Date.now() - 5000) },
        },
        select: { id: true },
      })
      if (sameText) return NextResponse.json({ ok: true, deduped: "content" })
    }

    // Match the Chatwoot sender to a known contact: reuse the contact linked to any
    // earlier message from the same Chatwoot contact id. Unknown senders stay
    // contactId:null (the SocialConversation carries the display name) — same as the
    // Telegram handler, which does NOT auto-create a Contact for first contact.
    let contactId: string | undefined = undefined
    if (chatwootContactId) {
      const prevMsg = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          contactId: { not: null },
          metadata: { path: ["chatwootContactId"], equals: chatwootContactId },
        },
        select: { contactId: true },
      })
      if (prevMsg?.contactId) contactId = prevMsg.contactId
    }

    const messageMetadata = tiktokDmMetadata({
      source: "chatwoot",
      chatwootConversationId: convExternalId,
      chatwootInboxId: inboxId,
      chatwootContactId,
      chatwootAccountId: accountId,
    }) as Prisma.InputJsonObject

    let savedMsg
    try {
      savedMsg = await prisma.channelMessage.create({
        data: {
          organizationId: orgId,
          channelConfigId: channelConfig.id,
          direction: "inbound",
          channelType: "tiktok",
          contactId,
          from: senderName,
          to: "chatwoot",
          body: text,
          mediaUrl: mediaUrl ?? undefined,
          messageType,
          status: "delivered",
          externalId: externalMessageId ?? undefined,
          metadata: messageMetadata,
        },
      })
    } catch (e) {
      // Atomic backstop: the partial unique index (org, externalId) WHERE inbound+tiktok
      // rejects a same-id duplicate that the read-then-write dedup above raced past (a
      // Chatwoot retry landing concurrently). P2002 = that duplicate — treat it as a dedup,
      // skipping the conversation upsert AND the downstream AI reply (no double of either).
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json({ ok: true, deduped: "unique" })
      }
      throw e
    }

    // TikTok Social Monitoring is reserved for comments under owned publications
    // (same operator model as Instagram comments). Chatwoot carries TikTok DMs and
    // video-share events, so keep them in the omnichannel inbox but do not mirror
    // them into SocialMention where they pollute the monitoring feed.

    // Upsert the unified-inbox conversation and link this message to it. platform is
    // "tiktok" so it lands under the TikTok pill; externalId is the Chatwoot
    // conversation id (also the reply target for Phase 2). Idempotent via
    // @@unique(organizationId, platform, externalId). Errors are acknowledged with
    // 200, but fail closed for automated replies because the durable terminal marker
    // cannot be evaluated without a linked conversation.
    let convId: string | null = null
    let terminalFlow = false
    let flowSafetyUnavailable = false
    try {
      const { upsertSocialConversation } = await import("@/lib/facebook")
      const conv = await upsertSocialConversation(
        orgId, "tiktok", convExternalId,
        senderName, text, channelConfig.id,
      )
      convId = conv.id
      await prisma.channelMessage.update({
        where: { id: savedMsg.id },
        data: { conversationId: conv.id },
      })
      notifyConversationRecipients(orgId, conv.id, conv.assignedTo, {
        type: "info",
        title: "New message",
        message: `New message in TikTok`,
        entityType: "inbox_message",
        entityId: conv.id,
        kind: "inbox.message",
      }).catch(() => {})
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        const flowEvents = await emitConversationIngestEvents({
          organizationId: orgId,
          conversationId: conv.id,
          wasCreated: conv.wasCreated,
        })
        terminalFlow = flowEvents.terminal === true
      } catch (e) {
        console.error("[Chatwoot Webhook] conversation flow event failed:", e)
        // `emitConversationIngestEvents` also evaluates durable terminal
        // delivery markers. If that safety check is unavailable, fail closed:
        // no keyword/AI/media fallback may create another customer message.
        flowSafetyUnavailable = true
      }
    } catch (e) {
      console.error("[Chatwoot Webhook] SocialConversation link failed:", e)
      // Without a linked conversation we cannot evaluate its durable terminal
      // marker. A 200 still acknowledges the webhook, but all reply paths must
      // stay suppressed for this turn.
      flowSafetyUnavailable = true
    }

    if (terminalFlow || flowSafetyUnavailable) {
      // A flow already attempted a customer-facing send whose Chatwoot delivery
      // result is unknown. Stop every later reply path for this inbound turn:
      // keyword bot, AI, audio transcript/fallback and unsupported-media fallback.
      if (contactId) {
        await prisma.contact.updateMany({
          where: { id: contactId, organizationId: orgId },
          data: { lastContactAt: new Date() },
        }).catch(() => {})
      }
      return NextResponse.json({
        ok: true,
        terminal: true,
        ...(flowSafetyUnavailable ? { reason: "flow_safety_unavailable" } : {}),
      })
    }

    // Keyword auto-escalation — if the customer's message hits a configured escalate keyword
    // (e.g. "жалоба"/"менеджер"), hand the conversation to a human: notify the inbox team and
    // DO NOT auto-reply, in BOTH ai and agent mode. Runs ahead of the reply branch below.
    const escalateKeywords = (channelConfig.settings as { escalateKeywords?: string[] } | null)?.escalateKeywords
    const matchedKeyword = matchEscalationKeyword(text, escalateKeywords)
    if (matchedKeyword && convId) {
      await notifyEscalationTeam({ orgId, conversationId: convId, platform: "tiktok", keyword: matchedKeyword, contactName: senderName })
      return NextResponse.json({ ok: true, escalated: matchedKeyword })
    }

    // Auto-reply routing — mirrors the telegram/whatsapp/fb/ig/vk webhooks:
    //   1. KEYWORD rules first (`maybeAutoReply`, gated on the org `chatbotAutoReply`
    //      flag). The rule sender now has a "tiktok" case (→ Chatwoot transport), so
    //      keyword rules targeting the TikTok channel actually fire.
    //   2. AI second — only when the channel is set to "ai" (ChannelConfig.settings.replyMode)
    //      AND the keyword bot didn't already take ownership of this message (no double reply).
    //      The LLM engine self-gates on the org `aiAutoReply` flag + budget + an atomic
    //      per-conversation claim, hands off to a human on [ESCALATE].
    // Both replies travel LeadDrive → Chatwoot → TikTok via sendChatwootMessage.
    // Gate on REAL inbound text — `text` falls back to "[attachment]" for media-only
    // messages, and we don't want the bots answering a placeholder.
    const replyMode = (channelConfig.settings as { replyMode?: string } | null)?.replyMode ?? "agent"
    const hasRealText = !!(body?.content || "").trim()
    const runAutoReply = async (inboundText: string) => {
      if (!convId) return
      // Stop talking into a channel that has stopped carrying our words. Both
      // bots below reach the customer through the same Chatwoot inbox, so a
      // provider that refused the last replies will refuse the next one; the
      // only difference another answer makes is a longer silence for the
      // customer and more spend for us. Ahead of both, not just the AI.
      if (await stopAutoReplyForBrokenDelivery({
        orgId,
        conversationId: convId,
        contactName: senderName,
      })) {
        return
      }
      try {
        const { maybeAutoReply, chatbotTookOwnership } = await import("@/lib/chatbot-autoreply")
        const r = await maybeAutoReply({
          orgId, channelType: "tiktok", conversationId: convId,
          contactId: contactId ?? null, inboundText, to: convExternalId,
          channelConfigId: channelConfig.id,
          inboundMessageId: savedMsg.id,
        })
        if (replyMode === "ai" && !chatbotTookOwnership(r)) {
          const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
          const { sendChatwootMessage } = await import("@/lib/chatwoot")
          await maybeAiAutoReply({
            orgId,
            channelConfigId: channelConfig.id,
            platform: "tiktok",
            conversationId: convId,
            pageId: "chatwoot",
            externalId: convExternalId,
            userMessage: inboundText,
            senderName,
            contactId: contactId ?? null,
            inboundMessageId: savedMsg.id,
            send: async (reply) => {
              const sr = await sendChatwootMessage({ conversationId: convExternalId, content: reply, organizationId: orgId, channelConfigId: channelConfig.id })
              if (!sr.success) return sr.deliveryUnknown ? "unknown" : false
              return { ok: true as const, externalId: sr.messageId ?? null }
            },
          }).then((outcome) => {
            if (outcome.skipped) {
              console.info("[Chatwoot Webhook] AI auto-reply outcome", {
                channel: "tiktok",
                outcome: outcome.skipped,
              })
            }
          })
        }
      } catch (e) {
        console.error("[Chatwoot Webhook] auto-reply failed:", e)
      }
    }

    if (replyMode === "ai" && messageType === "audio" && mediaUrl && convId) {
      const { sendChatwootMessage } = await import("@/lib/chatwoot")
      await handleTikTokInboundAudio({
        organizationId: orgId,
        messageId: savedMsg.id,
        audioUrl: mediaUrl,
        metadata: messageMetadata,
        onTranscript: runAutoReply,
        sendFallback: (fallbackText) =>
          sendChatwootMessage({
            conversationId: convExternalId,
            content: fallbackText,
            organizationId: orgId,
            channelConfigId: channelConfig.id,
          }),
      })
    } else if (replyMode === "ai" && unsupportedMedia && convId) {
      const { sendChatwootMessage } = await import("@/lib/chatwoot")
      await sendChatwootMessage({
        conversationId: convExternalId,
        content: INSTAGRAM_AUDIO_TEXT_FALLBACK,
        organizationId: orgId,
        channelConfigId: channelConfig.id,
      })
    } else if (hasRealText && convId) {
      await runAutoReply(text)
    }

    if (contactId) {
      await prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: { lastContactAt: new Date() },
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })

    }) // end runWithTenant (tenant-scoped handler body)
  } catch (err) {
    console.error("[Chatwoot Webhook] Error:", err)
    // Always 200 so Chatwoot doesn't disable the webhook after repeated failures.
    return NextResponse.json({ ok: true })
  }
}

// Chatwoot / health checks may GET the endpoint.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "chatwoot-webhook" })
}
