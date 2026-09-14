import { describe, expect, it } from "vitest"
import { mtmDurationParts, summarizeMtmRouteExecution } from "@/lib/mtm/route-point-execution"

// The route from the prod audit of 2026-09-14 (Asia/Baku, UTC+4).
const AUDIT_ROUTE = [
  {
    id: "p1",
    orderIndex: 0,
    status: "VISITED",
    plannedTime: "2026-09-14T05:00:00.000Z", // 09:00
    visitedAt: "2026-09-14T14:53:00.000Z",
    visits: [{ id: "v1", status: "CHECKED_OUT", checkInAt: "2026-09-14T14:49:00.000Z", checkOutAt: "2026-09-14T14:53:00.000Z" }],
  },
  {
    id: "p2",
    orderIndex: 1,
    status: "VISITED",
    plannedTime: "2026-09-14T05:30:00.000Z", // 09:30
    visitedAt: "2026-09-14T13:09:00.000Z",
    visits: [{ id: "v2", status: "CHECKED_OUT", checkInAt: "2026-09-14T12:46:00.000Z", checkOutAt: "2026-09-14T13:09:00.000Z" }],
  },
]

describe("summarizeMtmRouteExecution", () => {
  it("reports lateness, reverse order and duration for the audited route", () => {
    const summary = summarizeMtmRouteExecution(AUDIT_ROUTE)
    expect(summary.points.map((point) => point.pointId)).toEqual(["p1", "p2"])
    expect(summary.points[0]).toMatchObject({
      plannedSequence: 1,
      actualSequence: 2,
      outOfOrder: true,
      checkInAt: "2026-09-14T14:49:00.000Z",
      checkOutAt: "2026-09-14T14:53:00.000Z",
      durationMinutes: 4,
      delayMinutes: 589,
      timing: "LATE",
    })
    expect(summary.points[1]).toMatchObject({
      plannedSequence: 2,
      actualSequence: 1,
      outOfOrder: true,
      durationMinutes: 23,
      delayMinutes: 436,
      timing: "LATE",
    })
    expect(summary).toMatchObject({
      visitedCount: 2,
      totalCount: 2,
      firstCheckInAt: "2026-09-14T12:46:00.000Z",
      lastCheckOutAt: "2026-09-14T14:53:00.000Z",
      lateCount: 2,
      outOfOrderCount: 2,
    })
  })

  it("stays quiet about a route visited in plan order within tolerance", () => {
    const summary = summarizeMtmRouteExecution([
      { id: "a", orderIndex: 0, status: "VISITED", plannedTime: "2026-09-14T05:00:00Z", visits: [{ id: "va", status: "CHECKED_OUT", checkInAt: "2026-09-14T05:10:00Z", checkOutAt: "2026-09-14T05:40:00Z" }] },
      { id: "b", orderIndex: 1, status: "VISITED", plannedTime: "2026-09-14T06:00:00Z", visits: [{ id: "vb", status: "CHECKED_OUT", checkInAt: "2026-09-14T05:40:00Z", checkOutAt: null }] },
      { id: "c", orderIndex: 2, status: "PENDING", plannedTime: "2026-09-14T07:00:00Z", visits: [] },
    ])
    expect(summary.points.map((point) => point.timing)).toEqual(["ON_TIME", "EARLY", "NOT_VISITED"])
    expect(summary.points.map((point) => point.outOfOrder)).toEqual([false, false, false])
    expect(summary.points[1].durationMinutes).toBeNull()
    expect(summary.points[2]).toMatchObject({ actualSequence: null, checkInAt: null, delayMinutes: null })
    expect(summary.outOfOrderCount).toBe(0)
  })

  it("ignores cancelled visits and ranks only visited stops for order", () => {
    const summary = summarizeMtmRouteExecution([
      { id: "a", orderIndex: 0, status: "SKIPPED", visits: [{ id: "x", status: "CANCELLED", checkInAt: "2026-09-14T09:00:00Z" }] },
      { id: "b", orderIndex: 1, status: "VISITED", visits: [{ id: "vb", status: "CHECKED_OUT", checkInAt: "2026-09-14T08:00:00Z", checkOutAt: "2026-09-14T08:30:00Z" }] },
    ])
    expect(summary.points[0]).toMatchObject({ visit: null, timing: "NOT_VISITED", outOfOrder: false })
    expect(summary.points[1]).toMatchObject({ actualSequence: 1, outOfOrder: false, timing: "NOT_PLANNED" })
  })

  it("falls back to the stop's own close time when the payload carries no visits", () => {
    const summary = summarizeMtmRouteExecution([
      { id: "a", orderIndex: 0, status: "VISITED", visitedAt: "2026-09-14T14:53:00Z" },
    ])
    expect(summary.visitedCount).toBe(1)
    expect(summary.lastCheckOutAt).toBe("2026-09-14T14:53:00.000Z")
    expect(summary.firstCheckInAt).toBeNull()
  })
})

describe("mtmDurationParts", () => {
  it("splits minutes for «3 saat 23 dəq»", () => {
    expect(mtmDurationParts(203)).toEqual({ hours: 3, minutes: 23 })
    expect(mtmDurationParts(4)).toEqual({ hours: 0, minutes: 4 })
    expect(mtmDurationParts(-5)).toEqual({ hours: 0, minutes: 0 })
  })
})
