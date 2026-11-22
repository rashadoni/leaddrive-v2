/**
 * What an AI phone call's conversation is journaled at («Настройки → ИИ и
 * расходы»), checked against what Google counted: the fixture is the real
 * `usageMetadata` of two stand calls, record by record, and the Live lines of
 * the Google bill for 1–22 November 2026 (reconciliation of 2026-11-22).
 */
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ai/gateway/access", () => ({ journalPlatformAiCall: vi.fn() }))

import {
  aiCallLiveEstimateUsd, geminiSpeechMinuteUsd, liveUsageCostUsd, UNIT_PRICING, type LiveTokenCounts,
} from "@/lib/ai/gateway/pricing"
import { addLiveUsage, EMPTY_LIVE_USAGE, type LiveUsageMetadata } from "@/lib/ai/voice/live-usage"
import { journalAiCallSpend, journalLineCallSpend, STATION_LIVE_MODEL, STATION_SPEECH_MODEL } from "@/lib/voice-agent/call-spend"
import { voiceAgentLineUsageSchema } from "@/lib/voice-agent/post-call"

type Turn = LiveUsageMetadata & { atSecond?: number }
const stand = JSON.parse(readFileSync("src/__tests__/fixtures/gemini-live-stand-usage.json", "utf8")) as {
  orderLine62s: { seconds: number; turns: Turn[] }
  bookingCall190s: { seconds: number; turns: Turn[] }
  googleBill: Record<"textIn" | "audioIn" | "textOut" | "audioOut", { tokens: number; usd: number }>
}

/** A call's turns added up the way a counter that knows the split adds them. */
const counted = (turns: Turn[]) => turns.reduce((totals, turn) => addLiveUsage(totals, turn), EMPTY_LIVE_USAGE)

/**
 * The same call as the station core installed on 2026-11-11 reports it: four
 * numbers, with every token Google gave no modality inside the audio ones.
 */
function asTheStationReportsToday(turns: Turn[]) {
  const all = counted(turns)
  return { textIn: all.textIn, audioIn: all.audioIn + (all.otherIn ?? 0), textOut: all.textOut,
    audioOut: all.audioOut + (all.otherOut ?? 0), turns: all.turns }
}

const NOVEMBER = new Date("2026-11-22T12:00:00Z")

function journaled(spend: typeof journalLineCallSpend, call: Parameters<typeof journalLineCallSpend>[1], at = NOVEMBER) {
  const journal = vi.fn()
  spend("org-1", call, journal, at)
  return journal.mock.calls.map((call) => ({ org: call[0], provider: call[1], feature: call[2], ...call[3] }))
}

describe("the Live price table against the Google bill", () => {
  it("gives the bill's own dollars for the bill's own tokens, line by line", () => {
    const none: LiveTokenCounts = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 }
    for (const line of ["textIn", "audioIn", "textOut", "audioOut"] as const) {
      const usd = liveUsageCostUsd({ ...none, [line]: stand.googleBill[line].tokens })
      expect(Math.round(usd * 100) / 100, line).toBe(stand.googleBill[line].usd)
    }
  })

  it("prices tokens with no modality as text, not as audio", () => {
    // 1,000 unmarked prompt tokens and 1,000 unmarked response tokens.
    expect(liveUsageCostUsd({ textIn: 0, audioIn: 0, textOut: 0, audioOut: 0, otherIn: 1000, otherOut: 1000 }))
      .toBeCloseTo((1000 * 0.75 + 1000 * 4.5) / 1e6, 12)
  })
})

