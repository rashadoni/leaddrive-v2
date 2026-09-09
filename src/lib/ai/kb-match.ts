import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"

const KB_MODEL = "claude-haiku-4-5-20251001"

export interface KbMatchResult {
  articleId: string
  articleTitle: string
  confidence: number
  reasoning: string
}

interface KbMatchTextBlock {
  type?: string
  text?: string
}

interface KbMatchModelResponse {
  content?: KbMatchTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export async function findTicketsForKbMatching(orgId: string, now: Date) {
  const recent = new Date(now.getTime() - 24 * 3600000)
  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      status: "new",
      createdAt: { gte: recent },
    },
    select: {
      id: true, organizationId: true, subject: true, description: true, ticketNumber: true,
    },
    take: 10,
  })
  if (tickets.length === 0) return []

  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_kb_close", "ai_auto_kb_close_shadow"] },
      entityType: "ticket",
      entityId: { in: tickets.map((t: { id: string }) => t.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return tickets.filter((t: { id: string }) => !skip.has(t.id))
}

export async function matchTicketToKb(
  ticket: { id: string; organizationId: string; subject: string; description: string | null },
): Promise<KbMatchResult | null> {
  const articles = await prisma.kbArticle.findMany({
    where: {
      organizationId: ticket.organizationId,
      status: "published",
    },
    select: { id: true, title: true, content: true },
    take: 30,
    orderBy: { viewCount: "desc" },
  })
  if (articles.length === 0) return null

  const anthropic = getAnthropicClient()

  const articleCatalog = articles.map((a: { id: string; title: string; content: string | null }, idx: number) =>
    `[${idx}] ${a.id} — ${a.title}${a.content ? `\n   Summary: ${a.content.slice(0, 200)}` : ""}`
  ).join("\n")

  const prompt = `You match support tickets to the knowledge-base article that most closely answers them.

Ticket subject: ${ticket.subject}
${ticket.description ? `Ticket description: ${ticket.description.slice(0, 1500)}` : ""}

KB articles (pick ONE or none):
${articleCatalog}

Rules:
- Only return a match if the article genuinely solves the customer's question (confidence >= 0.8).
- If nothing fits, return confidence 0 and articleId empty string.
- Prefer exact-feature / exact-error matches over general overviews.

Output STRICT JSON (no markdown, no code fences):
{
  "articleId": "<id or empty string>",
  "articleTitle": "<title copy or empty string>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1 short sentence in English>"
}`

  const piiMasker = new PiiMasker()
  const maskedPrompt = piiMasker.mask(prompt)

  const start = Date.now()
  let response: KbMatchModelResponse
  try {
    response = await anthropic.messages.create({
      model: KB_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as KbMatchModelResponse
  } catch (e) {
    console.error("KB match AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is KbMatchTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = piiMasker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<KbMatchResult> = {}
  try { parsed = JSON.parse(cleaned) } catch { return null }

  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
  const articleId = String(parsed.articleId || "").trim()
  const reasoning = String(parsed.reasoning || "").slice(0, 240)

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(KB_MODEL, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: ticket.organizationId,
      userMessage: `kb_match:${ticket.id}`,
      aiResponse: cleaned.slice(0, 1000),
      model: KB_MODEL,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  // Validate articleId against known set
  const validArticle = articles.find((a: { id: string }) => a.id === articleId)
  if (!validArticle || confidence < 0.8) return null

  return {
    articleId: validArticle.id,
    articleTitle: validArticle.title,
    confidence,
    reasoning,
  }
}

export async function writeKbMatchShadowAction(
  orgId: string,
  ticket: { id: string; subject: string; ticketNumber: string },
  match: KbMatchResult,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_kb_close_shadow" : "ai_auto_kb_close",
      entityType: "ticket",
      entityId: ticket.id,
      actionType: "kb_close_ticket",
      payload: {
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        articleId: match.articleId,
        articleTitle: match.articleTitle,
        confidence: match.confidence,
        reasoning: match.reasoning,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
