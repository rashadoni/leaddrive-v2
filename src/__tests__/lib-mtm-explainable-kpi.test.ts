import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { aggregateExplainableKpiTrend, buildExplainableKpi, isValidKpiCoordinatePair, MTM_KPI_FORMULA_VERSION } from "@/lib/mtm/explainable-kpi"
import { buildMobileKpi } from "@/lib/mtm/mobile-kpi"
import reference from "./fixtures/mtm-kpi-reference-v1.json"

describe("SwissMed explainable KPI formula", () => {
  const base = {
    agentId: "agent-1", agentName: "Agent One", customerId: "customer-1",
    customerName: "Clinic", contactId: "contact-1", date: "2026-07-14",
    visitType: "INDEPENDENT", brandIds: ["brand-a"],
  }

  it("aggregates daily evidence into weeks, months and quarters without averaging percentages", () => {
    const points = [
      { date: "2026-03-31", planned: 3, completed: 1, visits: 2, gps: 1, planPercentage: 33.3, gpsPercentage: 50 },
      { date: "2026-04-01", planned: 1, completed: 1, visits: 1, gps: 1, planPercentage: 100, gpsPercentage: 100 },
      { date: "2026-04-06", planned: 4, completed: 3, visits: 3, gps: 2, planPercentage: 75, gpsPercentage: 66.7 },
    ]

    expect(aggregateExplainableKpiTrend(points, "DAY")).toBe(points)
    expect(aggregateExplainableKpiTrend(points, "WEEK")).toEqual([
      { date: "2026-03-30", planned: 4, completed: 2, visits: 3, gps: 2, planPercentage: 50, gpsPercentage: 66.7 },
      { date: "2026-04-06", planned: 4, completed: 3, visits: 3, gps: 2, planPercentage: 75, gpsPercentage: 66.7 },
    ])
    expect(aggregateExplainableKpiTrend(points, "MONTH")).toEqual([
      { date: "2026-03-01", planned: 3, completed: 1, visits: 2, gps: 1, planPercentage: 33.3, gpsPercentage: 50 },
      { date: "2026-04-01", planned: 5, completed: 4, visits: 4, gps: 3, planPercentage: 80, gpsPercentage: 75 },
    ])
    expect(aggregateExplainableKpiTrend(points, "QUARTER")).toEqual([
      { date: "2026-01-01", planned: 3, completed: 1, visits: 2, gps: 1, planPercentage: 33.3, gpsPercentage: 50 },
      { date: "2026-04-01", planned: 5, completed: 4, visits: 4, gps: 3, planPercentage: 80, gpsPercentage: 75 },
    ])
  })

  it("rejects missing, out-of-range and null-island GPS evidence", () => {
    expect(isValidKpiCoordinatePair(40.4093, 49.8671)).toBe(true)
    expect(isValidKpiCoordinatePair(0, 0)).toBe(false)
    expect(isValidKpiCoordinatePair(91, 49)).toBe(false)
    expect(isValidKpiCoordinatePair(40, 181)).toBe(false)
    expect(isValidKpiCoordinatePair(null, 49)).toBe(false)
  })

  it("reproduces the checksum-pinned anonymized reference dataset", () => {
    const fixtureBytes = readFileSync(new URL("./fixtures/mtm-kpi-reference-v1.json", import.meta.url))
    const expectedDigest = readFileSync(new URL("./fixtures/mtm-kpi-reference-v1.sha256", import.meta.url), "utf8").trim()
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(expectedDigest)
    expect(reference.formulaVersion).toBe(MTM_KPI_FORMULA_VERSION)
    const report = buildExplainableKpi({
      planPoints: reference.planPoints,
      visits: reference.visits,
      visitType: reference.filter.visitType as "ALL",
      brandId: reference.filter.brandId,
      generatedAt: new Date(reference.generatedAt),
    })
    expect(report.plan).toEqual(reference.expected.plan)
    expect(report.gps).toEqual(reference.expected.gps)
  })

  it("keeps the signed plan/GPS formula identical in web and mobile read models", () => {
    const web = buildExplainableKpi({
      planPoints: reference.planPoints,
      visits: reference.visits,
      visitType: "ALL",
      brandId: null,
      generatedAt: new Date(reference.generatedAt),
    })
    const mobile = buildMobileKpi({
      routes: [{
        id: "route-reference",
        date: new Date("2026-07-13T00:00:00.000Z"),
        status: "PLANNED",
        points: reference.planPoints.map((point) => ({
          id: point.routePointId,
          customerId: point.customerId,
          contactId: point.contactId,
          status: point.completed ? "VISITED" : "PENDING",
          customer: { name: point.customerName, objectType: "CLINIC" },
        })),
      }],
      visits: reference.visits.map((visit) => ({
        id: visit.visitId,
        customerId: visit.customerId,
        contactId: visit.contactId,
        routePointId: visit.routePointId,
        status: visit.completed ? "CHECKED_OUT" : "CHECKED_IN",
        checkInLat: visit.gpsConfirmed ? 40.4 : null,
        checkInLng: visit.gpsConfirmed ? 49.8 : null,
        checkOutLat: visit.gpsConfirmed ? 40.4 : null,
        checkOutLng: visit.gpsConfirmed ? 49.8 : null,
        customer: { name: visit.customerName, objectType: "CLINIC" },
      })),
      tasks: [], workdays: [], locations: [], totalLocationCount: 0,
      locationsTruncated: false, timezone: "UTC", today: "2026-07-15",
      now: new Date(reference.generatedAt),
    })
    expect(mobile.formula.version).toBe(web.formula.version)
    expect(mobile.visits.fulfillment).toEqual(web.plan)
    expect(mobile.gps.visitConfirmation).toEqual(web.gps)
  })

  it("keeps numerator, denominator, filters and drill-down on one formula version", () => {
    const report = buildExplainableKpi({
      planPoints: [
        { ...base, routePointId: "point-1", completed: true },
        { ...base, routePointId: "point-2", completed: false, brandIds: ["brand-b"] },
      ],
      visits: [
        { ...base, visitId: "visit-1", routePointId: "point-1", completed: true, gpsConfirmed: true },
        { ...base, visitId: "visit-2", routePointId: null, completed: true, gpsConfirmed: false, brandIds: ["brand-b"] },
      ],
      visitType: "INDEPENDENT",
      brandId: "brand-a",
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
    })

    expect(report.formula.version).toBe(MTM_KPI_FORMULA_VERSION)
    expect(report.plan).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(report.gps).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(report.drilldown.planDenominator.map((row) => row.routePointId)).toEqual(["point-1"])
    expect(report.drilldown.gpsNumerator.map((row) => row.visitId)).toEqual(["visit-1"])
  })

  it("does not hide a zero denominator or treat missing GPS as confirmed", () => {
    const report = buildExplainableKpi({
      planPoints: [],
      visits: [{ ...base, visitId: "visit-1", routePointId: null, completed: true, gpsConfirmed: false }],
      visitType: "ALL", brandId: null, generatedAt: new Date("2026-07-15T08:00:00.000Z"),
    })
    expect(report.plan).toEqual({ numerator: 0, denominator: 0, percentage: 0 })
    expect(report.gps).toEqual({ numerator: 0, denominator: 1, percentage: 0 })
  })

  it("applies the latest audited exclusion or restore to the same filtered cohort", () => {
    const point = { ...base, routePointId: "point-1", completed: true }
    const visit = { ...base, visitId: "visit-1", routePointId: "point-1", completed: true, gpsConfirmed: true }
    const report = buildExplainableKpi({
      planPoints: [point], visits: [visit], visitType: "ALL", brandId: null,
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      adjustments: [
        { factType: "PLAN_POINT", factId: "point-1", action: "EXCLUDE", reason: "duplicate plan", createdAt: "2026-07-15T07:00:00.000Z", actorAgentId: "manager-1" },
        { factType: "GPS_VISIT", factId: "visit-1", action: "EXCLUDE", reason: "invalid GPS", createdAt: "2026-07-15T07:10:00.000Z", actorAgentId: "manager-1" },
        { factType: "GPS_VISIT", factId: "visit-1", action: "RESTORE", reason: "evidence verified", createdAt: "2026-07-15T07:20:00.000Z", actorAgentId: "manager-1" },
      ],
    })
    expect(report.plan.denominator).toBe(0)
    expect(report.gps).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(report.drilldown.exclusions.planPoints).toHaveLength(1)
    expect(report.drilldown.exclusions.visits).toHaveLength(0)
  })

  it("returns adjustment history only for facts in the filtered cohort", () => {
    const report = buildExplainableKpi({
      planPoints: [
        { ...base, routePointId: "point-a", completed: true },
        { ...base, routePointId: "point-b", completed: true, brandIds: ["brand-b"] },
      ],
      visits: [],
      visitType: "ALL",
      brandId: "brand-a",
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      adjustments: [
        { factType: "PLAN_POINT", factId: "point-a", action: "EXCLUDE", reason: "duplicate fact A", createdAt: "2026-07-15T07:00:00.000Z", actorAgentId: "manager-1", auditId: "audit-a" },
        { factType: "PLAN_POINT", factId: "point-b", action: "EXCLUDE", reason: "duplicate fact B", createdAt: "2026-07-15T07:01:00.000Z", actorAgentId: "manager-1", auditId: "audit-b" },
      ],
    })

    expect(report.formula.adjustments.map((item) => item.auditId)).toEqual(["audit-a"])
    expect(report.drilldown.exclusions.planPoints.map((item) => item.routePointId)).toEqual(["point-a"])
  })

  it("removes invalid GPS evidence from the numerator without improving the denominator", () => {
    const visit = { ...base, visitId: "visit-1", routePointId: null, completed: true, gpsConfirmed: true }
    const report = buildExplainableKpi({
      planPoints: [], visits: [visit], visitType: "ALL", brandId: null,
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      adjustments: [{
        factType: "GPS_VISIT", factId: "visit-1", action: "EXCLUDE", reason: "coordinate evidence invalid",
        createdAt: "2026-07-15T07:10:00.000Z", actorAgentId: "manager-1",
      }],
    })
    expect(report.gps).toEqual({ numerator: 0, denominator: 1, percentage: 0 })
    expect(report.drilldown.gpsDenominator).toHaveLength(1)
    expect(report.drilldown.exclusions.visits).toHaveLength(1)
  })

  it("uses audit ids to deterministically resolve adjustments with the same timestamp", () => {
    const point = { ...base, routePointId: "point-1", completed: true }
    const report = buildExplainableKpi({
      planPoints: [point], visits: [], visitType: "ALL", brandId: null,
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      adjustments: [
        {
          factType: "PLAN_POINT", factId: "point-1", action: "RESTORE", reason: "verified source fact",
          createdAt: "2026-07-15T07:00:00.000Z", actorAgentId: "manager-1", auditId: "audit-b",
        },
        {
          factType: "PLAN_POINT", factId: "point-1", action: "EXCLUDE", reason: "duplicate source fact",
          createdAt: "2026-07-15T07:00:00.000Z", actorAgentId: "manager-1", auditId: "audit-a",
        },
      ],
    })

    expect(report.plan).toEqual({ numerator: 1, denominator: 1, percentage: 100 })
    expect(report.formula.adjustments.map((item) => item.auditId)).toEqual(["audit-a", "audit-b"])
  })

  it("explains GPS failures by workday and preserves manual evidence decisions", () => {
    const report = buildExplainableKpi({
      planPoints: [],
      visits: [
        {
          ...base, visitId: "visit-valid", routePointId: null, completed: true,
          gpsConfirmed: true, gpsEvidenceState: "CONFIRMED",
        },
        {
          ...base, visitId: "visit-missing", routePointId: null, completed: true,
          gpsConfirmed: false, gpsEvidenceState: "MISSING_CHECK_OUT",
        },
      ],
      visitType: "ALL", brandId: null,
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      workdays: [{ id: "workday-1", agentId: "agent-1", date: "2026-07-14", state: "PAUSED" }],
      adjustments: [{
        factType: "GPS_VISIT", factId: "visit-valid", action: "EXCLUDE", reason: "coordinate evidence invalid",
        createdAt: "2026-07-15T07:00:00.000Z", actorAgentId: "manager-1", auditId: "audit-1",
      }],
    })

    expect(report.gps).toEqual({ numerator: 0, denominator: 2, percentage: 0 })
    expect(report.drilldown.gpsDays).toEqual([expect.objectContaining({
      agentId: "agent-1",
      date: "2026-07-14",
      workdayId: "workday-1",
      workdayState: "PAUSED",
      evidenceSource: "VISIT_COORDINATES",
      gpsEvidenceStates: { MANUALLY_EXCLUDED: 1, MISSING_CHECK_OUT: 1 },
    })])
  })

  it("omits attendance facts instead of implying a missing workday for Routes-only output", () => {
    const report = buildExplainableKpi({
      planPoints: [],
      visits: [{
        ...base, visitId: "visit-1", routePointId: null, completed: true,
        gpsConfirmed: true,
      }],
      visitType: "ALL",
      brandId: null,
      generatedAt: new Date("2026-07-15T08:00:00.000Z"),
      includeWorkforce: false,
    })

    expect(report.drilldown.gpsDays[0]).not.toHaveProperty("workdayId")
    expect(report.drilldown.gpsDays[0]).not.toHaveProperty("workdayState")
  })
})
