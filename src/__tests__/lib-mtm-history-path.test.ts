import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { HISTORY_MAP_COLORS, splitHistoryPathAtGaps } from "@/lib/mtm/history-path"

/**
 * Owner 2026-09-22: «why a straight line — he does not move like that» and
 * «lines by colours and pieces, no explanation». The track now breaks where
 * the data does, and a legend says what each line is.
 */
const point = (latitude: number, recordedAt: string) => ({ latitude, longitude: 49.8, recordedAt })

describe("the history track", () => {
  it("breaks at a gap instead of drawing a straight line across it", () => {
    const points = [
      point(40.1, "2026-09-21T08:00:00.000Z"),
      point(40.2, "2026-09-21T08:00:30.000Z"),
      point(40.9, "2026-09-21T19:38:00.000Z"),
      point(40.91, "2026-09-21T19:38:30.000Z"),
    ]
    const gaps = [{ startedAt: "2026-09-21T08:00:30.000Z", endedAt: "2026-09-21T19:38:00.000Z" }]
    expect(splitHistoryPathAtGaps(points, gaps)).toEqual([
      [[40.1, 49.8], [40.2, 49.8]],
      [[40.9, 49.8], [40.91, 49.8]],
    ])
    expect(splitHistoryPathAtGaps(points, [])).toHaveLength(1)
  })

  // A break begins when he pressed «Перерыв», inside the silence, not at the
  // fix before it (detectHistoryGaps, verification of 2026-10-20).
  it("breaks where a gap begins inside the silence — a break — and where the point it began at was thinned out", () => {
    const points = [
      point(40.1, "2026-09-21T08:00:00.000Z"),
      point(40.2, "2026-09-21T08:00:30.000Z"),
      point(40.3, "2026-09-21T08:05:00.000Z"),
      point(40.31, "2026-09-21T08:05:30.000Z"),
    ]
    const lunch = [{ startedAt: "2026-09-21T08:00:35.000Z", endedAt: "2026-09-21T08:04:55.000Z" }]
    expect(splitHistoryPathAtGaps(points, lunch)).toEqual([
      [[40.1, 49.8], [40.2, 49.8]],
      [[40.3, 49.8], [40.31, 49.8]],
    ])
    // The map's points thinned: the fix the lost signal began at (08:00:30) is not among them.
    const thinned = [points[0], points[2], points[3]]
    const signal = [{ startedAt: "2026-09-21T08:00:30.000Z", endedAt: "2026-09-21T08:05:00.000Z" }]
    expect(splitHistoryPathAtGaps(thinned, signal)).toEqual([[[40.3, 49.8], [40.31, 49.8]]])
    // A gap that begins at the later point belongs to the stretch after it.
    expect(splitHistoryPathAtGaps(points, [{ startedAt: "2026-09-21T08:05:30.000Z", endedAt: "2026-09-21T08:30:00.000Z" }])).toHaveLength(1)
  })

  // Old data: fixes recorded inside a break (accepted until 2026-10-11). The
  // break is the journal's, from «Перерыв» to «Продолжить» (detectHistoryGaps,
  // verification of 2026-10-20, round 4), and no line joins a fix inside it
  // to anything: none is drawn in his own time.
  it("joins a fix recorded inside a break to nothing", () => {
    const points = [
      point(40.1, "2026-09-21T08:00:00.000Z"),
      point(40.2, "2026-09-21T08:00:30.000Z"),
      point(40.25, "2026-09-21T08:02:00.000Z"),
      point(40.26, "2026-09-21T08:03:00.000Z"),
      point(40.3, "2026-09-21T08:05:00.000Z"),
      point(40.31, "2026-09-21T08:05:30.000Z"),
    ]
    const lunch = [{ startedAt: "2026-09-21T08:00:35.000Z", endedAt: "2026-09-21T08:04:55.000Z" }]
    expect(splitHistoryPathAtGaps(points, lunch)).toEqual([
      [[40.1, 49.8], [40.2, 49.8]],
      [[40.3, 49.8], [40.31, 49.8]],
    ])
  })

  it("drops a lone point that no line can join", () => {
    const points = [point(40.1, "2026-09-21T08:00:00.000Z"), point(40.9, "2026-09-21T12:00:00.000Z")]
    expect(splitHistoryPathAtGaps(points, [{ startedAt: "2026-09-21T08:00:00.000Z", endedAt: "2026-09-21T12:00:00.000Z" }])).toEqual([])
  })

  it("explains every line and marker in a legend drawn from the map's own colours", () => {
    const panel = readFileSync("src/components/mtm/location-history-panel.tsx", "utf8")
    const map = readFileSync("src/components/mtm/location-history-map.tsx", "utf8")
    expect(panel).toContain('data-testid="mtm-history-map-legend"')
    for (const key of Object.keys(HISTORY_MAP_COLORS)) expect(panel).toContain(`HISTORY_MAP_COLORS.${key}`)
    expect(map).toContain("splitHistoryPathAtGaps(visiblePoints, gaps)")
    expect(map).not.toMatch(/color: "#2563eb"|color: "#dc2626"|color: "#7c3aed"/)
    for (const locale of ["az", "ru", "en"]) {
      const history = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmMap.history
      for (const key of ["legendTrack", "legendGap", "legendPlan", "legendStop", "legendVisit", "legendCurrent"]) {
        expect(typeof history[key]).toBe("string")
      }
    }
  })
})
