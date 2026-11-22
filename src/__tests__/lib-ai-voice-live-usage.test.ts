/**
 * The voice assistant's real price (owner, 2026-11-10: «Да, сделай»): Gemini
 * Live sends usageMetadata with every turn, each turn billing the whole
 * conversation again; the console adds them up and the server prices them.
 *
 * 2026-11-22, reconciliation with the Google bill: tokens Google reports with
 * no modality are counted apart and priced as text, not as audio.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { addLiveUsage, EMPTY_LIVE_USAGE, parseLiveUsage, type LiveUsageMetadata } from "@/lib/ai/voice/live-usage"
import { LIVE_AUDIO_IN_MINUTE_USD, liveTokenTotals, liveUsageCostUsd } from "@/lib/ai/gateway/pricing"

const stand = JSON.parse(readFileSync("src/__tests__/fixtures/gemini-live-stand-usage.json", "utf8")) as {
  orderLine62s: { turns: LiveUsageMetadata[] }
  bookingCall190s: { turns: LiveUsageMetadata[] }
}

describe("Gemini Live usage of a voice conversation", () => {
  it("adds turns up, splitting text from audio as Google marks them and keeping the unmarked rest apart", () => {
    let totals = addLiveUsage(EMPTY_LIVE_USAGE, {
      promptTokenCount: 9_000,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 8_500 }, { modality: "AUDIO", tokenCount: 500 }],
      responseTokenCount: 300,
      responseTokensDetails: [{ modality: "AUDIO", tokenCount: 300 }],
    })
    // The second turn bills the first one again, plus tool results and thinking;
    // 800 of its prompt tokens and its whole response (a function call) carry no modality.
    totals = addLiveUsage(totals, {
      promptTokenCount: 10_000,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 9_200 }],
      toolUsePromptTokenCount: 400,
      thoughtsTokenCount: 50,
      responseTokenCount: 200,
    })
    expect(totals).toEqual({ textIn: 8_500 + 9_200 + 400, audioIn: 500, otherIn: 800, textOut: 50, audioOut: 300, otherOut: 200, turns: 2 })
    expect(EMPTY_LIVE_USAGE.turns).toBe(0)
  })

  it("counts a real call's four turns exactly as Google sent them", () => {
    const totals = stand.orderLine62s.turns.reduce(addLiveUsage, EMPTY_LIVE_USAGE)
    expect(totals).toEqual({ textIn: 48_434, audioIn: 5_156, otherIn: 4_484, textOut: 1_140, audioOut: 596, otherOut: 267, turns: 4 })
    // Nothing is lost between Google's totals and the row the journal shows.
    const sent = stand.orderLine62s.turns.reduce((sum, turn) => ({
      prompt: sum.prompt + turn.promptTokenCount!,
      output: sum.output + turn.responseTokenCount! + turn.thoughtsTokenCount!,
    }), { prompt: 0, output: 0 })
    expect(liveTokenTotals(totals)).toEqual({ inputTokens: sent.prompt, outputTokens: sent.output })
  })

  it("counts a prompt with no breakdown at all as audio — the dearer kind — and a response with none as unmarked", () => {
    expect(addLiveUsage(EMPTY_LIVE_USAGE, { promptTokenCount: 1_000, responseTokenCount: 100 }))
      .toEqual({ textIn: 0, audioIn: 1_000, otherIn: 0, textOut: 0, audioOut: 0, otherOut: 100, turns: 1 })
  })

  it("prices tokens at the Live table: text in $0.75, audio in $3, text out $4.50, audio out $12 per million", () => {
    expect(liveUsageCostUsd({ textIn: 1_000_000, audioIn: 0, textOut: 0, audioOut: 0 })).toBeCloseTo(0.75, 12)
    expect(liveUsageCostUsd({ textIn: 100_000, audioIn: 10_000, textOut: 1_000, audioOut: 5_000 })).toBeCloseTo(0.075 + 0.03 + 0.0045 + 0.06, 12)
    // A minute of incoming audio alone: 1500 tokens at $3.
    expect(LIVE_AUDIO_IN_MINUTE_USD).toBeCloseTo(0.0045, 12)
  })

  it("prices the unmarked tokens as text: the real call costs $0.0686, not the $0.0807 of the audio rule", () => {
    const totals = stand.orderLine62s.turns.reduce(addLiveUsage, EMPTY_LIVE_USAGE)
    expect(Math.round(liveUsageCostUsd(totals) * 1e4) / 1e4).toBe(0.0686)
    // The same call from a console loaded before the split: its audio columns hold the unmarked tokens.
    const old = { textIn: totals.textIn, audioIn: totals.audioIn + totals.otherIn!, textOut: totals.textOut,
      audioOut: totals.audioOut + totals.otherOut!, turns: totals.turns }
    expect(Math.round(liveUsageCostUsd(old) * 1e4) / 1e4).toBe(0.0807)
  })

  it("leaves a call with no tools almost where it was: its prompt has few unmarked tokens", () => {
    const totals = stand.bookingCall190s.turns.reduce(addLiveUsage, EMPTY_LIVE_USAGE)
    expect(totals).toEqual({ textIn: 73_481, audioIn: 25_788, otherIn: 2_669, textOut: 1_673, audioOut: 2_154, otherOut: 0, turns: 15 })
    const old = { ...totals, audioIn: totals.audioIn + totals.otherIn!, otherIn: 0 }
    expect(liveUsageCostUsd(old) / liveUsageCostUsd(totals)).toBeCloseTo(1.036, 3)
  })

  it("takes from the console only a plausible count, never a guess", () => {
    const ok = { textIn: 10, audioIn: 20, textOut: 3, audioOut: 4, turns: 1 }
    expect(parseLiveUsage(ok)).toEqual(ok)
    for (const bad of [null, "x", {}, { ...ok, turns: 0 }, { ...ok, textIn: -1 }, { ...ok, audioIn: 1.5 }, { ...ok, audioOut: 60_000_000 }, { ...ok, turns: "1" }]) {
      expect(parseLiveUsage(bad)).toBeNull()
    }
  })

  it("takes «no turn, no tokens» as a count — the model never answered — but not tokens without a turn", () => {
    const silent = { textIn: 0, audioIn: 0, otherIn: 0, textOut: 0, audioOut: 0, otherOut: 0, turns: 0 }
    expect(parseLiveUsage(silent)).toEqual(silent)
    expect(parseLiveUsage(EMPTY_LIVE_USAGE)).toEqual(silent)
    // Such a conversation is priced by its listening: nothing by tokens.
    expect(liveUsageCostUsd(silent)).toBe(0)
    for (const bad of [{ ...silent, textIn: 1 }, { ...silent, otherOut: 1 }, { ...silent, audioIn: 25 }]) {
      expect(parseLiveUsage(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it("takes the unmarked counters when the console sends them, and refuses the report when they are not counts", () => {
    const ok = { textIn: 10, audioIn: 20, otherIn: 5, textOut: 3, audioOut: 4, otherOut: 6, turns: 1 }
    expect(parseLiveUsage(ok)).toEqual(ok)
    expect(parseLiveUsage({ ...ok, extra: "ignored" })).toEqual(ok)
    for (const bad of [{ ...ok, otherIn: -1 }, { ...ok, otherOut: 0.5 }, { ...ok, otherIn: "5" }, { ...ok, otherOut: 60_000_000 }, { ...ok, otherIn: null }]) {
      expect(parseLiveUsage(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
