/**
 * Tests for H2 Atlas Reasoning Engine slice 1 — prompt builder,
 * decision evaluator, driver orchestration. Pure-functional + mocked LLM.
 */
import { describe, it, expect, vi } from "vitest"
import {
  formatDoc,
  formatRagSection,
  formatStepRecord,
  formatTraceSection,
  formatToolList,
  formatBudgetSection,
  buildPlanningPrompt,
  MAX_DOC_CHARS,
} from "@/lib/agent/atlas/prompt-builder"
import {
  evaluateDecision,
  resolveAvailableTools,
} from "@/lib/agent/atlas/decision-evaluator"
import { runIteration } from "@/lib/agent/atlas/driver"
import type {
  LLMClient,
  PlanDecision,
  PlanEnvelope,
  PlanStepRecord,
  RetrievedDoc,
} from "@/lib/agent/atlas/types"

const doc = (overrides: Partial<RetrievedDoc> = {}): RetrievedDoc => ({
  id: "kb_article:1",
  kind: "kb_article",
  title: "Test KB",
  content: "Body content for the article.",
  score: 0.9,
  ...overrides,
})

const envelope = (overrides: Partial<PlanEnvelope> = {}): PlanEnvelope => ({
  goal: "Find recent deals worth >$50k",
  agentRole: "Sales Analyst",
  systemPrompt: "You are a senior sales analyst.",
  recentSteps: [],
  availableTools: ["add_note", "log_activity"],
  rag: { docs: [], memory: undefined },
  costSoFarUsd: 0,
  budgetUsd: 0.5,
  stepCount: 0,
  maxSteps: 20,
  ...overrides,
})

const step = (overrides: Partial<PlanStepRecord> = {}): PlanStepRecord => ({
  stepIndex: 0,
  kind: "observe",
  observation: "Initial observation",
  outcome: "ok",
  ...overrides,
})

/* ─── Prompt builder ──────────────────────────────────────────────────── */

describe("H2 atlas — formatDoc", () => {
  it("truncates content exceeding cap with ellipsis", () => {
    const d = doc({ content: "x".repeat(MAX_DOC_CHARS + 100) })
    const out = formatDoc(d)
    expect(out.length).toBeLessThan(MAX_DOC_CHARS + 200)
    expect(out.endsWith("…")).toBe(true)
  })

  it("keeps short content verbatim", () => {
    const d = doc({ content: "Short body" })
    expect(formatDoc(d)).toContain("Short body")
  })

  it("includes score in header when present", () => {
    expect(formatDoc(doc({ score: 0.85 }))).toContain("score=0.85")
  })

  it("omits score when undefined", () => {
    expect(formatDoc(doc({ score: undefined }))).not.toContain("score=")
  })

  it("includes kind + title in header", () => {
    const out = formatDoc(doc({ kind: "deal", title: "Acme renewal" }))
    expect(out).toContain("deal: Acme renewal")
  })
})

describe("H2 atlas — formatRagSection", () => {
  it("empty docs → placeholder message", () => {
    expect(formatRagSection([])).toContain("No relevant documents")
  })

  it("renders all docs when within budget", () => {
    const out = formatRagSection([doc({ id: "1" }), doc({ id: "2" })])
    expect(out).toContain("Test KB")
    expect(out.split("Test KB").length).toBe(3) // 2 occurrences
  })

  it("truncates to per-doc cap, then surfaces 'N more' tail", () => {
    const docs: RetrievedDoc[] = Array.from({ length: 30 }, (_, i) =>
      doc({ id: `${i}`, content: "x".repeat(2000) })
    )
    const out = formatRagSection(docs, 5000)
    expect(out).toMatch(/more docs not shown/)
  })

  it("when even the first doc exceeds total budget, emits only the tail-marker", () => {
    // Single doc, body > 1200 (per-doc cap), total budget tiny → no content fits.
    const docs = [doc({ content: "x".repeat(5000) })]
    const out = formatRagSection(docs, 100)
    expect(out).toMatch(/1 more docs not shown/)
    // Tail-marker should be the only content
    expect(out).not.toMatch(/Test KB/)
  })
})

