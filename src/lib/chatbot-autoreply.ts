/**
 * Phase 7 slice-2 — inbound auto-reply orchestration (net-new; the webhooks call
 * `maybeAutoReply` after they persist + link an inbound message — that wiring is the
 * separate shared-edit step).
 *
 * Safety gates (the [P1] requirements):
 *  - per-org ENABLE flag: "chatbotAutoReply" present in `org.features` (a string[] of
 *    enabled flags), OFF by default → nothing fires on prod until a tenant opts in.
 *  - rate-limit / loop-guard: at most ONE auto-reply per conversation per cooldown
 *    window — caps any bot-to-bot or echo loop at 1 reply / window, no storm.
 *  - inbound-only: callers invoke this only on inbound ingest; we never reply to our
 *    own outbound (the recorded auto-reply carries metadata.autoReply, so it's also
 *    excluded from re-triggering by the rate-limit scan).
 */
import { autoReplyOff } from "@/lib/inbox/conversation-auto-reply"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { isChatbotChannelEnabled, matchChatbotRule, type ChatbotRuleLike } from "@/lib/chatbot-engine"
import { maybeCreateQualifiedLeadTask } from "@/lib/inbox/lead-qualification"
import { maybeClassifyCustomerStage } from "@/lib/inbox/customer-stage-classifier"
import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"
import { applySnippetVariables } from "@/lib/inbox/snippet-vars"
import { handOffAfterAutoReply } from "@/lib/inbox/autoreply-handoff"

/** At most one auto-reply per conversation per this window (rate-limit + loop-guard). */
export const AUTOREPLY_COOLDOWN_MS = 5 * 60_000
/** True iff a ChannelMessage's metadata marks it as a bot auto-reply. Pure. */
export function isAutoReply(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).autoReply === true
  )
}

export interface RecentOutbound {
  metadata: unknown
  createdAt: string | Date
}

/**
 * Loop-guard / rate-limit decision (pure). Given the conversation's recent OUTBOUND
 * messages, allow an auto-reply only if NO prior auto-reply landed within the cooldown
 * window. This single rule covers both the rate-limit (≤1/window) and the bot-loop
 * guard (a reply storm can't exceed 1/window per conversation).
 */
export function shouldAutoReply(recentOutbounds: RecentOutbound[], nowMs: number, cooldownMs: number): boolean {
  return !recentOutbounds.some(
    (r) => isAutoReply(r.metadata) && nowMs - new Date(r.createdAt).getTime() < cooldownMs,
  )
}

/** Send a plain-text reply on the conversation's channel: telegram, whatsapp, facebook,
 *  instagram, vkontakte (the social channels that persist a SocialConversation). Mirrors
 *  the per-channel dispatch in inbox/conversations/[id]/messages/route.ts (unify = [P3]). */
