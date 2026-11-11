/**
 * What an AI call costs, for every model the gateway meters. The one price
 * table: `calculateAiCost` in `src/lib/ai/budget.ts` reads it too.
 */

/** USD per million tokens. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  // Opus 4.6 and 4.8 cost $5 / $25 (Anthropic price list, checked 2026-11-09);
  // $15 / $75 was Opus 4 / 4.1.
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  // Current Anthropic aliases (sonnet/opus aliases carry no date suffix).
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  // Other providers, list prices as published by third-party price trackers
  // on 2026-11-10 (the providers' own pages could not be read then) — check
  // before relying on them for billing:
  // Gemini 3.8 Flash: introductory $0.75 / $3.75, to $1.50 / $7.50 from 2027-01-01.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  // GPT-5.6 Luna after the 2026-07-30 price cut.
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  // Voyage voyage-3-lite: input only.
  "voyage-3-lite": { input: 0.02, output: 0 },
}

/**
 * What a call billed by time or by item costs, in USD — same sources and
 * date as above. Gemini Live is billed in audio tokens (25 a second; $3 in,
 * $12 out per million): a minute of conversation is priced as if both sides
 * spoke all of it, an estimate from above. Gemini speech output ($10 per
 * million audio tokens) likewise.
 */
export const UNIT_PRICING = {
  /** OpenAI whisper-1, per minute of audio. */
  whisperMinute: 0.006,
  /** Google Speech-to-Text v2 chirp_3 (standard tier), per minute of audio. */
  chirpMinute: 0.016,
  /** Gemini Live conversation, per minute of session. */
  geminiLiveMinute: 0.0225,
  /**
   * A phone order line call in Gemini Live, per minute, for a call the station
   * sent no token count for. Far above `geminiLiveMinute`: every turn bills the
   * line's whole prompt and catalog context again. Four line-stand calls priced
   * from their own `usageMetadata` (2026-11-06..07, LIVE_TOKEN_PRICING): $0.081
   * for 62 s, $0.11 for 53 s, $0.153 for 107 s, $0.78 for 198 s — $0.078 to
   * $0.236 a minute, growing with the call; their mean.
   */
  phoneLineLiveMinute: 0.13,
  /** Gemini / Vertex speech synthesis, per minute of speech produced. */
  geminiSpeechMinute: 0.015,
  /** Google Vision TEXT_DETECTION, per image. */
  visionImage: 0.0015,
} as const

/**
 * Gemini Live (gemini-3.8-live), USD per million tokens — the phone line's
 * table (ai.google.dev/gemini-api/docs/pricing, read 2026-11-04 for
 * scripts/zeytun-line/stand-crm.ts). Every turn bills the whole context.
 */
export const LIVE_TOKEN_PRICING = { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 } as const

export function liveUsageCostUsd(tokens: { textIn: number; audioIn: number; textOut: number; audioOut: number }): number {
  return (tokens.textIn * LIVE_TOKEN_PRICING.textIn + tokens.audioIn * LIVE_TOKEN_PRICING.audioIn
    + tokens.textOut * LIVE_TOKEN_PRICING.textOut + tokens.audioOut * LIVE_TOKEN_PRICING.audioOut) / 1_000_000
}

/** The least a connected Live minute costs: its incoming audio once (25 tokens a second at the audio-in price). */
export const LIVE_AUDIO_IN_MINUTE_USD = 25 * 60 * LIVE_TOKEN_PRICING.audioIn / 1_000_000

export function perMinuteCostUsd(pricePerMinute: number, seconds: number): number {
  return Math.max(0, seconds) / 60 * pricePerMinute
}

/** A model nobody priced is counted at the Haiku price, as it always was. */
const UNPRICED = MODEL_PRICING["claude-haiku-4-5-20251001"]

/**
 * The price of a model id as the provider answers it: exact, or the longest
 * priced id it starts with — OpenAI answers "gpt-5.6-luna-2026-07-30" for a
 * request to "gpt-5.6-luna".
 */
function modelPricing(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]
  const prefix = Object.keys(MODEL_PRICING)
    .filter((priced) => model.startsWith(`${priced}-`))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? MODEL_PRICING[prefix] : UNPRICED
}

/**
 * Prompt-cache prices as a share of the input price: a read costs a tenth, a
 * write to the default 5-minute cache a quarter more than plain input.
 */
export const CACHE_READ_PRICE_FACTOR = 0.1
export const CACHE_WRITE_5M_PRICE_FACTOR = 1.25

/**
 * The price of one call. With prompt caching `inputTokens` is only the
 * uncached rest of the prompt; the cached part comes as read and written
 * tokens, and must be passed or the budget misses it.
 */
export function aiCallCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: { readTokens?: number; writeTokens?: number },
): number {
  const pricing = modelPricing(model)
  const cachedInput = (cache?.readTokens || 0) * CACHE_READ_PRICE_FACTOR
    + (cache?.writeTokens || 0) * CACHE_WRITE_5M_PRICE_FACTOR
  return ((inputTokens + cachedInput) * pricing.input + outputTokens * pricing.output) / 1_000_000
}
