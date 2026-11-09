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
}

/** A model nobody priced is counted at the Haiku price, as it always was. */
const UNPRICED = MODEL_PRICING["claude-haiku-4-5-20251001"]

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
  const pricing = MODEL_PRICING[model] ?? UNPRICED
  const cachedInput = (cache?.readTokens || 0) * CACHE_READ_PRICE_FACTOR
    + (cache?.writeTokens || 0) * CACHE_WRITE_5M_PRICE_FACTOR
  return ((inputTokens + cachedInput) * pricing.input + outputTokens * pricing.output) / 1_000_000
}
