/**
 * C4 Call Transcription — provider router.
 *
 * Resolves the organization's TranscriptionClient through the AI gateway:
 *
 *   const client = await resolveTranscriptionClient(orgId, "call-transcription")
 *   if (!client) return 503  // not configured / not allowed / limit spent
 *   const result = await client.transcribe({ audioUrl, language })
 *
 * The key is the organization's own OpenAI key or the platform's
 * (src/lib/ai/gateway), the platform's daily limit applies on the platform's
 * key, and every finished transcription is journaled by its audio length.
 *
 * For tests, callers can inject a mock client directly into the
 * route handler (see `__tests__/api-calls-transcribe.test.ts`).
 */

import { aiKeyOrRefusal, isAiUnavailable, perMinuteCostUsd, UNIT_PRICING, type AiFeature } from "@/lib/ai/gateway"
import { createOpenAIWhisperClient } from "./providers/openai-whisper"
import type { TranscriptionClient } from "./types"

/** The organization's client, or null when transcription is not available to
 *  it — routes should respond with 503 rather than 500 in that case. */
export async function resolveTranscriptionClient(orgId: string, feature: AiFeature): Promise<TranscriptionClient | null> {
  const provider = process.env.TRANSCRIPTION_PROVIDER || "openai-whisper"
  // Unknown provider — fail closed.
  if (provider !== "openai-whisper") return null

  const access = await aiKeyOrRefusal(orgId, "openai", feature)
  if (isAiUnavailable(access)) return null
  const client = createOpenAIWhisperClient({
    apiKey: access.apiKey,
    baseUrl: process.env.OPENAI_BASE_URL,
    timeoutMs: parseTimeoutMs(process.env.TRANSCRIPTION_TIMEOUT_MS),
  })
  return {
    async transcribe(request) {
      const result = await client.transcribe(request)
      // Whisper bills the audio's length; without it, nothing to price.
      if (typeof result.durationSeconds === "number") {
        access.journal({ model: "whisper-1", costUsd: perMinuteCostUsd(UNIT_PRICING.whisperMinute, result.durationSeconds) })
      }
      return result
    },
  }
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 600_000) return undefined
  return n
}
