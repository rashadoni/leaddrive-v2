import { describe, expect, it } from "vitest"
import {
  buildWorkforceSiteTransitionReport,
  WorkforceSiteTransitionReportError,
  type WorkforceSiteTransitionReportRow,
} from "@/lib/workforce/site-transition-report"

function row(overrides: Partial<WorkforceSiteTransitionReportRow> = {}): WorkforceSiteTransitionReportRow {
  return {
    agentId: "agent-1",
    workdayId: "workday-1",
    segmentId: "segment-1",
    siteId: "site-a",
    kind: "ARRIVAL",
    claimedAt: new Date("2026-09-13T05:00:00.000Z"),
    attendanceReviewState: "NOT_REQUIRED",
    ...overrides,
  }
}

describe("buildWorkforceSiteTransitionReport", () => {
  it("reconciles complete and incomplete segment claims by site and employee", () => {
    const report = buildWorkforceSiteTransitionReport([
      row(),
      row({ kind: "DEPARTURE", claimedAt: new Date("2026-09-13T09:00:00.000Z") }),
      row({
        agentId: "agent-2",
        workdayId: "workday-2",
        segmentId: "segment-2",
        siteId: "site-b",
        attendanceReviewState: "PENDING_REVIEW",
      }),
    ])

    expect(report.summary).toEqual({
      employees: 2,
      sites: 2,
      claims: 3,
      arrivals: 2,
      departures: 1,
      completedSegments: 1,
      incompleteSegments: 1,
      pendingReviewClaims: 1,
      legacyUnknownClaims: 0,
    })
    expect(report.bySite).toEqual([
      expect.objectContaining({ siteId: "site-a", completedSegments: 1, incompleteSegments: 0 }),
      expect.objectContaining({ siteId: "site-b", completedSegments: 0, incompleteSegments: 1 }),
    ])
    expect(report.byEmployee).toHaveLength(2)
  })

  it("keeps presence, raw proof and payroll outside the report contract", () => {
    const report = buildWorkforceSiteTransitionReport([])

    expect(report.boundaries).toEqual({
      physicalPresence: "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE",
      rawLocation: "EXCLUDED_FROM_TRANSITION_REPORT",
      proofDetails: "EXCLUDED_FROM_TRANSITION_REPORT",
      payroll: "NOT_A_PAYROLL_INPUT",
    })
    expect(JSON.stringify(report)).not.toMatch(/latitude|longitude|distanceMeters|qrToken|deviceKey/)
  })

  it("fails closed on duplicate transition kinds within one scheduled segment", () => {
    expect(() => buildWorkforceSiteTransitionReport([row(), row()]))
      .toThrow(WorkforceSiteTransitionReportError)
  })

  it("fails closed on malformed identifiers, timestamps and oversized input", () => {
    expect(() => buildWorkforceSiteTransitionReport([row({ siteId: "" })]))
      .toThrow(WorkforceSiteTransitionReportError)
    expect(() => buildWorkforceSiteTransitionReport([row({ claimedAt: new Date("invalid") })]))
      .toThrow(WorkforceSiteTransitionReportError)
    expect(() => buildWorkforceSiteTransitionReport(
      Array.from({ length: 5_001 }, () => row()),
    )).toThrow(WorkforceSiteTransitionReportError)
  })
})
