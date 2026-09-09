import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { calculateAiCost } from "@/lib/ai/budget"
import { decimalToNumber } from "@/lib/prisma-decimal"

const RENEWAL_MODEL = "claude-haiku-4-5-20251001"
const ELIGIBLE_RENEWAL_STATUSES = ["active", "renewing"]
const WINDOW_DAYS_START = 28
const WINDOW_DAYS_END = 32

type ContractWithRefs = Prisma.ContractGetPayload<{
  include: {
    company: { select: { id: true; name: true } }
    contact: { select: { id: true; fullName: true; email: true; preferredLanguage: true } }
  }
}>

async function fetchContractsInWindow(orgId: string, now: Date): Promise<ContractWithRefs[]> {
  const windowStart = new Date(now.getTime() + WINDOW_DAYS_START * 86400000)
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS_END * 86400000)

  return prisma.contract.findMany({
    where: {
      organizationId: orgId,
      status: { in: ELIGIBLE_RENEWAL_STATUSES },
      endDate: { gte: windowStart, lte: windowEnd },
    },
    include: {
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, fullName: true, email: true, preferredLanguage: true } },
    },
  })
}

function languageInstructions(lang: string): { name: string; directive: string } {
  switch (lang) {
    case "ru":
      return { name: "Russian", directive: "Write the email body in Russian (formal business tone). Subject in Russian too." }
    case "az":
      return { name: "Azerbaijani", directive: "Write the email body in Azerbaijani (formal business tone, Latin alphabet). Subject in Azerbaijani too." }
    default:
      return { name: "English", directive: "Write the email body in English (formal business tone). Subject in English too." }
  }
}

