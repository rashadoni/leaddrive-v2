import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  cancelWorkforceSelfRequest,
  submitWorkforceSelfRequest,
  WorkforceSelfRequestSchema,
} from "@/lib/workforce/self-request"

const ACTOR = { agentId: "agent-1", role: "AGENT" as const, scopedAgentIds: ["agent-1"] }
const ORGANIZATION_ID = "org-workforce"

function input(overrides: Record<string, unknown> = {}) {
  return WorkforceSelfRequestSchema.parse({
    clientRequestId: "request-key-123",
    type: "LEAVE",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    reason: "Annual leave request",
    ...overrides,
  })
}

function requestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    type: "LEAVE",
    status: "PENDING",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: new Date("2026-09-02T00:00:00.000Z"),
    correctionWorkdayId: null,
    exceptionCaseId: null,
    requestedStartAt: null,
    requestedEndAt: null,
    reason: "Annual leave request",
    submittedAt: new Date("2026-08-30T09:00:00.000Z"),
    cancelledAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmHrmRequest.create).mockResolvedValue(requestRecord() as never)
  vi.mocked(prisma.mtmHrmRequest.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("Workforce employee self-service requests", () => {
  it("submits a self-scoped leave request with metadata-only audit", async () => {
    const result = await submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input(),
      timezone: "Asia/Baku",
      audit: { ipAddress: "203.0.113.8", userAgent: "vitest-self-request" },
    })

    expect(result).toMatchObject({ kind: "success", idempotent: false, data: { id: "request-1", status: "PENDING" } })
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: "agent-1",
        clientRequestId: "request-key-123",
        type: "LEAVE",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SELF_REQUEST_SUBMITTED",
        ipAddress: "203.0.113.8",
        newData: expect.objectContaining({
          type: "LEAVE",
          correctionRequested: false,
        }),
      }),
    }))
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("Annual leave request")
  })

  it("binds a correction request to the employee's exact workday and organization-local time", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "workday-1" } as never)
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue({ id: "case-1" } as never)
    vi.mocked(prisma.mtmHrmRequest.create).mockResolvedValue(requestRecord({
      type: "TIME_CORRECTION",
      correctionWorkdayId: "workday-1",
      exceptionCaseId: "case-1",
      requestedStartAt: new Date("2026-08-28T05:00:00.000Z"),
      requestedEndAt: null,
    }) as never)

    const result = await submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input({
        clientRequestId: "correction-key-123",
        type: "TIME_CORRECTION",
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        correctionWorkdayId: "workday-1",
        exceptionCaseId: "case-1",
        requestedStartLocal: "2026-08-28T09:00",
        reason: "Clock-in needs correction",
      }),
      timezone: "Asia/Baku",
    })

    expect(result).toMatchObject({ kind: "success", data: { type: "TIME_CORRECTION" } })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: {
        id: "workday-1",
        organizationId: ORGANIZATION_ID,
        agentId: "agent-1",
        workDate: new Date("2026-08-28T00:00:00.000Z"),
      },
      select: { id: true },
    })
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        exceptionCaseId: "case-1",
        requestedStartAt: new Date("2026-08-28T05:00:00.000Z"),
        requestedEndAt: null,
      }),
    }))
    expect(prisma.workforceExceptionCase.findFirst).toHaveBeenCalledWith({
      where: {
        id: "case-1",
        organizationId: ORGANIZATION_ID,
        agentId: "agent-1",
        workdayId: "workday-1",
      },
      select: { id: true },
    })
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("case-1")
  })

  it("rejects a case source hint on a non-correction request", () => {
    expect(() => input({ exceptionCaseId: "case-1" })).toThrow("correction fields are valid only for a time correction")
  })

  it("returns an exact client request retry but rejects changed details under the same id", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(requestRecord() as never)

    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input(),
      timezone: "Asia/Baku",
    })).resolves.toMatchObject({ kind: "success", idempotent: true })

    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input({ reason: "Different leave reason" }),
      timezone: "Asia/Baku",
    })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_SELF_REQUEST_IDEMPOTENCY_MISMATCH",
    })
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })

  it("does not submit a correction for a different employee workday", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)

    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input({
        type: "TIME_CORRECTION",
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        correctionWorkdayId: "other-employees-workday",
        requestedEndLocal: "2026-08-28T18:00",
        reason: "Clock-out needs correction",
      }),
      timezone: "Asia/Baku",
    })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND",
    })
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })

  it("does not link a correction to a missing, foreign or different-day exception case", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "workday-1" } as never)
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue(null as never)

    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input({
        clientRequestId: "exception-case-key-123",
        type: "TIME_CORRECTION",
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        correctionWorkdayId: "workday-1",
        exceptionCaseId: "case-not-owned-by-employee",
        requestedEndLocal: "2026-08-28T18:00",
        reason: "Clock-out needs correction",
      }),
      timezone: "Asia/Baku",
    })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND",
    })
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })

  it("treats a changed exception source under the same request key as a non-retry", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(requestRecord({
      type: "TIME_CORRECTION",
      startDate: new Date("2026-08-28T00:00:00.000Z"),
      endDate: new Date("2026-08-28T00:00:00.000Z"),
      correctionWorkdayId: "workday-1",
      exceptionCaseId: "case-1",
      requestedStartAt: new Date("2026-08-28T05:00:00.000Z"),
      reason: "Clock-in needs correction",
    }) as never)

    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      input: input({
        type: "TIME_CORRECTION",
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        correctionWorkdayId: "workday-1",
        exceptionCaseId: "case-2",
        requestedStartLocal: "2026-08-28T09:00",
        reason: "Clock-in needs correction",
      }),
      timezone: "Asia/Baku",
    })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_SELF_REQUEST_IDEMPOTENCY_MISMATCH",
    })
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })

  it("cancels only a pending self request and treats an existing cancellation as a safe retry", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst)
      .mockResolvedValueOnce(requestRecord() as never)
      .mockResolvedValueOnce(requestRecord({ status: "CANCELLED", cancelledAt: new Date("2026-08-30T09:15:00.000Z") }) as never)

    await expect(cancelWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      requestId: "request-1",
    })).resolves.toMatchObject({ kind: "success", idempotent: false, data: { status: "CANCELLED" } })
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "request-1", organizationId: ORGANIZATION_ID, agentId: "agent-1", status: "PENDING" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }))
    await expect(cancelWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: ACTOR,
      requestId: "request-1",
    })).resolves.toMatchObject({ kind: "success", idempotent: true, data: { status: "CANCELLED" } })
  })

  it("never lets an administrator submit or cancel an employee request as if it were their own", async () => {
    const adminActor = { agentId: null, role: "ADMIN" as const, scopedAgentIds: null }
    await expect(submitWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: adminActor,
      input: input(),
      timezone: "Asia/Baku",
    })).resolves.toEqual({ kind: "forbidden" })
    await expect(cancelWorkforceSelfRequest({
      organizationId: ORGANIZATION_ID,
      actor: adminActor,
      requestId: "request-1",
    })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
