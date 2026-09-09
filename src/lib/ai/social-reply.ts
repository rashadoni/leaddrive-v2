import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { calculateAiCost } from "@/lib/ai/budget"
import {
  findForeignBrandMentions,
  TENANT_RESPONDER_REPLY_PROMPT_VERSION,
} from "@/lib/social/reply-brand-integrity"
import crypto from "node:crypto"

const REPLY_MODEL = "claude-haiku-4-5-20251001"
const PII_PLACEHOLDER_RE = /\[(?:PERSON|COMPANY|EMAIL|PHONE|CARD|IBAN|IP|TAXID|SSN|PASSPORT|TOKEN|CRYPTO|URLCRED|DLIC)_\d+\]/g

export interface SocialReplyDraft {
  reply: string
  tone: "apologetic" | "supportive" | "informative" | "grateful"
  reasoning: string
  snapshot: {
    model: string
    temperature: number
    promptVersion: string
    maskedPromptSha256: string
    inputTokens: number
    outputTokens: number
  }
}

interface SocialReplyTextBlock {
  type?: string
  text?: string
}

interface SocialReplyModelResponse {
  content?: SocialReplyTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

function scrubPublicReplyPlaceholders(reply: string): string {
  return reply
    .replace(/\b(hi|hello|salam|здравствуйте|привет),?\s*\[(?:PERSON|COMPANY)_\d+\],?/gi, "$1,")
    .replace(PII_PLACEHOLDER_RE, "details")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function isSocialReplyTone(value: unknown): value is SocialReplyDraft["tone"] {
  return value === "apologetic" || value === "supportive" || value === "informative" || value === "grateful"
}

export async function findMentionsForReply(orgId: string, now: Date) {
  const recent = new Date(now.getTime() - 24 * 3600000)

  // Target: new negative/neutral mentions on platforms that support replying
  const mentions = await prisma.socialMention.findMany({
    where: {
      organizationId: orgId,
      status: "new",
      createdAt: { gte: recent },
      sentiment: { in: ["negative", "neutral"] },
      platform: { in: ["twitter", "facebook", "instagram"] },
    },
    select: {
      id: true, organizationId: true, platform: true, text: true,
      authorName: true, authorHandle: true, sentiment: true, externalId: true,
    },
    take: 15,
    orderBy: { createdAt: "desc" },
  })
  if (mentions.length === 0) return []

  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_social_reply", "ai_auto_social_reply_shadow"] },
      entityType: "social_mention",
      entityId: { in: mentions.map((m: { id: string }) => m.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return mentions.filter((m: { id: string }) => !skip.has(m.id))
}

export async function draftSocialReply(
  mention: { id: string; organizationId: string; platform: string; text: string; authorName: string | null; authorHandle: string | null; sentiment: string | null },
  responderName: string,
  lang: string = "en",
  persona?: { systemPrompt?: string | null; model?: string | null; temperature?: number | null } | null,
  monitoredSubjectName?: string | null,
  forbiddenResponderNames: string[] = [],
): Promise<SocialReplyDraft | null> {
  const anthropic = getAnthropicClient()

  const langLabel = lang === "ru" ? "Russian" : lang === "az" ? "Azerbaijani" : "English"
  // The org's configured Social agent persona (character/voice) takes priority; the
  // structural rules below still apply as guardrails on top of it.
  const personaPreamble = persona?.systemPrompt?.trim()
    ? `Brand voice and persona to follow:\n${persona.systemPrompt.trim()}\n\n`
    : ""
  const otherResponderNames = forbiddenResponderNames
    .filter(name => name.trim() && name.trim().toLocaleLowerCase() !== responderName.trim().toLocaleLowerCase())
    .slice(0, 50)
  const identityGuard = `Official responder identity: ${responderName}
Monitored subject discussed in the source: ${monitoredSubjectName?.trim() || "not identified"}
You speak ONLY as the official responder identity. The monitored subject is context and may be mentioned, but you must never claim that it is your identity.
${otherResponderNames.length > 0 ? `Other responder identities that MUST NOT appear in the reply: ${otherResponderNames.join(", ")}` : ""}
If the configured persona conflicts with the official responder identity, keep its tone and operating rules but ignore the conflicting identity.`
  const prompt = `${personaPreamble}${identityGuard}

You are a social-media community manager drafting a reply to a brand mention.

Platform: ${mention.platform}
Author: ${mention.authorName || mention.authorHandle || "user"}
Sentiment: ${mention.sentiment || "unknown"}

Mention text:
"${mention.text.slice(0, 1500)}"

Draft a reply that:
- Is under 280 characters (Twitter limit is hard).
- Matches the inferred tone: apologetic for legit complaints, supportive for frustration, informative for questions, grateful for praise.
- Does NOT make promises you can't keep (no "we'll refund", no "it will be fixed today").
- Invites the conversation to move to DM or email if the issue is complex.
- Does NOT repeat personal data, contact details, handles, IDs, or bracket placeholders like [EMAIL_1]. If details are needed, ask for them in DM.
- Never uses hashtags or emojis unless the author used them first.
- Signs with no signature (community-manager style).
- Is written in ${langLabel}.

Output STRICT JSON (no markdown, no code fences):
{
  "reply": "<the reply text>",
  "tone": "<apologetic | supportive | informative | grateful>",
  "reasoning": "<1 short sentence in English describing the strategy>"
}`

  const piiMasker = new PiiMasker()
  piiMasker.addKnownNames([mention.authorName || "", mention.authorHandle || ""])
  const maskedPrompt = piiMasker.mask(prompt)

  const start = Date.now()
  const model = persona?.model?.trim() || REPLY_MODEL
  const temperature = typeof persona?.temperature === "number" ? Math.max(0, Math.min(1, persona.temperature)) : 0.4
  let response: SocialReplyModelResponse
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 500,
      temperature,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as SocialReplyModelResponse
  } catch (e) {
    console.error("Social reply AI call failed:", e)
    return null
  }

  const textBlock = response.content?.find(
    (block): block is SocialReplyTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const raw: string = textBlock?.text ?? "{}"
  const cleaned = raw.replace(/```(?:json)?\s*|\s*```/g, "").trim()

  let parsed: Partial<SocialReplyDraft> = {}
  try { parsed = JSON.parse(cleaned) } catch { return null }

  const reply = scrubPublicReplyPlaceholders(String(parsed.reply || "").trim())
  if (!reply) return null
  const foreignBrandNames = findForeignBrandMentions(reply, responderName, forbiddenResponderNames)
  if (foreignBrandNames.length > 0) {
    console.error("Blocked social reply draft with foreign brand identity", {
      mentionId: mention.id,
      responderName,
      foreignBrandNames,
    })
    return null
  }

  const tone = isSocialReplyTone(parsed.tone) ? parsed.tone : "informative"
  const reasoning = String(parsed.reasoning || "").slice(0, 240)

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  const cost = calculateAiCost(model, inputTokens, outputTokens)

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: mention.organizationId,
      userMessage: `social_reply:${mention.id}`,
      aiResponse: cleaned.slice(0, 1000),
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: cost,
      latencyMs: Date.now() - start,
    },
  }).catch(() => {})

  return {
    reply: reply.slice(0, 280),
    tone,
    reasoning,
    snapshot: {
      model,
      temperature,
      promptVersion: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      maskedPromptSha256: crypto.createHash("sha256").update(maskedPrompt).digest("hex"),
      inputTokens,
      outputTokens,
    },
  }
}

export async function writeSocialReplyShadowAction(
  orgId: string,
  mention: { id: string; platform: string; authorHandle: string | null; authorName: string | null; text: string; sentiment: string | null; externalId: string },
  draft: SocialReplyDraft,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_social_reply_shadow" : "ai_auto_social_reply",
      entityType: "social_mention",
      entityId: mention.id,
      actionType: "post_social_reply",
      payload: {
        platform: mention.platform,
        authorHandle: mention.authorHandle,
        authorName: mention.authorName,
        mentionExcerpt: mention.text.slice(0, 200),
        mentionSentiment: mention.sentiment,
        replyText: draft.reply,
        tone: draft.tone,
        reasoning: draft.reasoning,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
