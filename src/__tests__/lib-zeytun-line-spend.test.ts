import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ai/gateway/access", () => ({ journalPlatformAiCall: vi.fn() }))

import { liveUsageCostUsd, UNIT_PRICING } from "@/lib/ai/gateway/pricing"
import { journalLineCallSpend, LINE_LIVE_MODEL, LINE_SPEECH_MODEL } from "@/lib/voice-agent/pharmacy/zeytun-line-spend"

// The line-stand call of 2026-11-06 ("cost-check"): 62 s, the station logged $0.0807.
const live = { textIn: 48434, audioIn: 9640, textOut: 1140, audioOut: 863, turns: 4 }

function journaled(call: Parameters<typeof journalLineCallSpend>[1]) {
  const journal = vi.fn()
  journalLineCallSpend("org-zeytun", call, journal)
  return journal.mock.calls
}

describe("journalLineCallSpend", () => {
  it("prices the station's Live tokens at the line's table and its speech by the seconds returned", () => {
    const calls = journaled({ durationSeconds: 62, usage: { live: { ...live, model: "gemini-3.8-live" },
      tts: { model: "gemini-3.8-flash-tts", requests: 6, chars: 410, audioSeconds: 30 } } })
    expect(calls).toEqual([
      ["org-zeytun", "gemini", "phone-line", { model: "gemini-3.8-live", inputTokens: 48434 + 9640,
        outputTokens: 1140 + 863, costUsd: liveUsageCostUsd(live) }],
      ["org-zeytun", "gemini", "phone-line", { model: "gemini-3.8-flash-tts", costUsd: UNIT_PRICING.geminiSpeechMinute / 2 }],
    ])
    // The same number the station itself logs for the call (zeytun_cost usd).
    expect(Math.round(calls[0][3].costUsd * 1e4) / 1e4).toBe(0.0807)
  })

  it("names the line's models when the station does not", () => {
    const calls = journaled({ durationSeconds: 62, usage: { live, tts: { requests: 1, chars: 10, audioSeconds: 2 } } })
    expect(calls.map((call) => call[3].model)).toEqual([LINE_LIVE_MODEL, LINE_SPEECH_MODEL])
  })

  it("estimates Live by the AI leg's length for a station that does not count yet, and no speech", () => {
    const calls = journaled({ durationSeconds: 90 })
    expect(calls).toEqual([["org-zeytun", "gemini", "phone-line",
      { model: LINE_LIVE_MODEL, costUsd: UNIT_PRICING.phoneLineLiveMinute * 1.5 }]])
  })

  it("journals nothing for a leg that never connected, and no speech that returned no audio", () => {
    expect(journaled({ durationSeconds: 0 })).toEqual([])
    expect(journaled({ durationSeconds: 0, usage: { tts: { requests: 2, chars: 40, audioSeconds: 0 } } })).toEqual([])
  })
})
