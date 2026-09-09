// E3.2 — "AI Assist" for the inbox composer (respond.io-style inline compose helper).
// Reuses the shared timeout-bounded Anthropic client + the daily AI budget guard, and
// logs to AiInteractionLog so the spend is visible to checkAiBudget (same accounting as
// the auto-reply bot). Returns PLAIN TEXT (one suggestion), not JSON — the composer just
// drops it into the reply box for the agent to edit before sending.
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { prisma } from "@/lib/prisma"
import { checkAiBudget, calculateAiCost } from "@/lib/ai/budget"
import { buildInboxKbContext } from "@/lib/inbox/kb-context"

const ASSIST_MODEL = "claude-haiku-4-5-20251001"

export type AiAssistAction = "rewrite" | "shorten" | "polite" | "translate" | "suggest"
export const AI_ASSIST_ACTIONS: AiAssistAction[] = ["rewrite", "shorten", "polite", "translate", "suggest"]

export interface AiAssistInput {
  organizationId: string
  action: AiAssistAction
  draft: string // current composer text (may be empty for "suggest")
  lastInbound?: string // last inbound customer message — context, required for "suggest"
  lang?: string // target/output language code (ru | az | en); defaults to en
}

export type AiAssistOutcome =
  | { ok: true; suggestion: string }
  | { ok: false; error: "budget" | "empty_input" | "ai_failed" }

interface AiAssistTextBlock {
  type?: string
  text?: string
}

interface AiAssistModelResponse {
  content?: AiAssistTextBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

function langLabel(lang?: string): string {
  return lang === "ru" ? "Russian" : lang === "az" ? "Azerbaijani" : "English"
}

function buildPrompt(
  action: AiAssistAction,
  draft: string,
  lastInbound: string | undefined,
  label: string,
  kbContext = "",
): string {
  const draftBlock = draft ? `\n\nCurrent draft reply:\n"""${draft.slice(0, 4000)}"""` : ""
  const inboundBlock = lastInbound ? `\n\nThe customer's last message:\n"""${lastInbound.slice(0, 4000)}"""` : ""
  const kbBlock = kbContext ? `\n\nUse this knowledge-base context only when directly relevant:${kbContext}` : ""
  const common = `You are helping a customer-support agent write a chat reply. Output ONLY the resulting message text — no preamble, no quotes, no explanation, no markdown.`

  switch (action) {
    case "rewrite":
      return `${common}\nRewrite the draft to be clearer and more professional. Keep the same meaning and the same language (${label}).${draftBlock}`
    case "shorten":
      return `${common}\nMake the draft shorter and more concise without losing key information. Same language (${label}).${draftBlock}`
    case "polite":
      return `${common}\nRewrite the draft to be warmer, friendlier and more polite, while staying professional. Same language (${label}).${draftBlock}`
    case "translate":
      return `${common}\nTranslate the draft into ${label}. Preserve tone and meaning.${draftBlock}`
    case "suggest":
      return `${common}\nWrite a helpful, concise reply to the customer's last message, in ${label}. Do not invent facts or make promises you can't keep. If knowledge-base context is present and relevant, use it; if it is insufficient, do not pretend it answers the customer.${inboundBlock}${draftBlock}${kbBlock}`
  }
}

/** Whether the action has enough input to run (saves a wasted AI call). */
function hasInput(action: AiAssistAction, draft: string, lastInbound?: string): boolean {
  if (action === "suggest") return Boolean((lastInbound && lastInbound.trim()) || (draft && draft.trim()))
  return Boolean(draft && draft.trim())
}

export async function runAiAssist(input: AiAssistInput): Promise<AiAssistOutcome> {
  const { organizationId, action, draft, lastInbound, lang } = input

  if (!hasInput(action, draft, lastInbound)) return { ok: false, error: "empty_input" }

  // Daily-budget guard — never let compose-assist blow the org's AI budget.
  try {
    const budget = await checkAiBudget(organizationId)
    if (!budget.allowed) return { ok: false, error: "budget" }
  } catch (e) {
    // a failing budget check shouldn't hard-block — the single call below is token-bounded —
    // but warn so a chronically-failing checkAiBudget doesn't silently bypass the guard.
    console.warn("[ai-assist] budget check failed, proceeding token-bounded:", e)
  }

  const kbContext =
    action === "suggest"
      ? await buildInboxKbContext({
          organizationId,
          query: [lastInbound, draft].filter(Boolean).join("\n\n"),
          limit: 3,
        })
      : ""
  const prompt = buildPrompt(action, draft, lastInbound, langLabel(lang), kbContext)
  const piiMasker = new PiiMasker()
  const maskedPrompt = piiMasker.mask(prompt)
  const anthropic = getAnthropicClient()
  const start = Date.now()

  let response: AiAssistModelResponse
  try {
    response = await anthropic.messages.create({
      model: ASSIST_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: maskedPrompt }],
    }) as AiAssistModelResponse
  } catch (e) {
    console.error("AI assist call failed:", e)
    return { ok: false, error: "ai_failed" }
  }

  const textBlock = response.content?.find(
    (block): block is AiAssistTextBlock & { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
  )
  const suggestion = piiMasker.unmask(String(textBlock?.text ?? ""))
    .replace(/^```(?:\w+)?\s*|\s*```$/g, "")
    .trim()
  if (!suggestion) return { ok: false, error: "ai_failed" }

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  // Budget accounting — without this log, checkAiBudget is blind to compose-assist spend.
  await prisma.aiInteractionLog
    .create({
      data: {
        organizationId,
        userMessage: `ai_assist:${action}`,
        aiResponse: suggestion.slice(0, 1000),
        model: ASSIST_MODEL,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        costUsd: calculateAiCost(ASSIST_MODEL, inputTokens, outputTokens),
        latencyMs: Date.now() - start,
        isCopilot: true,
        agentType: "inbox_assist",
      },
    })
    .catch(() => {})

  return { ok: true, suggestion: suggestion.slice(0, 4000) }
}
