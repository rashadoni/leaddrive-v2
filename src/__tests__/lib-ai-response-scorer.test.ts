import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A1 — LLM-judge quality scoring. The safety-critical contract: fail-soft (a scoring
 * failure NEVER throws — the caller must still send the reply), clamped axes, total
 * computed here (not trusted from the judge), and the judge call itself metered into
 * AiInteractionLog (agentType "response_scorer") so the daily budget sees it.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { aiInteractionLog: { create: vi.fn() } },
}))
const anthropicCreate = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: anthropicCreate } }) }))

import { scoreAiResponse, parseJudgeOutput, qualityMetadata } from "@/lib/ai/response-scorer"
import { prisma } from "@/lib/prisma"

const OPTS = {
  organizationId: "o1",
  question: "Сколько занимает возврат?",
  context: "[KB] Возврат занимает 14 дней.",
  response: "Возврат занимает 14 дней.",
  sessionId: "s1",
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as never)
  anthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: '{"grounded":0.9,"complete":0.8,"accurate":1.0,"is_clarifying_question":false}' }],
    usage: { input_tokens: 100, output_tokens: 30 },
  })
})

describe("scoreAiResponse", () => {
  it("returns clamped axes and computes total as the mean (never trusts a judge total)", async () => {
    const r = await scoreAiResponse(OPTS)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.score).toMatchObject({ grounded: 0.9, complete: 0.8, accurate: 1.0, isClarifyingQuestion: false })
    expect(r.score.total).toBe(0.9) // (0.9+0.8+1.0)/3 = 0.9
    expect(r.score.scorerModel).toBe("claude-haiku-4-5-20251001")
    expect(typeof r.score.scoredAt).toBe("string")
  })

  it("meters the judge call: AiInteractionLog row with agentType response_scorer + real cost", async () => {
    await scoreAiResponse(OPTS)
    const log = (vi.mocked(prisma.aiInteractionLog.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(log.organizationId).toBe("o1")
    expect(log.sessionId).toBe("s1")
    expect(log.agentType).toBe("response_scorer")
    expect(log.costUsd as number).toBeGreaterThan(0)
  })

  it("clamps out-of-range judge values into [0,1]", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"grounded":1.7,"complete":-0.4,"accurate":0.5,"is_clarifying_question":false}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const r = await scoreAiResponse(OPTS)
    if (!r.ok) throw new Error("expected ok")
    expect(r.score.grounded).toBe(1)
    expect(r.score.complete).toBe(0)
    expect(r.score.accurate).toBe(0.5)
    expect(r.score.total).toBe(0.5)
  })

  it("tolerates code fences / prose around the JSON", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: 'Вот оценка:\n```json\n{"grounded":0.6,"complete":0.6,"accurate":0.6,"is_clarifying_question":true}\n```' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const r = await scoreAiResponse(OPTS)
    if (!r.ok) throw new Error("expected ok")
    expect(r.score.isClarifyingQuestion).toBe(true)
    expect(r.score.total).toBe(0.6)
  })

  it("malformed judge output → fail-soft json_parse, but the spend is still logged", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "не могу оценить" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const r = await scoreAiResponse(OPTS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected failure")
    expect(r.failure).toMatchObject({ scoringFailed: true, error: "json_parse" })
    expect(prisma.aiInteractionLog.create).toHaveBeenCalledTimes(1)
  })

  it("missing input → missing_input, judge never called", async () => {
    const r = await scoreAiResponse({ ...OPTS, response: "  " })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected failure")
    expect(r.failure.error).toBe("missing_input")
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("no ANTHROPIC_API_KEY → no_api_key, judge never called", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const r = await scoreAiResponse(OPTS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected failure")
    expect(r.failure.error).toBe("no_api_key")
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("API error → fail-soft api_error (never throws)", async () => {
    anthropicCreate.mockRejectedValue(new Error("upstream 529"))
    const r = await scoreAiResponse(OPTS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected failure")
    expect(r.failure.error).toBe("api_error")
  })

  it("masks PII before the judge sees the inputs", async () => {
    await scoreAiResponse({
      ...OPTS,
      question: "Мой email aysel@example.com, телефон +994 50 123 45 67",
      response: "Отправим на aysel@example.com.",
    })
    const arg = anthropicCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const payload = arg.messages[0].content
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).toContain("[EMAIL_")
  })
})

describe("parseJudgeOutput", () => {
  it("returns null when a required axis is missing", () => {
    expect(parseJudgeOutput('{"grounded":0.9,"complete":0.8}')).toBeNull()
  })
  it("returns null on non-numeric axes", () => {
    expect(parseJudgeOutput('{"grounded":"high","complete":0.8,"accurate":0.9}')).toBeNull()
  })
})

describe("qualityMetadata", () => {
  it("passes the score through on success and the failure shape on failure", () => {
    const score = { grounded: 1, complete: 1, accurate: 1, total: 1, isClarifyingQuestion: false, scorerModel: "m", scoredAt: "t" }
    expect(qualityMetadata({ ok: true, score })).toBe(score)
    const failure = { scoringFailed: true as const, error: "api_error" as const, scoredAt: "t" }
    expect(qualityMetadata({ ok: false, failure })).toBe(failure)
  })
})
