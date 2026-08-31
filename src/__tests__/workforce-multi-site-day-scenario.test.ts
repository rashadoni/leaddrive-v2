import { describe, expect, it, vi } from "vitest"
import {
  applyMtmWorkdayEvent,
  parseMtmWorkdayEvent,
  workforceAttendanceClaimReview,
} from "@/lib/mtm/workday"
import { WorkforceEvidenceEnvelopeSchema } from "@/lib/workforce/evidence-envelope"
import {
  evaluateWorkforceSnapshottedGeofence,
  WorkforceSnapshottedCircleGeofenceSchema,
} from "@/lib/workforce/geofence-evaluation"
import { assessWorkforceLocationEvidence } from "@/lib/workforce/location-evidence-policy"
import {
  workforceScheduledSnapshotSegment,
  workforceSnapshottedSegmentAt,
  workforceSnapshottedSiteGeofence,
} from "@/lib/workforce/snapshot-writer"
import {
  recordWorkforceSiteTransition,
  WorkforceSiteTransitionClaimSchema,
} from "@/lib/workforce/site-transition-facts"
import { resolveWorkforceHistoricalTeamMembership } from "@/lib/workforce/team-membership"
import { calculateWorkforceTimesheetDay } from "@/lib/workforce/timesheet-calculation"
import { replayWorkforceWorkdayFacts } from "@/lib/workforce/workday-facts-replay"
import { makeMtmPrismaMock } from "./mocks/mtm-prisma"

const SCOPE = { organizationId: "org-leaddrive", agentId: "employee-1" }
const WORKDAY_ID = "workday-multi-site-1"
const WORKDAY_STARTED_AT = new Date("2026-08-30T05:00:00.000Z") // 09:00 Asia/Baku

const siteA = WorkforceSnapshottedCircleGeofenceSchema.parse({
  revisionId: "site-a-geofence-r1",
  kind: "CIRCLE",
  centerLatitude: 40.4093,
  centerLongitude: 49.8671,
  radiusMeters: 100,
})

const siteB = WorkforceSnapshottedCircleGeofenceSchema.parse({
  revisionId: "site-b-geofence-r1",
  kind: "CIRCLE",
  centerLatitude: 40.425,
  centerLongitude: 49.9,
  radiusMeters: 100,
})

const scheduledSegments = [
  { id: "segment-site-a", mode: "SITE", siteId: "site-a", startTime: "09:00", endTime: "12:00" },
  { id: "segment-travel", mode: "TRAVEL", siteId: null, startTime: "12:00", endTime: "14:00" },
  { id: "segment-site-b", mode: "SITE", siteId: "site-b", startTime: "14:00", endTime: "18:00" },
]

const snapshottedSites = [
  {
    id: "site-a",
    geofenceRevision: {
      id: "site-a-geofence-r1",
      kind: "CIRCLE",
      centerLatitude: 40.4093,
      centerLongitude: 49.8671,
      radiusMeters: 100,
    },
  },
  {
    id: "site-b",
    geofenceRevision: {
      id: "site-b-geofence-r1",
      kind: "CIRCLE",
      centerLatitude: 40.425,
      centerLongitude: 49.9,
      radiusMeters: 100,
    },
  },
]

