/**
 * Tests for H1 Agent framework slice 1 — state machine.
 * Pure functional; no Prisma, no I/O.
 */
import { describe, it, expect } from "vitest"
import {
  applyStep,
  canTransitionStatus,
  AgentStateError,
  TERMINAL_STATUSES,
  type SessionStatus,
  type SessionView,
  type StepInput,
} from "@/lib/agent/state-machine"

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    status: "executing",
    stepCount: 0,
    maxSteps: 20,
    costSoFarUsd: 0,
    budgetUsd: null,
    ...overrides,
  }
}

const observe = (cost = 0): StepInput => ({ kind: "observe", outcome: "ok", costUsd: cost })
const think = (cost = 0): StepInput => ({ kind: "think", outcome: "ok", costUsd: cost })
const act = (cost = 0, outcome: "ok" | "error" = "ok"): StepInput => ({ kind: "act", outcome, costUsd: cost })
const respond = (cost = 0, outcome: "ok" | "error" = "ok"): StepInput => ({ kind: "respond", outcome, costUsd: cost })
const ask = (cost = 0): StepInput => ({ kind: "ask", outcome: "ok", costUsd: cost })

describe("H1 agent — applyStep happy path", () => {
  it("observe step keeps session executing", () => {
    const r = applyStep(session(), observe())
    expect(r.nextStatus).toBe("executing")
    expect(r.nextStepCount).toBe(1)
  })

  it("think step keeps executing", () => {
    const r = applyStep(session({ stepCount: 3 }), think())
    expect(r.nextStatus).toBe("executing")
    expect(r.nextStepCount).toBe(4)
  })

  it("act step keeps executing", () => {
    const r = applyStep(session({ stepCount: 5 }), act())
    expect(r.nextStatus).toBe("executing")
  })

  it("respond step transitions to completed", () => {
    const r = applyStep(session(), respond())
    expect(r.nextStatus).toBe("completed")
    expect(r.reason).toBe("responded")
  })

  it("ask step transitions to waiting_input (pauses for user clarification)", () => {
    const r = applyStep(session(), ask())
    expect(r.nextStatus).toBe("waiting_input")
    expect(r.reason).toBe("asked_user")
  })

  it("ask step still increments stepCount and accrues cost", () => {
    const r = applyStep(session({ stepCount: 4, costSoFarUsd: 0.1 }), ask(0.05))
    expect(r.nextStepCount).toBe(5)
    expect(r.nextCostSoFarUsd).toBeCloseTo(0.15, 10)
  })

  it("step counter increments by 1", () => {
    const r = applyStep(session({ stepCount: 7 }), observe())
    expect(r.nextStepCount).toBe(8)
  })

  it("cost accumulates", () => {
    const r = applyStep(session({ costSoFarUsd: 0.12 }), act(0.05))
    expect(r.nextCostSoFarUsd).toBeCloseTo(0.17, 10)
  })

  it("planning → executing on first step", () => {
    const r = applyStep(session({ status: "planning" }), observe())
    expect(r.nextStatus).toBe("executing")
  })
})

