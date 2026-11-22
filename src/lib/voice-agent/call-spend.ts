/**
 * What the AI leg of a phone call spent on AI, into the organization's journal
 * (`ai_usage`, «Настройки → ИИ и расходы»).
 *
 * The conversation (Gemini Live) and, on the order line, its voice (Gemini
 * speech, Vertex first) run on the station, on the platform's keys. The
 * station reports what it counted with the call's result (`usage`):
 *  - Live: the sum of every `usageMetadata` of the call's sessions, by
 *    modality, priced at the Live table;
 *  - speech: the seconds of audio its synthesis requests returned, at the
 *    price of the day.
 * A leg the station counted nothing for is priced by its length at a measured
 * rate, and the row says so (`estimated`): today that is every call that is
 * not the order line's — the core sends `usage` only for the line.
 *
 * Platform keys either way, so the spend counts toward the organization's
 * daily AI limit when it set one, like Chirp; the station itself is never
 * stopped by the limit.
 */
import { journalPlatformAiCall } from "@/lib/ai/gateway/access"
import type { AiFeature } from "@/lib/ai/gateway/features"
import {
  aiCallLiveEstimateUsd, geminiSpeechMinuteUsd, liveTokenTotals, liveUsageCostUsd, perMinuteCostUsd, UNIT_PRICING,
} from "@/lib/ai/gateway/pricing"
import type { VoiceAgentLineUsage } from "@/lib/voice-agent/post-call"

/** The station's models (scripts/pbx/fanum-zeytun-inbound.py), when it does not name them. */
export const STATION_LIVE_MODEL = "gemini-3.8-live"
export const STATION_SPEECH_MODEL = "gemini-3.8-flash-tts"

type Journal = typeof journalPlatformAiCall
export type AiLegSpend = { durationSeconds: number; usage?: VoiceAgentLineUsage }

function journalLegSpend(
  organizationId: string,
  feature: AiFeature,
  /** What a leg of this many seconds costs when the station counted no tokens. */
  estimateUsd: (seconds: number) => number,
  call: AiLegSpend,
  journal: Journal,
  at: Date,
): void {
  const live = call.usage?.live
  if (live) {
    journal(organizationId, "gemini", feature, {
      model: live.model ?? STATION_LIVE_MODEL,
      ...liveTokenTotals(live),
      costUsd: liveUsageCostUsd(live),
    })
  } else if (call.durationSeconds > 0) {
    journal(organizationId, "gemini", feature, {
      model: STATION_LIVE_MODEL,
      costUsd: estimateUsd(call.durationSeconds),
      estimated: true,
    })
  }
  const speech = call.usage?.tts
  if (speech && speech.audioSeconds > 0) {
    journal(organizationId, "gemini", feature, {
      model: speech.model ?? STATION_SPEECH_MODEL,
      costUsd: perMinuteCostUsd(geminiSpeechMinuteUsd(at), speech.audioSeconds),
    })
  }
}

/**
 * A phone order line call (owner, 2026-11-11: «почему расходов 0?»). A leg the
 * station sent no count for — a core that predates the count, or one that saw
 * no `usageMetadata` at all — is priced at the line's measured rate a minute.
 */
export function journalLineCallSpend(
  organizationId: string,
  call: AiLegSpend,
  journal: Journal = journalPlatformAiCall,
  at: Date = new Date(),
): void {
  journalLegSpend(organizationId, "phone-line",
    (seconds) => perMinuteCostUsd(UNIT_PRICING.phoneLineLiveMinute, seconds), call, journal, at)
}

/**
 * Every other AI call — an organization's inbound calls the AI answers, its
 * outbound and callback calls, a demo call (owner, 2026-11-22). Until then
 * nothing of their conversation reached the journal: an organization saw the
 * after-call analysis, a tenth of a cent, and none of the Live that the call
 * actually cost, so the margin on a minute sold to it could not be read here.
 * The core sends no tokens for these calls yet; when it does, the same
 * `usage` is priced exactly, with no change on this side.
 */
export function journalAiCallSpend(
  organizationId: string,
  call: AiLegSpend,
  journal: Journal = journalPlatformAiCall,
  at: Date = new Date(),
): void {
  journalLegSpend(organizationId, "ai-call", aiCallLiveEstimateUsd, call, journal, at)
}
