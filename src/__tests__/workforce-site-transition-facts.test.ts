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
})
