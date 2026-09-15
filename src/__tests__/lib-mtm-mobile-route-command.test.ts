import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMtmSettings: vi.fn(),
  resolveMtmRouteActor: vi.fn(),
  canCreateMtmRouteFor: vi.fn(),
  canEditMtmRouteDraft: vi.fn(),
  canPublishMtmRoute: vi.fn(),
  canSelfUpdatePublishedMtmRoute: vi.fn(),
  validateMtmRouteTargets: vi.fn(),
  validateMtmMobileRouteTargetEligibility: vi.fn(),
  acquireMtmRouteScheduleLocks: vi.fn(),
  buildMtmRouteDedupeKey: vi.fn(() => "route-dedupe"),
  detectMtmRouteInternalScheduleConflicts: vi.fn(() => []),
  detectMtmRoutePlanningSignals: vi.fn(() => ({ conflicts: [], coordination: [] })),
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: mocks.getMtmSettings }))
vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: mocks.resolveMtmRouteActor,
  canCreateMtmRouteFor: mocks.canCreateMtmRouteFor,
  canEditMtmRouteDraft: mocks.canEditMtmRouteDraft,
  canPublishMtmRoute: mocks.canPublishMtmRoute,
  canSelfUpdatePublishedMtmRoute: mocks.canSelfUpdatePublishedMtmRoute,
}))
vi.mock("@/lib/mtm/route-targets", () => ({
  mtmRouteTargetKey: (point: { customerId: string; contactId?: string | null }) => point.contactId
    ? `contact:${point.contactId}`
    : `customer:${point.customerId}`,
  validateMtmRouteTargets: mocks.validateMtmRouteTargets,
  validateMtmMobileRouteTargetEligibility: mocks.validateMtmMobileRouteTargetEligibility,
}))
vi.mock("@/lib/mtm/route-planning", () => ({
  acquireMtmRouteScheduleLocks: mocks.acquireMtmRouteScheduleLocks,
  buildMtmRouteDedupeKey: mocks.buildMtmRouteDedupeKey,
  detectMtmRouteInternalScheduleConflicts: mocks.detectMtmRouteInternalScheduleConflicts,
  detectMtmRoutePlanningSignals: mocks.detectMtmRoutePlanningSignals,
}))

import { prisma } from "@/lib/prisma"
import { executeMtmMobileRouteCommand } from "@/lib/mtm/mobile-route-command"
import { hashMtmMobileRouteCommand } from "@/lib/mtm/mobile-route-command-receipt"
import { MtmMobileRouteCommandSchema } from "@/lib/mtm-validators"

const now = new Date("2026-09-02T10:00:00.000Z")
const auth = { orgId: "org-1", agentId: "agent-1", userId: "user-1", role: "AGENT" }

function createCommand(points: Array<{ customerId: string; contactId?: string; plannedTime?: string | null }> = []) {
  return MtmMobileRouteCommandSchema.parse({
    operationId: "route-command-001",
    command: "CREATE_DRAFT",
    payload: { date: "2026-09-02", points },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMtmSettings.mockResolvedValue({
    timezone: "UTC",
    enforceWorkCalendarForRoutes: false,
    routeSelfPublish: true,
  })
  mocks.resolveMtmRouteActor.mockResolvedValue({
    agentId: "agent-1",
    role: "AGENT",
    canPlanOwnRoutes: true,
    canSelfPublishRoutes: true,
    scopedAgentIds: ["agent-1"],
  })
  mocks.canCreateMtmRouteFor.mockReturnValue(true)
  mocks.canEditMtmRouteDraft.mockReturnValue(true)
  mocks.canPublishMtmRoute.mockReturnValue(true)
  mocks.canSelfUpdatePublishedMtmRoute.mockReturnValue(true)
  mocks.detectMtmRouteInternalScheduleConflicts.mockReturnValue([])
  mocks.detectMtmRoutePlanningSignals.mockReturnValue({ conflicts: [], coordination: [] })
  mocks.validateMtmRouteTargets.mockResolvedValue({
    ok: true,
    missingCustomerIds: [],
    missingContactIds: [],
    invalidContactWorkplaces: [],
  })
  mocks.validateMtmMobileRouteTargetEligibility.mockResolvedValue({ ok: true })
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: null } as never)
  vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmMobileRouteCommandReceipt.create).mockResolvedValue({ id: "receipt-1" } as never)
  vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmRoute.create).mockResolvedValue({
    id: "route-1",
    status: "DRAFT",
    version: 1,
    publishedVersion: null,
    publishedAt: null,
  } as never)
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmRoutePoint.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ id: "workday-1" } as never)
})

