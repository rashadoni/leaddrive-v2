/**
 * B2 — channelAiTrend: the 7d-vs-30d AI-effectiveness arrow. The short/long
 * swap depends on which window the card is displaying — exactly the branch
 * that is easy to get backwards, so it is pinned here.
 */
import { describe, it, expect } from "vitest"
import { channelAiTrend } from "@/lib/inbox-analytics"

describe("channelAiTrend", () => {
  it("current window is the SHORT one (7d view): current=short, other=long", () => {
    expect(channelAiTrend(75, 80, true)).toEqual({ shortPct: 75, longPct: 80, dir: "down" })
    expect(channelAiTrend(80, 70, true)).toEqual({ shortPct: 80, longPct: 70, dir: "up" })
  })

  it("current window is the LONG one (30d view): current=long, other=short", () => {
    // 30d card row shows 80, the 7-day window sits at 75 → recent dip → down
    expect(channelAiTrend(80, 75, false)).toEqual({ shortPct: 75, longPct: 80, dir: "down" })
    expect(channelAiTrend(70, 80, false)).toEqual({ shortPct: 80, longPct: 70, dir: "up" })
  })

  it("no arrow below the threshold (default 3pt)", () => {
    expect(channelAiTrend(75, 77, true)).toBeNull()
    expect(channelAiTrend(75, 78, true)).not.toBeNull() // boundary: exactly 3pt shows
  })

  it("no arrow when either window has no closures (null pct)", () => {
    expect(channelAiTrend(null, 80, true)).toBeNull()
    expect(channelAiTrend(75, null, true)).toBeNull()
    expect(channelAiTrend(null, null, false)).toBeNull()
  })

  it("0% is a real value, not a missing one", () => {
    expect(channelAiTrend(0, 50, true)).toEqual({ shortPct: 0, longPct: 50, dir: "down" })
  })
})
