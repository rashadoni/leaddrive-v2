import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  WorkforceSiteTransitionClaimSchema,
  WorkforceSiteTransitionError,
  recordWorkforceSiteTransition,
  workforceSiteTransitionRequestHash,
} from "@/lib/workforce/site-transition-facts"

const organizationId = "org-workforce"
const agentId = "agent-1"
const now = new Date("2026-08-30T09:05:00.000Z")
const multiSiteSegments = [
  { id: "segment-a", mode: "SITE", siteId: "site-a" },
  { id: "segment-travel", mode: "TRAVEL", siteId: null },
  { id: "segment-b", mode: "SITE", siteId: "site-b" },
]

function snapshottedSites(currentLatitude = 40.4103) {
  return [
    {
      id: "site-a",
      geofenceRevision: {
        id: "site-a-r1",
        kind: "CIRCLE",
        centerLatitude: 40.4093,
        centerLongitude: 49.8671,
        radiusMeters: 100,
      },
    },
    {
      id: "site-b",
      geofenceRevision: {
        id: "site-b-r1",
        kind: "CIRCLE",
        centerLatitude: currentLatitude,
        centerLongitude: 49.8671,
        radiusMeters: 100,
      },
    },
  ]
}

function claim(overrides: Record<string, unknown> = {}) {
  return WorkforceSiteTransitionClaimSchema.parse({
    workdayId: "workday-1",
    segmentId: "segment-a",
    clientTransitionId: "transition-1",
    kind: "ARRIVAL",
    claimedAt: "2026-08-30T09:00:00.000Z",
    capturedAt: "2026-08-30T09:00:10.000Z",
    queuedAt: "2026-08-30T09:00:20.000Z",
    schemaVersion: 1,
    ...overrides,
  })
}