describe("the order line's call (62 s on the stand, four billed turns)", () => {
  const turns = stand.orderLine62s.turns

  it("is counted from Google's records: text, audio and the unmarked rest apart", () => {
    expect(counted(turns)).toEqual({ textIn: 48434, audioIn: 5156, otherIn: 4484, textOut: 1140, audioOut: 596, otherOut: 267, turns: 4 })
  })

  it("is journaled as before for a station that still reports four numbers", () => {
    const usage = { live: { ...asTheStationReportsToday(turns), model: "gemini-3.8-live" } }
    expect(usage.live).toEqual({ textIn: 48434, audioIn: 9640, textOut: 1140, audioOut: 863, turns: 4, model: "gemini-3.8-live" })
    const [row, ...more] = journaled(journalLineCallSpend, { durationSeconds: 62, usage })
    expect(more).toEqual([])
    expect(row).toMatchObject({ org: "org-1", provider: "gemini", feature: "phone-line", model: "gemini-3.8-live",
      inputTokens: 48434 + 9640, outputTokens: 1140 + 863 })
    // The number the station itself logged for this call (zeytun_cost usd).
    expect(Math.round(row.costUsd * 1e4) / 1e4).toBe(0.0807)
    expect(row.estimated).toBeUndefined()
  })

  it("costs 15 % less once the station reports the unmarked tokens apart — the same tokens, the same call", () => {
    const all = counted(turns)
    const usage = voiceAgentLineUsageSchema.parse({ live: all })
    const [row] = journaled(journalLineCallSpend, { durationSeconds: 62, usage })
    // Every token is still shown: the row's totals do not shrink, only the price does.
    expect(row).toMatchObject({ inputTokens: 48434 + 5156 + 4484, outputTokens: 1140 + 596 + 267 })
    expect(row.costUsd).toBeCloseTo((48434 * 0.75 + 5156 * 3 + 4484 * 0.75 + 1140 * 4.5 + 596 * 12 + 267 * 4.5) / 1e6, 12)
    expect(Math.round(row.costUsd * 1e4) / 1e4).toBe(0.0686)
    const before = liveUsageCostUsd(asTheStationReportsToday(turns))
    expect(before / row.costUsd).toBeGreaterThan(1.17)
    expect(before / row.costUsd).toBeLessThan(1.18)
  })

  it("names the line's models when the station does not, and marks no counted row as an estimate", () => {
    const rows = journaled(journalLineCallSpend, { durationSeconds: 62,
      usage: { live: asTheStationReportsToday(turns), tts: { requests: 1, chars: 10, audioSeconds: 2 } } })
    expect(rows.map((row) => row.model)).toEqual([STATION_LIVE_MODEL, STATION_SPEECH_MODEL])
    expect(rows.map((row) => row.estimated)).toEqual([undefined, undefined])
  })

  it("is priced by the leg's length, as an estimate, when the station counted nothing", () => {
    expect(journaled(journalLineCallSpend, { durationSeconds: 90 })).toEqual([{ org: "org-1", provider: "gemini",
      feature: "phone-line", model: STATION_LIVE_MODEL, costUsd: UNIT_PRICING.phoneLineLiveMinute * 1.5, estimated: true }])
  })

  it("journals nothing for a leg that never connected, and no speech that returned no audio", () => {
    expect(journaled(journalLineCallSpend, { durationSeconds: 0 })).toEqual([])
    expect(journaled(journalLineCallSpend, { durationSeconds: 0, usage: { tts: { requests: 2, chars: 40, audioSeconds: 0 } } })).toEqual([])
  })
})

describe("synthesized speech", () => {
  const speech = { tts: { model: "gemini-3.8-flash-tts", requests: 6, chars: 410, audioSeconds: 60 } }
  const cost = (at: Date) => journaled(journalLineCallSpend, { durationSeconds: 0, usage: speech }, at)[0].costUsd

  it("costs $0.0135 a minute through 2026 and $0.027 from 2027 — 25 audio tokens a second at $9, then $18, a million", () => {
    expect(cost(NOVEMBER)).toBeCloseTo(0.0135, 12)
    expect(cost(new Date("2027-03-01T00:00:00Z"))).toBeCloseTo(0.027, 12)
    expect(geminiSpeechMinuteUsd(NOVEMBER)).toBeCloseTo(60 * 25 * 9 / 1e6, 12)
  })

  it("changes price when Google's billing day does: at midnight Pacific time", () => {
    // 23:59 on 31 December in Los Angeles is 07:59 UTC on 1 January.
    expect(cost(new Date("2027-01-01T07:59:59Z"))).toBeCloseTo(0.0135, 12)
    expect(cost(new Date("2027-01-01T08:00:00Z"))).toBeCloseTo(0.027, 12)
  })

  it("is half a minute's price for half a minute of speech", () => {
    const rows = journaled(journalLineCallSpend, { durationSeconds: 62, usage: { tts: { ...speech.tts, audioSeconds: 30 } } })
    expect(rows[1]).toMatchObject({ feature: "phone-line", model: "gemini-3.8-flash-tts" })
    expect(rows[1].costUsd).toBeCloseTo(0.00675, 12)
  })
})