function locationEvidence(input: {
  capturedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
}) {
  return WorkforceEvidenceEnvelopeSchema.parse({
    schemaVersion: 1,
    source: "LOCATION",
    capturedAt: input.capturedAt,
    operationReference: "operation-multi-site-0001",
    sessionReference: "session-multi-site-0001",
    deviceReference: "device-multi-site-0001",
    app: { platform: "ANDROID", version: "1.0.0", buildReference: "build-multi-site-0001" },
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

describe("Workforce multi-site day scenario", () => {
  it("keeps Site A, travel and Site B facts separate while weak or wrong-site GPS remains reviewable", () => {
    const siteAArrival = locationEvidence({
      capturedAt: "2026-08-30T05:00:00.000Z",
      latitude: 40.4093,
      longitude: 49.8671,
      accuracyMeters: 10,
    })
    const wrongSiteAtB = locationEvidence({
      capturedAt: "2026-08-30T10:00:00.000Z",
      latitude: 40.4093,
      longitude: 49.8671,
      accuracyMeters: 10,
    })
    const weakGpsAtB = locationEvidence({
      capturedAt: "2026-08-30T10:00:00.000Z",
      latitude: 40.425,
      longitude: 49.9,
      accuracyMeters: 101,
    })

    expect(workforceScheduledSnapshotSegment(scheduledSegments, "segment-site-a")).toEqual({
      id: "segment-site-a", mode: "SITE", siteId: "site-a",
    })
    expect(workforceScheduledSnapshotSegment(scheduledSegments, "segment-travel")).toEqual({
      id: "segment-travel", mode: "TRAVEL", siteId: null,
    })
    expect(workforceScheduledSnapshotSegment(scheduledSegments, "segment-site-b")).toEqual({
      id: "segment-site-b", mode: "SITE", siteId: "site-b",
    })
    expect(workforceSnapshottedSegmentAt({
      workDate: new Date("2026-08-30T00:00:00.000Z"),
      timezone: "Asia/Baku",
      segments: scheduledSegments,
      occurredAt: new Date("2026-08-30T10:00:00.000Z"),
    })).toEqual({ id: "segment-site-b", mode: "SITE", siteId: "site-b" })
    expect(workforceSnapshottedSegmentAt({
      workDate: new Date("2026-08-30T00:00:00.000Z"),
      timezone: "Asia/Baku",
      segments: scheduledSegments,
      occurredAt: new Date("2026-08-30T09:00:00.000Z"),
    })).toEqual({ id: "segment-travel", mode: "TRAVEL", siteId: null })
    expect(workforceSnapshottedSiteGeofence(snapshottedSites, "site-b")).toEqual(siteB)

    expect(assessWorkforceLocationEvidence({
      evidence: siteAArrival,
      now: new Date("2026-08-30T05:01:00.000Z"),
    })).toMatchObject({ status: "ELIGIBLE_FOR_GEOFENCE", reasonCodes: ["LOCATION_READY_FOR_GEOFENCE"] })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence: siteA, evidence: siteAArrival })).toMatchObject({
      verdict: "INSIDE",
      reasonCode: "INSIDE_WITH_ACCURACY",
    })

    expect(evaluateWorkforceSnapshottedGeofence({ geofence: siteB, evidence: wrongSiteAtB })).toMatchObject({
      verdict: "OUTSIDE",
      reasonCode: "OUTSIDE_WITH_ACCURACY",
    })
    expect(assessWorkforceLocationEvidence({
      evidence: weakGpsAtB,
      now: new Date("2026-08-30T10:01:00.000Z"),
    })).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasonCodes: ["LOCATION_ACCURACY_EXCEEDED"],
    })
    expect(evaluateWorkforceSnapshottedGeofence({ geofence: siteB, evidence: weakGpsAtB })).toMatchObject({
      verdict: "UNKNOWN",
      reasonCode: "BOUNDARY_ACCURACY_OVERLAP",
    })

    const facts = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "start-site-a", type: "START", occurredAt: "2026-08-30T05:00:00.000Z" },
        { id: "travel-break", type: "PAUSE", occurredAt: "2026-08-30T09:00:00.000Z" },
        { id: "resume-site-b", type: "RESUME", occurredAt: "2026-08-30T10:00:00.000Z" },
        { id: "finish-site-b", type: "FINISH", occurredAt: "2026-08-30T14:00:00.000Z" },
      ],
    })
    const timesheet = calculateWorkforceTimesheetDay({
      asOf: "2026-08-30T14:00:00.000Z",
      schedule: {
        shiftSnapshotId: "shift-multi-site-r1",
        workDate: "2026-08-30",
        timezone: "Asia/Baku",
        plannedStartAt: "2026-08-30T05:00:00.000Z",
        plannedEndAt: "2026-08-30T14:00:00.000Z",
      },
      policySnapshot: {
        snapshotId: "policy-leaddrive-baku-r1",
        expectedWorkSeconds: 8 * 60 * 60,
        lateGraceSeconds: 15 * 60,
        undertimeToleranceSeconds: 0,
        overtimeThresholdSeconds: 15 * 60,
        longPauseThresholdSeconds: 60 * 60,
      },
      facts,
    })

    expect(timesheet).toMatchObject({
      status: "COMPLETED",
      fact: { workedSeconds: 8 * 60 * 60, pausedSeconds: 60 * 60 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 },
      exceptions: [],
    })
  })

  it("records a delayed Site B arrival against the earlier immutable schedule, not a later live transfer", async () => {
    const db = makeMtmPrismaMock()
    const receivedAt = new Date("2026-08-30T10:20:00.000Z")
    const delayedBClaim = WorkforceSiteTransitionClaimSchema.parse({
      workdayId: WORKDAY_ID,
      segmentId: "segment-site-b",
      clientTransitionId: "site-b-arrival-offline-1",
      kind: "ARRIVAL",
      claimedAt: "2026-08-30T10:00:00.000Z",
      capturedAt: "2026-08-30T10:00:10.000Z",
      queuedAt: "2026-08-30T10:00:20.000Z",
      schemaVersion: 1,
    })

    vi.mocked(db.$queryRaw).mockResolvedValue([{
      id: "team-before-transfer", teamId: "team-a", effectiveAt: WORKDAY_STARTED_AT,
    }] as never)
    await expect(resolveWorkforceHistoricalTeamMembership(db as never, {
      ...SCOPE,
      workdayStartedAt: WORKDAY_STARTED_AT,
    })).resolves.toEqual({ id: "team-before-transfer", teamId: "team-a", effectiveAt: WORKDAY_STARTED_AT })

    vi.mocked(db.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "site-a-departure" } as never)
    vi.mocked(db.mtmAgentWorkday.findFirst).mockResolvedValue({ id: WORKDAY_ID } as never)
    vi.mocked(db.workforceShiftSegment.findFirst).mockResolvedValue({ id: "segment-site-b" } as never)
    vi.mocked(db.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-multi-site-r1",
      segments: scheduledSegments,
    } as never)
    vi.mocked(db.workforceSiteTransition.create).mockImplementation(async (value: unknown) => {
      const data = (value as { data: Record<string, unknown> }).data
      return {
        id: "transition-site-b-arrival",
        ...data,
        createdAt: receivedAt,
      } as never
    })

    await expect(recordWorkforceSiteTransition({
      db: db as never,
      ...SCOPE,
      claim: delayedBClaim,
      now: receivedAt,
    })).resolves.toMatchObject({ status: "recorded", idempotent: false })

    expect(db.workforceSiteTransition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        segmentId: "segment-site-b",
        attendanceReviewState: "PENDING_REVIEW",
        attendanceReviewReasonCode: "DELAYED_CLAIM",
      }),
    }))
    expect(db.workforceSiteAssignment.findMany).not.toHaveBeenCalled()
    expect(workforceAttendanceClaimReview(delayedBClaim.claimedAt, receivedAt)).toMatchObject({
      state: "PENDING_REVIEW",
      reasonCode: "DELAYED_CLAIM",
      claimAgeSeconds: 20 * 60,
    })

    const eventDb = makeMtmPrismaMock()
    const delayedStart = parseMtmWorkdayEvent({
      action: "START",
      id: WORKDAY_ID,
      occurredAt: "2026-08-30T05:00:00.000Z",
      claimedAt: "2026-08-30T05:00:00.000Z",
      capturedAt: "2026-08-30T05:00:10.000Z",
      queuedAt: "2026-08-30T05:00:20.000Z",
      schemaVersion: 2,
    }, "workday-start-offline-1", "Asia/Baku", new Date("2026-08-30T05:20:00.000Z"))
    expect(delayedStart.error).toBeNull()
    vi.mocked(eventDb.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)
    vi.mocked(eventDb.mtmAgentWorkday.create).mockResolvedValue({
      id: WORKDAY_ID,
      status: "STARTED",
      workDate: new Date("2026-08-30T00:00:00.000Z"),
      startedAt: WORKDAY_STARTED_AT,
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
    } as never)
    vi.mocked(eventDb.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "event-start-offline-1",
      workdayId: WORKDAY_ID,
      clientEventId: "workday-start-offline-1",
      type: "START",
      occurredAt: WORKDAY_STARTED_AT,
      attendanceReviewState: "PENDING_REVIEW",
      attendanceReviewReasonCode: "DELAYED_CLAIM",
    } as never)
    vi.mocked(eventDb.workforceAttendanceReviewCase.create).mockResolvedValue({ id: "case-delayed-1" } as never)

    await expect(applyMtmWorkdayEvent(eventDb as never, SCOPE, delayedStart.input!)).resolves.toMatchObject({
      status: "ok",
      review: { state: "PENDING_REVIEW", reasonCode: "DELAYED_CLAIM" },
    })
    expect(eventDb.workforceAttendanceReviewCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workdayId: WORKDAY_ID,
        workdayEventId: "event-start-offline-1",
        status: "PENDING_REVIEW",
        reasonCode: "DELAYED_CLAIM",
      }),
    })
  })
})
