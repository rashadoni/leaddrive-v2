/**
 * Automatic callback — the decision, in isolation.
 *
 * Every "yes" here becomes a phone ringing in a customer's pocket, so the
 * suppression rules get at least as much attention as the trigger ones.
 */
import { describe, it, expect } from "vitest"

import {
  CALLBACK_FRESHNESS_MS,
  agentSaidGoodbye,
  decideCallback,
  type CallbackEvidence,
} from "@/lib/voice-agent/callback-decision"

const endedAt = new Date("2026-08-17T12:00:00.000Z")

function evidence(overrides: Partial<CallbackEvidence> = {}): CallbackEvidence {
  return {
    agentMidUtterance: false,
    recoveryAttempts: 0,
    agentSaidGoodbye: false,
    continuesCallId: null,
    callMode: "ai",
    durationSeconds: 40,
    endedAt,
    now: new Date(endedAt.getTime() + 60_000),
    ...overrides,
  }
}

describe("decideCallback", () => {
  it("calls back when the customer hung up mid-sentence", () => {
    expect(decideCallback(evidence({ agentMidUtterance: true }))).toEqual({
      callback: true,
      reason: "agent_cut_off",
    })
  })

  it("calls back when the provider dropped during the call", () => {
    expect(decideCallback(evidence({ recoveryAttempts: 1 }))).toEqual({
      callback: true,
      reason: "provider_recovered",
    })
  })

  it("never calls back after the agent said goodbye", () => {
    // The owner's explicit rule, and it outranks every trigger: a finished
    // conversation that gets dialled again is worse than a missed callback.
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      recoveryAttempts: 3,
      agentSaidGoodbye: true,
    }))).toEqual({ callback: false, reason: "agent_said_goodbye" })
  })

  it("never gives a callback its own callback", () => {
    // Exactly one retry. This is checked before the triggers so no combination
    // of evidence can produce a chain.
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      continuesCallId: "call-1",
    }))).toEqual({ callback: false, reason: "already_a_callback" })
  })

  it("stays silent when nothing says the call broke", () => {
    expect(decideCallback(evidence())).toEqual({
      callback: false,
      reason: "no_break_evidence",
    })
  })

  it("treats unmeasured calls as unbroken rather than guessing", () => {
    // Every call recorded by a PBX build older than the evidence fields lands
    // here. Null means "not measured", which must not become a callback.
    expect(decideCallback(evidence({
      agentMidUtterance: null,
      recoveryAttempts: null,
    }))).toEqual({ callback: false, reason: "no_break_evidence" })
  })

  it("ignores a hangup on contact", () => {
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      durationSeconds: 3,
    }))).toEqual({ callback: false, reason: "call_too_short" })
  })

  it("refuses to continue a break the customer has moved on from", () => {
    // Also the guard that stops a stalled queue from dialling at 3am: the
    // callback ignores business hours by design, so staleness is what bounds it.
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      now: new Date(endedAt.getTime() + CALLBACK_FRESHNESS_MS + 1_000),
    }))).toEqual({ callback: false, reason: "stale_break" })
  })

  it("still continues a break right at the edge of the window", () => {
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      now: new Date(endedAt.getTime() + CALLBACK_FRESHNESS_MS),
    }))).toEqual({ callback: true, reason: "agent_cut_off" })
  })

  it("leaves human calls alone", () => {
    expect(decideCallback(evidence({
      agentMidUtterance: true,
      callMode: "human",
    }))).toEqual({ callback: false, reason: "not_an_ai_call" })
  })
})

describe("agentSaidGoodbye", () => {
  it("recognises a farewell in the agent's closing turn", () => {
    expect(agentSaidGoodbye([
      { role: "agent", text: "Salam, necəsiniz?" },
      { role: "customer", text: "Yaxşı." },
      { role: "agent", text: "Çox sağ olun, görüşərik!" },
    ])).toBe(true)
  })

  it("survives transcripts written without diacritics", () => {
    expect(agentSaidGoodbye([
      { role: "agent", text: "Cox sag olun, ugurlar." },
    ])).toBe(true)
  })

  it("ignores a farewell spoken by the customer", () => {
    // This is the case that most needs a callback: the customer signs off and
    // drops while the agent is still working, so the agent never closed.
    expect(agentSaidGoodbye([
      { role: "agent", text: "Sizə qiyməti deyim..." },
      { role: "customer", text: "Sağ olun." },
    ])).toBe(false)
  })

  it("ignores a farewell from the middle of a long call", () => {
    // A polite "sağ olun" early on is thanks, not a sign-off, and the
    // conversation visibly continued past it.
    const turns = [
      { role: "agent", text: "Sağ olun ki, gözlədiniz." },
      { role: "customer", text: "Buyurun." },
      { role: "agent", text: "Qiymət 300 manatdır." },
      { role: "customer", text: "Düşünüm." },
      { role: "agent", text: "Əlbəttə, sizə məlumat göndərim." },
    ]
    expect(agentSaidGoodbye(turns)).toBe(false)
  })

  it("says no on an empty transcript", () => {
    expect(agentSaidGoodbye([])).toBe(false)
  })
})
