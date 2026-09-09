/**
 * Tests for H6 Einstein Email Insights slice 1 — pure detectors + analyzer.
 * No DB, no LLM (mocked), deterministic.
 */
import { describe, it, expect, vi } from "vitest"
import {
  MAX_SIGNALS,
  detectEmailSignals,
  reconcileUrgency,
} from "@/lib/email-insights/signal-detectors"
import { analyzeEmail } from "@/lib/email-insights/analyzer"
import type {
  EmailAnalyzerLLMClient,
  EmailAnalyzerLLMResponse,
  EmailSignal,
  EmailUrgency,
} from "@/lib/email-insights/types"

/* ─── detectEmailSignals ──────────────────────────────────────────────── */

describe("H6 — detectEmailSignals", () => {
  it("returns empty on empty inputs", () => {
    expect(detectEmailSignals("", "")).toEqual([])
  })

  it("detects urgency keywords case-insensitively + whole-word", () => {
    const s = detectEmailSignals("Need this ASAP", "Production is DOWN — please help")
    const kinds = s.map(x => x.kind)
    expect(kinds.filter(k => k === "urgent_keyword").length).toBeGreaterThanOrEqual(2)
    expect(s.some(x => x.match.toLowerCase() === "asap" && x.source === "subject")).toBe(true)
    expect(s.some(x => x.match.toLowerCase() === "down" && x.source === "body")).toBe(true)
  })

  it("does NOT match substrings (whole-word only)", () => {
    // "downstream" contains "down", but whole-word boundary must reject it.
    const s = detectEmailSignals("", "the downstream service handles this")
    expect(s.filter(x => x.kind === "urgent_keyword")).toHaveLength(0)
  })

  it("preserves original casing in the match field", () => {
    const s = detectEmailSignals("", "URGENT escalation needed")
    const urgent = s.find(x => x.kind === "urgent_keyword")!
    expect(urgent.match).toBe("URGENT")
  })

  it("deduplicates repeated occurrences within a single source", () => {
    const s = detectEmailSignals("", "asap asap ASAP asap")
    const urgent = s.filter(x => x.kind === "urgent_keyword" && x.source === "body")
    expect(urgent).toHaveLength(1)
  })

  it("emits subject + body separately when same keyword appears in both", () => {
    const s = detectEmailSignals("urgent ticket", "we need this urgent fix")
    const urgent = s.filter(x => x.kind === "urgent_keyword")
    expect(urgent).toHaveLength(2)
    expect(urgent.map(x => x.source).sort()).toEqual(["body", "subject"])
  })

  it("detects deadline phrases", () => {
    const s = detectEmailSignals("", "Please finish by Friday before EOD; the deadline is firm.")
    const deadlines = s.filter(x => x.kind === "deadline_phrase")
    expect(deadlines.length).toBeGreaterThanOrEqual(2)
  })

  it("detects negative indicators", () => {
    const s = detectEmailSignals(
      "Refund request",
      "This is unacceptable — your service is broken and I'm frustrated."
    )
    const negatives = s.filter(x => x.kind === "negative_indicator")
    const matches = negatives.map(n => n.match.toLowerCase())
    expect(matches).toContain("refund")
    expect(matches).toContain("unacceptable")
    expect(matches).toContain("frustrated")
  })

  it("orders signals: urgent → deadline → negative, subject before body", () => {
    const s = detectEmailSignals(
      "Urgent: refund",
      "This is unacceptable. We need it ASAP, by Friday."
    )
    const kinds = s.map(x => x.kind)
    // First urgent_keyword block, then deadline_phrase, then negative_indicator.
    const firstUrgent = kinds.indexOf("urgent_keyword")
    const firstDeadline = kinds.indexOf("deadline_phrase")
    const firstNegative = kinds.indexOf("negative_indicator")
    expect(firstUrgent).toBeLessThan(firstDeadline)
    expect(firstDeadline).toBeLessThan(firstNegative)
  })

  it("caps total signals at MAX_SIGNALS even with pathological input", () => {
    // Build a body with many distinct urgency keywords + deadline phrases
    // + negative indicators. With dedupe per source applied per keyword,
    // the cap should still kick in.
    const subject = "URGENT critical EMERGENCY blocker outage immediately"
    const body =
      "Production is DOWN and broken — showstopper level. " +
      "Please respond ASAP. " +
      "We need this by EOD today, by Friday before noon, due tomorrow, deadline is real. " +
      "Customer is frustrated, disappointed, angry — this is unacceptable, terrible, horrible, useless and wasted our time. " +
      "Need refund and to cancel the contract."
    const s = detectEmailSignals(subject, body)
    expect(s.length).toBe(MAX_SIGNALS)
    expect(MAX_SIGNALS).toBe(20)
  })

  it("does NOT include 'fire' as an urgency keyword (false-positive prone)", () => {
    // All 3 false-positive forms from the URGENCY_KEYWORDS docstring:
    // "fire alarm drill", "fire up the campaign", "fire away with questions".
    const s = detectEmailSignals(
      "Fire alarm drill",
      "let's fire up the campaign and fire away with questions"
    )
    expect(s.filter(x => x.kind === "urgent_keyword")).toHaveLength(0)
  })

  it("does NOT match 'fire' inside hyphenated composite words", () => {
    // Architect-flagged residual risk of \w-only boundary: "fire-up"
    // hyphenated form — `-` is non-word so a naive `\b`-style boundary
    // could still match "fire". Verify removal kept the door shut.
    const s = detectEmailSignals("Plan to fire-up the offsite", "")
    expect(s.filter(x => x.kind === "urgent_keyword")).toHaveLength(0)
  })

  it("excerpt has leading/trailing ellipsis when truncated", () => {
    const body = "x".repeat(200) + " urgent " + "y".repeat(200)
    const s = detectEmailSignals("", body)
    const u = s.find(x => x.kind === "urgent_keyword")!
    expect(u.excerpt.startsWith("…")).toBe(true)
    expect(u.excerpt.endsWith("…")).toBe(true)
    expect(u.excerpt).toContain("urgent")
  })
})

