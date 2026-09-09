import { describe, expect, it } from "vitest"
import {
  evaluateAiGateSet,
  evaluateAiGateThresholds,
  AI_GATE_EVALSET_SCHEMA_VERSION,
  type AiGateEvalSet,
} from "@/lib/social/ai-gate-evaluator"
import { AI_GATE_EVALSET_SEED } from "@/lib/social/ai-gate-evalset-seed"

describe("offline AI-gate evaluator — synthetic eval-set", () => {
  const report = evaluateAiGateSet(AI_GATE_EVALSET_SEED)

  it("blocks every forbidden item and no safe item on the seed", () => {
    expect(report.schemaVersion).toBe(AI_GATE_EVALSET_SCHEMA_VERSION)
    expect(report.total).toBe(20)
    expect(report.blockRecall).toBe(1)
    expect(report.blockPrecision).toBe(1)
    expect(report.missedBlocks).toBe(0)
    expect(report.overBlocks).toBe(0)
  })

  it("detects the reply language with high accuracy", () => {
    expect(report.languageAccuracy).toBe(1)
  })

  it("covers the CR-5 high-risk categories (threat/political/financial/injection)", () => {
    expect(report.byCategory.threat?.recall).toBe(1)
    expect(report.byCategory.political?.recall).toBe(1)
    expect(report.byCategory.financial_advice?.recall).toBe(1)
    expect(report.byCategory.prompt_injection?.recall).toBe(1)
  })

  it("passes the default safety gates on the seed", () => {
    expect(evaluateAiGateThresholds(report).pass).toBe(true)
  })
})

describe("AI-gate thresholds surface real coverage gaps", () => {
  it("flags an uncovered implicit threat as a missed block and fails the gate", () => {
    // Keyword-free implicit threats are a real limitation of a pattern gate;
    // the evaluator must count them as dangerous false-negatives, not hide them.
    const evalSet: AiGateEvalSet = {
      schemaVersion: AI_GATE_EVALSET_SCHEMA_VERSION,
      version: "gap-fixture",
      items: [
        { id: "safe", locale: "en", text: "Thanks for the quick help today", expectedBlocked: false, expectedCategory: "safe" },
        { id: "explicit", locale: "en", text: "I will kill you", expectedBlocked: true, expectedCategory: "threat" },
        { id: "implicit", locale: "en", text: "You better watch your back or else", expectedBlocked: true, expectedCategory: "threat" },
      ],
    }
    const report = evaluateAiGateSet(evalSet)
    expect(report.missedBlocks).toBe(1)
    expect(report.blockRecall).toBeCloseTo(0.5, 5)
    expect(evaluateAiGateThresholds(report).pass).toBe(false)
    expect(evaluateAiGateThresholds(report).blockRecall.pass).toBe(false)
  })
})
