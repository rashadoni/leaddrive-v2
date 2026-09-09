/**
 * Tests for A7 Conversation Intelligence slice 1 — extractors + analyzer.
 * Pure functional + mocked LLM client.
 */
import { describe, it, expect, vi } from "vitest"
import {
  extractCompetitorMentions,
  evaluateCoachingHints,
} from "@/lib/conversation-intel/extractors"
import { analyzeTranscript } from "@/lib/conversation-intel/analyzer"
import type {
  AnalyzerLLMClient,
  AnalyzerLLMResponse,
} from "@/lib/conversation-intel/types"

/* ─── extractCompetitorMentions ───────────────────────────────────────── */

describe("A7 — extractCompetitorMentions", () => {
  it("matches whole-word case-insensitively", () => {
    const r = extractCompetitorMentions(
      "We compared with HubSpot and Pipedrive last quarter.",
      ["HubSpot", "Pipedrive", "Salesforce"]
    )
    expect(r).toHaveLength(2)
    expect(r.map(m => m.name).sort()).toEqual(["HubSpot", "Pipedrive"])
  })

  it("counts repeated mentions", () => {
    const r = extractCompetitorMentions(
      "Hubspot is what they use now. Hubspot pricing is too high. They tried Hubspot before.",
      ["Hubspot"]
    )
    expect(r[0].count).toBe(3)
  })

  it("does not match substrings (whole word only)", () => {
    expect(extractCompetitorMentions("hubspotter is unrelated", ["HubSpot"])).toEqual([])
  })

  it("escapes regex-special chars in competitor names", () => {
    const r = extractCompetitorMentions(
      "We use Pipedrive (the EU edition).",
      ["Pipedrive (the EU edition)"]
    )
    expect(r).toHaveLength(1)
    expect(r[0].count).toBe(1)
  })

  it("returns context excerpt with leading/trailing ellipsis when truncated", () => {
    const tx = "x".repeat(200) + " HubSpot " + "y".repeat(200)
    const r = extractCompetitorMentions(tx, ["HubSpot"])
    expect(r[0].context.startsWith("…")).toBe(true)
    expect(r[0].context.endsWith("…")).toBe(true)
    expect(r[0].context).toContain("HubSpot")
  })

  it("preserves original casing of competitor name", () => {
    const r = extractCompetitorMentions("we use HUBSPOT", ["HubSpot"])
    expect(r[0].name).toBe("HubSpot")
  })

  it("empty transcript → empty result", () => {
    expect(extractCompetitorMentions("", ["X"])).toEqual([])
  })

  it("empty competitors → empty result", () => {
    expect(extractCompetitorMentions("transcript here", [])).toEqual([])
  })

  it("blank competitor names skipped", () => {
    const r = extractCompetitorMentions("Hubspot is good", ["", "  ", "Hubspot"])
    expect(r).toHaveLength(1)
  })
})

/* ─── evaluateCoachingHints ───────────────────────────────────────────── */

describe("A7 — evaluateCoachingHints", () => {
  it("fires missed_value_prop when none of expected props mentioned on call ≥ 60s", () => {
    const hints = evaluateCoachingHints({
      transcript: "Hey, talked about pricing and timeline. Anything else?",
      sentiment: "neutral",
      expectedValueProps: ["ROI calculator", "24/7 support", "API access"],
      durationSeconds: 600,
    })
    expect(hints.some(h => h.rule === "missed_value_prop")).toBe(true)
    const missed = hints.find(h => h.rule === "missed_value_prop")!
    expect(missed.severity).toBe("warning")
  })

  it("fires partial_value_prop when some props mentioned", () => {
    const hints = evaluateCoachingHints({
      transcript: "We have a great ROI calculator and 24/7 support.",
      sentiment: "neutral",
      expectedValueProps: ["ROI calculator", "24/7 support", "API access"],
      durationSeconds: 600,
    })
    expect(hints.some(h => h.rule === "partial_value_prop")).toBe(true)
    expect(hints.find(h => h.rule === "missed_value_prop")).toBeUndefined()
  })

  it("does NOT fire missed_value_prop OR partial_value_prop when ALL props mentioned", () => {
    const hints = evaluateCoachingHints({
      transcript: "Our ROI calculator is great, 24/7 support is included, and API access ships day one.",
      sentiment: "neutral",
      expectedValueProps: ["ROI calculator", "24/7 support", "API access"],
      durationSeconds: 600,
    })
    expect(hints.find(h => h.rule === "missed_value_prop")).toBeUndefined()
    expect(hints.find(h => h.rule === "partial_value_prop")).toBeUndefined()
  })

  it("matches value props as whole words (no 'AI' → 'available' false positive)", () => {
    const hints = evaluateCoachingHints({
      transcript: "Our SaaS is highly available and reliable.", // "AI" appears as substring of "available"
      sentiment: "neutral",
      expectedValueProps: ["AI"],
      durationSeconds: 600,
    })
    // "AI" was NOT mentioned as a whole word → missed_value_prop should fire.
    expect(hints.some(h => h.rule === "missed_value_prop")).toBe(true)
  })

  it("does NOT fire missed_value_prop on short calls", () => {
    const hints = evaluateCoachingHints({
      transcript: "Hello?",
      sentiment: "neutral",
      expectedValueProps: ["ROI calculator"],
      durationSeconds: 10,
    })
    expect(hints.some(h => h.rule === "missed_value_prop")).toBe(false)
  })

  it("does NOT fire missed_value_prop when no expected props given", () => {
    const hints = evaluateCoachingHints({
      transcript: "anything",
      sentiment: "neutral",
      durationSeconds: 600,
    })
    expect(hints.some(h => h.rule === "missed_value_prop")).toBe(false)
  })

  it("fires negative_sentiment with critical severity on very_negative", () => {
    const hints = evaluateCoachingHints({
      transcript: "x",
      sentiment: "very_negative",
    })
    const ns = hints.find(h => h.rule === "negative_sentiment")!
    expect(ns.severity).toBe("critical")
  })

  it("fires negative_sentiment with warning on negative", () => {
    const hints = evaluateCoachingHints({
      transcript: "x",
      sentiment: "negative",
    })
    expect(hints.find(h => h.rule === "negative_sentiment")?.severity).toBe("warning")
  })

  it("does NOT fire negative_sentiment on positive/neutral", () => {
    expect(evaluateCoachingHints({ transcript: "x", sentiment: "neutral" }).find(h => h.rule === "negative_sentiment")).toBeUndefined()
    expect(evaluateCoachingHints({ transcript: "x", sentiment: "positive" }).find(h => h.rule === "negative_sentiment")).toBeUndefined()
  })

  it("fires competitor_mentioned when count > 0", () => {
    const hints = evaluateCoachingHints({
      transcript: "x",
      sentiment: "neutral",
      competitorMentionCount: 2,
    })
    expect(hints.some(h => h.rule === "competitor_mentioned")).toBe(true)
  })

  it("fires short_call when duration < 30s AND transcript < 200 chars", () => {
    const hints = evaluateCoachingHints({
      transcript: "Hello?",
      sentiment: "neutral",
      durationSeconds: 15,
    })
    expect(hints.some(h => h.rule === "short_call")).toBe(true)
  })

  it("does NOT fire short_call when duration short but transcript long", () => {
    const hints = evaluateCoachingHints({
      transcript: "x".repeat(500),
      sentiment: "neutral",
      durationSeconds: 15,
    })
    expect(hints.some(h => h.rule === "short_call")).toBe(false)
  })

  it("multiple rules can fire in one evaluation", () => {
    const hints = evaluateCoachingHints({
      transcript: "barely said anything",
      sentiment: "negative",
      competitorMentionCount: 1,
      durationSeconds: 20,
    })
    const rules = hints.map(h => h.rule).sort()
    expect(rules).toContain("negative_sentiment")
    expect(rules).toContain("competitor_mentioned")
    expect(rules).toContain("short_call")
  })
})

