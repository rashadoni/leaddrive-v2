import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sanitizeLog } from "@/lib/sanitize"
import { readSettingsSecret, webhookSecretMatches } from "@/lib/webhook-secret"
import { upsertSocialConversation } from "@/lib/facebook"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const groupId = String(body.group_id)

    // RLS: this lookup IS the org resolution (VK group id is an external identifier) → bypass scope.
    const channel = await runWithRlsBypass(() =>
      prisma.channelConfig.findFirst({
        where: { pageId: groupId, channelType: "vkontakte", isActive: true },
      })
    )

    if (!channel) return new NextResponse("ok", { status: 200 })

    // F-26: `group_id` is a PUBLIC VK identifier, so it authenticates nothing.
    // Without the check below anyone could inject messages into this tenant's
    // inbox under an arbitrary `from_id`. VK's Callback API sends the secret in
    // the body — the mechanism existed all along and was simply unused.
    //
    // Failure answers a plain 200 "ok" rather than 401: a distinguishable error
    // would let a prober map which group ids are configured here. The log line
    // is the operator-facing half, and it is deliberately loud — a
    // misconfigured secret silently drops real traffic otherwise.
    const expectedSecret = readSettingsSecret(channel.settings, "secret")
    if (!expectedSecret) {
      console.error(
        `[vkontakte] REJECTED: no secret configured for channel ${channel.id}. ` +
        `Set settings.secret on the channel and the same value in the VK community callback settings.`
      )
      return new NextResponse("ok", { status: 200 })
    }
    if (!webhookSecretMatches(typeof body.secret === "string" ? body.secret : null, expectedSecret)) {
      console.warn(`[vkontakte] REJECTED: secret mismatch for group ${sanitizeLog(groupId)}`)
      return new NextResponse("ok", { status: 200 })
    }

    // Confirmation handshake runs AFTER verification: the confirmation code is
    // what proves ownership of this endpoint to VK, and it used to be handed to
    // any caller that guessed a group id.
    if (body.type === "confirmation") {
      const confirmCode = readSettingsSecret(channel.settings, "confirmationCode")
      if (!confirmCode) {
        console.error(`[vkontakte] confirmation requested but no confirmationCode set for channel ${channel.id}`)
        return new NextResponse("ok", { status: 200 })
      }
      return new NextResponse(confirmCode, { status: 200, headers: { "Content-Type": "text/plain" } })
    }

    // RLS: org resolved — ALL remaining handler work runs tenant-scoped.
    return await runWithTenant(channel.organizationId, async () => {

    if (body.type === "message_new") {
      const msg = body.object?.message
      if (!msg) return new NextResponse("ok")
      const userId = String(msg.from_id)
      const text = msg.text || "[attachment]"

      const conv = await upsertSocialConversation(
        channel.organizationId, "vkontakte", userId,
        userId, text, channel.id
      )

      await prisma.channelMessage.create({
        data: {
          organizationId: channel.organizationId,
          channelConfigId: channel.id,
          channelType: "vkontakte",
          direction: "inbound",
          from: userId,
          to: groupId,
          body: text,
          status: "delivered",
          messageType: "text",
          conversationId: conv.id,
          metadata: { userId, groupId, messageId: msg.id },
        },
      })

      // Phase 2b + collaborators — notify the assignee AND every internal participant (deduped).
      notifyConversationRecipients(channel.organizationId, conv.id, conv.assignedTo, {
        type: "info",
        title: "New message",
        message: `New message in VKontakte`,
        entityType: "inbox_message",
        entityId: conv.id,
        kind: "inbox.message",
      }).catch(() => {})
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        await emitConversationIngestEvents({ organizationId: channel.organizationId, conversationId: conv.id, wasCreated: conv.wasCreated })
      } catch (e) {
        console.error("[VK Webhook] conversation flow event failed:", e)
      }

      // Phase 7 slice-2 — inbound chatbot auto-reply (vk). DORMANT unless the org opts
      // in; only on real text (not the [attachment] fallback); isolated try.
      if (msg.text?.trim()) {
        try {
          const { maybeAutoReply, chatbotTookOwnership, sendChannelReply } = await import("@/lib/chatbot-autoreply")
          const r = await maybeAutoReply({
            orgId: channel.organizationId, channelType: "vkontakte",
            conversationId: conv.id, inboundText: text, to: userId,
          })
          // Per-channel AI auto-reply (Y2) — mirrors fb/ig/chatwoot/telegram. Fires only when the
          // channel is "ai" AND the rules bot didn't own; maybeAiAutoReply self-gates on the org
          // aiAutoReply flag + budget + the atomic claim; outbound via the same sendChannelReply.
          const replyMode = (channel.settings as { replyMode?: string } | null)?.replyMode ?? "agent"
          if (replyMode === "ai" && !chatbotTookOwnership(r)) {
            const { maybeAiAutoReply } = await import("@/lib/social/ai-autoreply")
            await maybeAiAutoReply({
              orgId: channel.organizationId, channelConfigId: channel.id, platform: "vkontakte",
              conversationId: conv.id, pageId: groupId, externalId: userId, userMessage: text, senderName: userId, contactId: undefined,
              send: (txt) => sendChannelReply({ orgId: channel.organizationId, channelType: "vkontakte", to: userId, text: txt }).then((res) => res.ok),
            })
          }
        } catch (e) {
          console.error("[VK Webhook] auto-reply failed:", e)
        }
      }
    }
    return new NextResponse("ok", { status: 200 })

    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e) {
    console.error("VK webhook error:", e)
    return new NextResponse("ok", { status: 200 })
  }
}
