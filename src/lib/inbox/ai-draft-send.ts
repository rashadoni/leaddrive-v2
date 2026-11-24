/**
 * Sending or discarding a pending AI reply draft (SocialConversation.metadata.aiDraft) — one path for
 * every place a person decides on it: the inbox screen (api/v1/inbox/conversations/[id]/ai-draft) and
 * the employees' Telegram bot (lib/inbox/ai-draft-telegram, owner 2026-11-24: «я подтверждал, и он
 * отсылал»). So the bot sends through exactly what the screen sends through: the conversation's AI
 * reply lease, the draft re-read under it, sendConversationReply with its channel checks (Meta's 24-hour
 * window included) and one delivery idempotency key per draft — a second press cannot send twice.
 *
 * Who may decide is the caller's business: the route checks the browser session, the bot the linked
 * employee's role and channels.
 */
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { sendConversationReply, type ConversationReplyChannel } from "@/lib/inbox/send-conversation-reply"
import { readConversationAiDraft, clearConversationAiDraft, type ConversationAiDraft } from "@/lib/inbox/ai-draft"
import { claimConversationAiReply, releaseConversationAiReplyClaim } from "@/lib/social/ai-autoreply"

export const DRAFT_SEND_CHANNELS = new Set(["email", "telegram", "sms", "whatsapp", "tiktok", "facebook", "instagram", "vkontakte"])

export type DraftDecider = { userId: string; name: string | null; email: string | null }

export type DraftActionOutcome =
  | { ok: true; discarded: true }
  | { ok: true; discarded?: false; sent: true; edited: boolean; messageId: string; draft: ConversationAiDraft; body: string }
  | {
      ok: false
      status: number
      code: "not_found" | "no_draft" | "busy" | "changed" | "discard_failed" | "attempted" | "already_answered" | "web_chat_missing" | "channel" | "send_failed" | "finalize"
      error: string
      deliveryUnknown?: boolean
    }

