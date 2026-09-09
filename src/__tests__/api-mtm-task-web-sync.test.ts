import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: unknown, _action: unknown, handler: (...args: any[]) => unknown) =>
    (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-1",
      userId: "web-agent-user",
      role: "member",
      email: "agent@example.com",
      name: "Agent",
    }, ctx),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn().mockResolvedValue({ timezone: "Asia/Baku" }),
}))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/mtm/task-recurrence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/task-recurrence")>()
  return { ...actual, spawnNextMtmTaskRecurrenceInTransaction: vi.fn().mockResolvedValue({ status: "ended", occurrence: null }) }
})
vi.mock("@/lib/mtm/visit-requirements", () => ({
  completeMtmVisit: vi.fn(),
  createVisitRequirementSnapshot: vi.fn(),
  lockMtmActiveVisitSlot: vi.fn(),
}))

import { POST } from "@/app/api/v1/mtm/sync/push/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { spawnNextMtmTaskRecurrenceInTransaction } from "@/lib/mtm/task-recurrence"

const operationId = "123e4567-e89b-42d3-a456-426614174000"
const req = (data: Record<string, unknown>) => new NextRequest("http://localhost/api/v1/mtm/sync/push", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ operations: [{ operationId, entity: "tasks", op: "update", data }] }),
})

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    agentId: "agent-1",
    customerId: null,
    visitId: null,
    title: "Call doctor",
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    scheduledStartAt: null,
    dueDate: new Date("2026-08-10T09:00:00.000Z"),
    result: null,
    progress: null,
    version: 2,
    acceptedAt: null,
    startedAt: null,
    completedAt: null,
    recurrenceRule: "DAILY",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceTimezone: "Asia/Baku",
    recurrenceAnchorScheduledStartAt: null,
    recurrenceAnchorDueDate: new Date("2026-08-10T09:00:00.000Z"),
    recurrenceParentId: null,
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmSyncOperation.create).mockResolvedValue({ id: "sync-1" } as never)
  vi.mocked(prisma.mtmTaskEvent.create).mockResolvedValue({ id: "event-1" } as never)
})

describe("web offline task execution sync", () => {
  it("CAS-completes own task, pins result, records event, and spawns recurrence", async () => {
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task() as never)
      .mockResolvedValueOnce(task({ status: "COMPLETED", progress: 100, result: "done", version: 3 }) as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await POST(req({ id: "task-1", expectedVersion: 2, status: "COMPLETED", progress: 50, result: "done" }))
    const body = await response.json()

    expect(body.data.results[0]).toMatchObject({ status: "ok", result: { status: "updated" } })
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      agentId: "agent-1",
      status: "PENDING",
      version: 2,
    })
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data).toMatchObject({ progress: 100 })
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.mtmTask.updateMany).mock.invocationCallOrder[0],
    )
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "COMPLETED", clientEventId: operationId }),
    }))
    expect(spawnNextMtmTaskRecurrenceInTransaction).toHaveBeenCalledTimes(1)
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "tasks", opType: "update", status: "ok" }),
    }))
  })

  it("returns a stable conflict when the task is outside the authenticated employee scope", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    const response = await POST(req({ id: "task-outside", expectedVersion: 1, status: "IN_PROGRESS" }))
    expect((await response.json()).data.results[0]).toMatchObject({
      status: "conflict",
      result: { status: "task_not_found", code: "MTM_TASK_NOT_FOUND" },
    })
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("rejects stale expectedVersion before mutation", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ version: 4 }) as never)
    const response = await POST(req({ id: "task-1", expectedVersion: 2, progress: 50 }))
    expect((await response.json()).data.results[0]).toMatchObject({
      status: "conflict",
      result: { status: "version_conflict", code: "MTM_TASK_VERSION_CONFLICT" },
    })
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("replays a stored operation without applying task mutation again", async () => {
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{
      operationId,
      status: "ok",
      result: { status: "updated", task: { id: "task-1", version: 3 } },
    }] as never)
    const response = await POST(req({ id: "task-1", expectedVersion: 2, progress: 50 }))
    expect((await response.json()).data.results[0]).toMatchObject({ status: "ok", replayed: true })
    expect(prisma.mtmTask.findFirst).not.toHaveBeenCalled()
  })
})