describe("MTM mobile route-command state machine", () => {
  it("commits a new draft and its terminal receipt in one transaction", async () => {
    const result = await executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: createCommand([{ customerId: "customer-1" }]),
      now,
    })

    expect(result).toMatchObject({
      responseStatus: 201,
      replayed: false,
      result: { success: true, data: { id: "route-1", version: 1, status: "DRAFT" } },
    })
    expect(prisma.mtmRoute.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", agentId: "agent-1", status: "DRAFT" }),
    }))
    expect(prisma.mtmMobileRouteCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        deviceId: "rf-device-1",
        operationId: "route-command-001",
        command: "CREATE_DRAFT",
        targetRouteId: null,
        outcome: "APPLIED",
        responseStatus: 201,
        expiresAt: new Date("2026-12-01T10:00:00.000Z"),
      }),
    })
    expect(prisma.mtmRoute.create.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.mtmMobileRouteCommandReceipt.create.mock.invocationCallOrder[0]!)
    expect(mocks.acquireMtmRouteScheduleLocks).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      agentIds: ["agent-1"],
    })
  })

  it("replays an exact receipt without another route write", async () => {
    const command = createCommand()
    const requestHash = hashMtmMobileRouteCommand({
      command: "CREATE_DRAFT",
      targetRouteId: null,
      payload: command.payload,
    })
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue({
      organizationId: "org-1",
      agentId: "agent-1",
      deviceId: "rf-device-1",
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      targetRouteId: null,
      requestHash,
      responseStatus: 201,
      result: { success: true, data: { id: "route-1", status: "DRAFT", version: 1 } },
      expiresAt: new Date("2026-12-01T10:00:00.000Z"),
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command, now }))
      .resolves.toMatchObject({
        responseStatus: 201,
        replayed: true,
        result: { success: true, data: { id: "route-1" } },
      })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("fails closed when a reused operation ID changes device or payload", async () => {
    const original = createCommand()
    const requestHash = hashMtmMobileRouteCommand({
      command: "CREATE_DRAFT",
      targetRouteId: null,
      payload: original.payload,
    })
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue({
      organizationId: "org-1",
      agentId: "agent-1",
      deviceId: "rf-device-1",
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      targetRouteId: null,
      requestHash,
      responseStatus: 201,
      result: { success: true, data: { id: "route-1" } },
      expiresAt: new Date("2026-12-01T10:00:00.000Z"),
    } as never)

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-2",
      command: createCommand([{ customerId: "customer-2" }]),
      now,
    })).resolves.toMatchObject({
      responseStatus: 409,
      replayed: false,
      result: { code: "MOBILE_ROUTE_COMMAND_IDEMPOTENCY_MISMATCH" },
    })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("never pins a terminal receipt when the business transaction fails", async () => {
    vi.mocked(prisma.mtmRoute.create).mockRejectedValue(new Error("database unavailable"))

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: createCommand(),
      now,
    })).rejects.toThrow("database unavailable")

    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("writes publish notification outbox evidence before the same receipt", async () => {
    const publish = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-publish-001",
      command: "PUBLISH",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({ id: "route-1", date: new Date("2026-09-02T00:00:00.000Z"), agentId: "agent-1" } as never)
      .mockResolvedValueOnce({
        id: "route-1",
        agentId: "agent-1",
        date: new Date("2026-09-02T00:00:00.000Z"),
        status: "DRAFT",
        version: 4,
        publishedVersion: null,
        publishedAt: null,
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
        points: [{ customerId: "customer-1", contactId: null, plannedTime: null, deletedAt: null }],
      } as never)
    vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mockResolvedValue({ id: "outbox-1" } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: publish, now }))
      .resolves.toMatchObject({
        responseStatus: 200,
        result: { success: true, data: { id: "route-1", status: "PLANNED", version: 5 } },
      })

    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_dedupeKey: { organizationId: "org-1", dedupeKey: "route:route-1:published:5:agent-1" } },
    }))
    expect(prisma.mtmRouteNotificationOutbox.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.mtmMobileRouteCommandReceipt.create.mock.invocationCallOrder[0]!)
  })

  it("fails closed when the fresh agent or tenant self-publish grant is absent", async () => {
    const publish = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-publish-denied-001",
      command: "PUBLISH",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    mocks.canPublishMtmRoute.mockReturnValue(false)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({ id: "route-1", date: new Date("2026-09-02T00:00:00.000Z"), agentId: "agent-1" } as never)
      .mockResolvedValueOnce({
        id: "route-1",
        agentId: "agent-1",
        date: new Date("2026-09-02T00:00:00.000Z"),
        status: "DRAFT",
        version: 4,
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
        points: [{ customerId: "customer-1", contactId: null, plannedTime: null, deletedAt: null }],
      } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: publish, now }))
      .resolves.toMatchObject({
        responseStatus: 403,
        replayed: false,
        result: { success: false, code: "MTM_ROUTE_SCOPE_DENIED" },
      })

    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("starts only the current self-managed planned route and writes one durable receipt", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      assignments: [{ agentId: "agent-1" }],
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({
        responseStatus: 200,
        replayed: false,
        result: {
          success: true,
          data: {
            id: "route-1",
            status: "IN_PROGRESS",
            version: 5,
            publishedVersion: 4,
            startedAt: now.toISOString(),
          },
        },
      })

    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "route-1",
        organizationId: "org-1",
        status: "PLANNED",
        version: 4,
        deletedAt: null,
      }),
      data: { status: "IN_PROGRESS", startedAt: now, version: { increment: 1 } },
    })
    expect(prisma.mtmMobileRouteCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        command: "START",
        targetRouteId: "route-1",
        outcome: "APPLIED",
        responseStatus: 200,
      }),
    })
    expect(prisma.mtmRouteNotificationOutbox.upsert).not.toHaveBeenCalled()
  })

  it("starts a current CRM-assigned participant route after the participant starts their workday", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-assigned-participant-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-2",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      totalPoints: 1,
      assignments: [
        { agentId: "agent-2", role: "PRIMARY" },
        { agentId: "agent-1", role: "PARTICIPANT" },
      ],
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({
        responseStatus: 200,
        result: { success: true, data: { id: "route-1", status: "IN_PROGRESS", version: 5 } },
      })

    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", status: "STARTED" },
      select: { id: true },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "route-1",
        organizationId: "org-1",
        status: "PLANNED",
        version: 4,
      }),
      data: { status: "IN_PROGRESS", startedAt: now, version: { increment: 1 } },
    })
  })

  it("does not let an observer start an assigned route", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-observer-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-2",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      totalPoints: 1,
      assignments: [
        { agentId: "agent-2", role: "PRIMARY" },
        { agentId: "agent-1", role: "OBSERVER" },
      ],
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({
        responseStatus: 403,
        result: { success: false, code: "MTM_ROUTE_SCOPE_DENIED" },
      })

    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("refuses route start without an active workday without mutating the route", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-start-without-workday-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      assignments: [{ agentId: "agent-1" }],
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({
        responseStatus: 409,
        replayed: false,
        result: { success: false, code: "MTM_ROUTE_WORKDAY_REQUIRED" },
      })

    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", status: "STARTED" },
      select: { id: true },
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "CONFLICT", responseStatus: 409, command: "START" }),
    })
  })

  it("replays an exact START receipt without applying the route transition twice", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    const requestHash = hashMtmMobileRouteCommand({
      command: "START",
      targetRouteId: "route-1",
      payload: start.payload,
    })
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue({
      organizationId: "org-1",
      agentId: "agent-1",
      deviceId: "rf-device-1",
      operationId: "route-command-start-001",
      command: "START",
      targetRouteId: "route-1",
      requestHash,
      responseStatus: 200,
      result: { success: true, data: { id: "route-1", status: "IN_PROGRESS", version: 5 } },
      expiresAt: new Date("2026-12-01T10:00:00.000Z"),
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({ responseStatus: 200, replayed: true })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("refuses to start an empty legacy route", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-empty-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      totalPoints: 0,
      assignments: [{ agentId: "agent-1" }],
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_EMPTY" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("does not start a stale, future, or out-of-scope route", async () => {
    const start = MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    })
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-09-03T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      assignments: [{ agentId: "agent-1" }],
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: start, now }))
      .resolves.toMatchObject({
        responseStatus: 409,
        result: { code: "MOBILE_ROUTE_START_DATE_INVALID" },
      })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-2",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      assignments: [{ agentId: "agent-2" }],
    } as never)
    const otherOperation = MtmMobileRouteCommandSchema.parse({
      ...start,
      operationId: "route-command-start-002",
    })
    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: otherOperation, now }))
      .resolves.toMatchObject({ responseStatus: 403, result: { code: "MTM_ROUTE_SCOPE_DENIED" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-09-02T00:00:00.000Z"),
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      startedAt: null,
      assignments: [{ agentId: "agent-1" }],
    } as never)
    const staleOperation = MtmMobileRouteCommandSchema.parse({
      ...start,
      operationId: "route-command-start-003",
      payload: { expectedVersion: 3 },
    })
    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: staleOperation, now }))
      .resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_VERSION_CONFLICT" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })
})

