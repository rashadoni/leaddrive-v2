import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"

const POSITIVE_WORDS = [
  "love", "great", "awesome", "amazing", "excellent", "thank", "best",
  "perfect", "super", "хорош", "отлично", "супер", "əla", "təşəkkür",
]
const NEGATIVE_WORDS = [
  "hate", "bad", "terrible", "worst", "awful", "broken", "sucks",
  "problem", "issue", "плохо", "ужас", "проблема", "pis", "xarab",
]

interface SentimentTextBlock {
  type?: string
  text?: string
}

export type AiSentimentErrorClass =
  | "MISSING_KEY"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTHENTICATION"
  | "UPSTREAM"
  | "INVALID_RESPONSE"
  | "UNKNOWN"

export type AiSentimentResult = {
  sentiment: "positive" | "neutral" | "negative" | null
  errorClass: AiSentimentErrorClass | null
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function classifyAiSentimentError(error: unknown, aborted: boolean): AiSentimentErrorClass {
  const details = errorRecord(error)
  const name = typeof details.name === "string" ? details.name : ""
  const status = typeof details.status === "number" ? details.status : null
  if (aborted || /(?:abort|timeout)/iu.test(name)) return "TIMEOUT"
  if (status === 429) return "RATE_LIMIT"
  if (status === 401 || status === 403) return "AUTHENTICATION"
  if (status !== null && status >= 500) return "UPSTREAM"
  return "UNKNOWN"
}

/**
 * Lexicon-based sentiment. Fast, deterministic, no network. Used as fallback.
 */
export function crudeSentiment(text: string): "positive" | "neutral" | "negative" {
  const lower = text.toLowerCase()
  let score = 0
  for (const w of POSITIVE_WORDS) if (lower.includes(w)) score++
  for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score--
  if (score > 0) return "positive"
  if (score < 0) return "negative"
  return "neutral"
}

/**
 * AI sentiment classification via Anthropic SDK.
 * Returns a typed failure so durable workers can retry without guessing.
 */
export async function aiSentimentDetailed(
  text: string,
  options: { logErrors?: boolean; timeoutMs?: number } = {},
): Promise<AiSentimentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { sentiment: null, errorClass: "MISSING_KEY" }
  if (!text.trim()) return { sentiment: null, errorClass: "INVALID_INPUT" }

  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 45_000, 120_000))
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  timeout.unref?.()

  try {
    // Disable SDK retries here. Callers that need recovery persist their retry
    // state, while the AbortSignal guarantees that a timed-out request does not
    // continue consuming an orphaned provider slot after the cron lease ends.
    const client = getAnthropicClient({ apiKey, timeout: timeoutMs, maxRetries: 0 })
    const truncated = text.length > 1000 ? text.slice(0, 1000) + "…" : text
    const piiMasker = new PiiMasker()
    const maskedText = piiMasker.mask(truncated)
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4,
      system:
        "Classify the sentiment of the text. Respond with exactly one lowercase word: positive, neutral, or negative. No punctuation.",
      messages: [{ role: "user", content: maskedText }],
    }, { signal: abortController.signal })
    const out = res.content
      .map((b) => {
        if (b.type !== "text" || !("text" in b)) return ""
        const text = (b as SentimentTextBlock).text
        return typeof text === "string" ? text : ""
      })
      .join("")
      .trim()
      .toLowerCase()
    if (out === "positive" || out === "neutral" || out === "negative") {
      return { sentiment: out, errorClass: null }
    }
    return { sentiment: null, errorClass: "INVALID_RESPONSE" }
  } catch (e) {
    if (options.logErrors !== false) console.error("[sentiment] AI failed:", e)
    return {
      sentiment: null,
      errorClass: classifyAiSentimentError(e, abortController.signal.aborted),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Backwards-compatible sentiment helper for existing best-effort callers.
 */
export async function aiSentiment(
  text: string,
  options: { logErrors?: boolean; timeoutMs?: number } = {},
): Promise<"positive" | "neutral" | "negative" | null> {
  return (await aiSentimentDetailed(text, options)).sentiment
}

/**
 * Best-effort sentiment: AI first, crude fallback.
 */
export async function classifySentiment(text: string): Promise<"positive" | "neutral" | "negative"> {
  const ai = await aiSentiment(text)
  return ai || crudeSentiment(text)
}
