import { prisma } from "./prisma"
import { getAnthropicClient } from "./ai/anthropic-client"
import { checkAiBudget, calculateAiCost } from "./ai/budget"
import { PiiMasker } from "./ai/pii-masker"
import { isSupportAiEnabled } from "./ai/support-feature"

export type ComplaintAiResult = {
  riskLevel: "low" | "medium" | "high"
  department: string
  complaintType: "complaint" | "suggestion"
  confidence: number
}

const MODEL = "claude-haiku-4-5-20251001"

// Run the Haiku categorizer and return a structured label. Safe to call
// in the background (caller can `.catch(() => {})`). Silently returns null
// when the AI budget is exhausted or the API fails.
export async function categorizeComplaint(
  orgId: string,
  input: { content: string; brand?: string | null; productCategory?: string | null },
): Promise<ComplaintAiResult | null> {
  if (!(await isSupportAiEnabled(orgId))) return null

  const budget = await checkAiBudget(orgId)
  if (!budget.allowed) return null

  try {
    const anthropic = getAnthropicClient()
    const masker = new PiiMasker()
    const masked = masker.mask(input.content.slice(0, 1500))

    const prompt = `You classify customer complaints for an FMCG / consumer-goods company.
Return ONLY valid JSON (no prose):
{
  "riskLevel": "low" | "medium" | "high",
  "department": "Keyfiyyət nəzarət şöbəsi" | "Marketing departmenti" | "Satış departamenti" | "İstehsal şöbəsi" | "Logistika şöbəsi" | "other",
  "complaintType": "complaint" | "suggestion",
  "confidence": 0.0-1.0
}

Rules:
- Foreign objects, spoilage, health safety → high.
- Late delivery, shortage, missing item → medium.
- Price/packaging opinions → low.
- Suggestion = customer proposing an idea, not complaining.

Brand: ${input.brand || "unknown"}
Product: ${input.productCategory || "unknown"}
Complaint: ${masked}`

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content[0]?.type === "text" ? response.content[0].text : ""
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const p = JSON.parse(m[0])
    const risks = ["low", "medium", "high"] as const
    const types = ["complaint", "suggestion"] as const
    const result: ComplaintAiResult = {
      riskLevel: risks.includes(p.riskLevel) ? p.riskLevel : "medium",
      department: typeof p.department === "string" && p.department.length < 100 ? p.department : "other",
      complaintType: types.includes(p.complaintType) ? p.complaintType : "complaint",
      confidence: typeof p.confidence === "number" ? Math.min(1, Math.max(0, p.confidence)) : 0.5,
    }

    const it = response.usage?.input_tokens || 0
    const ot = response.usage?.output_tokens || 0
    await prisma.aiInteractionLog.create({
      data: {
        organizationId: orgId,
        userMessage: `complaint-categorize: ${input.content.slice(0, 100)}`,
        aiResponse: JSON.stringify(result),
        promptTokens: it,
        completionTokens: ot,
        costUsd: calculateAiCost(MODEL, it, ot),
        model: MODEL,
        agentType: "complaint_categorizer",
        isCopilot: true,
      },
    })
    return result
  } catch (e) {
    console.error("[complaint-ai] categorize failed:", e)
    return null
  }
}

// Background: run categorizer and fill in any gaps on the ComplaintMeta row.
// Never throws — safe to .catch(() => {}) at the call site.
export async function enrichComplaintInBackground(ticketId: string, orgId: string): Promise<void> {
  try {
    const meta = await prisma.complaintMeta.findUnique({
      where: { ticketId },
      include: { ticket: { select: { description: true } } },
    })
    if (!meta?.ticket?.description) return
    // Skip if both fields are already user-provided
    if (meta.riskLevel && meta.responsibleDepartment) return

    const ai = await categorizeComplaint(orgId, {
      content: meta.ticket.description,
      brand: meta.brand,
      productCategory: meta.productCategory,
    })
    if (!ai) return

    await prisma.complaintMeta.update({
      where: { ticketId },
      data: {
        ...(meta.riskLevel ? {} : { riskLevel: ai.riskLevel }),
        ...(meta.responsibleDepartment ? {} : { responsibleDepartment: ai.department === "other" ? null : ai.department }),
      },
    })
  } catch (e) {
    console.error("[complaint-ai] enrich failed:", e)
  }
}
