/**
 * What a phone order line call spent on AI, into the organization's journal
 * (`ai_usage`, «Настройки → ИИ и расходы»).
 *
 * Owner, 2026-11-11: «почему расходов 0?». The line's conversation (Gemini
 * Live) and its voice (Gemini speech, Vertex first) run on the station, on the
 * platform's keys, and before this nothing of them reached the report: only
 * Chirp and the transcript recovery, a few cents of a call worth tens.
 *
 * The station counts both and sends them with the call's result (`usage`):
 *  - Live: the sum of every `usageMetadata` of the call's sessions, by
 *    modality, priced at the line's Live table;
 *  - speech: the seconds of audio its synthesis requests returned.
 * A station core that does not count yet sends no `usage`: the Live part is
 * then priced by the AI leg's length at the line's measured rate a minute,
 * and speech is not counted. Platform keys either way, so the spend counts
 * toward the organization's daily AI limit, like Chirp; the station itself is
 * never stopped by the limit.
 */
import { journalPlatformAiCall } from "@/lib/ai/gateway/access"
import { liveUsageCostUsd, perMinuteCostUsd, UNIT_PRICING } from "@/lib/ai/gateway/pricing"
import type { VoiceAgentLineUsage } from "@/lib/voice-agent/post-call"

/** The station's models (scripts/pbx/fanum-zeytun-inbound.py), when it does not name them. */
export const LINE_LIVE_MODEL = "gemini-3.8-live"
export const LINE_SPEECH_MODEL = "gemini-3.8-flash-tts"

type Journal = typeof journalPlatformAiCall

export function journalLineCallSpend(
  organizationId: string,
  call: { durationSeconds: number; usage?: VoiceAgentLineUsage },
  journal: Journal = journalPlatformAiCall,
): void {
  const live = call.usage?.live
  if (live) {
    journal(organizationId, "gemini", "phone-line", {
      model: live.model ?? LINE_LIVE_MODEL,
      inputTokens: live.textIn + live.audioIn,
      outputTokens: live.textOut + live.audioOut,
      costUsd: liveUsageCostUsd(live),
    })
  } else if (call.durationSeconds > 0) {
    journal(organizationId, "gemini", "phone-line", {
      model: LINE_LIVE_MODEL,
      costUsd: perMinuteCostUsd(UNIT_PRICING.phoneLineLiveMinute, call.durationSeconds),
    })
  }
  const speech = call.usage?.tts
  if (speech && speech.audioSeconds > 0) {
    journal(organizationId, "gemini", "phone-line", {
      model: speech.model ?? LINE_SPEECH_MODEL,
      costUsd: perMinuteCostUsd(UNIT_PRICING.geminiSpeechMinute, speech.audioSeconds),
    })
  }
}
