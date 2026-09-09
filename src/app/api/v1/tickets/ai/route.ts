import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { isSupportAiEnabled, SUPPORT_AI_DISABLED_ERROR } from "@/lib/ai/support-feature"

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return getAnthropicClient()
}

async function logAiInteraction(
  orgId: string,
  userMessage: string,
  aiResponse: string,
  latencyMs: number,
  model: string,
  usage?: { input_tokens: number; output_tokens: number },
) {
  try {
    const promptTokens = usage?.input_tokens || 0
    const completionTokens = usage?.output_tokens || 0
    const costUsd = (promptTokens * 0.00025 + completionTokens * 0.00125) / 1000 // Haiku pricing

    await prisma.aiInteractionLog.create({
      data: {
        organizationId: orgId,
        userMessage: userMessage.slice(0, 500),
        aiResponse: aiResponse.slice(0, 1000),
        latencyMs,
        promptTokens,
        completionTokens,
        costUsd,
        model,
        isCopilot: true,
      },
    })
  } catch (e) {
    console.error("Failed to log Da Vinci interaction:", e)
  }
}

// Find similar resolved tickets for context
async function findSimilarResolvedTickets(orgId: string, subject: string, category: string, currentTicketId: string, limit = 3): Promise<string> {
  const keywords = subject.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (keywords.length === 0) return ""

  const similar = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      id: { not: currentTicketId },
      status: { in: ["resolved", "closed"] },
      OR: [
        { category },
        ...keywords.map(kw => ({ subject: { contains: kw, mode: "insensitive" as const } })),
      ],
    },
    select: {
      subject: true,
      description: true,
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { comment: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })

  if (similar.length === 0) return ""

  return "\n\n--- SIMILAR RESOLVED TICKETS ---\n" +
    similar.map((t: any, i: number) => {
      const resolution = (t.comments[0] as any)?.comment?.substring(0, 300) || "No resolution comment"
      return `[Resolved #${i + 1}] ${t.subject}\nResolution: ${resolution}`
    }).join("\n\n")
}

// Search KB articles — vector search first, fallback to keyword
async function findRelevantKbArticles(orgId: string, query: string, limit = 3): Promise<string> {
  // Try vector search first (pgvector)
  try {
    const { searchKbByVector } = await import("@/lib/ai/embeddings")
    const vectorResults = await searchKbByVector(orgId, query, limit)
    if (vectorResults.length > 0 && vectorResults[0].similarity > 0.3) {
      return "\n\n--- KNOWLEDGE BASE ARTICLES (semantic match) ---\n" +
        vectorResults.map((r, i) => `[Article ${i + 1}] (${Math.round(r.similarity * 100)}% match)\n${r.content?.substring(0, 800) || ""}`).join("\n\n")
    }
  } catch { /* vector search not available, fallback to text */ }

  // Fallback: keyword search
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  if (keywords.length === 0) return ""

  const articles = await prisma.kbArticle.findMany({
    where: {
      organizationId: orgId,
      status: "published",
      OR: keywords.flatMap(kw => [
        { title: { contains: kw, mode: "insensitive" as const } },
        { content: { contains: kw, mode: "insensitive" as const } },
      ]),
    },
    select: { title: true, content: true },
    take: limit,
  })

  if (articles.length === 0) return ""

  return "\n\n--- KNOWLEDGE BASE ARTICLES ---\n" +
    articles.map((a: any, i: number) => `[Article ${i + 1}] ${a.title}\n${a.content?.substring(0, 800) || ""}`).join("\n\n")
}

