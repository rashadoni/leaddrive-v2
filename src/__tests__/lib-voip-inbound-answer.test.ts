import { describe, expect, it } from "vitest"

import {
  DEFAULT_INBOUND_GREETING,
  INBOUND_CALL_CONTEXT,
  MAX_INBOUND_RULES_LENGTH,
  deriveVoiceAgentMode,
  inboundCallContext,
  inboundRulesFitTransport,
  readInboundAnswerPolicy,
  shouldAiAnswer,
} from "@/lib/voip/inbound-answer"

const station = { provider: "asterisk", voiceAgentEnabled: true }
const t0 = new Date("2026-10-14T12:00:00Z")
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1_000)

describe("inbound answer policy", () => {
  it("reads as people-only for every line that predates the setting or cannot use the AI", () => {
    for (const settings of [
      undefined,
      {},
      station,
      { ...station, inboundAnswerMode: "voicemail" },
      { ...station, voiceAgentEnabled: false, inboundAnswerMode: "ai" },
      { provider: "twilio", voiceAgentEnabled: true, inboundAnswerMode: "ai" },
    ]) {
      expect(readInboundAnswerPolicy(settings).mode).toBe("human")
    }
  })

  it("keeps the ring count inside the station's 25-second wait", () => {
    expect(readInboundAnswerPolicy({ ...station, inboundAiAfterRings: 9 }).ringsBeforeAi).toBe(4)
    expect(readInboundAnswerPolicy({ ...station, inboundAiAfterRings: 0 }).ringsBeforeAi).toBe(1)
    expect(readInboundAnswerPolicy({ ...station, inboundAiAfterRings: 2.5 }).ringsBeforeAi).toBe(3)
    expect(readInboundAnswerPolicy(station).ringsBeforeAi).toBe(3)
  })

  it("uses the organisation's greeting, or a neutral one that never claims we called", () => {
    expect(readInboundAnswerPolicy({ ...station, voiceAgentInboundGreeting: "  Salam!  " }).greeting).toBe("Salam!")
    expect(readInboundAnswerPolicy({ ...station, voiceAgentInboundGreeting: "   " }).greeting).toBe(DEFAULT_INBOUND_GREETING)
  })

  it("adds only configured inbound rules to the fixed incoming-call context", () => {
    const policy = readInboundAnswerPolicy({ ...station, voiceAgentInboundRules: "  Məsləhət təklif et.  " })
    expect(policy.conversationRules).toBe("Məsləhət təklif et.")
    expect(inboundCallContext(policy)).toContain(INBOUND_CALL_CONTEXT)
    expect(inboundCallContext(policy)).toContain("Məsləhət təklif et.")
    for (const rules of [undefined, "", "  ", 123]) {
      expect(inboundCallContext(readInboundAnswerPolicy({ ...station, voiceAgentInboundRules: rules })))
        .toBe(INBOUND_CALL_CONTEXT)
    }
  })

  it("bounds legacy rules to the PBX context and JSON byte limits", () => {
    for (const rules of ["ə".repeat(2_000), "漢".repeat(2_000), "\u0000".repeat(2_000)]) {
      const policy = readInboundAnswerPolicy({ ...station, voiceAgentInboundRules: rules })
      expect(policy.conversationRules.length).toBeLessThanOrEqual(MAX_INBOUND_RULES_LENGTH)
      expect(inboundRulesFitTransport(policy.conversationRules)).toBe(true)
      expect(inboundCallContext(policy).length).toBeLessThanOrEqual(2_000)
    }
  })
})

describe("whether the AI picks up now", () => {
  const humanThenAi = readInboundAnswerPolicy({ ...station, inboundAnswerMode: "human_then_ai", inboundAiAfterRings: 3 })
  const ai = readInboundAnswerPolicy({ ...station, inboundAnswerMode: "ai" })
  const human = readInboundAnswerPolicy(station)

  it("waits the configured rings, five seconds each, when people answer first", () => {
    expect(shouldAiAnswer({ policy: humanThenAi, ringingSince: t0, now: after(14.9), hasLiveBrowserClaim: false })).toBe(false)
    expect(shouldAiAnswer({ policy: humanThenAi, ringingSince: t0, now: after(15), hasLiveBrowserClaim: false })).toBe(true)
  })

  it("answers at once in AI mode and never in people-only mode", () => {
    expect(shouldAiAnswer({ policy: ai, ringingSince: t0, now: t0, hasLiveBrowserClaim: false })).toBe(true)
    expect(shouldAiAnswer({ policy: human, ringingSince: t0, now: after(60), hasLiveBrowserClaim: false })).toBe(false)
  })

  it("never takes a call a salesperson is in the middle of answering", () => {
    expect(shouldAiAnswer({ policy: ai, ringingSince: t0, now: after(60), hasLiveBrowserClaim: true })).toBe(false)
  })
})

describe("the legacy voice-agent mode", () => {
  it("follows the inbound answer and the outbound switch", () => {
    expect(deriveVoiceAgentMode({ inboundAnswerMode: "human", outboundAiEnabled: true })).toBe("outbound")
    expect(deriveVoiceAgentMode({ inboundAnswerMode: "human", outboundAiEnabled: false })).toBe("outbound")
    expect(deriveVoiceAgentMode({ inboundAnswerMode: "ai", outboundAiEnabled: false })).toBe("inbound")
    expect(deriveVoiceAgentMode({ inboundAnswerMode: "human_then_ai", outboundAiEnabled: true })).toBe("both")
  })
})
