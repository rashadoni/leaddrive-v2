import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { correctWorkforceTimeDirectly } from "@/lib/workforce/direct-time-correction"

const ORGANIZATION_ID = "org-workforce"
const WORKDAY_ID = "workday-1"
const AGENT_ID = "agent-1"
const UPDATED_AT = new Date("2026-08-28T18:01:00.000Z")

function completedWorkday(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKDAY_ID,
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    status: "COMPLETED",
    startedAt: new Date("2026-08-28T09:00:00.000Z"),
    pausedAt: null,
    completedAt: new Date("2026-08-28T18:00:00.000Z"),
    totalPausedSeconds: 60 * 60,
    updatedAt: UPDATED_AT,
    agent: { userId: "agent-user-1" },
    ...overrides,
  }
}

const input = {
  operationId: "direct-correction-1",
  expectedUpdatedAt: UPDATED_AT.toISOString(),
  startedAt: "2026-08-28T08:45:00.000Z",
  completedAt: "2026-08-28T17:45:00.000Z",
  reason: "Verified with the employee",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
    { id: "event-1", type: "START", occurredAt: new Date("2026-08-28T09:00:00.000Z") },
    { id: "event-2", type: "PAUSE", occurredAt: new Date("2026-08-28T12:00:00.000Z") },
    { id: "event-3", type: "RESUME", occurredAt: new Date("2026-08-28T13:00:00.000Z") },
    { id: "event-4", type: "FINISH", occurredAt: new Date("2026-08-28T18:00:00.000Z") },
  ] as never)
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.workforceTimeCorrection.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.workforceTimeCorrection.create).mockResolvedValue({ id: "correction-1" } as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst)
    .mockResolvedValueOnce({
      id: WORKDAY_ID,
      agentId: AGENT_ID,
      agent: { userId: "agent-user-1" },
    } as never)
    .mockResolvedValueOnce(completedWorkday() as never)
})

describe("direct Workforce manager time correction", () => {
  it("writes ledger, projection and mandatory audit atomically without a fake legacy event", async () => {
    const result = await correctWorkforceTimeDirectly({
      organizationId: ORGANIZATION_ID,
      userId: "manager-user-1",
      actor: { agentId: "manager-agent-1", role: "MANAGER", scopedAgentIds: [AGENT_ID] },
      workdayId: WORKDAY_ID,
      input,
      audit: { ipAddress: "203.0.113.7", userAgent: "Vitest" },
    })

    expect(result).toMatchObject({ kind: "success", idempotent: false })
    expect(prisma.workforceTimeCorrection.create).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true },
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        workdayId: WORKDAY_ID,
        agentId: AGENT_ID,
        source: "DIRECT_MANAGER",
        operationId: input.operationId,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        actorUserId: "manager-user-1",
        reason: input.reason,
      }),
    }))
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: {
        startedAt: new Date(input.startedAt),
        completedAt: new Date(input.completedAt),
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_TIME_CORRECTION_APPLIED",
        metadataKind: "workforce_time_correction",
        ipAddress: "203.0.113.7",
        userAgent: "Vitest",
      }),
    }))
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("rejects stale manager screens before a new ledger fact is appended", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst)
      .mockReset()
      .mockResolvedValueOnce({
        id: WORKDAY_ID,
        agentId: AGENT_ID,
        agent: { userId: "agent-user-1" },
      } as never)
      .mockResolvedValueOnce(completedWorkday({ updatedAt: new Date("2026-08-28T18:02:00.000Z") }) as never)

    const result = await correctWorkforceTimeDirectly({
      organizationId: ORGANIZATION_ID,
      userId: "manager-user-1",
      actor: { agentId: "manager-agent-1", role: "MANAGER", scopedAgentIds: [AGENT_ID] },
      workdayId: WORKDAY_ID,
      input,
    })

    expect(result).toMatchObject({ kind: "conflict", code: "WORKFORCE_TIME_CORRECTION_VERSION_CONFLICT" })
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  })

  it("does not let an employee use the manager correction writer for themselves", async () => {
    const result = await correctWorkforceTimeDirectly({
      organizationId: ORGANIZATION_ID,
      userId: "agent-user-1",
      actor: { agentId: AGENT_ID, role: "MANAGER", scopedAgentIds: [AGENT_ID] },
      workdayId: WORKDAY_ID,
      input,
    })

    expect(result).toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not let a web admin correct the workday linked to the same user", async () => {
    const result = await correctWorkforceTimeDirectly({
      organizationId: ORGANIZATION_ID,
      userId: "agent-user-1",
      // resolveWorkforceActor intentionally gives web admins no agentId, so
      // the service must independently compare the target employee's user.
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
      workdayId: WORKDAY_ID,
      input,
    })

    expect(result).toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
