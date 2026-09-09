import { describe, expect, it } from "vitest"
import {
  assignmentIntersectsRouteDay,
  availableWorkdayActions,
  matchOperationalVisit,
  operationalPointState,
  operationalWeekSnapshotId,
  participantAtVisitTime,
  resolveOperationalWeekWindow,
  workedSeconds,
  type OperationalVisitEvidence,
} from "@/lib/mtm/operational-week"
import { classifyGpsFreshness } from "@/lib/mtm/live-location"

describe("operational week time and evidence contracts", () => {
  it.each([
    [1, "2026-07-15", "2026-07-16", "2026-07-14T20:00:00.000Z", "2026-07-15T20:00:00.000Z"],
    [5, "2026-07-13", "2026-07-18", "2026-07-12T20:00:00.000Z", "2026-07-17T20:00:00.000Z"],
    [7, "2026-07-13", "2026-07-20", "2026-07-12T20:00:00.000Z", "2026-07-19T20:00:00.000Z"],
  ] as const)("resolves %i tenant-local days in Asia/Baku", (days, start, end, utcStart, utcEnd) => {
    const window = resolveOperationalWeekWindow("2026-07-15", days, "Asia/Baku")
    expect(window).toMatchObject({ start, endExclusive: end, days })
    expect(window?.activityStart.toISOString()).toBe(utcStart)
    expect(window?.activityEnd.toISOString()).toBe(utcEnd)
  })

  it("treats assignment removal and participant departure boundaries as exclusive", () => {
    expect(assignmentIntersectsRouteDay({
      assignedAt: new Date("2026-07-13T10:00:00.000Z"),
      removedAt: new Date("2026-07-14T20:00:00.000Z"),
    }, "2026-07-15", "Asia/Baku")).toBe(false)
    expect(assignmentIntersectsRouteDay({
      assignedAt: new Date("2026-07-13T10:00:00.000Z"),
      removedAt: new Date("2026-07-14T20:00:00.001Z"),
    }, "2026-07-15", "Asia/Baku")).toBe(true)

    const checkInAt = new Date("2026-07-15T08:00:00.000Z")
    expect(participantAtVisitTime({ joinedAt: new Date("2026-07-15T07:00:00.000Z"), leftAt: checkInAt }, checkInAt)).toBe(false)
    expect(participantAtVisitTime({ joinedAt: checkInAt, leftAt: null }, checkInAt)).toBe(true)
  })

  it("does not let a fallback match steal evidence explicitly linked to a later duplicate point", () => {
    const visit: OperationalVisitEvidence & { dateKey: string } = {
      id: "visit-for-point-2",
      routeId: "route-1",
      routePointId: "point-2",
      customerId: "customer-1",
      contactId: null,
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-15T08:00:00.000Z"),
      checkOutAt: new Date("2026-07-15T08:30:00.000Z"),
      dateKey: "2026-07-15",
    }
    expect(matchOperationalVisit({
      routeId: "route-1",
      routeDateKey: "2026-07-15",
      pointId: "point-1",
      customerId: "customer-1",
      contactId: null,
    }, [visit])).toBeNull()
    expect(matchOperationalVisit({
      routeId: "route-1",
      routeDateKey: "2026-07-15",
      pointId: "point-2",
      customerId: "customer-1",
      contactId: null,
    }, [visit])).toMatchObject({ match: "ROUTE_POINT", visit: { id: "visit-for-point-2" } })
  })

  it("keeps workday actions/state calculations deterministic", () => {
    expect(availableWorkdayActions(null)).toEqual(["START"])
    expect(availableWorkdayActions("STARTED")).toEqual(["PAUSE", "FINISH"])
    expect(availableWorkdayActions("PAUSED")).toEqual(["RESUME", "FINISH"])
    expect(availableWorkdayActions("COMPLETED")).toEqual([])
    expect(workedSeconds({
      status: "PAUSED",
      startedAt: new Date("2026-07-15T08:00:00.000Z"),
      pausedAt: new Date("2026-07-15T09:00:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 600,
    }, new Date("2026-07-15T10:00:00.000Z"))).toBe(3_000)
    expect(operationalPointState({ routeStatus: "CANCELLED", pointStatus: "VISITED", visitStatus: "CHECKED_OUT" })).toBe("CANCELLED")
  })

  it("pins the independent GPS threshold boundaries used by the week response", () => {
    const now = new Date("2026-07-15T08:00:00.000Z")
    const thresholds = { onlineSeconds: 300, delayedSeconds: 600 }
    expect(classifyGpsFreshness(new Date("2026-07-15T07:55:00.000Z"), now, thresholds)).toBe("ONLINE")
    expect(classifyGpsFreshness(new Date("2026-07-15T07:54:59.999Z"), now, thresholds)).toBe("DELAYED")
    expect(classifyGpsFreshness(new Date("2026-07-15T07:50:00.000Z"), now, thresholds)).toBe("DELAYED")
    expect(classifyGpsFreshness(new Date("2026-07-15T07:49:59.999Z"), now, thresholds)).toBe("STALE")
  })

  it("hashes source state independently of key order", () => {
    expect(operationalWeekSnapshotId({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(operationalWeekSnapshotId({ a: { c: 3, d: 4 }, b: 2 }))
  })
})
