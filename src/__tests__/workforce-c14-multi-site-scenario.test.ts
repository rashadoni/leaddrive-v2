import { describe, expect, it } from "vitest"
import { WorkforceShiftTemplateDraftCreateSchema } from "@/lib/workforce/configuration-management"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  WorkforceSnapshottedCircleGeofenceSchema,
  evaluateWorkforceSnapshottedGeofence,
} from "@/lib/workforce/geofence-evaluation"
import { assessWorkforceLocationEvidence } from "@/lib/workforce/location-evidence-policy"
import { evaluateWorkforceAttendanceRiskSignals } from "@/lib/workforce/attendance-risk-signals"
import { createWorkforceExceptionCaseDraft } from "@/lib/workforce/exception-case-ledger"
import {
  WorkforceSiteTransitionClaimSchema,
} from "@/lib/workforce/site-transition-facts"
import { buildWorkforceSiteTransitionReport } from "@/lib/workforce/site-transition-report"
import { calculateWorkforceTimesheetDay } from "@/lib/workforce/timesheet-calculation"

const SITE_A = WorkforceSnapshottedCircleGeofenceSchema.parse({
  revisionId: "site-a-geofence-v1",
  kind: "CIRCLE",
  centerLatitude: 40.4093,
  centerLongitude: 49.8671,
  radiusMeters: 100,
})
const SITE_B = WorkforceSnapshottedCircleGeofenceSchema.parse({
  revisionId: "site-b-geofence-v1",
  kind: "CIRCLE",
  centerLatitude: 40.4193,
  centerLongitude: 49.8671,
  radiusMeters: 100,
})

function location(input: {
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
}) {
  return WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt: input.capturedAt,
    operationReference: "operation-c14-multi-site",
    sessionReference: "session-c14-multi-site",
    deviceReference: "device-c14-multi-site",
    app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-c14-multi-site" },
    location: {
      availability: "AVAILABLE",
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      provider: "FUSED",
      isMock: false,
    },
    methodReference: null,
  })
}