describe("H2 atlas — formatStepRecord", () => {
  it("includes all non-empty fields", () => {
    const out = formatStepRecord(step({
      stepIndex: 3,
      kind: "act",
      thought: "Need to check the deal",
      toolName: "add_note",
      toolInputBrief: '{"text":"hi"}',
      outcome: "ok",
    }))
    expect(out).toContain("#3")
    expect(out).toContain("[act]")
    expect(out).toContain("thought:")
    expect(out).toContain("tool: add_note")
  })

  it("hides outcome line when ok", () => {
    expect(formatStepRecord(step({ outcome: "ok" }))).not.toContain("outcome:")
  })

  it("surfaces error message when outcome=error", () => {
    const out = formatStepRecord(step({ outcome: "error", errorMessage: "Tool failed" }))
    expect(out).toContain("outcome: error")
    expect(out).toContain("Tool failed")
  })

  it("truncates long values to brief cap", () => {
    const longText = "x".repeat(400)
    const out = formatStepRecord(step({ thought: longText }), 100)
    expect(out.length).toBeLessThan(longText.length)
    expect(out).toContain("…")
  })
})

describe("H2 atlas — formatTraceSection", () => {
  it("placeholder when no steps", () => {
    expect(formatTraceSection([])).toContain("first iteration")
  })

  it("includes recent steps", () => {
    const steps = [step({ stepIndex: 0 }), step({ stepIndex: 1, kind: "think" })]
    expect(formatTraceSection(steps)).toContain("#0")
  })

  it("elides earlier steps with summary line when > maxSteps", () => {
    const steps: PlanStepRecord[] = Array.from({ length: 20 }, (_, i) =>
      step({ stepIndex: i, kind: "observe" })
    )
    const out = formatTraceSection(steps, 5)
    expect(out).toMatch(/15 earlier step\(s\) elided/)
    expect(out).toContain("#15")
    expect(out).toContain("#19")
    expect(out).not.toContain("#5") // before cutoff
  })
})

describe("H2 atlas — formatToolList", () => {
  it("formats as bulleted list", () => {
    expect(formatToolList(["add_note", "create_task"])).toBe("- add_note\n- create_task")
  })

  it("placeholder when empty", () => {
    expect(formatToolList([])).toContain("No tools available")
  })
})

describe("H2 atlas — formatBudgetSection", () => {
  it("shows percent when budget set", () => {
    const out = formatBudgetSection(envelope({ costSoFarUsd: 0.25, budgetUsd: 0.5 }))
    expect(out).toContain("$0.2500 / $0.5000")
    expect(out).toContain("50%")
  })

  it("omits percent when budget null", () => {
    const out = formatBudgetSection(envelope({ budgetUsd: null }))
    expect(out).toContain("Cost so far")
    expect(out).not.toMatch(/%/)
  })
})

describe("H2 atlas — buildPlanningPrompt", () => {
  it("system message includes role + agent's system prompt", () => {
    const p = buildPlanningPrompt(envelope({
      agentRole: "SDR",
      systemPrompt: "Be concise.",
    }))
    expect(p.system).toContain("SDR")
    expect(p.system).toContain("Be concise.")
  })

  it("system message includes planning protocol", () => {
    const p = buildPlanningPrompt(envelope())
    expect(p.system).toContain("PLANNING PROTOCOL")
    expect(p.system).toContain("observe")
    expect(p.system).toContain("respond")
  })

  it("user message includes goal + budget + tools + RAG + trace", () => {
    const p = buildPlanningPrompt(envelope({
      goal: "Find renewals",
      availableTools: ["add_note"],
      rag: { docs: [doc({ title: "Renewal SOP" })], memory: "Past: discussed pricing" },
      recentSteps: [step()],
    }))
    expect(p.user).toContain("GOAL")
    expect(p.user).toContain("Find renewals")
    expect(p.user).toContain("BUDGET")
    expect(p.user).toContain("AVAILABLE TOOLS")
    expect(p.user).toContain("add_note")
    expect(p.user).toContain("RETRIEVED CONTEXT")
    expect(p.user).toContain("Renewal SOP")
    expect(p.user).toContain("SESSION MEMORY")
    expect(p.user).toContain("Past: discussed pricing")
    expect(p.user).toContain("TRACE")
  })

  it("omits SESSION MEMORY section when absent", () => {
    const p = buildPlanningPrompt(envelope({ rag: { docs: [] } }))
    expect(p.user).not.toContain("SESSION MEMORY")
  })
})

/* ─── Decision evaluator ──────────────────────────────────────────────── */

