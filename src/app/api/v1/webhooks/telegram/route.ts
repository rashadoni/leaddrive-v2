import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sanitizeLog } from "@/lib/sanitize"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { fetchAndStoreTelegramMedia } from "@/lib/telegram-media"
import { matchInboundLeadId } from "@/lib/inbound-lead-match"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

/**
 * Telegram Bot Webhook — receives incoming messages from Telegram.
 * Set webhook via: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://app.leaddrivecrm.org/api/v1/webhooks/telegram?token=<TOKEN>
 */
export async function POST(req: NextRequest) {
  try {
    const botToken = req.nextUrl.searchParams.get("token")
    if (!botToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    // SECURITY: Verify Telegram secret token header if configured
    // (set via setWebhook's secret_token parameter → sent as X-Telegram-Bot-Api-Secret-Token)
    const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (telegramSecret) {
      const headerSecret = req.headers.get("x-telegram-bot-api-secret-token")
      if (headerSecret !== telegramSecret) {
        console.error("[TG Webhook] Invalid secret token — rejecting request")
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    const body = await req.json()
    const message = body.message || body.edited_message
    if (!message) {
      return NextResponse.json({ ok: true }) // ignore non-message updates
    }

    const chatId = String(message.chat.id)

    // Detect inbound media (Slice 2) — Telegram delivers photos/docs/etc as a file_id we must
    // download. Without this a media message with no caption persists as an EMPTY body (blank bubble).
    let mediaFileId: string | null = null
    let mediaPlaceholder = ""
    if (Array.isArray(message.photo) && message.photo.length) {
      mediaFileId = message.photo[message.photo.length - 1]?.file_id ?? null // largest size variant
      mediaPlaceholder = "[Фото]"
    } else if (message.document?.file_id) {
      mediaFileId = message.document.file_id
      mediaPlaceholder = `[Документ: ${message.document.file_name || "file"}]`
    } else if (message.voice?.file_id) {
      mediaFileId = message.voice.file_id; mediaPlaceholder = "[Голосовое сообщение]"
    } else if (message.video?.file_id) {
      mediaFileId = message.video.file_id; mediaPlaceholder = "[Видео]"
    } else if (message.video_note?.file_id) {
      mediaFileId = message.video_note.file_id; mediaPlaceholder = "[Видео-сообщение]"
    } else if (message.audio?.file_id) {
      mediaFileId = message.audio.file_id; mediaPlaceholder = "[Аудио]"
    } else if (message.animation?.file_id) {
      mediaFileId = message.animation.file_id; mediaPlaceholder = "[GIF]"
    } else if (message.sticker?.file_id) {
      mediaFileId = message.sticker.file_id
      mediaPlaceholder = message.sticker.emoji ? `[Стикер ${message.sticker.emoji}]` : "[Стикер]"
    }

    const text = message.text || message.caption || mediaPlaceholder || ""
    const fromUser = message.from
    const senderName = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(" ") || "Unknown"

    // Find channel config by bot token
    // RLS: this lookup IS the org resolution (bot token is an external identifier) → bypass scope.
    const channelConfig = await runWithRlsBypass(() =>
      prisma.channelConfig.findFirst({
        where: { botToken, channelType: "telegram", isActive: true },
      })
    )

    if (!channelConfig) {
      console.log(`[TG Webhook] No active config for bot token ending ...${sanitizeLog(botToken.slice(-6))}`)
      return NextResponse.json({ ok: true })
    }

    const orgId = channelConfig.organizationId

    // RLS: org resolved — ALL remaining handler work runs tenant-scoped.
    return await runWithTenant(orgId, async () => {

    // Download inbound media so the thread renders the real file instead of just "[Фото]".
    // Best-effort — a failure leaves mediaUrl null and the text placeholder stands.
    let mediaUrl: string | null = null
    if (mediaFileId) {
      const stored = await fetchAndStoreTelegramMedia(mediaFileId, botToken, orgId)
      if (stored) mediaUrl = stored.url
    }

    // Try to match telegram sender to an existing contact
    // 1. Check if any previous message from this chatId has a contactId
    // 2. If not, try matching by telegram username in contact notes/phone
    let contactId: string | undefined = undefined

    const prevMsg = await prisma.channelMessage.findFirst({
      where: {
        organizationId: orgId,
        channelType: "telegram",
        contactId: { not: null },
        metadata: { path: ["chatId"], equals: chatId },
      },
      select: { contactId: true },
    })
    if (prevMsg?.contactId) {
      contactId = prevMsg.contactId
    }

    // Slice 3b: for an UNKNOWN sender (no prior message linked a contact), link a
    // matching Lead by Telegram @username so the lead's inbound Telegram surfaces in
    // the lead timeline. Existing contacts skip the lookup (contact precedence).
    const leadId = !contactId
      ? await matchInboundLeadId(orgId, { telegramHandle: fromUser?.username })
      : undefined

    const savedMsg = await prisma.channelMessage.create({
      data: {
        organizationId: orgId,
        channelConfigId: channelConfig.id,
        direction: "inbound",
        channelType: "telegram",
        contactId,
        leadId,
        from: senderName,
        to: "bot",
        body: text,
        mediaUrl: mediaUrl ?? undefined,
        status: "delivered",
        externalId: String(message.message_id),
        metadata: {
          chatId,
          telegramUserId: fromUser?.id,
          username: fromUser?.username,
        },
      },
    })

    // Upsert the social conversation for the unified inbox and link this message
    // to it. Option-D D-2: awaited so conversationId is reliably set (was
    // fire-and-forget). Errors are logged, not swallowed — but never block the
    // 200 we owe Telegram; a failed link just leaves conversationId null and the
    // inbox falls back to heuristic grouping.
    let convId: string | null = null
    try {
      const { upsertSocialConversation } = await import("@/lib/facebook")
      const conv = await upsertSocialConversation(
        orgId, "telegram", chatId,
        senderName, text, channelConfig.id,
      )
      convId = conv.id
      await prisma.channelMessage.update({
        where: { id: savedMsg.id },
        data: { conversationId: conv.id },
      })
      // Phase 2b + collaborators — notify the assignee AND every internal participant (deduped).
      notifyConversationRecipients(orgId, conv.id, conv.assignedTo, {
        type: "info",
        title: "New message",
        message: `New message in Telegram`,
        entityType: "inbox_message",
        entityId: conv.id,
        kind: "inbox.message",
      }).catch(() => {})
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        await emitConversationIngestEvents({ organizationId: orgId, conversationId: conv.id, wasCreated: conv.wasCreated })
      } catch (e) {
        console.error("[TG Webhook] conversation flow event failed:", e)
      }
    } catch (e) {
      console.error("[TG Webhook] SocialConversation link failed:", e)
    }

    // Phase 7 slice-2 — inbound chatbot auto-reply. DORMANT unless the org opts in
    // (features.chatbotAutoReply); isolated try so a failure never blocks the 200.
    if (text.trim()) {
      try {
        const { maybeAutoReply, chatbotTookOwnership, sendChannelReply } = await import("@/lib/chatbot-autoreply")
        const r = await maybeAutoReply({
          orgId, channelType: "telegram", conversationId: convId,
          contactId, inboundText: text, to: chatId,
        })
        // Per-channel AI auto-reply (Y2) — mirrors fb/ig/chatwoot. Fires only when the channel
        // is set to "ai" (matrix) AND the rules bot didn't already own the message. maybeAiAutoReply
        // self-gates on the org `aiAutoReply` flag + budget + the atomic per-conversation claim;
        // outbound goes back via the same sendChannelReply dispatcher the rules bot uses.
        const replyMode = (channelConfig.settings as { replyMode?: string } | null)?.replyMode ?? "agent"
        if (replyMode === "ai" && convId && !chatbotTookOwnership(r)) {
          const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
          await maybeAiAutoReply({
            orgId, channelConfigId: channelConfig.id, platform: "telegram",
            conversationId: convId, pageId: "bot", externalId: chatId, userMessage: text, senderName, contactId,
            send: (txt) => sendChannelReply({ orgId, channelType: "telegram", to: chatId, text: txt, contactId }).then((res) => res.ok),
          })
        }
      } catch (e) {
        console.error("[TG Webhook] auto-reply failed:", e)
      }
    }

    // Update lastContactAt
    if (contactId) {
      await prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: { lastContactAt: new Date() },
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })

    }) // end runWithTenant (tenant-scoped handler body)
  } catch (err) {
    console.error("[TG Webhook] Error:", err)
    return NextResponse.json({ ok: true }) // always 200 to Telegram
  }
}

// Telegram sends GET to verify webhook
export async function GET() {
  return NextResponse.json({ status: "ok", service: "telegram-webhook" })
}
