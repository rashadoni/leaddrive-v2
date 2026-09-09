import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { PiiMasker } from "@/lib/ai/pii-masker"
import Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { decimalToNumber } from "@/lib/prisma-decimal"

function getGrade(score: number): string {
  if (score >= 80) return "A"
  if (score >= 60) return "B"
  if (score >= 40) return "C"
  if (score >= 20) return "D"
  return "F"
}

const LANG_LABELS: Record<string, Record<string, string>> = {
  en: { strengths: "Strengths", gaps: "Gaps", hasEmail: "has email", hasPhone: "has phone", company: "company identified", strongSource: "strong source", priority: "priority", hasValue: "has estimated value", status: "status", noEmail: "no email", noPhone: "no phone", noNotes: "no notes" },
  ru: { strengths: "Сильные стороны", gaps: "Пробелы", hasEmail: "есть email", hasPhone: "есть телефон", company: "компания указана", strongSource: "сильный источник", priority: "приоритет", hasValue: "есть оценочная стоимость", status: "статус", noEmail: "нет email", noPhone: "нет телефона", noNotes: "нет заметок" },
  az: { strengths: "Güclü tərəflər", gaps: "Boşluqlar", hasEmail: "e-poçt var", hasPhone: "telefon var", company: "şirkət müəyyən edilib", strongSource: "güclü mənbə", priority: "prioritet", hasValue: "təxmini dəyər var", status: "status", noEmail: "e-poçt yoxdur", noPhone: "telefon yoxdur", noNotes: "qeyd yoxdur" },
}

// Localized labels for raw enum values interpolated into the reasoning text.
// Without these, the priority/source/status code values (e.g. "high", "referral",
// "qualified") leak as raw English into otherwise-localized reasoning strings.
const LANG_PRIORITY_VALUES: Record<string, Record<string, string>> = {
  en: { high: "high", medium: "medium", low: "low", urgent: "urgent", critical: "critical" },
  ru: { high: "высокий", medium: "средний", low: "низкий", urgent: "срочный", critical: "критический" },
  az: { high: "yüksək", medium: "orta", low: "aşağı", urgent: "təcili", critical: "kritik" },
}

const LANG_SOURCE_VALUES: Record<string, Record<string, string>> = {
  en: { website: "website", referral: "referral", cold_call: "cold call", linkedin: "LinkedIn", email: "email" },
  ru: { website: "веб-сайт", referral: "реферал", cold_call: "холодный звонок", linkedin: "LinkedIn", email: "email" },
  az: { website: "veb sayt", referral: "referans", cold_call: "soyuq zəng", linkedin: "LinkedIn", email: "email" },
}

const LANG_STATUS_VALUES: Record<string, Record<string, string>> = {
  en: { new: "new", contacted: "contacted", qualified: "qualified", converted: "converted", lost: "lost" },
  ru: { new: "новый", contacted: "связались", qualified: "квалифицирован", converted: "конвертирован", lost: "потерян" },
  az: { new: "yeni", contacted: "əlaqə quruldu", qualified: "kvalifikasiya edildi", converted: "çevrildi", lost: "itirildi" },
}

function localizeValue(map: Record<string, Record<string, string>>, locale: string, value: string | null | undefined): string {
  if (!value) return ""
  const table = map[locale] || map.en
  return table[value] || value
}

const LANG_NAMES: Record<string, string> = { en: "English", ru: "Russian", az: "Azerbaijani" }

const LANG_FALLBACKS: Record<string, { ruleBasedFallback: string; aiComplete: string }> = {
  en: { ruleBasedFallback: "Da Vinci — rule-based analysis", aiComplete: "Da Vinci analysis complete" },
  ru: { ruleBasedFallback: "Da Vinci — анализ на основе правил", aiComplete: "Анализ Da Vinci завершён" },
  az: { ruleBasedFallback: "Da Vinci — qayda əsaslı təhlil", aiComplete: "Da Vinci təhlili tamamlandı" },
}

