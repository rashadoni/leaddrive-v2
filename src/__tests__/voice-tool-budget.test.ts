import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  createVoiceToolBudget,
  voiceToolBudgetMessage,
  VOICE_TOOL_BUDGET,
} from "@/lib/ai/voice/tool-budget"

/**
 * Roadmap V1.8 — ceilings on how much the model may do in one breath.
 *
 * Three guards already existed and none of them is a ceiling: a 15-second
 * timeout per read call, a stop after two consecutive tool failures, and a
 * server rate limit of twenty proposals a minute. A rate limit is not a
 * ceiling — over an hour that is twelve hundred proposals, and the shape it
 * permits is the one that hurts: a model that cannot get a draft accepted
 * keeps trying, and the user hears the assistant narrate the attempts.
 */
describe("what one answer may spend", () => {
  it("lets an answer read up to its allowance", () => {
    const budget = createVoiceToolBudget()
    for (let i = 0; i < VOICE_TOOL_BUDGET.callsPerTurn; i += 1) {
      expect(budget.claim("read"), `call ${i + 1}`).toEqual({ ok: true })
    }
    expect(budget.claim("read")).toEqual({ ok: false, reason: "turn_exhausted" })
  })

  it("starts the allowance again on the next answer", () => {
    const budget = createVoiceToolBudget()
    for (let i = 0; i < VOICE_TOOL_BUDGET.callsPerTurn; i += 1) budget.claim("read")
    expect(budget.claim("read").ok).toBe(false)

    budget.endTurn()
    expect(budget.claim("read")).toEqual({ ok: true })
    expect(budget.counts().turn).toBe(1)
  })

  // A per-turn reset alone would let a slow leak run for ever: eight calls an
  // answer, for an hour.
  it("keeps counting across answers until the session allowance is gone", () => {
    const budget = createVoiceToolBudget({ ...VOICE_TOOL_BUDGET, callsPerTurn: 2, callsPerSession: 5 })
    for (let turn = 0; turn < 3; turn += 1) {
      budget.claim("read")
      budget.claim("read")
      budget.endTurn()
    }
    expect(budget.counts().session).toBe(5)
    expect(budget.claim("read")).toEqual({ ok: false, reason: "session_exhausted" })
  })

  it("reports the session ceiling ahead of the turn ceiling", () => {
    // Both are exhausted at once here; the session one is the honest answer,
    // because the next turn will not help.
    const budget = createVoiceToolBudget({ ...VOICE_TOOL_BUDGET, callsPerTurn: 2, callsPerSession: 2 })
    budget.claim("read")
    budget.claim("read")
    expect(budget.claim("read")).toEqual({ ok: false, reason: "session_exhausted" })
  })
})

describe("what one conversation may prepare", () => {
  it("allows a handful of drafts and then stops", () => {
    const budget = createVoiceToolBudget()
    for (let i = 0; i < VOICE_TOOL_BUDGET.proposalsPerSession; i += 1) {
      expect(budget.claim("propose"), `proposal ${i + 1}`).toEqual({ ok: true })
    }
    expect(budget.claim("propose")).toEqual({ ok: false, reason: "proposals_exhausted" })
  })

  // The loop this guards against spans turns: each refusal ends the turn that
  // carried it, so a per-turn reset would refill the allowance every time.
  it("does not refill the proposal allowance on a new answer", () => {
    const budget = createVoiceToolBudget({ ...VOICE_TOOL_BUDGET, proposalsPerSession: 2 })
    budget.claim("propose")
    budget.endTurn()
    budget.claim("propose")
    budget.endTurn()
    expect(budget.claim("propose")).toEqual({ ok: false, reason: "proposals_exhausted" })
  })

  it("counts proposals apart from reads", () => {
    const budget = createVoiceToolBudget()
    budget.claim("propose")
    budget.claim("read")
    expect(budget.counts()).toMatchObject({ proposals: 1, turn: 1, session: 1 })
  })

  it("does not let a refused proposal spend a read", () => {
    const budget = createVoiceToolBudget({ ...VOICE_TOOL_BUDGET, proposalsPerSession: 0 })
    expect(budget.claim("propose").ok).toBe(false)
    expect(budget.counts().session).toBe(0)
  })
})

describe("what the model is told when it runs out", () => {
  // Addressed to the model as an instruction, because the useful behaviour is
  // to stop and say something true — not to retry with different arguments.
  it("tells it to answer with what it has when the turn is spent", () => {
    const message = voiceToolBudgetMessage("turn_exhausted")
    expect(message).toMatch(/Answer now with what you already have/)
    expect(message).toMatch(/Do not call another tool/)
  })

  it("tells it to hand the draft back to the user when proposals run out", () => {
    const message = voiceToolBudgetMessage("proposals_exhausted")
    expect(message).toMatch(/Stop preparing anything/)
    expect(message).toMatch(/finish or cancel the draft on screen/)
  })

  it("tells it the conversation is spent, not that something broke", () => {
    const message = voiceToolBudgetMessage("session_exhausted")
    expect(message).toMatch(/suggest starting a new one/)
    expect(message).not.toMatch(/error|failed/i)
  })
})

describe("the console spends the budget where the loop runs", () => {
  const console_ = readFileSync("src/components/ai/voice-console.tsx", "utf8")

  it("claims before a read and before a proposal", () => {
    expect(console_).toContain('toolBudgetRef.current.claim("read")')
    expect(console_).toContain('toolBudgetRef.current.claim("propose")')
  })

  // Navigation and screen context touch no data and cost nothing; charging for
  // them would make the assistant stop following the user around.
  it("does not charge for navigation or screen context", () => {
    const dispatcher = console_.slice(
      console_.indexOf("const executeTool = useCallback"),
      console_.indexOf("UNKNOWN_TOOL"),
    )
    const navigation = dispatcher.indexOf('name === "open_record"')
    const firstClaim = dispatcher.indexOf("toolBudgetRef.current.claim")
    expect(navigation).toBeGreaterThan(-1)
    expect(firstClaim).toBeGreaterThan(navigation)
  })

  it("refills the per-turn allowance when the answer is finished", () => {
    expect(console_).toMatch(/turnComplete[\s\S]{0,400}toolBudgetRef\.current\.endTurn\(\)/)
  })

  it("gives a new conversation a new budget", () => {
    expect(console_).toContain("toolBudgetRef.current = createVoiceToolBudget()")
  })

  // Every read call already had a deadline; the proposal did not, and a hung
  // one keeps the tool response outstanding while the conversation waits.
  it("puts the same deadline on a proposal as on a read", () => {
    const propose = console_.slice(
      console_.indexOf("const propose = useCallback"),
      console_.indexOf("const executeTool = useCallback"),
    )
    expect(propose).toContain("new AbortController()")
    expect(propose).toContain("TOOL_TIMEOUT_MS")
    expect(propose).toContain("signal: controller.signal")
    expect(propose).toContain("window.clearTimeout(timeout)")
  })
})
