/**
 * Who answers a call the customer places to the station number.
 *
 * One setting on the VoIP page, stored in the Asterisk channel config:
 *
 *  - "human": the call rings salespeople's browsers; nobody answers → missed.
 *  - "ai": the AI voice agent answers at once.
 *  - "human_then_ai": salespeople first; if nobody has answered after N rings,
 *    the AI voice agent picks the call up.
 *
 * The station asks the CRM once a second while the caller hears ringing
 * (`/api/internal/asterisk/inbound-browser-ready`), so the decision lives here
 * and the station only follows it. The station stops asking after 25 seconds,
 * which is why the ring count is capped: four rings must fit inside that wait.
 */

export const INBOUND_ANSWER_MODES = ["human", "ai", "human_then_ai"] as const
export type InboundAnswerMode = (typeof INBOUND_ANSWER_MODES)[number]

/** Azerbaijani/Russian ring cadence: one second of tone, four of silence. */
export const RING_SECONDS = 5
export const MIN_RINGS_BEFORE_AI = 1
export const MAX_RINGS_BEFORE_AI = 4
export const DEFAULT_RINGS_BEFORE_AI = 3
export const MAX_INBOUND_GREETING_LENGTH = 500

/**
 * Spoken word for word when the AI picks up an inbound call and the org has
 * not written its own. Neutral on purpose: the outbound opening says "I am
 * calling you", which is wrong to somebody who just dialled us.
 */
export const DEFAULT_INBOUND_GREETING =
  "Salam! Zənginiz üçün təşəkkür edirik. Mən virtual köməkçiyəm. Sizə necə kömək edə bilərəm?"

/**
 * Appended to the AI's instructions for an inbound call. The org prompt is
 * usually written for outbound sales; this one paragraph is what keeps the
 * agent from treating the caller as somebody it phoned.
 */
export const INBOUND_CALL_CONTEXT =
  "Bu zəngi müştəri özü edib: o, bizim nömrəmizə zəng edib və sən zəngə cavab verirsən. "
  + "Müştəriyə zəng etdiyini demə və zəngin səbəbini özün uydurma. "
  + "Əvvəlcə onun nə istədiyini soruş, sonra qaydalarına uyğun kömək et."

export type InboundAnswerPolicy = {
  mode: InboundAnswerMode
  ringsBeforeAi: number
  greeting: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function clampRingsBeforeAi(value: unknown): number {
  const rings = typeof value === "number" && Number.isInteger(value)
    ? value
    : DEFAULT_RINGS_BEFORE_AI
  return Math.min(MAX_RINGS_BEFORE_AI, Math.max(MIN_RINGS_BEFORE_AI, rings))
}

/**
 * Read the policy from a VoIP channel config's settings.
 *
 * The AI can only answer when the voice agent itself is switched on — it has
 * no rules to speak by otherwise — so a disabled agent reads as "human" no
 * matter what the select says. Every unreadable value falls back to "human",
 * which is how inbound calls behaved before this setting existed.
 */
export function readInboundAnswerPolicy(settingsValue: unknown): InboundAnswerPolicy {
  const settings = record(settingsValue)
  const stored = settings.inboundAnswerMode
  const mode: InboundAnswerMode = (INBOUND_ANSWER_MODES as readonly unknown[]).includes(stored)
    ? stored as InboundAnswerMode
    : "human"
  const greeting = typeof settings.voiceAgentInboundGreeting === "string"
    ? settings.voiceAgentInboundGreeting.trim().slice(0, MAX_INBOUND_GREETING_LENGTH)
    : ""
  return {
    mode: settings.provider === "asterisk" && settings.voiceAgentEnabled === true ? mode : "human",
    ringsBeforeAi: clampRingsBeforeAi(settings.inboundAiAfterRings),
    greeting: greeting || DEFAULT_INBOUND_GREETING,
  }
}

/**
 * Whether the AI should take this ringing call now.
 *
 * A salesperson who has already pressed "Answer" keeps the call while their
 * claim is live: their browser is opening the microphone, and handing the
 * customer to the AI a second before the person says "hello" would put two
 * voices on one call. If the claim lapses, the countdown applies as usual.
 */
export function shouldAiAnswer(params: {
  policy: InboundAnswerPolicy
  ringingSince: Date
  now: Date
  hasLiveBrowserClaim: boolean
}): boolean {
  if (params.policy.mode === "human") return false
  if (params.hasLiveBrowserClaim) return false
  if (params.policy.mode === "ai") return true
  const ringingMs = params.now.getTime() - params.ringingSince.getTime()
  return ringingMs >= params.policy.ringsBeforeAi * RING_SECONDS * 1_000
}

/**
 * The legacy voice-agent mode, derived from the inbound answer and outbound
 * switches so the page keeps one control instead of two that can disagree.
 */
export function deriveVoiceAgentMode(params: {
  inboundAnswerMode: InboundAnswerMode
  outboundAiEnabled: boolean
}): "inbound" | "outbound" | "both" {
  const inboundAi = params.inboundAnswerMode !== "human"
  if (inboundAi && params.outboundAiEnabled) return "both"
  if (inboundAi) return "inbound"
  return "outbound"
}
