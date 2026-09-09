import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders, isOriginAllowed } from "@/lib/widget-cors"
import { escalateWebChatToTicket } from "@/lib/web-chat-escalate"
import { checkRateLimit } from "@/lib/rate-limit"
import { sendPushToUser } from "@/lib/push-send"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { calculateAiCost, checkConversationAiLimits } from "@/lib/ai/budget"
import { scoreAiResponse, qualityMetadata, type AiQualityMetadata } from "@/lib/ai/response-scorer"
import { decideAiReplyAction, isInAiRollout } from "@/lib/inbox/ai-reply-gate"
import { saveConversationAiDraft } from "@/lib/inbox/ai-draft"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { maybeClassifyCustomerStage } from "@/lib/inbox/customer-stage-classifier"
import {
  OMNICHANNEL_COMMITMENT_RULES,
  detectOmnichannelReplyLocale,
  guardOmnichannelCommitments,
} from "@/lib/inbox/omnichannel-commitment-rules"
import type Anthropic from "@anthropic-ai/sdk"

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, req.headers.get("origin")) })
}

const schema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000),
  lang: z.enum(["en", "ru", "az"]).optional(),
})

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400, headers })

  if (!checkRateLimit(`wc-msg:${parsed.data.sessionId}`, { maxRequests: 30, windowMs: 60000 })) {
    return NextResponse.json({ error: "Too many messages, please slow down" }, { status: 429, headers })
  }

  // RLS phase 1 — org resolution: the visitor's sessionId is a cross-tenant
  // external identifier, so the lookup runs bypass-scoped (resolution only).
  const session = await runWithRlsBypass(() =>
    prisma.webChatSession.findUnique({
      where: { id: parsed.data.sessionId },
    })
  )
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404, headers })

  // Reject messages on closed sessions — visitor must start a new session
  if (session.status === "closed") {
    return NextResponse.json({ error: "Session is closed" }, { status: 410, headers })
  }

  // RLS phase 2 — all remaining handler work runs tenant-scoped (the
  // ensure+notify and push IIFEs, the fire-and-forget auto-escalate and the
  // AI reply all start inside this scope and inherit the tenant context).
  return await runWithTenant(session.organizationId, async () => {
  const widget = await prisma.webChatWidget.findUnique({
    where: { organizationId: session.organizationId },
  })
  if (!widget || !widget.enabled) {
    return NextResponse.json({ error: "Widget disabled" }, { status: 403, headers })
  }
  if (!isOriginAllowed(origin, widget.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  const visitorMsg = await prisma.webChatMessage.create({
    data: {
      organizationId: session.organizationId,
      sessionId: session.id,
      fromRole: "visitor",
      text: parsed.data.text,
    },
  })

  await prisma.webChatSession.update({
    where: { id: session.id },
    data: { lastMessageAt: new Date() },
  })

  // [P3-followup] Ensure a SocialConversation for this web-chat session (keyed w:<sessionId>, matching
  // the inbox GET) + notify the assignee AND every internal participant (collaborators) of the new
  // inbound message — the same fan-out social channels get. Fire-and-forget; the visitor's reply must
  // never wait on it. kind inbox.message → in-app/bell only, never echoed back to the visitor widget.
  ;(async () => {
    try {
      const conv = await ensureConversation(session.organizationId, {
        channel: "web-chat",
        webChatSessionId: session.id,
        contactName: session.visitorName || "Web visitor",
        reopenOnInbound: true,
      })
      await maybeClassifyCustomerStage({
        organizationId: session.organizationId,
        conversationId: conv.id,
        contactId: session.contactId,
        inboundText: parsed.data.text,
      }).catch((error: unknown) =>
        console.error("[web-chat customer stage] classification failed:", error),
      )
      await notifyConversationRecipients(session.organizationId, conv.id, session.assignedUserId ?? null, {
        type: "info",
        title: "New message",
        message: `New web-chat message from ${session.visitorName || "a visitor"}`,
        entityType: "inbox_message",
        entityId: conv.id,
        kind: "inbox.message",
      })
      try {
        const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
        await emitConversationIngestEvents({ organizationId: session.organizationId, conversationId: conv.id, wasCreated: conv.wasCreated })
      } catch (eventError) {
        console.error("[web-chat] conversation flow event failed:", eventError)
      }
    } catch (e) {
      console.error("[web-chat] ensure+notify failed:", e)
    }
  })()

  // Fire web-push to the assigned agent (or all agents if unassigned).
  // Fire-and-forget — never block the visitor's request on push delivery.
  ;(async () => {
    try {
      const visitorName = session.visitorName || session.visitorEmail || "a visitor"
      const preview = parsed.data.text.length > 80 ? parsed.data.text.slice(0, 77) + "…" : parsed.data.text
      const payload = {
        title: `💬 ${visitorName}`,
        body: preview,
        url: `/inbox/web-chat`,
        tag: `ld-webchat-${session.id}`,
      }
      if (session.assignedUserId) {
        await sendPushToUser(session.organizationId, session.assignedUserId, payload)
      } else {
        // Unassigned — notify every admin/manager/support user in the org
        const recipients = await prisma.user.findMany({
          where: { organizationId: session.organizationId, role: { in: ["admin", "manager", "support"] } },
          select: { id: true },
        })
        for (const u of recipients) {
          await sendPushToUser(session.organizationId, u.id, payload)
        }
      }
    } catch (e) {
      console.error("[web-chat] push notify failed:", e)
    }
  })()

  // Auto-escalate: fires once when widget.escalateToTicket=true AND visitor has email on session
  // AND there's no ticket yet. Happens AFTER first real visitor message (not on session start).
  if (widget.escalateToTicket && session.visitorEmail && !session.ticketId) {
    const priorVisitorMsgs = await prisma.webChatMessage.count({
      where: { sessionId: session.id, fromRole: "visitor" },
    })
    // priorVisitorMsgs includes the one we just created, so first-message count = 1
    if (priorVisitorMsgs === 1) {
      escalateWebChatToTicket(session.id, null).catch(e => {
        console.error("[web-chat] auto-escalate failed:", e)
      })
    }
  }

  // Optional AI auto-reply via Da Vinci — skipped when a human has taken over.
  // A3 — audience rollout: the session id is the conversation key, so a visitor's whole
  // dialog is deterministically in or out; excluded sessions burn no tokens.
  let botReply: { id: string; text: string; createdAt: Date } | null = null
  const inRollout = isInAiRollout(
    session.id,
    typeof widget.aiRolloutPercent === "number" ? widget.aiRolloutPercent : null,
  )
  // A6 — per-session reply cap before generation.
  const capVerdict = widget.aiEnabled && !session.aiPaused && inRollout
    ? await checkConversationAiLimits({ orgId: session.organizationId, webChatSessionId: session.id })
    : null
  if (widget.aiEnabled && !session.aiPaused && inRollout && capVerdict?.allowed) {
    try {
      const reply = await generateAiReply(session.organizationId, session.id, parsed.data.text, parsed.data.lang, capVerdict?.limits.maxOutputTokens)
      if (reply) {
        // A2 — send-or-draft gate over the widget policy (aiDraftMode / aiThreshold; both
        // default-off = pre-A2 behavior). A draft parks the reply on the conversation for
        // operator review; the visitor simply doesn't get an instant bot answer.
        // A commitment violation always becomes an operator draft, even when
        // the widget normally auto-sends and regardless of the LLM quality
        // score. The visitor receives neither the unsafe original nor an
        // unverified claim that a human hand-off already happened.
        const decision = reply.forceHandoff
          ? { action: "draft" as const, reason: "commitment_guard" as const }
          : decideAiReplyAction(
              {
                draftMode: widget.aiDraftMode === true,
                aiThreshold: typeof widget.aiThreshold === "number" ? widget.aiThreshold : null,
                aiRolloutPercent: null, // rollout is enforced above, before generation
              },
              reply.quality,
            )
        if (decision.action === "draft") {
          try {
            const conv = await ensureConversation(session.organizationId, {
              channel: "web-chat",
              webChatSessionId: session.id,
              contactName: session.visitorName || "Web visitor",
            })
            await saveConversationAiDraft({
              organizationId: session.organizationId,
              conversationId: conv.id,
              draft: {
                text: reply.text,
                reason: decision.reason,
                quality: reply.quality,
                channel: "web-chat",
                to: session.id,
                logId: reply.logId,
                createdAt: new Date().toISOString(),
                inboundPreview: parsed.data.text.slice(0, 300),
              },
            })
          } catch (e) {
            console.error("[web-chat] AI draft save failed:", e)
          }
        } else {
          const botMsg = await prisma.webChatMessage.create({
            data: {
              organizationId: session.organizationId,
              sessionId: session.id,
              fromRole: "bot",
              text: reply.text,
              // A1 — persist the judge score with the bot message (aiGenerated feeds the A4 badge).
              metadata: { aiGenerated: true, aiQuality: reply.quality, ...(reply.logId ? { aiLogId: reply.logId } : {}) },
            },
          })
          botReply = { id: botMsg.id, text: botMsg.text, createdAt: botMsg.createdAt }
        }
      }
    } catch (e) {
      console.error("[web-chat] AI reply failed:", e)
    }
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        message: {
          id: visitorMsg.id,
          fromRole: visitorMsg.fromRole,
          text: visitorMsg.text,
          createdAt: visitorMsg.createdAt,
        },
        botReply,
      },
    },
    { headers },
  )
  }) // end runWithTenant (tenant-scoped handler body)
}