describe("UPDATE_PUBLISHED: changing a published route from Route Field", () => {
  const routeDate = new Date("2026-09-02T00:00:00.000Z")

  function stop(
    id: string,
    customerId: string,
    orderIndex: number,
    extra: { status?: string; visits?: number; changeRequests?: number; plannedTime?: Date | null } = {},
  ) {
    return {
      id,
      customerId,
      contactId: null,
      orderIndex,
      plannedTime: extra.plannedTime ?? null,
      status: extra.status ?? "PENDING",
      _count: { visits: extra.visits ?? 0, changeRequests: extra.changeRequests ?? 0 },
    }
  }

  function givenRoute(status: string, points: ReturnType<typeof stop>[], version = 4) {
    // The diff reads points again after taking the point locks.
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue(points as never)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({ id: "route-1", date: routeDate, agentId: "agent-1" } as never)
      .mockResolvedValueOnce({
        id: "route-1",
        agentId: "agent-1",
        date: routeDate,
        status,
        version,
        publishedVersion: version,
        publishedAt: new Date("2026-09-01T18:00:00.000Z"),
        totalPoints: points.length,
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
        points,
      } as never)
  }

  function updatePublished(
    points: Array<{ customerId: string; plannedTime?: string | null }>,
    options: { expectedVersion?: number; operationId?: string } = {},
  ) {
    return MtmMobileRouteCommandSchema.parse({
      operationId: options.operationId ?? "route-command-update-published-001",
      command: "UPDATE_PUBLISHED",
      routeId: "route-1",
      payload: { expectedVersion: options.expectedVersion ?? 4, points },
    })
  }

  beforeEach(() => {
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mockResolvedValue({ id: "outbox-1" } as never)
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 1 } as never)
  })

  it("keeps surviving stop ids, soft-deletes removed stops, adds new ones and reorders on a PLANNED route", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1), stop("p3", "c3", 2)])

    const result = await executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([
        { customerId: "c3", plannedTime: "2026-09-02T09:00:00.000Z" },
        { customerId: "c4" },
        { customerId: "c1" },
      ]),
      now,
    })

    expect(result).toMatchObject({
      responseStatus: 200,
      replayed: false,
      result: {
        success: true,
        data: {
          id: "route-1",
          status: "PLANNED",
          version: 5,
          publishedVersion: 5,
          publishedAt: "2026-09-01T18:00:00.000Z",
          totalPoints: 3,
          keptPointIds: ["p3", "p1"],
          removedPointIds: ["p2"],
          addedPointCount: 1,
        },
      },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith({
      where: { id: "route-1", organizationId: "org-1", status: "PLANNED", version: 4, deletedAt: null },
      data: { dedupeKey: "route-dedupe", totalPoints: 3, version: { increment: 1 }, publishedVersion: 5 },
    })
    // Removal is a tombstone, never a physical delete, and never recreates kept rows.
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["p2"] }, status: "PENDING" }),
      data: { deletedAt: now, version: { increment: 1 } },
    }))
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p3" }),
      data: { orderIndex: 0, plannedTime: new Date("2026-09-02T09:00:00.000Z"), version: { increment: 1 } },
    }))
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p1" }),
      data: { orderIndex: 2, plannedTime: null, version: { increment: 1 } },
    }))
    expect(prisma.mtmRoutePoint.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "org-1", routeId: "route-1", customerId: "c4", contactId: null, orderIndex: 1, plannedTime: null }],
    })
    expect(prisma.mtmRoutePoint.deleteMany).not.toHaveBeenCalled()
    expect(mocks.validateMtmMobileRouteTargetEligibility).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      points: [{ customerId: "c4", contactId: null }],
    }))
    expect(mocks.detectMtmRoutePlanningSignals).toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_dedupeKey: { organizationId: "org-1", dedupeKey: "route:route-1:published:5:agent-1" } },
    }))
    expect(prisma.mtmMobileRouteCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        command: "UPDATE_PUBLISHED",
        targetRouteId: "route-1",
        outcome: "APPLIED",
        responseStatus: 200,
      }),
    })
    expect(prisma.mtmRouteNotificationOutbox.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.mtmMobileRouteCommandReceipt.create.mock.invocationCallOrder[0]!)
    expect(result.audit).toMatchObject({
      action: "ROUTE_UPDATE",
      routeId: "route-1",
      oldData: {
        status: "PLANNED",
        version: 4,
        stops: [
          { id: "p1", customerId: "c1" },
          { id: "p2", customerId: "c2" },
          { id: "p3", customerId: "c3" },
        ],
      },
      newData: {
        status: "PLANNED",
        version: 5,
        publishedVersion: 5,
        removedPointIds: ["p2"],
        command: "UPDATE_PUBLISHED",
        stops: [
          { customerId: "c3", plannedTime: "2026-09-02T09:00:00.000Z" },
          { customerId: "c4" },
          { customerId: "c1" },
        ],
      },
    })
  })

  it("refuses an agent without the self-publish grant with ROUTE_EDIT_FORBIDDEN and pins nothing", async () => {
    mocks.canSelfUpdatePublishedMtmRoute.mockReturnValue(false)
    givenRoute("PLANNED", [stop("p1", "c1", 0)])

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 403, result: { success: false, code: "ROUTE_EDIT_FORBIDDEN" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("refuses a route owned by another agent", async () => {
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({ id: "route-1", date: routeDate, agentId: "agent-2" } as never)
      .mockResolvedValueOnce({
        id: "route-1",
        agentId: "agent-2",
        date: routeDate,
        status: "PLANNED",
        version: 4,
        assignments: [{ agentId: "agent-2", role: "PRIMARY" }],
        points: [stop("p1", "c1", 0)],
      } as never)
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 403, result: { code: "MTM_ROUTE_SCOPE_DENIED" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("answers a stale version with ROUTE_VERSION_CONFLICT", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)], 6)

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }], { expectedVersion: 4 }),
      now,
    })).resolves.toMatchObject({
      responseStatus: 409,
      result: { code: "ROUTE_VERSION_CONFLICT", currentVersion: 6, status: "PLANNED" },
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
  })

  it("refuses finished routes and drafts with ROUTE_TRANSITION_INVALID", async () => {
    for (const [index, status] of ["COMPLETED", "CANCELLED", "INCOMPLETE", "DRAFT"].entries()) {
      givenRoute(status, [stop("p1", "c1", 0)])
      await expect(executeMtmMobileRouteCommand({
        auth,
        deviceId: "rf-device-1",
        command: updatePublished([{ customerId: "c1" }], { operationId: `route-command-finished-00${index}` }),
        now,
      })).resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_TRANSITION_INVALID", status } })
    }
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("locks visited stops of an IN_PROGRESS route against removal and reordering", async () => {
    const started = () => [
      stop("p1", "c1", 0, { status: "VISITED", visits: 1 }),
      stop("p2", "c2", 1, { status: "SKIPPED" }),
      stop("p3", "c3", 2),
    ]
    givenRoute("IN_PROGRESS", started())
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c2" }, { customerId: "c3" }], { operationId: "route-command-locked-001" }),
      now,
    })).resolves.toMatchObject({
      responseStatus: 409,
      result: { success: false, code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] },
    })

    givenRoute("IN_PROGRESS", started())
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished(
        [{ customerId: "c2" }, { customerId: "c1" }, { customerId: "c3" }],
        { operationId: "route-command-locked-002" },
      ),
      now,
    })).resolves.toMatchObject({
      responseStatus: 409,
      result: { code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1", "p2"] },
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "CONFLICT", responseStatus: 409, command: "UPDATE_PUBLISHED" }),
    })

    givenRoute("IN_PROGRESS", started())
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished(
        [{ customerId: "c1" }, { customerId: "c2" }, { customerId: "c9" }],
        { operationId: "route-command-locked-003" },
      ),
      now,
    })).resolves.toMatchObject({
      responseStatus: 200,
      result: { success: true, data: { status: "IN_PROGRESS", version: 5, removedPointIds: ["p3"], addedPointCount: 1 } },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "IN_PROGRESS", version: 4 }),
    }))
  })

  it("refuses to remove a stop with a pending route change request", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0, { changeRequests: 1 }), stop("p2", "c2", 1)])

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({
      responseStatus: 409,
      result: { code: "ROUTE_POINT_CHANGE_PENDING", pointIds: ["p1"] },
    })
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
  })

  it("refuses an empty stop list", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command: updatePublished([]), now }))
      .resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_EMPTY" } })
  })

  it("re-runs the publish planning checks against the edited stop list", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    mocks.detectMtmRoutePlanningSignals.mockReturnValue({ conflicts: [{ kind: "AGENT_BUSY" }], coordination: [] } as never)
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_CONFLICT" } })

    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    mocks.detectMtmRoutePlanningSignals.mockReturnValue({ conflicts: [], coordination: [] })
    mocks.detectMtmRouteInternalScheduleConflicts.mockReturnValue([{ plannedTime: "x" }] as never)
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c2" }], { operationId: "route-command-time-001" }),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_POINT_TIME_CONFLICT" } })

    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    mocks.detectMtmRouteInternalScheduleConflicts.mockReturnValue([])
    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }], { operationId: "route-command-horizon-001" }),
      now: new Date("2026-09-20T10:00:00.000Z"),
    })).resolves.toMatchObject({ responseStatus: 409, result: { code: "MOBILE_ROUTE_COMMAND_DATE_OUTSIDE_HORIZON" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("rolls back without a receipt when a stop was checked in between read and write", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1)])
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValueOnce({ count: 0 } as never)

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, replayed: false, result: { code: "ROUTE_VERSION_CONFLICT" } })
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).not.toHaveBeenCalled()
  })

  it("takes check-in's point locks in sorted order and re-reads points before touching the route row", async () => {
    givenRoute("PLANNED", [stop("p3", "c3", 0), stop("p1", "c1", 1), stop("p2", "c2", 2)])

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c3" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 200 })

    const executeCalls = vi.mocked(prisma.$executeRaw).mock.calls
    const pointLockIndexes = executeCalls
      .map((call, index) => ({ key: String(call[1]), index }))
      .filter((call) => call.key.startsWith("mtm-route-point-check-in:"))
    expect(pointLockIndexes.map((call) => call.key)).toEqual([
      "mtm-route-point-check-in:org-1:p1",
      "mtm-route-point-check-in:org-1:p2",
      "mtm-route-point-check-in:org-1:p3",
    ])
    const lastPointLock = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[pointLockIndexes.at(-1)!.index]!
    const rowLock = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]!
    const freshRead = vi.mocked(prisma.mtmRoutePoint.findMany).mock.invocationCallOrder[0]!
    const routeWrite = vi.mocked(prisma.mtmRoute.updateMany).mock.invocationCallOrder[0]!
    const firstPointWrite = vi.mocked(prisma.mtmRoutePoint.updateMany).mock.invocationCallOrder[0]!
    expect(lastPointLock).toBeLessThan(rowLock)
    expect(rowLock).toBeLessThan(freshRead)
    expect(freshRead).toBeLessThan(routeWrite)
    expect(routeWrite).toBeLessThan(firstPointWrite)
  })

  it("decides locks from the post-lock read: a check-in that committed while waiting blocks removal", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1)])
    // The route read saw no visit; the fresh read after the locks does.
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      stop("p1", "c1", 0, { visits: 1 }),
      stop("p2", "c2", 1),
    ] as never)

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
  })

  it("answers a version conflict when a stop appeared between the route read and the locks", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([stop("p1", "c1", 0), stop("p9", "c9", 1)] as never)

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, result: { code: "ROUTE_VERSION_CONFLICT" } })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("maps a Postgres deadlock to a retryable version conflict instead of 500", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.mtmRoute.updateMany).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("deadlock detected", { code: "P2034", clientVersion: "6" }),
    )

    await expect(executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c2" }]),
      now,
    })).resolves.toMatchObject({ responseStatus: 409, replayed: false, result: { code: "ROUTE_VERSION_CONFLICT" } })
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("maps a Prisma transaction timeout (P2028) to a retryable version conflict without a receipt", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Transaction already closed: timeout", { code: "P2028", clientVersion: "6" }),
    )

    const result = await executeMtmMobileRouteCommand({
      auth,
      deviceId: "rf-device-1",
      command: updatePublished([{ customerId: "c1" }, { customerId: "c2" }]),
      now,
    })

    expect(result).toMatchObject({ responseStatus: 409, replayed: false, result: { code: "ROUTE_VERSION_CONFLICT" } })
    expect(JSON.stringify(result.result)).not.toContain("Transaction already closed")
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("replays a receipt without a second write or a second notification", async () => {
    const command = updatePublished([{ customerId: "c1" }])
    vi.mocked(prisma.mtmMobileRouteCommandReceipt.findUnique).mockResolvedValue({
      organizationId: "org-1",
      agentId: "agent-1",
      deviceId: "rf-device-1",
      operationId: command.operationId,
      command: "UPDATE_PUBLISHED",
      targetRouteId: "route-1",
      requestHash: hashMtmMobileRouteCommand({ command: "UPDATE_PUBLISHED", targetRouteId: "route-1", payload: command.payload }),
      responseStatus: 200,
      result: { success: true, data: { id: "route-1", status: "PLANNED", version: 5, publishedVersion: 5 } },
      expiresAt: new Date("2026-12-01T10:00:00.000Z"),
    } as never)

    await expect(executeMtmMobileRouteCommand({ auth, deviceId: "rf-device-1", command, now }))
      .resolves.toMatchObject({
        responseStatus: 200,
        replayed: true,
        result: { success: true, data: { version: 5, publishedVersion: 5 } },
      })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).not.toHaveBeenCalled()
    expect(prisma.mtmMobileRouteCommandReceipt.create).not.toHaveBeenCalled()
  })

  it("accepts exactly the UPDATE_DRAFT point shape and nothing more", () => {
    expect(() => MtmMobileRouteCommandSchema.parse({
      operationId: "route-command-shape-001",
      command: "UPDATE_PUBLISHED",
      routeId: "route-1",
      payload: {
        expectedVersion: 4,
        points: [{ customerId: "c1", contactId: "d1", plannedTime: "2026-09-02T09:00:00.000Z" }],
      },
    })).not.toThrow()
    expect(MtmMobileRouteCommandSchema.safeParse({
      operationId: "route-command-shape-002",
      command: "UPDATE_PUBLISHED",
      routeId: "route-1",
      payload: { expectedVersion: 4, points: [{ customerId: "c1", id: "p1" }] },
    }).success).toBe(false)
    expect(MtmMobileRouteCommandSchema.safeParse({
      operationId: "route-command-shape-003",
      command: "UPDATE_PUBLISHED",
      routeId: "route-1",
      payload: { expectedVersion: 4, points: [{ customerId: "c1" }, { customerId: "c1" }] },
    }).success).toBe(false)
  })
})