/* ─── reconcileUrgency ────────────────────────────────────────────────── */

describe("H6 — reconcileUrgency", () => {
  const mkSignals = (counts: Partial<Record<EmailSignal["kind"], number>>): EmailSignal[] => {
    const out: EmailSignal[] = []
    for (const [kind, n] of Object.entries(counts)) {
      for (let i = 0; i < (n ?? 0); i++) {
        out.push({
          kind: kind as EmailSignal["kind"],
          match: "x",
          excerpt: "x",
          source: "body",
        })
      }
    }
    return out
  }

  it("never de-escalates the LLM's baseline", () => {
    // LLM says critical, no signals — must stay critical.
    expect(reconcileUrgency("critical", [])).toBe("critical")
    // LLM says high, only one weak deadline — must stay high.
    expect(reconcileUrgency("high", mkSignals({ deadline_phrase: 1 }))).toBe("high")
  })

  it("escalates ≥2 urgent + deadline to critical", () => {
    const sig = mkSignals({ urgent_keyword: 2, deadline_phrase: 1 })
    expect(reconcileUrgency("low", sig)).toBe("critical")
    expect(reconcileUrgency("normal", sig)).toBe("critical")
  })

  it("escalates urgent + negative to at-least high", () => {
    expect(reconcileUrgency("low", mkSignals({ urgent_keyword: 1, negative_indicator: 1 }))).toBe("high")
  })

  it("escalates single urgent to at-least high", () => {
    expect(reconcileUrgency("low", mkSignals({ urgent_keyword: 1 }))).toBe("high")
  })

  it("escalates deadline-only to at-least normal", () => {
    expect(reconcileUrgency("low", mkSignals({ deadline_phrase: 1 }))).toBe("normal")
  })

  it("no signals → no escalation", () => {
    expect(reconcileUrgency("low", [])).toBe("low")
    expect(reconcileUrgency("normal", [])).toBe("normal")
  })
})

/* ─── analyzeEmail orchestrator ───────────────────────────────────────── */

