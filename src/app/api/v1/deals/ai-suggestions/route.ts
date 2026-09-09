import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { checkAiBudget, calculateAiCost } from "@/lib/ai/budget"
import { prisma } from "@/lib/prisma"
import { predictDealWin } from "@/lib/ai/predictive"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { getOrgModuleContext } from "@/lib/api-auth"
import { canRead } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"
import { applyRecordFilter } from "@/lib/sharing-rules"

/**
 * AI Deal Suggestions (Copilot mode)
 * GET ?dealId=xxx → 2-3 actionable suggestions based on deal context
 * Used in <AiSuggestions> component on deal detail page.
 */
export const GET = withRlsAuth("deals", "read", async (req, auth) => {
  const { orgId } = auth

  const dealId = new URL(req.url).searchParams.get("dealId")
  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 })

  // Defence in depth: the wrapper enforces deals:read and its Sales module
  // mapping, while these explicit checks keep this endpoint safe if its route
  // scope is ever changed. Do this before any deal/context/provider work.
  if (!canRead(auth.role, "deals")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const orgCtx = await getOrgModuleContext(orgId)
  if (!hasModule(orgCtx, "sales")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const visibleDealWhere = await applyRecordFilter(
      orgId,
      auth.userId,
      auth.role,
      "deal",
      { id: dealId, organizationId: orgId },
    )

    // Gather deal context. Deal links to contacts via DealContactRole (M2M),
    // there is no singular `contact` relation. Pull the first contact role
    // for a best-effort main contact — enough for the AI summary block.
    const deal = await prisma.deal.findFirst({
      where: visibleDealWhere,
      include: {
        company: { select: { name: true } },
        contactRoles: {
          take: 1,
          include: { contact: { select: { fullName: true, email: true } } },
        },
      },
    })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    // Budget/provider work happens only after canonical record sharing has
    // proved the caller may read this deal and its related context.
    const budget = await checkAiBudget(orgId)
    if (!budget.allowed) {
      return NextResponse.json({ error: "Daily AI budget exceeded" }, { status: 429 })
    }

    // Get prediction (graceful degradation if fails)
    let prediction: any = { winProbability: 0, expectedCloseDate: null, riskFactors: [], positiveFactors: [], confidence: 0 }
    try { prediction = await predictDealWin(dealId, orgId) } catch {}

    // Get recent activities
    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId, relatedType: "deal", relatedId: dealId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { type: true, subject: true, createdAt: true },
    })

    // Get recent notes (activity type=note for this deal)
    const notes = await prisma.activity.findMany({
      where: { organizationId: orgId, relatedType: "deal", relatedId: dealId, type: "note" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { description: true, createdAt: true },
    })

    // Count total tasks for this deal
    const taskCount = await prisma.task.count({
      where: { organizationId: orgId, relatedType: "deal", relatedId: dealId, status: { in: ["pending", "in_progress"] } },
    })

    const daysSinceLastActivity = activities[0]
      ? Math.floor((Date.now() - activities[0].createdAt.getTime()) / 86400000)
      : 999

    const dealAge = Math.floor((Date.now() - deal.createdAt.getTime()) / 86400000)

    // Build context for AI
    const context = {
      deal: {
        name: deal.name,
        stage: deal.stage,
        value: decimalToNumber(deal.valueAmount),
        probability: deal.probability,
        company: (deal.company as any)?.name,
        contact: (deal.contactRoles as any)?.[0]?.contact?.fullName,
        dealAgeDays: dealAge,
        daysSinceLastActivity,
        openTasks: taskCount,
      },
      prediction: {
        winProbability: prediction.winProbability,
        riskFactors: prediction.riskFactors.map((f: any) => f.key),
        positiveFactors: prediction.positiveFactors.map((f: any) => f.key),
      },
      recentActivities: activities.map((a: any) => ({ type: a.type, subject: a.subject })),
      recentNotes: notes.map((n: any) => n.description?.slice(0, 100)),
    }

    const piiMasker = new PiiMasker()
    const maskedContext = piiMasker.mask(JSON.stringify(context))

    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are a CRM sales advisor. Based on this deal context, suggest 2-3 specific, actionable next steps. Return ONLY a JSON array of objects with fields: {"action": string, "reason": string, "priority": "high"|"medium"|"low", "type": "call"|"email"|"meeting"|"task"|"update_stage"}

Context:
${maskedContext}`,
        },
      ],
    })

    const text = piiMasker.unmask(response.content[0]?.type === "text" ? response.content[0].text : "")

    // Parse JSON array from response
    let suggestions: any[] = []
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        suggestions = JSON.parse(arrayMatch[0]).slice(0, 3)
      } catch {
        // fallback to empty
      }
    }

    // Log interaction
    const inputTokens = response.usage?.input_tokens || 0
    const outputTokens = response.usage?.output_tokens || 0
    const cost = calculateAiCost("claude-haiku-4-5-20251001", inputTokens, outputTokens)

    await prisma.aiInteractionLog.create({
      data: {
        organizationId: orgId,
        userMessage: `deal_suggestions:${dealId}`,
        aiResponse: JSON.stringify(suggestions).slice(0, 1000),
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        costUsd: cost,
        model: "claude-haiku-4-5-20251001",
        agentType: "deal_advisor",
        isCopilot: true,
      },
    })

    return NextResponse.json({
      data: {
        suggestions,
        prediction: {
          winProbability: prediction.winProbability,
          confidence: prediction.confidence,
          riskFactors: prediction.riskFactors,
          positiveFactors: prediction.positiveFactors,
        },
      },
    })
  } catch (err: any) {
    console.error("AI deal suggestions error:", err)
    return NextResponse.json({ error: "AI suggestions failed" }, { status: 500 })
  }
})