// Rule-based fallback when no API key
function scoreLeadRuleBased(lead: any, locale: string = "en"): { score: number; factors: Record<string, number>; conversionProb: number; reasoning: string } {
  const factors: Record<string, number> = {}
  let score = 0

  if (lead.email) { factors.email = 15; score += 15 }
  if (lead.phone) { factors.phone = 10; score += 10 }
  if (lead.companyName) { factors.company = 10; score += 10 }
  if (lead.source === "referral") { factors.source = 20; score += 20 }
  else if (lead.source === "website") { factors.source = 15; score += 15 }
  else if (lead.source === "email") { factors.source = 10; score += 10 }
  else if (lead.source) { factors.source = 5; score += 5 }
  if (lead.priority === "high") { factors.priority = 15; score += 15 }
  else if (lead.priority === "medium") { factors.priority = 10; score += 10 }
  else { factors.priority = 5; score += 5 }
  if (lead.estimatedValue && lead.estimatedValue > 0) { factors.value = 10; score += 10 }
  if (lead.status === "qualified") { factors.status = 15; score += 15 }
  else if (lead.status === "contacted") { factors.status = 10; score += 10 }
  else if (lead.status === "converted") { factors.status = 20; score += 20 }
  if (lead.notes && lead.notes.length > 10) { factors.notes = 5; score += 5 }

  score = Math.min(score, 100)
  const conversionProb = Math.round(score * 0.85)

  // Build meaningful reasoning from factors in user's language
  const L = LANG_LABELS[locale] || LANG_LABELS.en
  const positives: string[] = []
  const negatives: string[] = []
  if (factors.email) positives.push(L.hasEmail)
  if (factors.phone) positives.push(L.hasPhone)
  if (factors.company) positives.push(L.company)
  if (factors.source >= 15) positives.push(`${L.strongSource} (${localizeValue(LANG_SOURCE_VALUES, locale, lead.source)})`)
  if (factors.priority >= 10) positives.push(`${localizeValue(LANG_PRIORITY_VALUES, locale, lead.priority)} ${L.priority}`)
  if (factors.value) positives.push(L.hasValue)
  if (factors.status >= 15) positives.push(`${L.status}: ${localizeValue(LANG_STATUS_VALUES, locale, lead.status)}`)
  if (!lead.email) negatives.push(L.noEmail)
  if (!lead.phone) negatives.push(L.noPhone)
  if (!lead.notes || lead.notes.length <= 10) negatives.push(L.noNotes)

  const parts: string[] = []
  if (positives.length > 0) parts.push(`${L.strengths}: ${positives.join(", ")}`)
  if (negatives.length > 0) parts.push(`${L.gaps}: ${negatives.join(", ")}`)
  const fb = LANG_FALLBACKS[locale] || LANG_FALLBACKS.en
  const reasoning = parts.length > 0 ? parts.join(". ") + "." : fb.ruleBasedFallback

  return { score, factors, conversionProb, reasoning }
}

// AI-powered scoring with Claude
async function scoreLeadWithAI(
  client: Anthropic,
  lead: any,
  activities: any[],
  deals: any[],
  locale: string = "en",
): Promise<{ score: number; factors: Record<string, number>; conversionProb: number; reasoning: string }> {
  const leadContext = `
Lead: ${lead.contactName}
Company: ${lead.companyName || "Unknown"}
Email: ${lead.email || "None"}
Phone: ${lead.phone || "None"}
Source: ${lead.source || "Unknown"}
Status: ${lead.status}
Priority: ${lead.priority}
Estimated Value: ${lead.estimatedValue ? `$${lead.estimatedValue}` : "Not set"}
Notes: ${lead.notes || "None"}
Created: ${lead.createdAt}

Activities (${activities.length}):
${activities.length > 0
  ? activities.slice(0, 10).map(a => `- ${a.type}: ${a.subject || a.description || "No details"} (${a.createdAt})`).join("\n")
  : "No activities recorded"}

Related Deals (${deals.length}):
${deals.length > 0
  ? deals.map(d => `- ${d.name}: stage=${d.stage}, value=$${decimalToNumber(d.valueAmount)} ${d.currency}`).join("\n")
  : "No deals"}
`.trim()

  try {
    const piiMasker = new PiiMasker()
    const maskedLeadContext = piiMasker.mask(leadContext)
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `You are a CRM lead scoring Da Vinci for an IT outsourcing company. Analyze this lead and provide a quality score.

${maskedLeadContext}

IMPORTANT: The "reasoning" field MUST be written in ${LANG_NAMES[locale] || "English"} language. Do NOT use English if the requested language is different.

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "score": <0-100 integer>,
  "conversionProb": <0-100 integer, realistic conversion probability>,
  "factors": {
    "contactCompleteness": <0-20>,
    "sourceQuality": <0-20>,
    "engagementLevel": <0-20>,
    "dealPotential": <0-20>,
    "recency": <0-20>
  },
  "reasoning": "<1-2 sentence explanation in ${LANG_NAMES[locale] || "English"}>"
}`
      }],
    })

    const rawText = response.content[0].type === "text" ? response.content[0].text : ""
    const parsed = JSON.parse(piiMasker.unmask(rawText))
    return {
      score: Math.min(100, Math.max(0, parsed.score || 0)),
      factors: parsed.factors || {},
      conversionProb: Math.min(100, Math.max(0, parsed.conversionProb || 0)),
      reasoning: parsed.reasoning || (LANG_FALLBACKS[locale] || LANG_FALLBACKS.en).aiComplete,
    }
  } catch (e) {
    console.error("Da Vinci scoring failed, using rule-based fallback:", e)
    return scoreLeadRuleBased(lead, locale)
  }
}