export async function decidePendingAiDraft(opts: {
  organizationId: string
  conversationId: string
  decider: DraftDecider
  action: "send" | "discard"
  /** A person's own text instead of the draft's. */
  text?: string
  /** Act only on this draft (the one the person saw), never on a newer one. */
  expectedCreatedAt?: string
  /**
   * Refuse when someone already wrote to the customer after the draft was made (the bot: the person
   * pressing in Telegram did not see the thread, and a second answer on top of a colleague's is worse
   * than none).
   */
  refuseIfAnswered?: boolean
}): Promise<DraftActionOutcome> {
  const { organizationId: orgId, decider } = opts
  const conv = await prisma.socialConversation.findFirst({
    where: { id: opts.conversationId, organizationId: orgId },
    select: { id: true, externalId: true, metadata: true, channelConfigId: true, contactId: true },
  })
  if (!conv) return { ok: false, status: 404, code: "not_found", error: "Not found" }

  const initialDraft = readConversationAiDraft(conv.metadata)
  if (!initialDraft || (opts.expectedCreatedAt && initialDraft.createdAt !== opts.expectedCreatedAt)) {
    return { ok: false, status: 404, code: "no_draft", error: "No pending AI draft" }
  }

  // Serialize both send and discard. Without one shared lease, a discard could
  // report success while a concurrent request was already sending the same
  // draft, or a stale sender could continue after the draft had been removed.
  const claim = await claimConversationAiReply({
    organizationId: orgId,
    conversationId: conv.id,
    holdMs: 10 * 60_000,
    // A person sends (or discards) the draft he read: «AI rejimi» off does not stop that.
    operatorAction: true,
  })
  if (!claim.claimed) return { ok: false, status: 409, code: "busy", error: "This draft is already being processed" }
  const releaseClaim = () => releaseConversationAiReplyClaim({ organizationId: orgId, conversationId: conv.id, token: claim.token })

  // Re-read after acquiring the lease so a request that observed an old draft
  // cannot send it after another worker replaced or cleared it.
  const latest = await prisma.socialConversation.findFirst({
    where: { id: conv.id, organizationId: orgId },
    select: { metadata: true },
  })
  const draft = readConversationAiDraft(latest?.metadata)
  if (!draft || draft.createdAt !== initialDraft.createdAt) {
    await releaseClaim()
    return { ok: false, status: 409, code: "changed", error: "The draft changed while it was being processed" }
  }

  if (opts.action === "discard") {
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (!cleared) return { ok: false, status: 409, code: "discard_failed", error: "The draft could not be discarded safely" }
    await releaseClaim()
    // The cards in Telegram for this draft stop offering buttons (a reply in the CRM does the same
    // from sendConversationReply).
    await import("@/lib/inbox/ai-draft-telegram")
      .then((m) => m.settleAiDraftCards({ organizationId: orgId, conversationId: conv.id, state: "closed" }))
      .catch(() => undefined)
    return { ok: true, discarded: true }
  }

  // send
  const priorAttempt = draft.channel === "web-chat"
    ? await prisma.webChatMessage.findFirst({
        where: {
          sessionId: draft.to,
          metadata: { path: ["aiDraftCreatedAt"], equals: draft.createdAt },
        },
        select: { id: true },
      })
    : await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          conversationId: conv.id,
          direction: "outbound",
          metadata: { path: ["aiDraftCreatedAt"], equals: draft.createdAt },
          OR: [
            { status: { in: ["pending", "sent", "delivered", "read"] } },
            { status: "failed", metadata: { path: ["deliveryUnknown"], equals: true } },
          ],
        },
        select: { id: true },
      })
  if (priorAttempt) {
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (cleared) await releaseClaim()
    return {
      ok: false,
      status: 409,
      code: "attempted",
      error: "This draft already has a delivery attempt. Verify the conversation before retrying.",
      deliveryUnknown: true,
    }
  }
  if (opts.refuseIfAnswered && draft.channel !== "web-chat") {
    const answered = await prisma.channelMessage.findFirst({
      where: {
        organizationId: orgId,
        conversationId: conv.id,
        direction: "outbound",
        createdAt: { gt: new Date(draft.createdAt) },
        status: { in: ["pending", "sent", "delivered", "read"] },
      },
      select: { id: true },
    })
    if (answered) {
      await releaseClaim()
      return { ok: false, status: 409, code: "already_answered", error: "The conversation was answered after the draft" }
    }
  }
  const edited = typeof opts.text === "string" && opts.text.trim() !== "" && opts.text.trim() !== draft.text.trim()
  const body = edited ? opts.text!.trim() : draft.text
  const authorName = decider.name || decider.email || null

  // Web-chat drafts deliver as a widget message (mirrors POST /api/v1/inbox channel=web-chat),
  // not through sendConversationReply (no external transport).
  if (draft.channel === "web-chat") {
    const wcSession = await prisma.webChatSession.findFirst({ where: { id: draft.to, organizationId: orgId } })
    if (!wcSession) {
      await releaseClaim()
      return { ok: false, status: 404, code: "web_chat_missing", error: "Web chat session not found" }
    }
    const message = await prisma.webChatMessage.create({
      data: {
        organizationId: orgId,
        sessionId: draft.to,
        fromRole: edited ? "agent" : "bot",
        authorUserId: decider.userId,
        text: body,
        metadata: {
          aiDraftApproved: true,
          aiDraftReason: draft.reason,
          aiDraftCreatedAt: draft.createdAt,
          aiGenerated: !edited,
          authorType: edited ? "operator" : "ai",
          authorUserId: edited ? decider.userId : null,
          authorName: edited ? authorName : null,
          sentVia: "leaddrive_inbox",
          sentOnBehalfOfCompany: true,
          ...(draft.quality && !edited ? { aiQuality: draft.quality } : {}),
          ...(draft.logId ? { aiLogId: draft.logId } : {}),
        },
      },
    })
    await prisma.webChatSession.update({
      where: { id: draft.to },
      data: { lastMessageAt: new Date(), assignedUserId: wcSession.assignedUserId || decider.userId },
    })
    const cleared = await clearConversationAiDraft({
      organizationId: orgId,
      conversationId: conv.id,
      expectedCreatedAt: draft.createdAt,
      claimToken: claim.token,
    })
    if (!cleared) {
      return { ok: false, status: 409, code: "finalize", error: "Message was sent, but the draft state could not be finalized. Do not retry.", deliveryUnknown: true }
    }
    await releaseClaim()
    return { ok: true, sent: true, edited, messageId: message.id, draft, body }
  }

  if (!DRAFT_SEND_CHANNELS.has(draft.channel)) {
    await releaseClaim()
    return { ok: false, status: 400, code: "channel", error: `Channel "${draft.channel}" cannot be replied from the inbox` }
  }
  const sent = await sendConversationReply({
    organizationId: orgId,
    channel: draft.channel as ConversationReplyChannel,
    to: draft.to,
    body,
    contactId: conv.contactId,
    conversationId: conv.id,
    channelConfigId: conv.channelConfigId,
    telegramParseMode: null,
    deliveryIdempotency: {
      source: "ai-draft",
      key: createHash("sha256")
        .update(`ai-draft:${orgId}:${conv.id}:${draft.createdAt}`)
        .digest("hex"),
    },
    extraMetadata: {
      autoReply: true,
      aiAutoReply: !edited, // edited by a human → no longer an AI-authored message (A4)
      aiDraftApproved: true,
      aiDraftReason: draft.reason,
      aiDraftCreatedAt: draft.createdAt,
      approvedBy: decider.userId,
      ...(edited ? {
        authorType: "operator",
        authorUserId: decider.userId,
        authorName,
      } : {}),
      ...(draft.quality && !edited ? { aiQuality: draft.quality } : {}),
      ...(draft.logId ? { aiLogId: draft.logId } : {}),
    },
  })
  if (!sent.success) {
    if (sent.deliveryUnknown) {
      // The sender recorded a durable deliveryUnknown row. Remove the draft so
      // the review UI cannot turn an ambiguous Chatwoot response into a second
      // automatic/operator POST.
      const cleared = await clearConversationAiDraft({
        organizationId: orgId,
        conversationId: conv.id,
        expectedCreatedAt: draft.createdAt,
        claimToken: claim.token,
      })
      if (cleared) await releaseClaim()
      return { ok: false, status: sent.statusCode, code: "send_failed", error: sent.error, deliveryUnknown: true }
    }
    // Keep the draft — the operator can retry after the channel recovers.
    await releaseClaim()
    return { ok: false, status: sent.statusCode, code: "send_failed", error: sent.error }
  }

  // Confirmed send → persist the assistant turn to AI history (mirrors flow ai_reply #4).
  if (draft.sessionId) {
    await prisma.aiChatMessage
      .create({ data: { sessionId: draft.sessionId, role: "assistant", content: body } })
      .catch(() => {})
  }
  const cleared = await clearConversationAiDraft({
    organizationId: orgId,
    conversationId: conv.id,
    expectedCreatedAt: draft.createdAt,
    claimToken: claim.token,
  })
  if (!cleared) {
    return { ok: false, status: 409, code: "finalize", error: "Message was sent, but the draft state could not be finalized. Do not retry.", deliveryUnknown: true }
  }
  await releaseClaim()
  return { ok: true, sent: true, edited, messageId: sent.data.id, draft, body }
}