export async function findContractsForRenewal(orgId: string, now: Date) {
  const contracts = await fetchContractsInWindow(orgId, now)
  if (contracts.length === 0) return []

  const ids = contracts.map(c => c.id)
  const recent = new Date(now.getTime() - 14 * 86400000)
  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_renewal", "ai_auto_renewal_shadow"] },
      entityType: "contract",
      entityId: { in: ids },
      OR: [{ approved: null }, { reviewedAt: { gte: recent } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return contracts.filter(c => !skip.has(c.id))
}

export interface RenewalDraft {
  proposedValue: number
  reasoning: string
  emailSubject: string
  emailBody: string
}

interface RenewalTextBlock {
  type?: string
  text?: string
}

interface RenewalModelResponse {
  content?: RenewalTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export async function generateRenewalProposal(
  contract: ContractWithRefs,
  orgName: string,
  lang: string = "en",
): Promise<RenewalDraft | null> {
  const anthropic = getAnthropicClient()
  const currentValue = decimalToNumber(contract.valueAmount)
  const currency = contract.currency || "USD"
  const companyName = contract.company?.name || "the client"
  const contactName = contract.contact?.fullName?.trim() || "there"
  const contactEmail = contract.contact?.email || ""
  const endDateIso = contract.endDate ? contract.endDate.toISOString().slice(0, 10) : "soon"
  const langCfg = languageInstructions(lang)

  const prompt = `You are a CRM assistant drafting a contract renewal proposal.

Contract:
- Company: ${companyName}
- Current value: ${currentValue} ${currency}
- Ends: ${endDateIso}
- Type: ${contract.type || "service agreement"}

Contact: ${contactName} <${contactEmail}>

Pricing guidance (be conservative):
- value < 100 → increase 5-8%
- value 100–1000 → increase 3-5%
- value > 1000 → increase 2-3%, round to nearest 100

Language: ${langCfg.directive}

Output STRICT JSON only (no markdown, no code fences):
{
  "proposedValue": <number>,
  "reasoning": "<one short sentence IN ENGLISH, describing the pricing logic for internal review>",
  "emailSubject": "<subject line in ${langCfg.name}>",
  "emailBody": "<HTML email body in ${langCfg.name}, 80–120 words. Address ${contactName} by name. Mention end date, proposed value and currency, call-to-action. Sign as '${orgName}'. Use <p> tags only.>"
}`

  const piiMasker = new PiiMasker()
  piiMasker.addKnownNames([contactName])
  piiMasker.addKnownCompanies([companyName, orgName])
  const maskedPrompt = piiMasker.mask(prompt)

  const start = Date.now()
  let response: RenewalModelResponse
  try {
    response = await anthropic.messages.create({
      model: RENEWAL_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as RenewalModelResponse
  } catch (e) {
    console.error("Renewal AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is RenewalTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = piiMasker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<RenewalDraft> = {}
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = {}
  }

  const fallbackValue = Math.max(1, Math.round(currentValue * 1.05))
  const rawBody = String(parsed.emailBody || defaultEmailBody(contactName, endDateIso, fallbackValue, currency, orgName, lang)).slice(0, 5000)
  const draft: RenewalDraft = {
    proposedValue: Number(parsed.proposedValue) > 0 ? Number(parsed.proposedValue) : fallbackValue,
    reasoning: String(parsed.reasoning || "Standard 5% renewal uplift").slice(0, 240),
    emailSubject: String(parsed.emailSubject || defaultSubject(companyName, lang)).slice(0, 200),
    emailBody: wrapBrandedHtml(rawBody, orgName, lang),
  }

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(RENEWAL_MODEL, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: contract.organizationId,
      userMessage: `renewal_draft:${contract.id}`,
      aiResponse: cleaned.slice(0, 2000),
      model: RENEWAL_MODEL,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  return draft
}

export function wrapBrandedHtml(innerHtml: string, orgName: string, lang: string): string {
  const escapedOrgName = orgName.replace(/[<>&]/g, c => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;")
  const footerNote = lang === "ru"
    ? `Это письмо отправлено от ${escapedOrgName}. Ответьте напрямую, чтобы связаться.`
    : lang === "az"
    ? `Bu məktub ${escapedOrgName} tərəfindən göndərilmişdir. Cavab vermək üçün birbaşa cavablayın.`
    : `This email was sent by ${escapedOrgName}. Reply directly to respond.`
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1a1a1a;background:#ffffff;line-height:1.5;">
  <div style="border-bottom:2px solid #0a0a0a;padding-bottom:16px;margin-bottom:28px;">
    <h2 style="margin:0;color:#0a0a0a;font-size:22px;font-weight:700;letter-spacing:-0.02em;">${escapedOrgName}</h2>
  </div>
  <div style="font-size:15px;color:#1a1a1a;">
${innerHtml}
  </div>
  <div style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:36px;color:#737373;font-size:12px;line-height:1.4;">
    ${footerNote}
  </div>
</div>`
}

export function defaultSubject(companyName: string, lang: string): string {
  if (lang === "ru") return `${companyName} — Предложение о продлении договора`
  if (lang === "az") return `${companyName} — Müqavilənin yenilənməsi təklifi`
  return `${companyName} — Contract Renewal Proposal`
}

export function defaultEmailBody(contactName: string, endDate: string, value: number, currency: string, orgName: string, lang: string) {
  if (lang === "ru") {
    return `<p>Здравствуйте, ${contactName}!</p>
<p>Ваш текущий договор с ${orgName} заканчивается ${endDate}. Мы предлагаем продление на новый срок по цене ${value} ${currency}.</p>
<p>Пожалуйста, ответьте на это письмо для подтверждения или предложите удобное время для короткого звонка.</p>
<p>— ${orgName}</p>`
  }
  if (lang === "az") {
    return `<p>Salam, ${contactName}!</p>
<p>${orgName} ilə mövcud müqaviləniz ${endDate} tarixində başa çatır. Növbəti dövr üçün ${value} ${currency} məbləğində yenilənməni təklif edirik.</p>
<p>Təsdiq üçün bu məktuba cavab verin və ya qısa görüş üçün uyğun vaxtı bildirin.</p>
<p>— ${orgName}</p>`
  }
  return `<p>Hello ${contactName},</p>
<p>Your current agreement with ${orgName} ends on ${endDate}. We'd like to propose renewing at ${value} ${currency} for the next term.</p>
<p>Reply to confirm, or let us know a good time for a quick call to discuss adjustments.</p>
<p>— ${orgName}</p>`
}

export async function writeRenewalShadowAction(
  orgId: string,
  contract: ContractWithRefs,
  draft: RenewalDraft,
  now: Date,
  shadow: boolean,
) {
  const daysUntilEnd = contract.endDate
    ? Math.max(0, Math.floor((contract.endDate.getTime() - now.getTime()) / 86400000))
    : 0

  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_renewal_shadow" : "ai_auto_renewal",
      entityType: "contract",
      entityId: contract.id,
      actionType: "send_renewal_proposal",
      payload: {
        contractNumber: contract.contractNumber,
        contractTitle: contract.title,
        companyId: contract.company?.id || null,
        companyName: contract.company?.name || null,
        contactId: contract.contact?.id || null,
        contactEmail: contract.contact?.email || null,
        currentValue: decimalToNumber(contract.valueAmount),
        proposedValue: draft.proposedValue,
        currency: contract.currency || "USD",
        daysUntilEnd,
        endDate: contract.endDate?.toISOString() || null,
        reasoning: draft.reasoning,
        emailSubject: draft.emailSubject,
        emailBody: draft.emailBody,
        // If not shadow (live mode), mark pre-approved so executor picks it up next run
        ...(shadow ? {} : { autoApproved: true }),
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
