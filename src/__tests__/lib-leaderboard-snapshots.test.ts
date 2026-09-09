import { describe, it, expect } from "vitest"
import {
  snapshotBucket,
  snapshotId,
  isHistoryWindow,
  extractAgentSeries,
  downsample,
  HISTORY_WINDOW_MS,
  type Standing,
} from "@/lib/leaderboard/snapshots"

describe("snapshot id + bucket", () => {
  it("buckets to the UTC hour (YYYY-MM-DDTHH)", () => {
    expect(snapshotBucket(new Date("2026-06-20T12:34:56.000Z"))).toBe("2026-06-20T12")
    expect(snapshotBucket(new Date("2026-06-20T12:00:00.000Z"))).toBe("2026-06-20T12")
    expect(snapshotBucket(new Date("2026-06-20T13:00:00.000Z"))).toBe("2026-06-20T13")
  })
  it("builds a deterministic org:group:bucket id", () => {
    expect(snapshotId("org_1", "mtm", "2026-06-20T12")).toBe("org_1:mtm:2026-06-20T12")
  })
})

describe("history window guard", () => {
  it("accepts only 1h/1d/1m/1y", () => {
    expect(isHistoryWindow("1h")).toBe(true)
    expect(isHistoryWindow("1y")).toBe(true)
    expect(isHistoryWindow("1w")).toBe(false)
    expect(isHistoryWindow(null)).toBe(false)
  })
  it("windows ascend 1h < 1d < 1m < 1y", () => {
    expect(HISTORY_WINDOW_MS["1h"]).toBeLessThan(HISTORY_WINDOW_MS["1d"])
    expect(HISTORY_WINDOW_MS["1d"]).toBeLessThan(HISTORY_WINDOW_MS["1m"])
    expect(HISTORY_WINDOW_MS["1m"]).toBeLessThan(HISTORY_WINDOW_MS["1y"])
  })
})

describe("extractAgentSeries", () => {
  const std = (id: string, pct: number, rank: number): Standing => ({ id, attainmentPct: pct, volume: 1, rank })
  const snaps = [
    { capturedAt: new Date("2026-06-20T10:00:00Z"), standings: [std("A", 50, 2), std("B", 80, 1)] },
    { capturedAt: new Date("2026-06-20T11:00:00Z"), standings: [std("B", 90, 1)] }, // A absent
    { capturedAt: new Date("2026-06-20T12:00:00Z"), standings: [std("A", 70, 1), std("B", 60, 2)] },
  ]
  it("pulls one agent's points in order, skipping snapshots where absent", () => {
    const a = extractAgentSeries(snaps, "A")
    expect(a.map((p) => p.attainmentPct)).toEqual([50, 70]) // 11:00 skipped (A absent)
    expect(a[0].rank).toBe(2)
    expect(a[1].rank).toBe(1)
    expect(a[0].t).toBe("2026-06-20T10:00:00.000Z")
  })
  it("tolerates non-array / malformed standings", () => {
    const out = extractAgentSeries([{ capturedAt: new Date(), standings: null }], "A")
    expect(out).toEqual([])
  })
})

describe("downsample", () => {
  const pts = Array.from({ length: 100 }, (_, i) => i)
  it("returns input unchanged when under the cap", () => {
    expect(downsample([1, 2, 3], 80)).toEqual([1, 2, 3])
  })
  it("caps to max points, keeping first + last", () => {
    const out = downsample(pts, 10)
    expect(out.length).toBe(10)
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(99)
  })
})