/* ─── analyzeTranscript orchestrator ──────────────────────────────────── */

function mockLLM(response: Partial<AnalyzerLLMResponse> = {}): AnalyzerLLMClient {
  return {
    analyzeTranscript: vi.fn().mockResolvedValue({
      sentiment: "neutral",
      sentimentScore: 0.5,
      summary: "Mock summary",
      topics: ["pricing", "timeline"],
      actionItems: [],
      ...response,
    }),
  }
}

describe("A7 — analyzeTranscript", () => {
  it("returns sentinel insight for empty transcript without invoking LLM", async () => {
    const llm = mockLLM()
    const r = await analyzeTranscript({ llm, transcript: "" })
    expect(r.summary).toBe("(empty transcript)")
    expect(r.sentiment).toBe("neutral")
    expect(llm.analyzeTranscript).not.toHaveBeenCalled()
  })

  it("invokes LLM exactly once for non-empty transcript", async () => {
    const llm = mockLLM()
    await analyzeTranscript({ llm, transcript: "Real transcript content." })
    expect(llm.analyzeTranscript).toHaveBeenCalledTimes(1)
  })

  it("merges LLM result with rule-based competitor mentions", async () => {
    const llm = mockLLM({ summary: "discussed competitors" })
    const r = await analyzeTranscript({
      llm,
      transcript: "They are evaluating HubSpot and Pipedrive.",
      competitors: ["HubSpot", "Pipedrive", "Salesforce"],
    })
    expect(r.summary).toBe("discussed competitors")
    expect(r.competitorMentions).toHaveLength(2)
    expect(r.competitorMentions.map(m => m.name).sort()).toEqual(["HubSpot", "Pipedrive"])
  })

  it("merges coaching hints based on detected sentiment + competitor count", async () => {
    const llm = mockLLM({ sentiment: "very_negative" })
    const r = await analyzeTranscript({
      llm,
      transcript: "They are not happy with our service.",
      competitors: ["Acme"],
    })
    const rules = r.coachingHints.map(h => h.rule)
    expect(rules).toContain("negative_sentiment")
    expect(r.coachingHints.find(h => h.rule === "negative_sentiment")?.severity).toBe("critical")
  })

  it("passes context to LLM client", async () => {
    const llm = mockLLM()
    await analyzeTranscript({
      llm,
      transcript: "x",
      context: "B2B SaaS sales call",
      expectedValueProps: ["ROI"],
    })
    expect(llm.analyzeTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: "x",
        context: "B2B SaaS sales call",
        expectedValueProps: ["ROI"],
      })
    )
  })

  it("passes through LLM cost + latency + model fields", async () => {
    const llm = mockLLM({
      costUsd: 0.012,
      latencyMs: 1500,
      model: "claude-sonnet-test",
    })
    const r = await analyzeTranscript({ llm, transcript: "x" })
    expect(r.costUsd).toBe(0.012)
    expect(r.latencyMs).toBe(1500)
    expect(r.model).toBe("claude-sonnet-test")
  })

  it("version field is always 1 (schema lock)", async () => {
    const llm = mockLLM()
    const r = await analyzeTranscript({ llm, transcript: "x" })
    expect(r.version).toBe(1)
  })

  it("competitorMentions empty when no registry supplied", async () => {
    const llm = mockLLM()
    const r = await analyzeTranscript({
      llm,
      transcript: "We compared with HubSpot.",
    })
    expect(r.competitorMentions).toEqual([])
  })
})
