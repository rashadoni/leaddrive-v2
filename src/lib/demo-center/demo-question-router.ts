import { PiiMasker } from "@/lib/ai/pii-masker"
import { DEMO_PREPARED_INTENTS, DEMO_PREPARED_INTENT_IDS, type DemoPreparedIntent } from "./assistant/prepared-answers"

/**
 * Picks which prepared answer a demo question needs — Jev (TypeSafe AI), a
 * decision model: it chooses one of our options and says how sure it is, and
 * writes no text of its own. Measured 2026-09-29 on 24 prospect questions in
 * Azerbaijani, Russian and English: 24 right, 23 of them at confidence ≥ 0.9,
 * ~0.2 s from prod, the whole run under a tenth of a cent.
 *
 * It only ever saves a Da Vinci call. Below the threshold, on a timeout, an
 * overload, a missing key or any surprise, it returns null and the route asks
 * Da Vinci exactly as it did before this existed — so the prospect waits at
 * most one short timeout longer, never gets a worse answer.
 *
 * The key and the rate limit are shared with the social relevance judge
 * (`src/lib/social/jev-relevance-judge.ts`); the route caps how many prepared
 * answers one session may take, so a scripted session cannot starve it.
 */

const API_URL = process.env.JEV_API_URL ?? "https://api.typesafe.ai/v1/systemone"
const MODEL = process.env.JEV_MODEL ?? "jev-latest"
/** The prospect is waiting for this one; past it, Da Vinci answers. */
const REQUEST_TIMEOUT_MS = 4_000
/** Where the social benchmark measured 99% agreement. */
export const DEMO_JEV_CONFIDENCE = 0.9
/** TypeSafe's price, for the cost recorded next to the answer. */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000

export interface DemoQuestionRoute {
  readonly intent: DemoPreparedIntent
  readonly confidence: number
  readonly inputTokens: number
  readonly costUsd: number
  readonly latencyMs: number
}

export interface DemoRouteContext {
  readonly sectionTitle: string | null
  readonly stepTitle: string | null
}

function request(question: string, context: DemoRouteContext) {
  const masker = new PiiMasker()
  return {
    model: MODEL,
    state: {
      product: "LeadDrive CRM — a guided product demo for a prospect",
      section: context.sectionTitle,
      step: context.stepTitle,
      // A prospect may type a phone number or an address into a question.
      prospect_question: masker.mask(question),
    },
    questions: {
      intent: {
        type: "choice",
        instructions:
          "Which prepared answer does the prospect's question need? Judge by meaning; the question may be in Azerbaijani, Russian or English. "
          + "Choose `other` whenever no option fits exactly — a wrong prepared answer is worse than a slower one.",
        criteria: Object.fromEntries(DEMO_PREPARED_INTENT_IDS.map((id) => [id, DEMO_PREPARED_INTENTS[id].criteria])),
      },
    },
  }
}

async function askOnce(question: string, context: DemoRouteContext, apiKey: string): Promise<DemoQuestionRoute | null | "retry"> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request(question, context)),
      signal: controller.signal,
    })
    if (response.status === 529 || response.status === 429) return "retry"
    if (!response.ok) return null
    const payload = await response.json() as {
      answers?: { intent?: { choice?: unknown; confidence?: unknown } }
      usage?: { input_tokens?: unknown }
    }
    const choice = payload.answers?.intent?.choice
    const confidence = payload.answers?.intent?.confidence
    if (typeof choice !== "string" || !(DEMO_PREPARED_INTENT_IDS as string[]).includes(choice)) return null
    if (typeof confidence !== "number") return null
    const inputTokens = typeof payload.usage?.input_tokens === "number" ? payload.usage.input_tokens : 0
    return {
      intent: choice as DemoPreparedIntent,
      confidence,
      inputTokens,
      costUsd: inputTokens * USD_PER_INPUT_TOKEN,
      latencyMs: Date.now() - started,
    }
  } catch {
    // A timeout is not retried: the prospect has waited long enough, and Da
    // Vinci is the answer from here.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The route for one question, or null — «ask Da Vinci». Never throws, and
 * only returns a route the caller may act on: confident, and naming an
 * intent that has a prepared answer.
 */
export async function routeDemoQuestion(question: string, context: DemoRouteContext): Promise<DemoQuestionRoute | null> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) return null
  let route = await askOnce(question, context, apiKey)
  if (route === "retry") route = await askOnce(question, context, apiKey)
  if (!route || route === "retry") return null
  if (route.confidence < DEMO_JEV_CONFIDENCE) return null
  if (DEMO_PREPARED_INTENTS[route.intent].answer === null) return null
  return route
}