describe("H1 agent — applyStep error paths", () => {
  it("any error outcome → failed", () => {
    const r = applyStep(session(), act(0, "error"))
    expect(r.nextStatus).toBe("failed")
    expect(r.reason).toContain("failed")
  })

  it("respond with error outcome → failed (not completed)", () => {
    const r = applyStep(session(), respond(0, "error"))
    expect(r.nextStatus).toBe("failed")
  })

  it("exceeding maxSteps → failed", () => {
    const r = applyStep(session({ stepCount: 19, maxSteps: 20 }), observe())
    expect(r.nextStatus).toBe("executing")
    const r2 = applyStep(session({ stepCount: 20, maxSteps: 20 }), observe())
    expect(r2.nextStatus).toBe("failed")
    expect(r2.reason).toContain("max steps")
  })

  it("exceeding budgetUsd → failed", () => {
    const r = applyStep(session({ costSoFarUsd: 0.95, budgetUsd: 1.0 }), act(0.1))
    expect(r.nextStatus).toBe("failed")
    expect(r.reason).toContain("Budget")
  })

  it("budget exhaustion takes precedence over max-steps + completion", () => {
    // Both conditions would trip — budget reason wins.
    const r = applyStep(
      session({ stepCount: 19, maxSteps: 20, costSoFarUsd: 0.99, budgetUsd: 1.0 }),
      respond(0.5)
    )
    expect(r.nextStatus).toBe("failed")
    expect(r.reason).toContain("Budget")
  })

  it("null budget disables budget check", () => {
    const r = applyStep(session({ budgetUsd: null }), act(1_000_000))
    expect(r.nextStatus).toBe("executing")
  })

  it("zero-cost step inside tiny budget OK", () => {
    const r = applyStep(session({ costSoFarUsd: 0.99, budgetUsd: 1.0 }), think(0))
    expect(r.nextStatus).toBe("executing")
  })

  it("respond step still increments stepCount and counts toward budget", () => {
    const r = applyStep(session({ costSoFarUsd: 0.5, budgetUsd: 1.0 }), respond(0.4))
    expect(r.nextStatus).toBe("completed")
    expect(r.nextCostSoFarUsd).toBeCloseTo(0.9, 10)
  })
})

describe("H1 agent — applyStep guards against terminal states", () => {
  it.each(["completed", "failed", "cancelled"] as SessionStatus[])(
    "rejects step on terminal status '%s'",
    (status) => {
      expect(() => applyStep(session({ status }), observe())).toThrow(AgentStateError)
    }
  )

  it("TERMINAL_STATUSES contains exactly the three terminal values", () => {
    expect(TERMINAL_STATUSES.size).toBe(3)
    expect(TERMINAL_STATUSES.has("completed")).toBe(true)
    expect(TERMINAL_STATUSES.has("failed")).toBe(true)
    expect(TERMINAL_STATUSES.has("cancelled")).toBe(true)
  })
})

describe("H1 agent — canTransitionStatus", () => {
  it("planning → executing", () => {
    expect(canTransitionStatus("planning", "executing")).toBe(true)
  })

  it("executing → waiting_input", () => {
    expect(canTransitionStatus("executing", "waiting_input")).toBe(true)
  })

  it("waiting_input → executing (user approved)", () => {
    expect(canTransitionStatus("waiting_input", "executing")).toBe(true)
  })

  it("any non-terminal → cancelled", () => {
    expect(canTransitionStatus("planning", "cancelled")).toBe(true)
    expect(canTransitionStatus("executing", "cancelled")).toBe(true)
    expect(canTransitionStatus("waiting_input", "cancelled")).toBe(true)
  })

  it("terminal → anything is forbidden", () => {
    expect(canTransitionStatus("completed", "executing")).toBe(false)
    expect(canTransitionStatus("failed", "executing")).toBe(false)
    expect(canTransitionStatus("cancelled", "executing")).toBe(false)
    expect(canTransitionStatus("completed", "cancelled")).toBe(false)
  })

  it("forbids weird transitions", () => {
    expect(canTransitionStatus("executing", "completed")).toBe(false) // only via respond step
    expect(canTransitionStatus("planning", "waiting_input")).toBe(false)
    expect(canTransitionStatus("waiting_input", "planning")).toBe(false)
  })
})

describe("H1 agent — error code surfaces", () => {
  it("AgentStateError carries terminal_state code on terminal-state step", () => {
    try {
      applyStep(session({ status: "completed" }), observe())
      expect(true).toBe(false) // should have thrown
    } catch (e) {
      expect(e).toBeInstanceOf(AgentStateError)
      expect((e as AgentStateError).code).toBe("terminal_state")
    }
  })
})