describe("Workforce C14 multi-site day scenario", () => {
  it("pins the Baku 09-13 site A and 14-18 site B schedule around the transition window", () => {
    const draft = WorkforceShiftTemplateDraftCreateSchema.parse({
      code: "BAKU_MULTI_SITE",
      name: "Baku site transfer day",
      definition: {
        startTime: "09:00",
        endTime: "18:00",
        timezone: "Asia/Baku",
        daysOfWeek: [1, 2, 3, 4, 5],
        plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
      },
      segments: [
        { mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "13:00", lateGraceSeconds: 900 },
        { mode: "SITE", siteId: "site-b", startTime: "14:00", endTime: "18:00", lateGraceSeconds: 900 },
      ],
    })

    expect(draft.definition.timezone).toBe("Asia/Baku")
    expect(draft.segments?.map(({ mode, siteId, startTime, endTime }) => ({ mode, siteId, startTime, endTime }))).toEqual([
      { mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "13:00" },
      { mode: "SITE", siteId: "site-b", startTime: "14:00", endTime: "18:00" },
    ])
  })

  it("turns wrong-site and weak-GPS evidence into review, never presence", () => {
    const atSiteA = location({
      capturedAt: "2026-09-14T10:00:00.000Z",
      latitude: SITE_A.centerLatitude,
      longitude: SITE_A.centerLongitude,
      accuracyMeters: 5,
    })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence: SITE_B, evidence: atSiteA }))
      .toMatchObject({ verdict: "OUTSIDE", reasonCode: "OUTSIDE_WITH_ACCURACY" })

    const weakAtSiteB = location({
      capturedAt: "2026-09-14T10:00:00.000Z",
      latitude: SITE_B.centerLatitude,
      longitude: SITE_B.centerLongitude,
      accuracyMeters: 150,
    })
    expect(assessWorkforceLocationEvidence({
      evidence: weakAtSiteB,
      now: new Date("2026-09-14T10:00:30.000Z"),
    })).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: ["LOCATION_ACCURACY_EXCEEDED"],
    })

    for (const [kind, eventId, evidenceId] of [
      ["WRONG_SITE", "arrival-site-b-wrong", "evidence-wrong-site"],
      ["WEAK_GPS", "arrival-site-b-weak", "evidence-weak-gps"],
    ] as const) {
      const reviewCase = createWorkforceExceptionCaseDraft({
        organizationId: "leaddrive",
        agentId: "employee-1",
        kind,
        detectorVersion: "workforce-c14-multi-site-v1",
        links: {
          workdayId: "workday-2026-09-14",
          workdayEventId: eventId,
          evidenceId,
          segmentId: "segment-site-b",
        },
      })
      expect(reviewCase.deduplicationKey).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(reviewCase)).not.toMatch(/latitude|longitude|payroll|discipline/i)
    }
  })

  it("keeps a delayed offline transfer ordered and reviewable without corrupting the timesheet", () => {
    const offlineArrival = WorkforceSiteTransitionClaimSchema.parse({
      workdayId: "workday-2026-09-14",
      segmentId: "segment-site-b",
      clientTransitionId: "arrival-site-b-offline",
      kind: "ARRIVAL",
      claimedAt: "2026-09-14T10:00:00.000Z",
      capturedAt: "2026-09-14T10:00:05.000Z",
      queuedAt: "2026-09-14T10:00:10.000Z",
      schemaVersion: 1,
    })
    const transferSignals = evaluateWorkforceAttendanceRiskSignals({
      previous: {
        departedAt: new Date("2026-09-14T09:00:00.000Z"),
        distanceToCurrentSiteMeters: 10_000,
      },
      current: {
        claimedAt: offlineArrival.claimedAt,
        capturedAt: offlineArrival.capturedAt,
        serverReceivedAt: new Date("2026-09-14T11:30:00.000Z"),
      },
    })
    expect(transferSignals).toEqual([])

    const report = buildWorkforceSiteTransitionReport([
      { agentId: "employee-1", workdayId: offlineArrival.workdayId, segmentId: "segment-site-a", siteId: "site-a", kind: "ARRIVAL", claimedAt: new Date("2026-09-14T05:00:00.000Z"), attendanceReviewState: "NOT_REQUIRED" },
      { agentId: "employee-1", workdayId: offlineArrival.workdayId, segmentId: "segment-site-a", siteId: "site-a", kind: "DEPARTURE", claimedAt: new Date("2026-09-14T09:00:00.000Z"), attendanceReviewState: "NOT_REQUIRED" },
      { agentId: "employee-1", workdayId: offlineArrival.workdayId, segmentId: offlineArrival.segmentId, siteId: "site-b", kind: "ARRIVAL", claimedAt: offlineArrival.claimedAt, attendanceReviewState: "PENDING_REVIEW" },
      { agentId: "employee-1", workdayId: offlineArrival.workdayId, segmentId: offlineArrival.segmentId, siteId: "site-b", kind: "DEPARTURE", claimedAt: new Date("2026-09-14T14:00:00.000Z"), attendanceReviewState: "NOT_REQUIRED" },
    ])
    expect(report.summary).toMatchObject({
      claims: 4,
      completedSegments: 2,
      incompleteSegments: 0,
      pendingReviewClaims: 1,
    })
    expect(report.boundaries.physicalPresence).toBe("CLAIMS_ARE_NOT_PHYSICAL_PRESENCE")

    const timesheet = calculateWorkforceTimesheetDay({
      asOf: "2026-09-14T14:00:00.000Z",
      schedule: {
        shiftSnapshotId: "shift-baku-multi-site-v1",
        workDate: "2026-09-14",
        timezone: "Asia/Baku",
        plannedStartAt: "2026-09-14T05:00:00.000Z",
        plannedEndAt: "2026-09-14T14:00:00.000Z",
      },
      policySnapshot: {
        snapshotId: "policy-baku-v1",
        expectedWorkSeconds: 8 * 60 * 60,
        lateGraceSeconds: 15 * 60,
        undertimeToleranceSeconds: 0,
        overtimeThresholdSeconds: 0,
        longPauseThresholdSeconds: 60 * 60,
      },
      facts: {
        workdayId: offlineArrival.workdayId,
        status: "COMPLETED",
        startedAt: "2026-09-14T05:00:00.000Z",
        completedAt: "2026-09-14T14:00:00.000Z",
        pauseIntervals: [{
          startedAt: "2026-09-14T09:00:00.000Z",
          endedAt: "2026-09-14T10:00:00.000Z",
        }],
      },
    })
    expect(timesheet.fact).toMatchObject({ workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 })
    expect(timesheet.exceptions).toEqual([])
    expect(report.summary.pendingReviewClaims).toBe(1)
  })
})