// GET — list leads with scores
export const GET = withRls(async (_req, { orgId }) => {
  const leads = await prisma.lead.findMany({
    where: { organizationId: orgId },
    orderBy: { score: "desc" },
  })

  return NextResponse.json({
    success: true,
    data: {
      leads: leads.map((l: any) => {
        const details = (l.scoreDetails as any) || {}
        return {
          id: l.id,
          contactName: l.contactName,
          companyName: l.companyName,
          email: l.email,
          phone: l.phone,
          source: l.source,
          status: l.status,
          priority: l.priority,
          score: l.score,
          scoreDetails: l.scoreDetails,
          grade: getGrade(l.score),
          conversionProb: details.conversionProb ?? Math.round(l.score * 0.85),
          reasoning: details.reasoning || null,
          lastScoredAt: l.lastScoredAt,
          estimatedValue: l.estimatedValue,
          notes: l.notes,
          createdAt: l.createdAt.toISOString(),
        }
      }),
      total: leads.length,
    },
  })
})

// POST — score leads with Da Vinci (or rule-based fallback)
export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json().catch(() => ({}))
  const leadId = body.leadId as string | undefined
  const locale = (body.locale as string) || "en"

  const where: any = { organizationId: orgId }
  if (leadId) where.id = leadId

  const leads = await prisma.lead.findMany({ where })

  const apiKey = process.env.ANTHROPIC_API_KEY
  const useAI = !!apiKey
  let client: Anthropic | null = null

  if (useAI) {
    client = getAnthropicClient({ apiKey })
  }

  let scored = 0
  const results: Array<{ id: string; name: string; score: number; grade: string }> = []

  for (const lead of leads) {
    let result: { score: number; factors: Record<string, number>; conversionProb: number; reasoning: string }

    if (useAI && client) {
      // Fetch related data for Da Vinci context
      const [activities, deals] = await Promise.all([
        prisma.activity.findMany({
          where: { organizationId: orgId, relatedType: "lead", relatedId: lead.id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }).catch(() => []),
        prisma.deal.findMany({
          where: { organizationId: orgId },
          take: 5,
        }).catch(() => []),
      ])

      result = await scoreLeadWithAI(client, lead, activities, deals, locale)
    } else {
      result = scoreLeadRuleBased(lead, locale)
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        score: result.score,
        scoreDetails: {
          factors: result.factors,
          conversionProb: result.conversionProb,
          grade: getGrade(result.score),
          reasoning: result.reasoning,
          aiPowered: useAI,
        },
        lastScoredAt: new Date(),
      },
    })

    results.push({ id: lead.id, name: lead.contactName, score: result.score, grade: getGrade(result.score) })
    scored++
  }

  return NextResponse.json({
    success: true,
    data: {
      scored,
      aiPowered: useAI,
      results,
    },
  })
})
