import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const RECAP_MODEL = "claude-haiku-4-5-20251001"

export interface MeetingRecapDraft {
  summary: string
  nextSteps: string[]
  matchedDealId: string | null
  matchedContactId: string | null
  matchedCompanyId: string | null
  customerEmail: string | null
  emailSubject: string
  emailBody: string
}

export interface MeetingInput {
  orgId: string
  title: string
  participants: string[]  // email addresses
  transcript: string
  meetingDate: Date
  providerId?: string  // fireflies meetingId / external ref
}

interface RecapTextBlock {
  type?: string
  text?: string
}

interface RecapModelResponse {
  content?: RecapTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export async function processMeetingRecap(input: MeetingInput): Promise<MeetingRecapDraft | null> {
  const { orgId, title, participants, transcript, meetingDate } = input

  // Find CRM-known participants
  const emails = participants.map(e => (e || "").toLowerCase()).filter(Boolean)
  if (emails.length === 0) return null

  const contacts = await prisma.contact.findMany({
    where: { organizationId: orgId, email: { in: emails, mode: "insensitive" }, isActive: true },
    select: { id: true, fullName: true, email: true, companyId: true },
  })
  if (contacts.length === 0) return null  // no CRM participants → skip

  const customerContact = contacts[0]
  const companyId = customerContact.companyId
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(orgId)

  // Look for a relevant deal: most recent non-final deal tied to this contact or company
  const deal = await prisma.deal.findFirst({
    where: {
      organizationId: orgId,
      stage: { notIn: closedStages },
      OR: [
        { contactId: customerContact.id },
        companyId ? { companyId } : {},
      ],
      createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
    },
    select: { id: true, name: true, stage: true, valueAmount: true, currency: true },
    orderBy: { updatedAt: "desc" },
  })

  const anthropic = getAnthropicClient()

  const prompt = `You are a CRM assistant summarizing a sales/support meeting transcript.

Meeting title: ${title}
Date: ${meetingDate.toISOString().slice(0, 10)}
Participants: ${emails.join(", ")}
${deal ? `Linked deal: ${deal.name} (stage: ${deal.stage}, value: ${decimalToNumber(deal.valueAmount)} ${deal.currency || "USD"})` : "No deal context available."}

Transcript:
${transcript.slice(0, 8000)}

Produce STRICT JSON (no markdown, no code fences):
{
  "summary": "<3-5 sentence summary of what was discussed, in English>",
  "nextSteps": ["<concrete next-step action for our team, up to 5 items>"],
  "emailSubject": "<recap email subject line for the customer>",
  "emailBody": "<HTML recap email body, 100-180 words, addressing ${customerContact.fullName} by name. Use <p> tags. Include meeting date, top 3 takeaways, next steps. Professional tone.>"
}`

  const piiMasker = new PiiMasker()
  piiMasker.addKnownNames([customerContact.fullName])
  piiMasker.addKnownCompanies([deal?.name || ""])
  const maskedPrompt = piiMasker.mask(prompt)

  const start = Date.now()
  let response: RecapModelResponse
  try {
    response = await anthropic.messages.create({
      model: RECAP_MODEL,
      max_tokens: 900,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as RecapModelResponse
  } catch (e) {
    console.error("Meeting recap AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is RecapTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = piiMasker.unmask(textBlock?.text ?? "{}")
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<MeetingRecapDraft> = {}
  try { parsed = JSON.parse(cleaned) } catch { return null }

  const summary = String(parsed.summary || "").slice(0, 1500)
  const nextSteps = Array.isArray(parsed.nextSteps)
    ? parsed.nextSteps.filter((s: unknown): s is string => typeof s === "string").map((s) => s.slice(0, 200)).slice(0, 5)
    : []
  const emailSubject = String(parsed.emailSubject || `Meeting recap — ${title}`).slice(0, 200)
  const emailBody = String(parsed.emailBody || `<p>Hi ${customerContact.fullName},</p><p>Thanks for the meeting on ${meetingDate.toISOString().slice(0, 10)}. Summary: ${summary}</p>`).slice(0, 5000)

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(RECAP_MODEL, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: orgId,
      userMessage: `meeting_recap:${input.providerId || title}`,
      aiResponse: cleaned.slice(0, 2000),
      model: RECAP_MODEL,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  return {
    summary,
    nextSteps,
    matchedDealId: deal?.id || null,
    matchedContactId: customerContact.id,
    matchedCompanyId: companyId,
    customerEmail: customerContact.email || null,
    emailSubject,
    emailBody,
  }
}

export async function writeMeetingRecapShadowAction(
  orgId: string,
  input: MeetingInput,
  draft: MeetingRecapDraft,
  now: Date,
  shadow: boolean,
) {
  const entityType = draft.matchedDealId ? "deal" : "contact"
  const entityId = draft.matchedDealId || draft.matchedContactId || ""

  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_meeting_recap_shadow" : "ai_auto_meeting_recap",
      entityType,
      entityId,
      actionType: "send_meeting_recap",
      payload: {
        meetingTitle: input.title,
        meetingDate: input.meetingDate.toISOString(),
        participants: input.participants,
        summary: draft.summary,
        nextSteps: draft.nextSteps,
        customerEmail: draft.customerEmail,
        contactId: draft.matchedContactId,
        dealId: draft.matchedDealId,
        companyId: draft.matchedCompanyId,
        emailSubject: draft.emailSubject,
        emailBody: draft.emailBody,
        providerId: input.providerId || null,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