export async function sendChannelReply(opts: {
  orgId: string
  channelType: string
  to: string
  text: string
  contactId?: string | null
  /**
   * The config the conversation belongs to. Only the "tiktok" (Chatwoot) case
   * reads it today; without it sendChatwootMessage falls back to "any active
   * chatwoot config for this org" and an org with two of them answers the
   * customer from the wrong Chatwoot account. autonomous-agent-cron has been
   * passing `config.id` here all along — the field just did not exist on this
   * type, so it was dropped silently (TS2353, and the typecheck is advisory).
   */
  channelConfigId?: string | null
}): Promise<{ ok: boolean; error?: string; deliveryUnknown?: boolean }> {
  const { orgId, channelType, to, text, contactId, channelConfigId } = opts
  switch (channelType) {
    case "whatsapp": {
      // skipLog: maybeAutoReply records the single canonical conversation-linked row
      // (with autoReply metadata) — without this, sendWhatsAppMessage's internal log
      // would double-write an orphaned, loop-guard-invisible row.
      const r = await sendWhatsAppMessage({
        to, message: text, organizationId: orgId, contactId: contactId ?? undefined,
        forceText: true, skipLog: true, channelConfigId,
      })
      return { ok: !!r.success, error: r.success ? undefined : (r.error ?? "whatsapp send failed") }
    }
    case "telegram": {
      const ch = await prisma.channelConfig.findFirst({
        where: { organizationId: orgId, channelType: "telegram", isActive: true },
        select: { botToken: true },
      })
      if (!ch?.botToken) return { ok: false, error: "no active telegram bot" }
      // Plain text (no parse_mode) — a user-authored responseText must never be parsed
      // as HTML (avoids parse errors + any markup injection).
      const res = await fetch(`https://api.telegram.org/bot${ch.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: to, text }),
        signal: AbortSignal.timeout(10_000), // don't let a hung Bot API block the webhook
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
      return { ok: !!data?.ok, error: data?.ok ? undefined : (data?.description ?? "telegram send failed") }
    }
    case "facebook":
    case "instagram": {
      // fb/ig share the Meta Graph send; token = ChannelConfig.apiKey, recipient = `to`
      // (the conversation's externalId = psid/igsid). Mirrors messages/route.ts.
      const ch = await prisma.channelConfig.findFirst({
        where: { organizationId: orgId, channelType, isActive: true },
        select: { apiKey: true },
      })
      if (!ch?.apiKey) return { ok: false, error: `no active ${channelType} config (apiKey)` }
      const { sendFacebookMessage, sendInstagramMessage } = await import("@/lib/facebook")
      const ok = channelType === "facebook"
        ? await sendFacebookMessage(to, text, ch.apiKey, orgId)
        : await sendInstagramMessage(to, text, ch.apiKey, orgId)
      return { ok, error: ok ? undefined : `${channelType} send failed` }
    }
    case "vkontakte": {
      const ch = await prisma.channelConfig.findFirst({
        where: { organizationId: orgId, channelType: "vkontakte", isActive: true },
        select: { apiKey: true },
      })
      if (!ch?.apiKey) return { ok: false, error: "no active vkontakte config (apiKey)" }
      const { sendVkMessage } = await import("@/lib/vkontakte")
      const ok = await sendVkMessage(to, text, ch.apiKey)
      return { ok, error: ok ? undefined : "vkontakte send failed" }
    }
    case "tiktok": {
      // TikTok DMs are bridged through Chatwoot (the transport — see webhooks/chatwoot).
      // The reply target `to` is the Chatwoot conversation id (= SocialConversation.externalId);
      // sendChatwootMessage resolves the org's chatwoot ChannelConfig (baseUrl/accountId/apiKey).
      const { sendChatwootMessage } = await import("@/lib/chatwoot")
      const r = await sendChatwootMessage({ conversationId: to, content: text, organizationId: orgId, channelConfigId: channelConfigId ?? null })
      return {
        ok: !!r.success,
        error: r.success ? undefined : (r.error ?? "tiktok (chatwoot) send failed"),
        ...(r.deliveryUnknown ? { deliveryUnknown: true } : {}),
      }
    }
    default:
      return { ok: false, error: `auto-reply not supported for channel "${channelType}" yet` }
  }
}

export interface MaybeAutoReplyResult {
  /** A rule matched the inbound text (regardless of whether we sent). */
  matched: boolean
  /** A reply was actually sent. */
  sent: boolean
  ruleId?: string
  /** Why we didn't send despite a match (for the caller's logs). */
  // "source_reply_detected": preSend said the conversation is no longer
  // unanswered. Deliberately NOT ownership (see chatbotTookOwnership below):
  // the bot did not reply, so the caller is free to carry on — the AI path runs
  // its own preSend and will stand down the same way.
  skipped?: "disabled" | "auto-reply-off" | "no-rule" | "no-conversation" | "rate-limited" | "send-failed" | "send-unknown" | "source_reply_detected"
}

/**
 * Caller contract: the chatbot has TAKEN OWNERSHIP of this inbound (downstream
 * handlers like the whatsapp AI auto-reply should NOT also reply) iff it actually
 * sent, or the transport timed out after a send attempt and delivery is
 * therefore unknown. A cooldown only suppresses another keyword-rule reply;
 * it must leave ownership open so the AI fallback can answer the new turn.
 */
export function chatbotTookOwnership(r: MaybeAutoReplyResult): boolean {
  return r.sent || r.skipped === "send-unknown"
}

/**
 * Whether this inbound is the customer's first message in the conversation — a «первое
 * сообщение» rule answers only that. Callers persist and link the inbound before calling
 * (see the module header), so the conversation holds exactly one inbound then. A failed read is
 * «not first»: a greeting is not worth a guess.
 */
async function isFirstInbound(orgId: string, conversationId: string | null, inboundMessageId?: string | null): Promise<boolean> {
  if (!conversationId) return false
  try {
    const earlier = await prisma.channelMessage.count({
      where: {
        organizationId: orgId,
        conversationId,
        direction: "inbound",
        ...(inboundMessageId ? { NOT: { id: inboundMessageId } } : {}),
      },
    })
    return inboundMessageId ? earlier === 0 : earlier <= 1
  } catch {
    return false
  }
}

/**
 * A rule's reply with the customer's data filled in — the same {{contact.*}} words a saved reply
 * carries («Готовые ответы»), so a reply taken from there reads the same when the bot sends it.
 * The bot has no name of its own: {{agent.name}} is refused when the rule is saved.
 */
async function fillRuleReply(text: string, orgId: string, contactId: string | null | undefined, conversationId: string | null): Promise<string> {
  if (!text.includes("{{")) return text
  const [contact, conversation] = await Promise.all([
    contactId
      ? prisma.contact.findFirst({ where: { id: contactId, organizationId: orgId }, select: { fullName: true, email: true } }).catch(() => null)
      : null,
    conversationId
      ? prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { contactName: true } }).catch(() => null)
      : null,
  ])
  const name = contact?.fullName?.trim() || conversation?.contactName?.trim() || null
  return applySnippetVariables(text, { contact: { name, email: contact?.email ?? null } })
}

function keywordReplyDeliveryKey(opts: {
  orgId: string
  conversationId: string
  inboundMessageId: string
}): string {
  // One stable operation per inbound turn. The payload hash in the shared
  // delivery ledger separately rejects a changed rule/body on a replay.
  return createHash("sha256")
    .update(`chatbot-keyword:v1\0${opts.orgId}\0${opts.conversationId}\0${opts.inboundMessageId}`)
    .digest("hex")
}

/**
 * Decide + (maybe) send an auto-reply for an inbound message. Returns a result the
 * caller uses to decide whether to fall through to other handlers (e.g. the whatsapp
 * AI auto-reply runs only when `matched` is false → no double-reply).
 *
 * NEVER throws to the caller path in practice (DB writes for recording are
 * best-effort); a send failure is reported via `{sent:false, skipped:"send-failed"}`.
 */
export async function maybeAutoReply(opts: {
  orgId: string
  channelType: string
  conversationId: string | null
  contactId?: string | null
  inboundText: string
  to: string
  channelConfigId?: string | null
  inboundMessageId?: string | null
  /**
   * Last check before an irreversible send: "is this conversation still
   * unanswered?". The AI path has had one since ai-autoreply.ts:973 — this one
   * did not, while its only caller (chatwoot-inbound) has been passing
   * `preSend` all along. The field was silently dropped, so a keyword reply had
   * nothing stopping it answering a thread an operator already handled.
   * Returning false skips the send, and a throw is treated as false: if the
   * check itself cannot answer, that is not a licence to send.
   */
  preSend?: () => Promise<boolean>
  nowMs?: number
}): Promise<MaybeAutoReplyResult> {
  const { orgId, channelType, conversationId, contactId, inboundText, to } = opts
  const nowMs = opts.nowMs ?? Date.now()

  // Independent customer lifecycle classifier. It records an AI suggestion and
  // only auto-applies early/non-terminal stages; a human choice is never overwritten.
  await maybeClassifyCustomerStage({
    organizationId: orgId,
    conversationId,
    contactId,
    inboundText,
  }).catch((error: unknown) => console.error("[inbox customer stage] failed:", error))

  // Independent, opt-in commercial qualification. It runs before the chatbot
  // master gate because an organization may want human replies but still create
  // qualified leads/tasks from high-intent inbound messages.
  await maybeCreateQualifiedLeadTask({
    orgId,
    channelType,
    conversationId,
    contactId,
    inboundText,
  }).catch((error: unknown) => console.error("[inbox-qualification] failed:", error))

  // 1. per-org enable flag — OFF by default. `Organization.features` is a STRING ARRAY
  // of enabled flags (e.g. ["whatsapp","ai"]), NOT a JSON object — auto-reply is on iff
  // the array contains "chatbotAutoReply" (toggle via PATCH /api/v1/settings/ai-features,
  // same mechanism as every other feature flag).
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { features: true } })
  const features = org?.features
  if (!isChatbotChannelEnabled(features, channelType)) {
    return { matched: false, sent: false, skipped: "disabled" }
  }
  // «AI rejimi» off for this conversation silences the keyword bot too — not a match, so the
  // caller goes on to the AI path, which refuses the same conversation (conversation-auto-reply).
  if (conversationId && await autoReplyOff(orgId, conversationId)) {
    return { matched: false, sent: false, skipped: "auto-reply-off" }
  }

  // 2. active rules for the org.
  const rules = (await prisma.chatbotRule.findMany({
    where: { organizationId: orgId, status: "active" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  })) as ChatbotRuleLike[]
  if (rules.length === 0) return { matched: false, sent: false, skipped: "no-rule" }

  // 3. match. «First message» is read only when such a rule could fire.
  const greetingRule = rules.some((candidate) => candidate.triggerType === "first_message")
  const isFirstMessage = greetingRule ? await isFirstInbound(orgId, conversationId, opts.inboundMessageId) : false
  const rule = matchChatbotRule(rules, { channelType, text: inboundText, isFirstMessage })
  if (!rule) return { matched: false, sent: false, skipped: "no-rule" }
  const replyText = await fillRuleReply(rule.responseText, orgId, contactId, conversationId)
  const handOff = async () => {
    if (!conversationId || !rule.handoffUserIds?.length) return
    const ruleName = (rule as ChatbotRuleLike & { name?: string }).name ?? ""
    await handOffAfterAutoReply({ orgId, conversationId, ruleName, channelType, handoffUserIds: rule.handoffUserIds })
  }

  // 4. rate-limit / loop-guard — REQUIRES a conversation to scope by. Without one we
  // can't bound replies, so we decline to send (don't take ownership) rather than risk
  // an unguarded storm. TikTok/Chatwoot evaluates this inside its atomic durable claim
  // below, where it can also distinguish a confirmed cooldown from an unknown send.
  if (!conversationId) return { matched: true, sent: false, ruleId: rule.id, skipped: "no-conversation" }
  if (channelType !== "tiktok") {
    const recent = await prisma.channelMessage.findMany({
      where: {
        organizationId: orgId, // explicit multi-tenant scope (conversationId is globally unique, but be explicit)
        conversationId,
        direction: "outbound",
        createdAt: { gte: new Date(nowMs - AUTOREPLY_COOLDOWN_MS) },
      },
      select: { metadata: true, createdAt: true },
    })
    if (!shouldAutoReply(recent, nowMs, AUTOREPLY_COOLDOWN_MS)) {
      return { matched: true, sent: false, ruleId: rule.id, skipped: "rate-limited" }
    }
  }

  // 5. send. Chatwoot is special: its provider call must be preceded by a
  // durable, tenant-bound claim. The claim also repeats the conversation
  // cooldown check under the delivery advisory lock, closing the race where
  // two distinct inbound IDs both passed the read-only check above.
  if (channelType === "tiktok") {
    const inboundMessageId = opts.inboundMessageId?.trim()
    if (!inboundMessageId) {
      return { matched: true, sent: false, ruleId: rule.id, skipped: "send-failed" }
    }

    if (opts.preSend) {
      const sourceStillEligible = await opts.preSend().catch(() => false)
      if (!sourceStillEligible) {
        return { matched: true, sent: false, ruleId: rule.id, skipped: "source_reply_detected" }
      }
    }

    const sendResult = await sendConversationReply({
      organizationId: orgId,
      channel: "tiktok",
      to,
      body: replyText,
      contactId: contactId ?? null,
      conversationId,
      channelConfigId: opts.channelConfigId ?? null,
      extraMetadata: {
        autoReply: true,
        keywordAutoReply: true,
        chatbotRuleId: rule.id,
        chatbotInboundMessageId: inboundMessageId,
      },
      deliveryIdempotency: {
        source: "chatbot",
        key: keywordReplyDeliveryKey({ orgId, conversationId, inboundMessageId }),
      },
      chatwootAutoReplyClaim: {
        inboundMessageId,
        cooldownMs: AUTOREPLY_COOLDOWN_MS,
        nowMs,
      },
    })

    if (!sendResult.success) {
      if (sendResult.deliveryUnknown) {
        // A pending/unknown durable attempt owns the turn: Chatwoot may have
        // accepted it, so neither another keyword retry nor AI fallback is safe.
        return { matched: true, sent: false, ruleId: rule.id, skipped: "send-unknown" }
      }
      if (sendResult.autoReplyCooldown) {
        return { matched: true, sent: false, ruleId: rule.id, skipped: "rate-limited" }
      }
      return { matched: true, sent: false, ruleId: rule.id, skipped: "send-failed" }
    }

    if (sendResult.data.replayed !== true) {
      await prisma.chatbotRule
        .update({ where: { id: rule.id }, data: { matchCount: { increment: 1 } } })
        .catch((e: unknown) => console.error("[chatbot-autoreply] matchCount bump failed:", e))
      await handOff()
    }
    return { matched: true, sent: true, ruleId: rule.id }
  }

  const sendRes = await sendChannelReply({ orgId, channelType, to, text: replyText, contactId, channelConfigId: opts.channelConfigId ?? null })
  if (sendRes.deliveryUnknown) {
    // The provider may have accepted the message. Persist an operator-visible
    // failed/unknown row and take ownership so the AI fallback cannot send a
    // second answer to the same inbound turn.
    await prisma.channelMessage
      .create({
        data: {
          organizationId: orgId,
          channelType,
          direction: "outbound",
          from: "bot",
          to,
          body: replyText,
          status: "failed",
          contactId: contactId ?? undefined,
          conversationId: conversationId ?? undefined,
          metadata: { autoReply: true, chatbotRuleId: rule.id, deliveryUnknown: true },
        },
      })
      .catch((e: unknown) => console.error("[chatbot-autoreply] record unknown outbound failed:", e))
    return { matched: true, sent: false, ruleId: rule.id, skipped: "send-unknown" }
  }
  if (!sendRes.ok) return { matched: true, sent: false, ruleId: rule.id, skipped: "send-failed" }

  // 6. record the outbound + bump matchCount (best-effort — a recording failure must
  // not undo the already-sent reply).
  await prisma.channelMessage
    .create({
      data: {
        organizationId: orgId,
        channelType,
        direction: "outbound",
        from: "bot",
        to,
        body: replyText,
        status: "sent",
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        metadata: { autoReply: true, chatbotRuleId: rule.id },
      },
    })
    .catch((e: unknown) => console.error("[chatbot-autoreply] record outbound failed:", e))
  await prisma.chatbotRule
    .update({ where: { id: rule.id }, data: { matchCount: { increment: 1 } } })
    .catch((e: unknown) => console.error("[chatbot-autoreply] matchCount bump failed:", e))
  // «Потом: передать сотруднику» — only after the reply is out: the customer is never handed
  // to a person in silence, and an unknown delivery above keeps the conversation unassigned.
  await handOff()

  return { matched: true, sent: true, ruleId: rule.id }
}