function transition(input: ReturnType<typeof claim>) {
  return {
    id: "transition-server-1",
    workdayId: input.workdayId,
    segmentId: input.segmentId,
    kind: input.kind,
    clientTransitionId: input.clientTransitionId,
    claimedAt: input.claimedAt,
    capturedAt: input.capturedAt,
    queuedAt: input.queuedAt,
    serverReceivedAt: now,
    appliedAt: now,
    schemaVersion: input.schemaVersion,
    requestHash: workforceSiteTransitionRequestHash({ organizationId, agentId }, input),
    attendanceReviewState: "NOT_REQUIRED",
    attendanceReviewReasonCode: null,
    createdAt: now,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce site-transition facts", () => {
  it("records a tenant-scoped arrival claim and audit without raw evidence or a second workday", async () => {
    const input = claim()
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1", segments: [{ id: input.segmentId, mode: "SITE", siteId: "site-1" }],
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockResolvedValue(transition(input) as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never,
      organizationId,
      agentId,
      claim: input,
      now,
      audit: { ipAddress: "203.0.113.4", userAgent: "Vitest" },
    })).resolves.toMatchObject({ status: "recorded", idempotent: false })

    expect(prisma.workforceSiteTransition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        agentId,
        workdayId: "workday-1",
        segmentId: "segment-a",
        kind: "ARRIVAL",
        attendanceReviewState: "NOT_REQUIRED",
        attendanceReviewReasonCode: null,
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SITE_TRANSITION_ARRIVAL",
        entity: "workforce_site_transition",
        entityId: "transition-server-1",
        newData: expect.not.objectContaining({ latitude: expect.anything(), longitude: expect.anything() }),
      }),
    }))
  })

  it("keeps delayed in-window claims reviewable and replays only an identical client transition", async () => {
    const delayed = claim({
      claimedAt: "2026-08-30T08:40:00.000Z",
      capturedAt: "2026-08-30T08:40:10.000Z",
      queuedAt: "2026-08-30T08:40:20.000Z",
    })
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: delayed.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: delayed.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1", segments: [{ id: delayed.segmentId, mode: "SITE", siteId: "site-1" }],
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockResolvedValue({
      ...transition(delayed),
      attendanceReviewState: "PENDING_REVIEW",
      attendanceReviewReasonCode: "DELAYED_CLAIM",
    } as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: delayed, now,
    })).resolves.toMatchObject({ status: "recorded", idempotent: false })
    expect(prisma.workforceSiteTransition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attendanceReviewState: "PENDING_REVIEW",
        attendanceReviewReasonCode: "DELAYED_CLAIM",
      }),
    }))

    const replay = transition(delayed)
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValueOnce(replay as never)
    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: delayed, now,
    })).resolves.toMatchObject({ status: "recorded", idempotent: true, transition: { id: "transition-server-1" } })

    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValueOnce({
      ...replay,
      requestHash: "different-payload",
    } as never)
    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: delayed, now,
    })).resolves.toMatchObject({
      status: "conflict",
      code: "WORKFORCE_SITE_TRANSITION_IDEMPOTENCY_MISMATCH",
    })
  })

  it("rejects unsupported old/future claims before any workday or segment lookup", async () => {
    const old = claim({
      claimedAt: "2026-08-22T08:00:00.000Z",
      capturedAt: "2026-08-22T08:00:10.000Z",
      queuedAt: "2026-08-22T08:00:20.000Z",
    })
    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: old, now,
    })).rejects.toMatchObject<Partial<WorkforceSiteTransitionError>>({
      code: "WORKFORCE_SITE_TRANSITION_OFFLINE_HORIZON",
    })

    const future = claim({
      claimedAt: "2026-08-30T09:11:00.000Z",
      capturedAt: "2026-08-30T09:11:00.000Z",
      queuedAt: "2026-08-30T09:11:00.000Z",
    })
    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: future, now,
    })).rejects.toMatchObject<Partial<WorkforceSiteTransitionError>>({
      code: "WORKFORCE_SITE_TRANSITION_FUTURE_TIME",
    })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceShiftSegment.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceWorkdayScheduleSnapshot.findFirst).not.toHaveBeenCalled()
  })

  it("does not attach a site claim to an unsnapshotted or non-site segment", async () => {
    const input = claim()
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1", segments: [{ id: input.segmentId, mode: "REMOTE", siteId: null }],
    } as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).rejects.toMatchObject<Partial<WorkforceSiteTransitionError>>({
      code: "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_SCHEDULED",
    })
    expect(prisma.workforceSiteTransition.create).not.toHaveBeenCalled()
  })

  it("returns a retryable conflict until an earlier scheduled-site departure exists", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: multiSiteSegments,
      sites: snapshottedSites(),
    } as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).resolves.toEqual({
      status: "conflict",
      code: "WORKFORCE_SITE_TRANSITION_PREDECESSOR_DEPARTURE_REQUIRED",
      message: "The previous scheduled site departure must be recorded before this arrival can be retried",
    })
    expect(prisma.workforceSiteTransition.findFirst).toHaveBeenLastCalledWith({
      where: {
        organizationId,
        agentId,
        workdayId: "workday-1",
        segmentId: "segment-a",
        kind: "DEPARTURE",
        claimedAt: { lt: input.claimedAt },
      },
      select: { id: true, claimedAt: true },
    })
    expect(prisma.workforceSiteTransition.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("accepts a retry after the predecessor departure and does not invent risk without complete geometry", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "departure-a", claimedAt: new Date("2026-08-30T08:50:00.000Z") } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: multiSiteSegments,
      sites: [],
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockImplementation(async (value: unknown) => ({
      id: "transition-server-1",
      ...(value as { data: Record<string, unknown> }).data,
      createdAt: now,
    }) as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).resolves.toMatchObject({ status: "recorded", idempotent: false })
    expect(prisma.workforceSiteTransition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attendanceReviewState: "NOT_REQUIRED",
        attendanceReviewReasonCode: null,
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newData: expect.objectContaining({ riskSignalCodes: [] }),
      }),
    }))
  })

  it("accepts an ordinary transition between complete snapshotted site circles without review", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "departure-a", claimedAt: new Date("2026-08-30T08:50:00.000Z") } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: multiSiteSegments,
      sites: snapshottedSites(),
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockImplementation(async (value: unknown) => ({
      id: "transition-server-1",
      ...(value as { data: Record<string, unknown> }).data,
      createdAt: now,
    }) as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).resolves.toMatchObject({
      status: "recorded",
      transition: {
        attendanceReviewState: "NOT_REQUIRED",
        attendanceReviewReasonCode: null,
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newData: expect.objectContaining({ riskSignalCodes: [] }),
      }),
    }))
  })

  it("records an impossible inter-site speed as review-only without exposing geometry", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "departure-a", claimedAt: new Date("2026-08-30T08:59:30.000Z") } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: multiSiteSegments,
      sites: snapshottedSites(41.7093),
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockImplementation(async (value: unknown) => ({
      id: "transition-server-1",
      ...(value as { data: Record<string, unknown> }).data,
      createdAt: now,
    }) as never)

    const result = await recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })
    expect(result).toMatchObject({
      status: "recorded",
      transition: {
        attendanceReviewState: "PENDING_REVIEW",
        attendanceReviewReasonCode: "IMPOSSIBLE_SITE_TRANSITION",
      },
    })
    const auditInput = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0][0] as {
      data: { newData: Record<string, unknown> }
    }
    expect(auditInput.data.newData).toMatchObject({
      attendanceReviewReasonCode: "IMPOSSIBLE_SITE_TRANSITION",
      riskSignalCodes: ["IMPOSSIBLE_SITE_TRANSITION"],
    })
    expect(JSON.stringify(auditInput.data.newData)).not.toMatch(
      /centerLatitude|centerLongitude|radiusMeters|distanceMeters|speedKmh/,
    )
  })

  it("keeps delayed claim as the primary reason while auditing only the safe impossible-transition code", async () => {
    const receivedAt = new Date("2026-08-30T09:05:00.000Z")
    const input = claim({
      segmentId: "segment-b",
      claimedAt: "2026-08-30T08:40:00.000Z",
      capturedAt: "2026-08-30T08:40:10.000Z",
      queuedAt: "2026-08-30T08:40:20.000Z",
    })
    vi.mocked(prisma.workforceSiteTransition.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "departure-a", claimedAt: new Date("2026-08-30T08:39:30.000Z") } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: multiSiteSegments,
      sites: snapshottedSites(41.7093),
    } as never)
    vi.mocked(prisma.workforceSiteTransition.create).mockImplementation(async (value: unknown) => ({
      id: "transition-server-1",
      ...(value as { data: Record<string, unknown> }).data,
      createdAt: receivedAt,
    }) as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now: receivedAt,
    })).resolves.toMatchObject({
      status: "recorded",
      transition: {
        attendanceReviewState: "PENDING_REVIEW",
        attendanceReviewReasonCode: "DELAYED_CLAIM",
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newData: expect.objectContaining({
          attendanceReviewReasonCode: "DELAYED_CLAIM",
          riskSignalCodes: ["IMPOSSIBLE_SITE_TRANSITION"],
        }),
      }),
    }))
  })

  it("returns an exact replay before schedule or geometry is read again", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValue(transition(input) as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).resolves.toMatchObject({ status: "recorded", idempotent: true })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceWorkdayScheduleSnapshot.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceSiteTransition.create).not.toHaveBeenCalled()
  })

  it("fails closed on a duplicate immutable segment context before predecessor lookup or write", async () => {
    const input = claim({ segmentId: "segment-b" })
    vi.mocked(prisma.workforceSiteTransition.findFirst).mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: input.workdayId } as never)
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({ id: input.segmentId } as never)
    vi.mocked(prisma.workforceWorkdayScheduleSnapshot.findFirst).mockResolvedValue({
      id: "schedule-snapshot-1",
      segments: [...multiSiteSegments, { id: "segment-a", mode: "SITE", siteId: "site-c" }],
      sites: snapshottedSites(),
    } as never)

    await expect(recordWorkforceSiteTransition({
      db: prisma as never, organizationId, agentId, claim: input, now,
    })).rejects.toMatchObject<Partial<WorkforceSiteTransitionError>>({
      code: "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_SCHEDULED",
    })
    expect(prisma.workforceSiteTransition.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.workforceSiteTransition.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
