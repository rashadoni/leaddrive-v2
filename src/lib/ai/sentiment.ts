import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"

const SENTIMENT_MODEL = "claude-haiku-4-5-20251001"

export type SentimentLevel = "positive" | "neutral" | "negative_low" | "negative_high"

export interface SentimentResult {
  level: SentimentLevel
  confidence: number
  reasoning: string
  keyPhrases: string[]
}

interface SentimentTextBlock {
  type?: string
  text?: string
}

interface SentimentModelResponse {
  content?: SentimentTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

const ALLOWED_SENTIMENT_LEVELS: SentimentLevel[] = ["positive", "neutral", "negative_low", "negative_high"]

function isAllowedSentimentLevel(value: unknown): value is SentimentLevel {
  return typeof value === "string" && ALLOWED_SENTIMENT_LEVELS.includes(value as SentimentLevel)
}

export async function findTicketsForSentimentCheck(orgId: string, now: Date) {
  const recent = new Date(now.getTime() - 24 * 3600000)
  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["new", "open", "in_progress"] },
      createdAt: { gte: recent },
      escalationLevel: 0,
    },
    select: {
      id: true, organizationId: true, subject: true, description: true,
      ticketNumber: true, priority: true, contactId: true, companyId: true,
    },
    take: 15,
  })
  if (tickets.length === 0) return []

  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_sentiment", "ai_auto_sentiment_shadow"] },
      entityType: "ticket",
      entityId: { in: tickets.map((t: { id: string }) => t.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return tickets.filter((t: { id: string }) => !skip.has(t.id))
}

export async function classifyTicketSentiment(
  ticket: { id: string; organizationId: string; subject: string; description: string | null },
): Promise<SentimentResult | null> {
  const anthropic = getAnthropicClient()

  const prompt = `You are a support-ticket sentiment classifier. Detect when customer is frustrated, angry, or threatening to churn.

Subject: ${ticket.subject}
${ticket.description ? `Description: ${ticket.description.slice(0, 2000)}` : ""}

Levels:
- positive — happy, praising
- neutral — standard request, no emotion
- negative_low — mildly frustrated, inconvenience
- negative_high — angry, threatens to leave, explicit complaint about product/service quality, demands refund, curse words, ALL CAPS

Output STRICT JSON (no markdown, no code fences):
{
  "level": "<one of: positive, neutral, negative_low, negative_high>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1 short sentence in English>",
  "keyPhrases": ["<up to 3 phrases from ticket that support this classification>"]
}`

  const piiMasker = new PiiMasker()
  const maskedPrompt = piiMasker.mask(prompt)
  const start = Date.now()
  let response: SentimentModelResponse
  try {
    response = await anthropic.messages.create({
      model: SENTIMENT_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as SentimentModelResponse
  } catch (e) {
    console.error("Sentiment AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is SentimentTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = piiMasker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<SentimentResult> = {}
  try { parsed = JSON.parse(cleaned) } catch { return null }

  const level: SentimentLevel = isAllowedSentimentLevel(parsed.level) ? parsed.level : "neutral"
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5))
  const reasoning = String(parsed.reasoning || "").slice(0, 240)
  const keyPhrases = Array.isArray(parsed.keyPhrases)
    ? parsed.keyPhrases.filter(p => typeof p === "string").map(p => (p as string).slice(0, 120)).slice(0, 3)
    : []

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(SENTIMENT_MODEL, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: ticket.organizationId,
      userMessage: `sentiment:${ticket.id}`,
      aiResponse: cleaned.slice(0, 1000),
      model: SENTIMENT_MODEL,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  return { level, confidence, reasoning, keyPhrases }
}

export async function writeSentimentShadowAction(
  orgId: string,
  ticket: { id: string; subject: string; ticketNumber: string; contactId: string | null; companyId: string | null },
  sentiment: SentimentResult,
  seniorAssigneeId: string,
  seniorAssigneeName: string,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_sentiment_shadow" : "ai_auto_sentiment",
      entityType: "ticket",
      entityId: ticket.id,
      actionType: "escalate_ticket",
      payload: {
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        sentimentLevel: sentiment.level,
        confidence: sentiment.confidence,
        keyPhrases: sentiment.keyPhrases,
        reasoning: sentiment.reasoning,
        suggestedAssigneeId: seniorAssigneeId,
        suggestedAssigneeName: seniorAssigneeName,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
