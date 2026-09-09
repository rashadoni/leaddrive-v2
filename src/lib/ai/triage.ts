import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"

const TRIAGE_MODEL = "claude-haiku-4-5-20251001"

const ALLOWED_CATEGORIES = ["billing", "technical", "onboarding", "complaint", "feature_request", "access", "general"] as const
const ALLOWED_PRIORITIES = ["low", "medium", "high", "urgent"] as const

export interface TriageSuggestion {
  category: (typeof ALLOWED_CATEGORIES)[number]
  priority: (typeof ALLOWED_PRIORITIES)[number]
  tags: string[]
  reasoning: string
}

interface TriageTextBlock {
  type?: string
  text?: string
}

interface TriageModelResponse {
  content?: TriageTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

function isAllowedCategory(value: unknown): value is TriageSuggestion["category"] {
  return typeof value === "string" && (ALLOWED_CATEGORIES as readonly string[]).includes(value)
}

function isAllowedPriority(value: unknown): value is TriageSuggestion["priority"] {
  return typeof value === "string" && (ALLOWED_PRIORITIES as readonly string[]).includes(value)
}

export async function findTicketsNeedingTriage(orgId: string, now: Date) {
  const recent = new Date(now.getTime() - 24 * 3600000)
  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      status: "new",
      createdAt: { gte: recent },
      OR: [
        { category: "general" },
        { category: "" },
      ],
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  })
  if (tickets.length === 0) return []

  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_triage", "ai_auto_triage_shadow"] },
      entityType: "ticket",
      entityId: { in: tickets.map((t: { id: string }) => t.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return tickets.filter((t: { id: string }) => !skip.has(t.id))
}

export async function generateTriageSuggestion(
  ticket: { id: string; organizationId: string; subject: string; description: string | null },
): Promise<TriageSuggestion | null> {
  const anthropic = getAnthropicClient()

  const prompt = `You are a support-ticket triage classifier. Read the ticket and return structured metadata.

Subject: ${ticket.subject}
${ticket.description ? `Description: ${ticket.description.slice(0, 1500)}` : ""}

Categories (pick exactly one):
- billing — invoices, payments, refunds, pricing
- technical — errors, bugs, integration issues, data sync
- onboarding — setup help, first-time config, training questions
- complaint — user explicitly frustrated, threatens to leave, negative sentiment
- feature_request — asking for new capability
- access — login, password, permissions
- general — doesn't fit above

Priorities (pick exactly one):
- urgent — production down, data loss, security, explicit "urgent"
- high — blocking core workflow, many users affected
- medium — standard issue, workaround exists
- low — minor, cosmetic, low impact

Output STRICT JSON (no markdown, no code fences):
{
  "category": "<category>",
  "priority": "<priority>",
  "tags": ["<1-3 lowercase-short-tags>"],
  "reasoning": "<1 short sentence in English describing why this classification>"
}`

  const piiMasker = new PiiMasker()
  const maskedPrompt = piiMasker.mask(prompt)
  const start = Date.now()
  let response: TriageModelResponse
  try {
    response = await anthropic.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as TriageModelResponse
  } catch (e) {
    console.error("Triage AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is TriageTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = piiMasker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<TriageSuggestion> = {}
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return null
  }

  const category = isAllowedCategory(parsed.category) ? parsed.category : "general"
  const priority = isAllowedPriority(parsed.priority) ? parsed.priority : "medium"
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter(t => typeof t === "string").map(t => (t as string).toLowerCase().slice(0, 30)).slice(0, 3)
    : []
  const reasoning = String(parsed.reasoning || "").slice(0, 240)

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(TRIAGE_MODEL, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: ticket.organizationId,
      userMessage: `triage:${ticket.id}`,
      aiResponse: cleaned.slice(0, 1000),
      model: TRIAGE_MODEL,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  return { category, priority, tags, reasoning }
}

export async function writeTriageShadowAction(
  orgId: string,
  ticket: { id: string; subject: string; ticketNumber: string; category: string; priority: string; contactId: string | null; companyId: string | null },
  suggestion: TriageSuggestion,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_triage_shadow" : "ai_auto_triage",
      entityType: "ticket",
      entityId: ticket.id,
      actionType: "triage_ticket",
      payload: {
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        currentCategory: ticket.category,
        currentPriority: ticket.priority,
        suggestedCategory: suggestion.category,
        suggestedPriority: suggestion.priority,
        suggestedTags: suggestion.tags,
        reasoning: suggestion.reasoning,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