const SYSTEM_PROMPTS: Record<string, string> = {
  en: "You are a helpful website support assistant. Reply briefly (1-3 sentences) in English. If you cannot resolve the question, politely invite the visitor to leave their email so a human can follow up.",
  ru: "Ты — полезный ассистент поддержки на сайте. Отвечай кратко (1–3 предложения) на русском языке. Если не можешь решить вопрос — вежливо попроси оставить email, чтобы оператор связался.",
  az: "Sən veb-saytın dəstək köməkçisisən. Azərbaycanca qısa (1–3 cümlə) cavab ver. Əgər suala cavab verə bilmirsənsə, nəzakətlə e-poçt buraxmağı xahiş et ki, operator geri zəng etsin.",
}

type AiSupportMessage = {
  role: "user" | "assistant"
  content: string
}

type AiSupportTextBlock = Extract<Anthropic.ContentBlock, { type: "text" }>

function isAiSupportTextBlock(block: Anthropic.ContentBlock): block is AiSupportTextBlock {
  return block.type === "text"
}

async function generateAiReply(
  orgId: string,
  sessionId: string,
  userText: string,
  lang?: "en" | "ru" | "az",
  maxOutputTokens = 400,
): Promise<{ text: string; quality: AiQualityMetadata; logId?: string; forceHandoff: boolean } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const history = await prisma.webChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 20,
  })

  const messages: AiSupportMessage[] = history
    .filter((m: { fromRole: string; text: string }) => m.fromRole !== "bot" || m.text.length < 1500)
    .map((m: { fromRole: string; text: string }) => ({
      role: m.fromRole === "visitor" ? "user" : "assistant",
      content: m.text,
    }))

  if (!messages.length) messages.push({ role: "user", content: userText })

  const piiMasker = new PiiMasker()
  const maskedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    ...m,
    content: typeof m.content === "string" ? piiMasker.mask(m.content) : m.content,
  }))

  try {
    const client = getAnthropicClient({ apiKey })
    const model = "claude-haiku-4-5-20251001"
    const startTime = Date.now()
    const res = await client.messages.create({
      model,
      max_tokens: Math.min(400, maxOutputTokens),
      system: (SYSTEM_PROMPTS[lang || "en"] || SYSTEM_PROMPTS.en) + OMNICHANNEL_COMMITMENT_RULES,
      messages: maskedMessages,
    })
    const generatedText = res.content
      .filter(isAiSupportTextBlock)
      .map(b => piiMasker.unmask(b.text))
      .join("\n")
      .trim()
    const commitmentGuard = guardOmnichannelCommitments(generatedText, {
      customerText: userText,
      locale: detectOmnichannelReplyLocale(userText, lang),
    })
    const text = commitmentGuard.text
    // A1 — judge the reply before the visitor sees it; fail-soft (failure shape is persisted too).
    const scored = text
      ? await scoreAiResponse({ organizationId: orgId, question: userText, response: text, sessionId })
      : null
    // Budget accounting — this generation was invisible to checkAiBudget before A1;
    // without the log the org's daily AI cap never sees web-chat spend.
    const usage = res.usage
    const logRow = await prisma.aiInteractionLog
      .create({
        data: {
          organizationId: orgId,
          sessionId,
          userMessage: userText.slice(0, 500),
          aiResponse: text.slice(0, 1000) || "[empty]",
          latencyMs: Date.now() - startTime,
          promptTokens: usage?.input_tokens ?? 0,
          completionTokens: usage?.output_tokens ?? 0,
          costUsd: calculateAiCost(model, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0),
          model,
          qualityScore: scored?.ok ? scored.score.total : undefined,
        },
      })
      .catch(() => null)
    if (!text || !scored) return null
    return {
      text,
      quality: qualityMetadata(scored),
      logId: logRow?.id,
      forceHandoff: commitmentGuard.forceHandoff,
    }
  } catch (e) {
    console.error("[web-chat] Anthropic error:", e)
    return null
  }
}
