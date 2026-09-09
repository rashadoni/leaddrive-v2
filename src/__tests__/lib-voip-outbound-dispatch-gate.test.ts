import { afterEach, describe, expect, it } from "vitest"

import { isOutboundVoiceDispatchPaused } from "@/lib/voip/outbound-dispatch-gate"

afterEach(() => {
  delete process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED
  delete process.env.VOICE_AGENT_ORGANIZATION_ID
})

describe("outbound voice dispatch maintenance gate", () => {
  it("defaults open, accepts exact false, and fails closed on ambiguous values", () => {
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-pilot"
    delete process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED
    expect(isOutboundVoiceDispatchPaused("org-pilot")).toBe(false)

    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "false"
    expect(isOutboundVoiceDispatchPaused("org-pilot")).toBe(false)

    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "1"
    expect(isOutboundVoiceDispatchPaused("org-pilot")).toBe(true)

    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "typo"
    expect(isOutboundVoiceDispatchPaused("org-pilot")).toBe(true)

    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"
    expect(isOutboundVoiceDispatchPaused("org-pilot")).toBe(true)
    expect(isOutboundVoiceDispatchPaused("org-other")).toBe(false)
  })

  it("fails closed when a requested pause has no pilot tenant binding", () => {
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"
    delete process.env.VOICE_AGENT_ORGANIZATION_ID
    expect(isOutboundVoiceDispatchPaused("org-any")).toBe(true)
  })
})
