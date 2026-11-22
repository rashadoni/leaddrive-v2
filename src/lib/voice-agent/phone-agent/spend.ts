/**
 * What a phone agent's call spent on AI, into the organization's journal
 * (`ai_usage`, «Настройки → ИИ и расходы», the row «Телефонный ИИ-агент»).
 *
 * Until 2026-11-22 only the pharmacy line's calls were counted: the Live
 * conversation and the voice of every other tenant's call ran on the
 * platform's keys and left no row at all, so their cost was visible only in
 * Google's bill. A call that took the agent's session
 * (src/lib/voice-agent/phone-agent/handler.ts) runs on the same station branch
 * as the line, and the station sends the same `usage` with its result:
 *  - Live: the sum of every `usageMetadata` of the call, by modality;
 *  - speech: the seconds of audio the synthesis returned.
 * No `usage` (the result of a call that ended before any turn): the Live part
 * is priced by the AI leg's length at the agent's measured rate a minute.
 *
 * The station counts every prompt token Google does not label TEXT as audio
 * (scripts/pbx/fanum-zeytun-inbound.py, add_usage), so the Live row errs high:
 * by 3–5 % on a call without tool rounds, up to about 10 % with two
 * (measured on the stand, 2026-11-22). Never low.
 */
import { journalPlatformAiCall } from "@/lib/ai/gateway/access"
import { liveUsageCostUsd, perMinuteCostUsd, UNIT_PRICING } from "@/lib/ai/gateway/pricing"
import type { VoiceAgentLineUsage } from "@/lib/voice-agent/post-call"

const LIVE_MODEL = "gemini-3.8-live"
const SPEECH_MODEL = "gemini-3.8-flash-tts"

type Journal = typeof journalPlatformAiCall

export function journalPhoneAgentCallSpend(
  organizationId: string,
  call: { durationSeconds: number; usage?: VoiceAgentLineUsage },
  journal: Journal = journalPlatformAiCall,
): void {
  const live = call.usage?.live
  if (live) {
    journal(organizationId, "gemini", "phone-agent", {
      model: live.model ?? LIVE_MODEL,
      inputTokens: live.textIn + live.audioIn,
      outputTokens: live.textOut + live.audioOut,
      costUsd: liveUsageCostUsd(live),
    })
  } else if (call.durationSeconds > 0) {
    journal(organizationId, "gemini", "phone-agent", {
      model: LIVE_MODEL,
      costUsd: perMinuteCostUsd(UNIT_PRICING.phoneAgentLiveMinute, call.durationSeconds),
    })
  }
  const speech = call.usage?.tts
  if (speech && speech.audioSeconds > 0) {
    journal(organizationId, "gemini", "phone-agent", {
      model: speech.model ?? SPEECH_MODEL,
      costUsd: perMinuteCostUsd(UNIT_PRICING.geminiSpeechMinute, speech.audioSeconds),
    })
  }
}
