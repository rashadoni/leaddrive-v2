import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk"

// Shared Anthropic client factory.
//
// Every server-side `new Anthropic(...)` MUST go through here. The SDK default
// is a 10-min timeout × 2 retries (~30 min worst case); with nothing bounding it
// a stalled upstream call hangs the awaited HTTP response indefinitely — this is
// what caused the /deals "Da Vinci аналитика" infinite-spinner bug. Prod is a
// self-hosted standalone `node server.js` under PM2, so Next's
// `export const maxDuration` is a no-op: `timeout × (1 + maxRetries)` is the ONLY
// real server-side bound. With the defaults below, 45s × (1 retry) ≈ 90s worst
// case, after which the awaited call rejects and the route's catch can return a
// clean 5xx instead of holding the connection open.

/** Default per-request upstream timeout (ms) for non-streaming AI calls. */
export const AI_DEFAULT_TIMEOUT_MS = 45_000

/** Default retry budget. `timeout × (1 + maxRetries)` is the real wall-clock bound. */
export const AI_DEFAULT_MAX_RETRIES = 1

/**
 * Construct a timeout-bounded Anthropic client.
 *
 * `overrides` shallow-merge over the safe defaults, so callers can pass a longer
 * `timeout` for heavy calls (e.g. cost-model's 16k-token + thinking analysis),
 * a per-tenant `apiKey`, etc.
 *
 * `apiKey` defaults to `process.env.ANTHROPIC_API_KEY`. Pass an explicit `apiKey`
 * override at any call site where the key comes from per-tenant config (e.g. a
 * ChannelConfig record) rather than the process env — otherwise the factory
 * would silently use the env key.
 */
export function getAnthropicClient(overrides?: ClientOptions): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: AI_DEFAULT_TIMEOUT_MS,
    maxRetries: AI_DEFAULT_MAX_RETRIES,
    ...overrides,
  })
}
