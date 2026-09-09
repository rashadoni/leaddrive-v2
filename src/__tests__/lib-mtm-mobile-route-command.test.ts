import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMtmSettings: vi.fn(),
  resolveMtmRouteActor: vi.fn(),
  canCreateMtmRouteFor: vi.fn(),
  canEditMtmRouteDraft: vi.fn(),
  canPublishMtmRoute: vi.fn(),
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
