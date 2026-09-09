import { describe, expect, it } from "vitest"
import { buildMobileKpi, resolveMobileKpiPeriod } from "@/lib/mtm/mobile-kpi"

describe("MTM mobile personal KPI helpers", () => {
  it("resolves week and month boundaries in the organization timezone", () => {
    expect(resolveMobileKpiPeriod("2026-07-15", "week", "Asia/Baku")).toMatchObject({
      start: "2026-07-13",
      endExclusive: "2026-07-20",
      activityFrom: new Date("2026-07-12T20:00:00.000Z"),
      activityTo: new Date("2026-07-19T20:00:00.000Z"),
    })
    expect(resolveMobileKpiPeriod("2026-12-31", "month", "Asia/Baku")).toMatchObject({
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    })
    expect(resolveMobileKpiPeriod("2026-02-29", "week", "UTC")).toBeNull()
  })

  it("keeps plan, actual, coverage segments, task exceptions and GPS evidence auditable", () => {
    const result = buildMobileKpi({
      routes: [{
        id: "route-1",
        date: new Date("2026-07-14T00:00:00.000Z"),
        status: "PLANNED",
        points: [
          { id: "point-doctor", customerId: "clinic-1", contactId: "doctor-1", status: "PENDING", customer: { name: "Dr Ali", objectType: "CLINIC" } },
          { id: "point-pharmacy", customerId: "pharmacy-1", contactId: null, status: "PENDING", customer: { name: "Aptek 1", objectType: "PHARMACY" } },
          { id: "point-other", customerId: "store-1", contactId: null, status: "VISITED", customer: { name: "Store 1", objectType: "STORE" } },
        ],
      }],
      visits: [
        { id: "visit-doctor", customerId: "clinic-1", contactId: "doctor-1", routePointId: "point-doctor", status: "CHECKED_OUT", checkInLat: 40.4, checkInLng: 49.8, checkOutLat: 40.4, checkOutLng: 49.8, customer: { name: "Clinic 1", objectType: "CLINIC" } },
        { id: "visit-unplanned", customerId: "pharmacy-2", contactId: null, routePointId: null, status: "CHECKED_OUT", customer: { name: "Aptek 2", objectType: "PHARMACY" } },
      ],
      tasks: [
        { id: "task-done", status: "COMPLETED", dueDate: new Date("2026-07-14T08:00:00.000Z"), completedAt: new Date("2026-07-14T09:00:00.000Z") },
        { id: "task-late", status: "IN_PROGRESS", dueDate: new Date("2026-07-14T08:00:00.000Z"), completedAt: null },
      ],
      workdays: [{
        id: "day-1",
        workDate: new Date("2026-07-14T00:00:00.000Z"),
        status: "COMPLETED",
        startedAt: new Date("2026-07-14T05:00:00.000Z"),
        pausedAt: null,
        completedAt: new Date("2026-07-14T13:30:00.000Z"),
        totalPausedSeconds: 1_800,
      }],
      locations: [
        { latitude: 40.4, longitude: 49.8, accuracy: 8, recordedAt: new Date("2026-07-14T05:00:00.000Z") },
        { latitude: 40.401, longitude: 49.801, accuracy: 12, recordedAt: new Date("2026-07-14T05:05:00.000Z") },
      ],
      totalLocationCount: 2,
      locationsTruncated: false,
      timezone: "Asia/Baku",
      today: "2026-07-15",
      now: new Date("2026-07-15T08:00:00.000Z"),
    })

    expect(result.visits).toMatchObject({
      planned: 3,
      completedPlanned: 2,
      completedTotal: 2,
      unplannedCompleted: 1,
      missed: 1,
      fulfillment: { numerator: 2, denominator: 3, percentage: 66.7 },
    })
    expect(result.coverage.overall).toMatchObject({ numerator: 2, denominator: 3, percentage: 66.7 })
    expect(result.coverage.doctors).toMatchObject({ numerator: 1, denominator: 1, percentage: 100 })
    expect(result.coverage.pharmacies).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 })
    expect(result.coverage.pharmacies.uncovered[0]).toMatchObject({ customerId: "pharmacy-1", segment: "PHARMACY" })
    expect(result.tasks).toMatchObject({
      assigned: 2,
      completed: 1,
      overdue: 1,
      completion: { numerator: 1, denominator: 2, percentage: 50 },
      overdueIds: ["task-late"],
    })
    expect(result.gps).toMatchObject({
      workdays: 1,
      workdaysWithGps: 1,
      dayCoverage: { numerator: 1, denominator: 1, percentage: 100 },
      visitConfirmation: { numerator: 1, denominator: 2, percentage: 50 },
      points: 2,
      workedSeconds: 28_800,
      averageAccuracyMeters: 10,
      truncated: false,
    })
    expect(result.gps.distanceMeters).toBeGreaterThan(0)
    expect(result.drilldown).toEqual({
      missedStopIds: ["point-pharmacy"],
      unplannedVisitIds: ["visit-unplanned"],
    })
  })

  it("does not publish a misleading distance when the GPS series was truncated", () => {
    const result = buildMobileKpi({
      routes: [], visits: [], tasks: [], workdays: [], locations: [],
      totalLocationCount: 50_100,
      locationsTruncated: true,
      timezone: "UTC",
      today: "2026-07-15",
      now: new Date("2026-07-15T08:00:00.000Z"),
    })
    expect(result.gps).toMatchObject({ points: 50_100, distanceMeters: null, truncated: true })
  })

  it("applies a plan exclusion only to plan attainment, not coverage or the missed-stop queue", () => {
    const result = buildMobileKpi({
      routes: [{
        id: "route-1",
        date: new Date("2026-07-14T00:00:00.000Z"),
        status: "PLANNED",
        points: [{
          id: "point-1", customerId: "clinic-1", contactId: "doctor-1", status: "PENDING",
          customer: { name: "Clinic 1", objectType: "CLINIC" },
        }],
      }],
      visits: [], tasks: [], workdays: [], locations: [], totalLocationCount: 0,
      locationsTruncated: false, timezone: "UTC", today: "2026-07-15",
      now: new Date("2026-07-15T08:00:00.000Z"),
      planPointExclusionIds: ["point-1"],
      completeness: "PARTIAL",
    })

    expect(result.visits.fulfillment).toEqual({ numerator: 0, denominator: 0, percentage: 0 })
    expect(result.visits.missed).toBe(1)
    expect(result.coverage.overall).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 })
    expect(result.drilldown.missedStopIds).toEqual(["point-1"])
    expect(result.formula).toMatchObject({ completeness: "PARTIAL", authoritative: false })
  })
})