describe("H2 atlas — evaluateDecision", () => {
  const tools = ["add_note", "create_task", "create_deal"]

  it("observe is always admissible", () => {
    const r = evaluateDecision({ kind: "observe", observation: "looked at deal" }, tools)
    expect(r.admissible).toBe(true)
  })

  it("think is always admissible", () => {
    expect(evaluateDecision({ kind: "think", thought: "plan" }, tools).admissible).toBe(true)
  })

  it("respond is always admissible", () => {
    expect(evaluateDecision({ kind: "respond", message: "done" }, tools).admissible).toBe(true)
  })

  it("ask is always admissible", () => {
    expect(evaluateDecision({ kind: "ask", question: "which deal?" }, tools).admissible).toBe(true)
  })

  it("act with available tool is admissible + surfaces risk + approval flag", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "add_note", toolInput: { text: "hi" } },
      tools
    )
    expect(r.admissible).toBe(true)
    expect(r.toolRisk).toBe("low")
    expect(r.requiresApproval).toBe(false)
  })

  it("act with high-risk tool flags requiresApproval", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "create_deal", toolInput: { name: "X", value: 100 } },
      tools
    )
    expect(r.admissible).toBe(true)
    expect(r.toolRisk).toBe("high")
    expect(r.requiresApproval).toBe(true)
  })

  it("act with tool NOT in availableTools is rejected", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "send_email", toolInput: { to: "x" } },
      tools
    )
    expect(r.admissible).toBe(false)
    expect(r.reason).toContain("not in agent's available tools")
  })

  it("act with non-object toolInput is rejected", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "add_note", toolInput: "not an object" as unknown as Record<string, unknown> },
      tools
    )
    expect(r.admissible).toBe(false)
    expect(r.reason).toMatch(/must be a plain object/)
  })

  it("act with array toolInput is rejected", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "add_note", toolInput: [] as unknown as Record<string, unknown> },
      tools
    )
    expect(r.admissible).toBe(false)
  })

  it("act with null toolInput is rejected", () => {
    const r = evaluateDecision(
      { kind: "act", toolName: "add_note", toolInput: null as unknown as Record<string, unknown> },
      tools
    )
    expect(r.admissible).toBe(false)
  })
})

describe("H2 atlas — resolveAvailableTools", () => {
  it("intersects enabled set with TOOL_META registry", () => {
    const r = resolveAvailableTools(["add_note", "bogus_tool", "create_task"])
    expect(r).toContain("add_note")
    expect(r).toContain("create_task")
    expect(r).not.toContain("bogus_tool")
  })

  it("empty enabled → empty result", () => {
    expect(resolveAvailableTools([])).toEqual([])
  })
})

/* ─── Driver ──────────────────────────────────────────────────────────── */

function mockLLM(decision: PlanDecision): LLMClient {
  return { decideNext: vi.fn().mockResolvedValue(decision) }
}

describe("H2 atlas — runIteration", () => {
  it("dispatches execute outcome for low-risk act", async () => {
    const llm = mockLLM({ kind: "act", toolName: "add_note", toolInput: { text: "hi" } })
    const r = await runIteration({ envelope: envelope(), llm })
    expect(r.kind).toBe("execute")
    if (r.kind === "execute") {
      expect(r.evaluation.toolRisk).toBe("low")
    }
  })

  it("routes high-risk act to approve outcome", async () => {
    const llm = mockLLM({ kind: "act", toolName: "create_deal", toolInput: { name: "x" } })
    const env = envelope({ availableTools: ["create_deal"] })
    const r = await runIteration({ envelope: env, llm })
    expect(r.kind).toBe("approve")
  })

  it("routes respond decision to respond outcome (terminal)", async () => {
    const llm = mockLLM({ kind: "respond", message: "All done." })
    const r = await runIteration({ envelope: envelope(), llm })
    expect(r.kind).toBe("respond")
    if (r.kind === "respond") {
      expect(r.decision.message).toBe("All done.")
    }
  })

  it("routes ask decision to ask outcome (waiting_input)", async () => {
    const llm = mockLLM({ kind: "ask", question: "Which deal?" })
    const r = await runIteration({ envelope: envelope(), llm })
    expect(r.kind).toBe("ask")
  })

  it("rejects act decision when tool not in availableTools", async () => {
    const llm = mockLLM({ kind: "act", toolName: "send_email", toolInput: { to: "x" } })
    const env = envelope({ availableTools: ["add_note"] })
    const r = await runIteration({ envelope: env, llm })
    expect(r.kind).toBe("reject")
    if (r.kind === "reject") {
      expect(r.evaluation.admissible).toBe(false)
    }
  })

  it("passes options through to LLM client", async () => {
    const llm = mockLLM({ kind: "observe", observation: "x" })
    await runIteration({ envelope: envelope(), llm, options: { timeoutMs: 5000, modelOverride: "claude-sonnet" } })
    expect(llm.decideNext).toHaveBeenCalledWith(
      expect.any(Object),
      { timeoutMs: 5000, modelOverride: "claude-sonnet" }
    )
  })

  it("always returns the composed prompt in the outcome", async () => {
    const llm = mockLLM({ kind: "observe", observation: "x" })
    const r = await runIteration({ envelope: envelope(), llm })
    expect(r.prompt.system).toBeDefined()
    expect(r.prompt.user).toBeDefined()
  })
})