// POST /api/v1/tickets/ai?action=reply|summary|steps
export const POST = withRls(async (req, { orgId }) => {
  if (!(await isSupportAiEnabled(orgId))) {
    return NextResponse.json(SUPPORT_AI_DISABLED_ERROR, { status: 403 })
  }

  const body = await req.json()
  const { action, ticketId, lang = "ru" } = body

  const langMap: Record<string, string> = {
    ru: "RUSSIAN",
    az: "AZERBAIJANI",
    en: "ENGLISH",
  }
  const langName = langMap[lang] || "RUSSIAN"

  if (!action || !ticketId) {
    return NextResponse.json({ error: "action and ticketId required" }, { status: 400 })
  }

  try {
    const piiMasker = new PiiMasker()

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, organizationId: orgId },
      include: { comments: { orderBy: { createdAt: "asc" } } },
    })

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    // Build context
    const commentsText = ticket.comments
      .map((c: any) => `[${c.isInternal ? "Internal" : "Customer"}] ${c.comment}`)
      .join("\n")

    const context = piiMasker.mask(`Ticket #${ticket.ticketNumber}: ${ticket.subject}
Status: ${ticket.status} | Priority: ${ticket.priority} | Category: ${ticket.category}
Description: ${ticket.description || "No description"}
Comments:\n${commentsText || "No comments yet"}`)

    const client = getClient()

    if (action === "reply") {
      // Search KB for relevant articles + similar resolved tickets
      const searchQuery = `${ticket.subject} ${ticket.description || ""} ${ticket.category}`
      const [kbContext, similarContext] = await Promise.all([
        findRelevantKbArticles(orgId, searchQuery),
        findSimilarResolvedTickets(orgId, ticket.subject, ticket.category || "general", ticketId),
      ])
      const extraContext = kbContext + similarContext

      if (client) {
        const systemPrompt = extraContext
          ? `You are a professional support agent. You have access to the company's knowledge base articles and similar resolved tickets below. Use them to provide accurate, helpful answers. If the KB articles or resolved tickets contain relevant information, reference them in your reply. ALWAYS reply in ${langName} language regardless of the ticket language. Do not use markdown, write plain text.${extraContext}`
          : `You are a professional support agent. Write a helpful, concise reply to the customer based on the ticket context. ALWAYS reply in ${langName} language regardless of the ticket language. Do not use markdown, write plain text.`

        const t0 = Date.now()
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: "user", content: context }],
        })
        const text = piiMasker.unmask(msg.content[0].type === "text" ? msg.content[0].text : "")
        await logAiInteraction(orgId, `[ticket-reply] ${ticket.subject}`, text, Date.now() - t0, "claude-haiku-4-5-20251001", msg.usage)
        return NextResponse.json({
          success: true,
          data: { text, kbUsed: kbContext.length > 0, similarUsed: similarContext.length > 0 },
        })
      }
      return NextResponse.json({
        success: true,
        data: { text: getFallbackReply(ticket, kbContext), kbUsed: kbContext.length > 0, similarUsed: false },
      })
    }

    if (action === "summary") {
      if (client) {
        const t0 = Date.now()
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: `Summarize this support ticket in 2-3 sentences. Include the main issue, current status, and any key actions taken. ALWAYS write in ${langName} language regardless of the ticket language.`,
          messages: [{ role: "user", content: context }],
        })
        const text = piiMasker.unmask(msg.content[0].type === "text" ? msg.content[0].text : "")
        await logAiInteraction(orgId, `[ticket-summary] ${ticket.subject}`, text, Date.now() - t0, "claude-haiku-4-5-20251001", msg.usage)
        return NextResponse.json({ success: true, data: { text } })
      }
      return NextResponse.json({
        success: true,
        data: { text: getFallbackSummary(ticket) },
      })
    }

    if (action === "steps") {
      if (client) {
        const t0 = Date.now()
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: `Based on this support ticket, suggest 3-5 concrete next steps the support agent should take to resolve it. Write numbered steps. ALWAYS write in ${langName} language regardless of the ticket language.`,
          messages: [{ role: "user", content: context }],
        })
        const text = piiMasker.unmask(msg.content[0].type === "text" ? msg.content[0].text : "")
        await logAiInteraction(orgId, `[ticket-steps] ${ticket.subject}`, text, Date.now() - t0, "claude-haiku-4-5-20251001", msg.usage)
        return NextResponse.json({ success: true, data: { text } })
      }
      return NextResponse.json({
        success: true,
        data: { text: getFallbackSteps(ticket) },
      })
    }

    return NextResponse.json({ error: "Unknown action. Use: reply, summary, steps" }, { status: 400 })
  } catch (e) {
    console.error("Ticket Da Vinci error:", e)
    return NextResponse.json({ error: "Da Vinci request failed" }, { status: 500 })
  }
})

function getFallbackReply(ticket: any, kbContext?: string): string {
  const lang = /[а-яА-Я]/.test(ticket.subject) ? "ru" : "en"
  let reply = ""
  if (lang === "ru") {
    reply = `Здравствуйте!\n\nСпасибо за обращение "${ticket.subject}". Мы приняли ваш запрос и работаем над его решением.\n\nПриоритет: ${ticket.priority}\nКатегория: ${ticket.category}`
  } else {
    reply = `Hello!\n\nThank you for reaching out regarding "${ticket.subject}". We have received your request and are working on resolving it.\n\nPriority: ${ticket.priority}\nCategory: ${ticket.category}`
  }
  if (kbContext) {
    // Extract article titles from KB context
    const articleTitles = kbContext.match(/\[Article \d+\] (.+)/g)?.map(m => m.replace(/\[Article \d+\] /, "")) || []
    if (articleTitles.length > 0) {
      reply += lang === "ru"
        ? `\n\nВозможно вам помогут следующие статьи из базы знаний:\n${articleTitles.map(t => `• ${t}`).join("\n")}`
        : `\n\nThe following knowledge base articles may help:\n${articleTitles.map(t => `• ${t}`).join("\n")}`
    }
  }
  reply += lang === "ru" ? "\n\nМы свяжемся с вами в ближайшее время." : "\n\nWe will follow up shortly."
  return reply
}

function getFallbackSummary(ticket: any): string {
  const commentCount = ticket.comments?.length || 0
  return `Ticket "${ticket.subject}" (${ticket.ticketNumber}) — Status: ${ticket.status}, Priority: ${ticket.priority}, Category: ${ticket.category}. ${commentCount} comment(s). ${ticket.description || "No description provided."}`
}

function getFallbackSteps(ticket: any): string {
  return `1. Review the ticket description and all comments\n2. Check if additional information is needed from the customer\n3. Investigate the ${ticket.category} issue\n4. Provide a resolution or escalate to the appropriate team\n5. Update ticket status and notify the customer`
}
