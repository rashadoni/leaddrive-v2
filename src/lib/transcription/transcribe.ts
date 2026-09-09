/**
 * C4 Call Transcription — provider router.
 *
 * Resolves a TranscriptionClient based on env config. Routes use:
 *
 *   const client = resolveTranscriptionClient()
 *   if (!client) return 503  // not configured
 *   const result = await client.transcribe({ audioUrl, language })
 *
 * Why a router instead of direct provider import: lets us swap
 * providers per-tenant later (channel config), or stand up a
 * self-hosted Whisper instance without touching call routes.
 *
 * For tests, callers can inject a mock client directly into the
 * route handler (see `__tests__/api-calls-transcribe.test.ts`).
 */

import { createOpenAIWhisperClient } from "./providers/openai-whisper"
import type { TranscriptionClient } from "./types"

/** Resolve the configured client based on env. Returns null when
 *  transcription isn't configured — routes should respond with 503
 *  rather than 500 in that case. */
export function resolveTranscriptionClient(): TranscriptionClient | null {
  const provider = process.env.TRANSCRIPTION_PROVIDER || "openai-whisper"

  if (provider === "openai-whisper") {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return null
    return createOpenAIWhisperClient({
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      timeoutMs: parseTimeoutMs(process.env.TRANSCRIPTION_TIMEOUT_MS),
    })
  }

  // Unknown provider — fail closed.
  return null
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 600_000) return undefined
  return n
}
