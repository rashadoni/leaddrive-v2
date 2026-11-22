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
 * What a call billed by time or by item costs, in USD. Speech synthesis is not
 * here: its price changes on a date (`geminiSpeechMinuteUsd`).
 */
export const UNIT_PRICING = {
  /** OpenAI whisper-1, per minute of audio. */
  whisperMinute: 0.006,
  /** Google Speech-to-Text v2 chirp_3 (standard tier), per minute of audio. */
  chirpMinute: 0.016,
  /**
   * The browser voice assistant in Gemini Live, per minute of session, for a
   * conversation whose token count never arrived (a tab closed before it
   * settled, the reaper). Until 2026-11-22 this was $0.0225 — a minute of
   * sound billed once (25 tokens a second: $0.0045 in + $0.018 out). Live does
   * not bill like that: every turn pays the whole context again, and the
   * assistant's context is its instruction and 61 tool declarations, about
   * twenty thousand tokens. The one conversation settled with Google's own
   * count: 41 s, 59,571 input and 1,285 output tokens, $0.0846 — $0.124 a
   * minute (reconciliation with the Google bill, 2026-11-22). One conversation,
   * and priced when tokens with no modality still counted as audio, so it errs
   * high rather than low; rows priced by it are marked as estimates.
   */
  geminiLiveMinute: 0.124,
  /**
   * A phone order line call in Gemini Live, per minute, for a call the station
   * sent no token count for. Every turn bills the line's whole prompt and
   * catalog context again. Four line-stand calls priced from their own
   * `usageMetadata` (2026-11-06..07, tokens with no modality counted as audio
   * then): $0.081 for 62 s, $0.11 for 53 s, $0.153 for 107 s, $0.78 for 198 s
   * — $0.078 to $0.236 a minute, growing with the call; their mean.
   */
  phoneLineLiveMinute: 0.13,
  /** Google Vision TEXT_DETECTION, per image. */
  visionImage: 0.0015,
} as const

/**
 * Gemini / Vertex speech synthesis (gemini-3.8-flash-tts), per minute of
 * speech produced. Google bills the audio it returns in tokens, 25 a second:
 * $9 per million through 2026-12-31, $18 from 2027-01-01 — the same dates on
 * the Gemini API, Vertex AI and Cloud Text-to-Speech price pages (read
 * 2026-11-22). On Vertex the invoice already shows $18 with half credited
 * back until that date. Google's billing day is a Pacific day, so the price
 * changes at midnight there. Until 2026-11-22 the CRM counted $0.015 a minute
 * whatever the date: 11 % above the bill today, 44 % below it from January.
 */
export const SPEECH_AUDIO_TOKENS_PER_SECOND = 25
export const SPEECH_AUDIO_PRICING = [
  { fromUtc: null, usdPerMillionTokens: 9 },
  { fromUtc: "2027-01-01T08:00:00Z", usdPerMillionTokens: 18 },
] as const

/** What a minute of synthesized speech costs on the day it was produced. */
export function geminiSpeechMinuteUsd(at: Date): number {
  let price: number = SPEECH_AUDIO_PRICING[0].usdPerMillionTokens
  for (const step of SPEECH_AUDIO_PRICING) {
    if (step.fromUtc === null || at.getTime() >= Date.parse(step.fromUtc)) price = step.usdPerMillionTokens
  }
  return SPEECH_AUDIO_TOKENS_PER_SECOND * 60 * price / 1_000_000
}

/**
 * Gemini Live (gemini-3.8-live), USD per million tokens — the phone line's
 * table (ai.google.dev/gemini-api/docs/pricing, read 2026-11-04 for
 * scripts/zeytun-line/stand-crm.ts; no change announced for 2027). Every turn
 * bills the whole context. These four prices times the four Live lines of the
 * Google bill for 1–22 November 2026 give that bill to the cent.
 */
export const LIVE_TOKEN_PRICING = { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 } as const

