import { prisma } from "@/lib/prisma"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import {
  conversationHasPhone,
  isAiCustomerStage,
  type CustomerStage,
} from "@/lib/inbox/customer-stage"
import { featureFlagsToArray } from "@/lib/modules"

const MODEL = "claude-haiku-4-5-20251001"
const FEATURE_FLAG = "inbox-customer-segmentation"

type StageDecision = {
  stage: CustomerStage | "unclassified"
  confidence: number
  reason: string
}

function parseDecision(text: string): StageDecision | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    const value = JSON.parse(cleaned) as Partial<StageDecision>
    const stage = value.stage === "unclassified" || isAiCustomerStage(value.stage)
      ? value.stage
      : null
    if (!stage || typeof value.confidence !== "number" || typeof value.reason !== "string") return null
    return {
      stage,
      confidence: Math.max(0, Math.min(1, value.confidence)),
      reason: value.reason.trim().replace(/\s+/g, " ").slice(0, 600),
    }
  } catch {
    return null
  }
}

async function classify(text: string, hasPhone: boolean): Promise<StageDecision | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const masked = new PiiMasker()
    .mask(text)
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, "[PHONE]")
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 220,
      temperature: 0,
      system: `Classify the latest inbound CRM conversation into exactly one stage:
- interested: asks a real question about a product/service, price, size, difference, credit, availability or characteristics, but has not supplied a phone number;
- potential: genuine commercial interest AND a usable phone number is present;
- no_result: clearly spam, job solicitation, abusive/testing content, or explicitly not interested;
- unclassified: greeting, ambiguous fragment, support-only request, or insufficient evidence.
Understand Azerbaijani/Russian/English transliteration and misspellings (for example ölçü, olcu, olchu all mean size).
Never choose potential when HAS_PHONE=false. Do not invent facts.
Return JSON only: {"stage":"interested|potential|no_result|unclassified","confidence":0.0,"reason":"short Azerbaijani explanation"}`,
      messages: [{
        role: "user",
        content: `HAS_PHONE=${hasPhone ? "true" : "false"}\nMESSAGES:\n${masked.slice(0, 6000)}`,
      }],
    })
    const content = response.content[0]
    return content?.type === "text" ? parseDecision(content.text) : null
  } catch (error) {
    console.error("[inbox customer stage] classification failed:", error)
    return null
  }
}

export async function maybeClassifyCustomerStage(input: {
  organizationId: string
  conversationId: string | null
  contactId?: string | null
  inboundText: string
}): Promise<{ applied: boolean; stage?: CustomerStage; reason: string }> {
  if (!input.conversationId) return { applied: false, reason: "no-conversation" }
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { features: true },
  })
  if (!featureFlagsToArray(org?.features).includes(FEATURE_FLAG)) {
    return { applied: false, reason: "disabled" }
  }

  const conversation = await prisma.socialConversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: {
      id: true,
      contactId: true,
      metadata: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { direction: true, body: true, from: true },
      },
    },
  })
  if (!conversation) return { applied: false, reason: "not-found" }
  const contactId = input.contactId ?? conversation.contactId
  const contact = contactId
    ? await prisma.contact.findFirst({
        where: { id: contactId, organizationId: input.organizationId },
        select: { phone: true, phones: true },
      })
    : null
  const hasPhone = conversationHasPhone({
    contactPhone: contact?.phone || contact?.phones?.[0] || null,
    metadata: conversation.metadata,
  }) || conversation.messages.some((message: { from: string; body: string }) =>
    /\d{7,}/.test(`${message.from} ${message.body}`.replace(/\D/g, "")),
  )
  const context = conversation.messages
    .slice()
    .reverse()
    .map((message: { direction: string; body: string }) => `${message.direction === "inbound" ? "CUSTOMER" : "AGENT"}: ${message.body}`)
    .concat(`CUSTOMER: ${input.inboundText}`)
    .join("\n")
  const decision = await classify(context, hasPhone)
  if (!decision) return { applied: false, reason: "classification-unavailable" }
  if (decision.stage === "unclassified") return { applied: false, reason: "unclassified" }
  const safeStage = decision.stage === "potential" && !hasPhone ? "interested" : decision.stage

  await prisma.socialConversation.updateMany({
    where: { id: conversation.id, organizationId: input.organizationId },
    data: {
      aiSuggestedCustomerStage: safeStage,
      aiCustomerStageConfidence: decision.confidence,
      aiCustomerStageReason: decision.reason,
      aiCustomerStageSuggestedAt: new Date(),
    },
  })
  // AI is advisory only. Marketing contact is recorded from an actual Inbox
  // reply, while sales qualification is confirmed manually on the Lead after
  // the phone call. Never turn model confidence into a human action.
  return { applied: false, stage: safeStage, reason: "suggestion-only" }
}

export const INBOX_CUSTOMER_SEGMENTATION_FLAG = FEATURE_FLAG
