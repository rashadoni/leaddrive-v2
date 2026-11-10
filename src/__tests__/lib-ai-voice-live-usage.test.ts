/**
 * The voice assistant's real price (owner, 2026-11-10: «Да, сделай»): Gemini
 * Live sends usageMetadata with every turn, each turn billing the whole
 * conversation again; the console adds them up and the server prices them.
 */
import { describe, expect, it } from "vitest"
import { addLiveUsage, EMPTY_LIVE_USAGE, parseLiveUsage } from "@/lib/ai/voice/live-usage"
import { LIVE_AUDIO_IN_MINUTE_USD, liveUsageCostUsd } from "@/lib/ai/gateway/pricing"

describe("Gemini Live usage of a voice conversation", () => {
  it("adds turns up, splitting text from audio as Google marks them", () => {
    let totals = addLiveUsage(EMPTY_LIVE_USAGE, {
      promptTokenCount: 9_000,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 8_500 }, { modality: "AUDIO", tokenCount: 500 }],
      responseTokenCount: 300,
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 300 }],
    })
    // The second turn bills the first one again, plus tool results and thinking.
    totals = addLiveUsage(totals, {
      promptTokenCount: 10_000,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 9_200 }],
      toolUsePromptTokenCount: 400,
      thoughtsTokenCount: 50,
      responseTokenCount: 200,
    })
    expect(totals).toEqual({ textIn: 8_500 + 9_200 + 400, audioIn: 500 + 800, textOut: 50, audioOut: 300 + 200, turns: 2 })
    expect(EMPTY_LIVE_USAGE.turns).toBe(0)
  })

  it("counts a turn with no breakdown as audio — the dearer kind", () => {
    expect(addLiveUsage(EMPTY_LIVE_USAGE, { promptTokenCount: 1_000, responseTokenCount: 100 }))
      .toEqual({ textIn: 0, audioIn: 1_000, textOut: 0, audioOut: 100, turns: 1 })
  })

  it("prices tokens at the Live table: text in $0.75, audio in $3, text out $4.50, audio out $12 per million", () => {
    expect(liveUsageCostUsd({ textIn: 1_000_000, audioIn: 0, textOut: 0, audioOut: 0 })).toBeCloseTo(0.75, 12)
    expect(liveUsageCostUsd({ textIn: 100_000, audioIn: 10_000, textOut: 1_000, audioOut: 5_000 })).toBeCloseTo(0.075 + 0.03 + 0.0045 + 0.06, 12)
    // A minute of incoming audio alone: 1500 tokens at $3.
    expect(LIVE_AUDIO_IN_MINUTE_USD).toBeCloseTo(0.0045, 12)
  })

  it("takes from the console only a plausible count, never a guess", () => {
    const ok = { textIn: 10, audioIn: 20, textOut: 3, audioOut: 4, turns: 1 }
    expect(parseLiveUsage(ok)).toEqual(ok)
    for (const bad of [null, "x", {}, { ...ok, turns: 0 }, { ...ok, textIn: -1 }, { ...ok, audioIn: 1.5 }, { ...ok, audioOut: 60_000_000 }, { ...ok, turns: "1" }]) {
      expect(parseLiveUsage(bad)).toBeNull()
    }
  })
})