describe("an AI call that is not the order line's", () => {
  it("is journaled by its length, marked as an estimate: $0.04 a minute to two minutes, $0.05 at three", () => {
    const row = (seconds: number) => journaled(journalAiCallSpend, { durationSeconds: seconds })
    expect(row(60)).toEqual([{ org: "org-1", provider: "gemini", feature: "ai-call", model: STATION_LIVE_MODEL,
      costUsd: expect.closeTo(0.04, 12), estimated: true }])
    expect(row(120)[0].costUsd).toBeCloseTo(0.08, 12)
    expect(row(180)[0].costUsd).toBeCloseTo(0.15, 12)
    expect(row(180)[0].costUsd / 3).toBeCloseTo(0.05, 12)
    expect(row(0)).toEqual([])
  })

  it("follows the measured booking call along its whole length", () => {
    // The 190-second stand call, priced turn by turn from Google's own records.
    const { turns, seconds } = stand.bookingCall190s
    let totals = EMPTY_LIVE_USAGE
    const ratios: number[] = []
    for (const turn of turns) {
      totals = addLiveUsage(totals, turn)
      // The greeting alone (the first four seconds) is not a call anybody is billed for.
      if (turn.atSecond! >= 15) ratios.push(aiCallLiveEstimateUsd(turn.atSecond!) / liveUsageCostUsd(totals))
    }
    const measured = liveUsageCostUsd(totals)
    expect(Math.round(measured * 1e4) / 1e4).toBe(0.1679)
    // Never more than 5 % under the measurement, never more than a quarter over it …
    expect(Math.min(...ratios)).toBeGreaterThan(0.95)
    expect(Math.max(...ratios)).toBeLessThan(1.25)
    // … and within 3 % of it for the call as a whole.
    expect(aiCallLiveEstimateUsd(seconds) / measured).toBeGreaterThan(0.97)
    expect(aiCallLiveEstimateUsd(seconds) / measured).toBeLessThan(1.03)
  })

  it("keeps the slope beyond three minutes only to the station's longest call", () => {
    expect(aiCallLiveEstimateUsd(300) / 5).toBeCloseTo(0.07, 12)
    expect(aiCallLiveEstimateUsd(900) / 15).toBeCloseTo(0.17, 12)
    // A leg reported longer than the station allows is not priced dearer a minute than its longest one.
    expect(aiCallLiveEstimateUsd(1800) / 30).toBeCloseTo(0.17, 12)
    expect(aiCallLiveEstimateUsd(-5)).toBe(0)
  })

  it("is priced from the station's tokens, with no estimate, the day the core sends them", () => {
    const all = counted(stand.bookingCall190s.turns)
    const rows = journaled(journalAiCallSpend, { durationSeconds: 190, usage: { live: all } })
    expect(rows).toEqual([{ org: "org-1", provider: "gemini", feature: "ai-call", model: STATION_LIVE_MODEL,
      inputTokens: 73481 + 25788 + 2669, outputTokens: 1673 + 2154, costUsd: expect.closeTo(0.167853, 6) }])
  })
})

describe("the station's usage report", () => {
  const live = { textIn: 1, audioIn: 2, textOut: 3, audioOut: 4, turns: 1 }

  it("is accepted with and without the unmarked counters, and with nothing else", () => {
    expect(voiceAgentLineUsageSchema.safeParse({ live }).success).toBe(true)
    expect(voiceAgentLineUsageSchema.safeParse({ live: { ...live, otherIn: 5, otherOut: 6 } }).success).toBe(true)
    expect(voiceAgentLineUsageSchema.safeParse({ live: { ...live, otherIn: 5 } }).success).toBe(true)
    for (const bad of [{ ...live, otherIn: -1 }, { ...live, otherOut: 1.5 }, { ...live, otherIn: "5" }, { ...live, unmarkedIn: 5 }]) {
      expect(voiceAgentLineUsageSchema.safeParse({ live: bad }).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is accepted with exactly the counters the station's bridge sends, and priced by every one of them", () => {
    // The schema is strict: a counter the bridge sends and this side does not know answers 400
    // to the whole call result, and the call's transcript is lost with it.
    const bridge = readFileSync("scripts/pbx/fanum-zeytun-inbound.py", "utf8")
    const sent = [...bridge.match(/USAGE_COUNTS = \(([^)]*)\)/)![1].matchAll(/"(\w+)"/g)].map((match) => match[1])
    expect(sent).toEqual(["textIn", "audioIn", "otherIn", "textOut", "audioOut", "otherOut"])
    const report = { ...Object.fromEntries(sent.map((name) => [name, 1_000_000])), turns: 1, model: "gemini-3.8-live" }
    const parsed = voiceAgentLineUsageSchema.parse({ live: report })
    // The bridge's own price list (LIVE_PRICE) and the CRM's give one number for one report.
    const prices = Object.fromEntries([...bridge.match(/LIVE_PRICE = \{([^}]*)\}/)![1].matchAll(/"(\w+)": ([\d.]+)/g)]
      .map((match) => [match[1], Number(match[2])]))
    expect(Object.keys(prices).sort()).toEqual([...sent].sort())
    expect(liveUsageCostUsd(parsed.live!)).toBeCloseTo(sent.reduce((sum, name) => sum + prices[name], 0), 9)
  })
})