/**
 * What Google counted for a Live conversation, added up over its turns.
 *
 * `otherIn` and `otherOut` are the tokens `usageMetadata` reports with no
 * modality: on the input the session's own overhead (about a tenth of a line
 * call's prompt tokens), on the output mostly function calls. Until
 * 2026-11-22 both counters put them into the audio column — «an estimate errs
 * high». The bill says Google does not charge them as audio: for 1–22 November
 * its Live audio-in tokens are 0.170 of its text-in tokens, the modality
 * labels on the stands give 0.169–0.181, and the old rule gives 0.320. So
 * they are priced as text, which is the dearest they can be — whether Google
 * charges them as text or not at all the bill does not settle (the two
 * readings differ by 8 % of Live).
 *
 * A counter that predates the split sends no `other*`: its `audioIn` and
 * `audioOut` still hold them, and it is priced as it always was.
 */
export type LiveTokenCounts = {
  textIn: number
  audioIn: number
  textOut: number
  audioOut: number
  otherIn?: number
  otherOut?: number
}

export function liveUsageCostUsd(tokens: LiveTokenCounts): number {
  const textIn = tokens.textIn + (tokens.otherIn ?? 0)
  const textOut = tokens.textOut + (tokens.otherOut ?? 0)
  return (textIn * LIVE_TOKEN_PRICING.textIn + tokens.audioIn * LIVE_TOKEN_PRICING.audioIn
    + textOut * LIVE_TOKEN_PRICING.textOut + tokens.audioOut * LIVE_TOKEN_PRICING.audioOut) / 1_000_000
}

/** Every token of the conversation's input and output, whatever its kind — what the journal row shows. */
export function liveTokenTotals(tokens: LiveTokenCounts): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: tokens.textIn + tokens.audioIn + (tokens.otherIn ?? 0),
    outputTokens: tokens.textOut + tokens.audioOut + (tokens.otherOut ?? 0),
  }
}

/** The least a connected Live minute costs: its incoming audio once (25 tokens a second at the audio-in price). */
export const LIVE_AUDIO_IN_MINUTE_USD = 25 * 60 * LIVE_TOKEN_PRICING.audioIn / 1_000_000

/**
 * Gemini Live of an AI phone call that is not the order line's, by the call's
 * length — for as long as the station core counts tokens only for the line.
 *
 * There is no price of a Live minute: each turn pays the whole conversation
 * so far again, so a minute of a long call costs more than a minute of a
 * short one. Measured on the stand on 2026-11-22, a 190-second booking call
 * on the general agent with no tools, priced from its own `usageMetadata`:
 * $0.033 a minute by the first minute, $0.038–0.041 by the second,
 * $0.047–0.050 by the third; with the instruction a tenant's calls carry
 * today (about 4,200 tokens against the stand's 2,700) the same call models
 * at $0.039 / $0.044 / $0.052. Hence $0.04 a minute for a call of up to two
 * minutes and a cent more a minute for every minute beyond — $0.05 at three.
 * Nothing longer was measured: the same slope is carried on to the station's
 * longest call, fifteen minutes. An agent with tools costs more than this.
 */
export const AI_CALL_LIVE_ESTIMATE = { minuteUsd: 0.04, flatMinutes: 2, growthPerMinute: 0.01, longestMinutes: 15 } as const

export function aiCallLiveEstimateUsd(seconds: number): number {
  const minutes = Math.max(0, seconds) / 60
  const beyond = Math.min(Math.max(0, minutes - AI_CALL_LIVE_ESTIMATE.flatMinutes),
    AI_CALL_LIVE_ESTIMATE.longestMinutes - AI_CALL_LIVE_ESTIMATE.flatMinutes)
  return minutes * (AI_CALL_LIVE_ESTIMATE.minuteUsd + beyond * AI_CALL_LIVE_ESTIMATE.growthPerMinute)
}

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
