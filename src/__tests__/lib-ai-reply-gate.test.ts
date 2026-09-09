import { describe, it, expect } from "vitest"
import { readAiReplyPolicy, decideAiReplyAction, isInAiRollout } from "@/lib/inbox/ai-reply-gate"
import type { AiQualityMetadata } from "@/lib/ai/response-scorer"

/**
 * A2 — send-or-draft gate. Safety contract: with NO policy configured the gate must be a
 * no-op (send everything = pre-A2 behavior); once armed it fails CLOSED on missing scores.
 */

const q = (total: number, isClarifyingQuestion = false): AiQualityMetadata => ({
  grounded: total, complete: total, accurate: total, total,
  isClarifyingQuestion, scorerModel: "m", scoredAt: "t",
})
const failure: AiQualityMetadata = { scoringFailed: true, error: "api_error", scoredAt: "t" }

describe("readAiReplyPolicy", () => {
  it("defaults to gating off", () => {
    expect(readAiReplyPolicy(null)).toEqual({ draftMode: false, aiThreshold: null, aiRolloutPercent: null })
    expect(readAiReplyPolicy({ replyMode: "ai" })).toEqual({ draftMode: false, aiThreshold: null, aiRolloutPercent: null })
  })
  it("reads draftMode and a valid threshold", () => {
    expect(readAiReplyPolicy({ draftMode: true, aiThreshold: 0.7 })).toEqual({ draftMode: true, aiThreshold: 0.7, aiRolloutPercent: null })
  })
  it("rejects out-of-range / non-numeric thresholds", () => {
    expect(readAiReplyPolicy({ aiThreshold: 1.5 }).aiThreshold).toBeNull()
    expect(readAiReplyPolicy({ aiThreshold: "0.7" }).aiThreshold).toBeNull()
  })
  it("A3: reads a valid rollout percent, rejects junk", () => {
    expect(readAiReplyPolicy({ aiRolloutPercent: 25 }).aiRolloutPercent).toBe(25)
    expect(readAiReplyPolicy({ aiRolloutPercent: 0 }).aiRolloutPercent).toBe(0)
    expect(readAiReplyPolicy({ aiRolloutPercent: 101 }).aiRolloutPercent).toBeNull()
    expect(readAiReplyPolicy({ aiRolloutPercent: 33.5 }).aiRolloutPercent).toBeNull()
    expect(readAiReplyPolicy({ aiRolloutPercent: "50" }).aiRolloutPercent).toBeNull()
  })
})

describe("isInAiRollout (A3)", () => {
  it("null / 100 → everyone; 0 → no one", () => {
    expect(isInAiRollout("cv1", null)).toBe(true)
    expect(isInAiRollout("cv1", 100)).toBe(true)
    expect(isInAiRollout("cv1", 0)).toBe(false)
  })
  it("deterministic: the same conversation always gets the same verdict", () => {
    for (const id of ["cv-a", "cv-b", "cv-c"]) {
      const first = isInAiRollout(id, 50)
      for (let i = 0; i < 5; i++) expect(isInAiRollout(id, 50)).toBe(first)
    }
  })
  it("monotonic: raising the percentage never drops an included conversation", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `conv_${i}_${i * 7919}`)
    for (const id of ids) {
      let wasIn = false
      for (const p of [10, 25, 50, 75, 100]) {
        const now = isInAiRollout(id, p)
        if (wasIn) expect(now).toBe(true)
        wasIn = now
      }
    }
  })
  it("distribution sanity: ~half of many ids land inside a 50% rollout", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `cuid_like_${i}_${(i * 2654435761) % 997}`)
    const inCount = ids.filter((id) => isInAiRollout(id, 50)).length
    expect(inCount).toBeGreaterThan(350)
    expect(inCount).toBeLessThan(650)
  })
})

describe("decideAiReplyAction", () => {
  const off = { draftMode: false, aiThreshold: null, aiRolloutPercent: null }
  const armed = { draftMode: false, aiThreshold: 0.7, aiRolloutPercent: null }

  it("no policy → send, even with a low score or no score (pre-A2 behavior preserved)", () => {
    expect(decideAiReplyAction(off, q(0.1))).toEqual({ action: "send" })
    expect(decideAiReplyAction(off, undefined)).toEqual({ action: "send" })
    expect(decideAiReplyAction(off, failure)).toEqual({ action: "send" })
  })

  it("draftMode → always draft (even a perfect score)", () => {
    expect(decideAiReplyAction({ draftMode: true, aiThreshold: null, aiRolloutPercent: null }, q(1))).toEqual({ action: "draft", reason: "draft_mode" })
  })

  it("threshold armed: below → draft, at/above → send", () => {
    expect(decideAiReplyAction(armed, q(0.69))).toEqual({ action: "draft", reason: "below_threshold" })
    expect(decideAiReplyAction(armed, q(0.7))).toEqual({ action: "send" })
    expect(decideAiReplyAction(armed, q(0.95))).toEqual({ action: "send" })
  })

  it("threshold armed: clarifying question → draft regardless of score", () => {
    expect(decideAiReplyAction(armed, q(0.99, true))).toEqual({ action: "draft", reason: "clarifying_question" })
  })

  it("threshold armed: scoring failure / missing score → fail CLOSED (draft)", () => {
    expect(decideAiReplyAction(armed, failure)).toEqual({ action: "draft", reason: "scoring_failed" })
    expect(decideAiReplyAction(armed, undefined)).toEqual({ action: "draft", reason: "scoring_failed" })
  })

  it("escalation hand-off bypasses the gate — customer must hear it now", () => {
    expect(decideAiReplyAction({ draftMode: true, aiThreshold: null, aiRolloutPercent: null }, q(0.1), { escalate: true })).toEqual({ action: "send" })
    expect(decideAiReplyAction(armed, failure, { escalate: true })).toEqual({ action: "send" })
  })
})