function mockLLM(response: Partial<EmailAnalyzerLLMResponse> = {}): EmailAnalyzerLLMClient {
  return {
    analyzeEmail: vi.fn().mockResolvedValue({
      sentiment: "neutral",
      sentimentScore: 0.5,
      intent: "other",
      urgency: "normal",
      summary: "Mock summary",
      topics: [],
      suggestedActions: [],
      ...response,
    }),
  }
}

describe("H6 — analyzeEmail", () => {
  it("returns sentinel insight for empty subject + body without invoking LLM", async () => {
    const llm = mockLLM()
    const r = await analyzeEmail({ llm, subject: "", body: "" })
    expect(r.summary).toBe("(empty email)")
    expect(r.urgency).toBe("low")
    expect(r.intent).toBe("other")
    expect(llm.analyzeEmail).not.toHaveBeenCalled()
  })

  it("invokes LLM exactly once for non-empty input", async () => {
    const llm = mockLLM()
    await analyzeEmail({ llm, subject: "hi", body: "" })
    expect(llm.analyzeEmail).toHaveBeenCalledTimes(1)
  })

  it("merges deterministic signals onto the LLM result", async () => {
    const llm = mockLLM({ urgency: "normal", summary: "Customer asks for refund" })
    const r = await analyzeEmail({
      llm,
      subject: "URGENT: refund please",
      body: "This is unacceptable. I need it by Friday.",
    })
    expect(r.signals.length).toBeGreaterThan(0)
    expect(r.signals.some(s => s.kind === "urgent_keyword")).toBe(true)
    expect(r.signals.some(s => s.kind === "deadline_phrase")).toBe(true)
    expect(r.signals.some(s => s.kind === "negative_indicator")).toBe(true)
  })

  it("escalates urgency when signals say critical but LLM said normal", async () => {
    const llm = mockLLM({ urgency: "normal" })
    const r = await analyzeEmail({
      llm,
      subject: "URGENT: prod is DOWN",
      body: "Customer outage. We need it fixed by EOD today.",
    })
    expect(r.urgency).toBe("critical")
  })

  it("never de-escalates urgency below the LLM baseline", async () => {
    const llm = mockLLM({ urgency: "critical" })
    const r = await analyzeEmail({ llm, subject: "FYI quick update", body: "no rush at all" })
    expect(r.urgency).toBe("critical")
  })

  it("passes context + toneHints to the LLM", async () => {
    const llm = mockLLM()
    await analyzeEmail({
      llm,
      subject: "x",
      body: "y",
      context: "B2B SaaS support",
      toneHints: ["internal helpdesk"],
    })
    expect(llm.analyzeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "x",
        body: "y",
        context: "B2B SaaS support",
        toneHints: ["internal helpdesk"],
      })
    )
  })

  it("passes through cost + latency + model fields", async () => {
    const llm = mockLLM({ costUsd: 0.003, latencyMs: 800, model: "claude-haiku-test" })
    const r = await analyzeEmail({ llm, subject: "x", body: "y" })
    expect(r.costUsd).toBe(0.003)
    expect(r.latencyMs).toBe(800)
    expect(r.model).toBe("claude-haiku-test")
  })

  it("version field is always 1 (schema lock)", async () => {
    const llm = mockLLM()
    const r = await analyzeEmail({ llm, subject: "x", body: "y" })
    expect(r.version).toBe(1)
  })

  it("trims whitespace-only subject + body to the sentinel path", async () => {
    const llm = mockLLM()
    const r = await analyzeEmail({ llm, subject: "   ", body: "\n\t  " })
    expect(r.summary).toBe("(empty email)")
    expect(llm.analyzeEmail).not.toHaveBeenCalled()
  })

  it("forwards LLM topics + suggestedActions without mutation", async () => {
    const llm = mockLLM({
      topics: ["billing", "refund"],
      suggestedActions: [
        { text: "Forward to billing", priority: "high" },
        { text: "Acknowledge within 1h", priority: "normal" },
      ],
    })
    const r = await analyzeEmail({ llm, subject: "x", body: "y" })
    expect(r.topics).toEqual(["billing", "refund"])
    expect(r.suggestedActions).toHaveLength(2)
  })
})
