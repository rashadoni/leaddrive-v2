import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authState = vi.hoisted(() => ({ principal: "web" as "web" | "mobile" }))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: any[]) => unknown) =>
    (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-1",
      userId: authState.principal === "mobile" ? "mobile-user" : "web-user",
      role: authState.principal === "mobile" ? "AGENT" : "member",
      email: "actor@example.com",
      name: "Actor",
      agentId: authState.principal === "mobile" ? "agent-1" : null,
      principal: authState.principal,
    }, ctx),
  withRouteFieldRlsAuth: (_action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-1",
      userId: authState.principal === "mobile" ? "mobile-user" : "web-user",
      role: authState.principal === "mobile" ? "AGENT" : "member",
      email: "actor@example.com",
      name: "Actor",
      agentId: authState.principal === "mobile" ? "agent-1" : null,
      principal: authState.principal,
    }, ctx),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn().mockResolvedValue({
    timezone: "Asia/Baku",
    taskSelfCreate: true,
    taskSelfRecurring: true,
  }),
}))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/mtm/task-recurrence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/task-recurrence")>()
  return { ...actual, spawnNextMtmTaskRecurrenceInTransaction: vi.fn().mockResolvedValue({ status: "ended", occurrence: null }) }
})
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { GET as listTasks, POST as createTask } from "@/app/api/v1/mtm/tasks/route"
import { GET as getTask, PUT as updateTask, DELETE as deleteTask } from "@/app/api/v1/mtm/tasks/[id]/route"
import { POST as reviewTask } from "@/app/api/v1/mtm/tasks/[id]/review/route"
import { POST as duplicateTask } from "@/app/api/v1/mtm/tasks/[id]/duplicate/route"
import { POST as commentTask } from "@/app/api/v1/mtm/tasks/[id]/events/route"
import { POST as uploadTaskDocument } from "@/app/api/v1/mtm/tasks/[id]/documents/route"
import { POST as bulkReassign } from "@/app/api/v1/mtm/tasks/bulk-reassign/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { spawnNextMtmTaskRecurrenceInTransaction } from "@/lib/mtm/task-recurrence"
import { getMtmSettings } from "@/lib/mtm-settings"

const manager = { agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["agent-1"] } as const
const agent = { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] } as const
const params = (id = "task-1") => ({ params: Promise.resolve({ id }) })
const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
})

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    agentId: "agent-1",
    customerId: null,
    visitId: null,
    sourceKey: null,
    title: "Call doctor",
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    scheduledStartAt: null,
    dueDate: new Date("2026-08-10T12:00:00.000Z"),
    completedAt: null,
    result: null,
    progress: null,
    returnReason: null,
    version: 3,
    acceptedAt: null,
    startedAt: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceUntil: null,
    recurrenceTimezone: null,
    recurrenceAnchorScheduledStartAt: null,
    recurrenceAnchorDueDate: null,
    recurrenceCursorScheduledStartAt: null,
    recurrenceCursorDueDate: null,
    recurrenceParentId: null,
    copiedFromId: null,
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.principal = "web"
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(manager as never)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmTask.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmTaskEvent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmDocument.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
})

describe("SWM-14 task scope and dual-principal containment", () => {
  it.each([
    ["due_desc", [
      { dueDate: { sort: "desc", nulls: "last" } },
      { priority: "desc" },
      { title: "asc" },
      { id: "asc" },
    ]],
    ["due_asc", [
      { dueDate: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
      { title: "asc" },
      { id: "asc" },
    ]],
    ["priority", [
      { priority: "desc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { title: "asc" },
      { id: "asc" },
    ]],
    ["title", [
      { title: "asc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]],
  ])("applies the validated %s server sort with stable tie-breakers", async (sort, expectedOrderBy) => {
    const response = await listTasks(request(`/api/v1/mtm/tasks?sort=${sort}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.sort).toBe(sort)
    expect(vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0].orderBy).toEqual(expectedOrderBy)
  })

  it("rejects an unknown task sort before querying task data", async () => {
    const response = await listTasks(request("/api/v1/mtm/tasks?sort=created_desc"))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("MTM_TASK_SORT_INVALID")
    expect(prisma.mtmTask.findMany).not.toHaveBeenCalled()
  })

  it("keeps an out-of-scope requested employee constrained by server scope", async () => {
    await listTasks(request("/api/v1/mtm/tasks?agentId=agent-2"))

    const where = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0].where as any
    expect(where.AND).toEqual([
      { agentId: { in: ["agent-1"] } },
      { agentId: "agent-2" },
    ])
  })

  it("exposes truthful self-create and self-recurrence capabilities", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)
    vi.mocked(getMtmSettings).mockResolvedValueOnce({
      timezone: "Asia/Baku",
      taskSelfCreate: false,
      taskSelfRecurring: false,
    } as never)

    const response = await listTasks(request("/api/v1/mtm/tasks"))
    const body = await response.json()

    expect(body.data.capabilities).toMatchObject({ canCreate: false, canCreateRecurring: false })
  })

  it("hydrates team names for assignee filters used by create and edit forms", async () => {
    await listTasks(request("/api/v1/mtm/tasks"))

    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        name: true,
        teamId: true,
        team: { select: { id: true, name: true } },
      }),
    }))
  })

  it("rejects orphan recurrence settings on a one-off create", async () => {
    const response = await createTask(request("/api/v1/mtm/tasks", "POST", {
      agentId: "agent-1",
      title: "one-off",
      recurrenceUntil: "2026-08-20T12:00:00.000Z",
    }))

    expect(response.status).toBe(400)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("ignores a legacy Android requested agent and pins the authenticated employee", async () => {
    authState.principal = "mobile"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)

    await listTasks(request("/api/v1/mtm/tasks?agentId=agent-2"))

    const where = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0].where as any
    expect(where.AND).toContainEqual({ agentId: "agent-1" })
  })

  it("denies legacy Android create and delete", async () => {
    authState.principal = "mobile"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)

    const create = await createTask(request("/api/v1/mtm/tasks", "POST", { agentId: "agent-1", title: "x" }))
    const remove = await deleteTask(request("/api/v1/mtm/tasks/task-1?expectedVersion=3", "DELETE"), params())

    expect(create.status).toBe(403)
    expect(remove.status).toBe(403)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("denies legacy Android execution to a manager even on their own assigned task", async () => {
    authState.principal = "mobile"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1"],
    } as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ agentId: "manager-1" }) as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      status: "IN_PROGRESS",
    }), params())

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe("MTM_TASK_MOBILE_METHOD_DENIED")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("returns privacy-preserving 404 for an out-of-scope detail", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    const response = await getTask(request("/api/v1/mtm/tasks/task-2"), params("task-2"))
    expect(response.status).toBe(404)
    expect(vi.mocked(prisma.mtmTask.findFirst).mock.calls[0][0].where).toMatchObject({
      id: "task-2",
      organizationId: "org-1",
      agentId: { in: ["agent-1"] },
    })
  })
})

describe("SWM-14 optimistic execution and immutability", () => {
  it("previews a monthly legacy series from its immutable cursor after a THIS-only exception", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: new Date("2026-02-05T09:00:00.000Z"),
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceTimezone: "UTC",
      recurrenceAnchorDueDate: null,
      recurrenceCursorDueDate: new Date("2026-01-31T09:00:00.000Z"),
    }) as never)

    const response = await getTask(request("/api/v1/mtm/tasks/task-1"), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.task.dueDate).toBe("2026-02-05T09:00:00.000Z")
    expect(body.data.recurrencePreview.occurrences[0].dueDate).toBe("2026-02-28T09:00:00.000Z")
  })

  it("rejects a stale web mutation without writing", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ version: 4 }) as never)
    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", { title: "changed", expectedVersion: 3 }), params())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_VERSION_CONFLICT")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("rehydrates a lost update conflict only through the manager's current scope", async () => {
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task() as never)
      .mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      title: "raced edit",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(409)
    expect(vi.mocked(prisma.mtmTask.findFirst).mock.calls[1][0].where).toMatchObject({
      id: "task-1",
      organizationId: "org-1",
      agentId: { in: ["agent-1"] },
    })
  })

  it("keeps completed core immutable", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ status: "COMPLETED", completedAt: new Date(), version: 4 }) as never)
    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", { title: "changed", expectedVersion: 4 }), params())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_IMMUTABLE")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("CAS-completes an own task and spawns recurrence in the same transaction", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ recurrenceRule: "DAILY", recurrenceInterval: 1, recurrenceTimezone: "Asia/Baku" }) as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", { status: "COMPLETED", progress: 50, result: "done", expectedVersion: 3 }), params())

    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      agentId: "agent-1",
      status: "PENDING",
      version: 3,
    })
    expect(spawnNextMtmTaskRecurrenceInTransaction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data).toMatchObject({ progress: 100 })
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.mtmTask.updateMany).mock.invocationCallOrder[0],
    )
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "COMPLETED" }),
    }))
  })

  it("recalculates monthly future instances sequentially and propagates the series anchor", async () => {
    const originalJanuary = new Date("2026-01-30T09:00:00.000Z")
    const january = new Date("2026-01-31T09:00:00.000Z")
    const february = new Date("2026-02-28T09:00:00.000Z")
    const march = new Date("2026-03-31T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: originalJanuary,
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceTimezone: "UTC",
    }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", status: "PENDING", version: 3, scheduledStartAt: null, dueDate: originalJanuary, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
      { id: "task-feb", agentId: "agent-1", status: "PENDING", version: 1, scheduledStartAt: null, dueDate: february, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
      { id: "task-mar", agentId: "agent-1", status: "PENDING", version: 1, scheduledStartAt: null, dueDate: march, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
    ] as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      dueDate: january.toISOString(),
      recurrenceInterval: 1,
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(200)
    const rowLockSql = vi.mocked(prisma.$queryRaw).mock.calls
      .map(([template]) => Array.isArray(template) ? template.join("?") : "")
      .find((sql) => sql.includes("FOR UPDATE"))
    expect(rowLockSql).toContain('ORDER BY "id" ASC')
    expect(vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0].where).toMatchObject({
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    })
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls.map(([call]) => call.data)).toEqual([
      expect.objectContaining({ recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: january }),
      expect.objectContaining({ dueDate: february, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: january }),
      expect.objectContaining({ dueDate: march, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: january }),
    ])
  })

  it("keeps a THIS reschedule as an exception without advancing or invalidating the series cursor", async () => {
    const occurrenceDue = new Date("2026-08-01T09:00:00.000Z")
    const exceptionDue = new Date("2026-08-05T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: occurrenceDue,
      recurrenceRule: "DAILY",
      recurrenceInterval: 1,
      recurrenceUntil: new Date("2026-08-03T23:59:59.000Z"),
      recurrenceTimezone: "UTC",
      // A legacy row exercises lazy cursor normalization too.
      recurrenceCursorDueDate: null,
    }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      dueDate: exceptionDue.toISOString(),
      editScope: "THIS",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dueDate: exceptionDue,
        recurrenceCursorDueDate: occurrenceDue,
      }),
    }))
    expect(spawnNextMtmTaskRecurrenceInTransaction).not.toHaveBeenCalled()
  })

  it("uses a legacy root cursor as the anchor when a title edit submits an unchanged full tuple", async () => {
    const january = new Date("2026-01-31T09:00:00.000Z")
    const february = new Date("2026-02-28T09:00:00.000Z")
    const march = new Date("2026-03-31T09:00:00.000Z")
    const rootException = new Date("2026-02-05T09:00:00.000Z")
    const current = task({
      id: "task-feb",
      dueDate: february,
      recurrenceRule: "MONTHLY",
      recurrenceInterval: null,
      recurrenceTimezone: null,
      recurrenceAnchorDueDate: null,
      recurrenceCursorDueDate: february,
      recurrenceParentId: "task-root",
    })
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce({
        id: "task-root",
        scheduledStartAt: null,
        dueDate: rootException,
        recurrenceAnchorScheduledStartAt: null,
        recurrenceAnchorDueDate: null,
        recurrenceCursorScheduledStartAt: null,
        recurrenceCursorDueDate: january,
      } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(getMtmSettings).mockResolvedValueOnce({
      timezone: "UTC",
      taskSelfCreate: true,
      taskSelfRecurring: true,
    } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-feb", agentId: "agent-1", status: "PENDING", version: 3, scheduledStartAt: null, dueDate: february, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null, recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: february },
      { id: "task-mar", agentId: "agent-1", status: "PENDING", version: 1, scheduledStartAt: null, dueDate: march, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null, recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: march },
    ] as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-feb", "PUT", {
      title: "Changed title",
      agentId: "agent-1",
      customerId: null,
      visitId: null,
      scheduledStartAt: null,
      dueDate: february.toISOString(),
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceUntil: null,
      recurrenceTimezone: "UTC",
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params("task-feb"))

    expect(response.status).toBe(200)
    const futureData = vi.mocked(prisma.mtmTask.updateMany).mock.calls[1][0].data
    expect(futureData).toMatchObject({
      title: "Changed title",
      recurrenceAnchorScheduledStartAt: null,
      recurrenceAnchorDueDate: january,
    })
    expect(futureData).not.toHaveProperty("scheduledStartAt")
    expect(futureData).not.toHaveProperty("dueDate")
    expect(futureData).not.toHaveProperty("recurrenceRule")
    expect(futureData).not.toHaveProperty("visitId")
  })

  it("selects THIS_AND_FUTURE by immutable occurrence cursors even when visible exceptions moved earlier", async () => {
    const cursor = new Date("2026-08-01T09:00:00.000Z")
    const nextCursor = new Date("2026-08-02T09:00:00.000Z")
    const current = task({
      id: "task-current",
      dueDate: new Date("2026-07-25T09:00:00.000Z"),
      recurrenceRule: "DAILY",
      recurrenceInterval: 1,
      recurrenceTimezone: "UTC",
      recurrenceAnchorDueDate: cursor,
      recurrenceCursorDueDate: cursor,
      recurrenceParentId: "task-root",
    })
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce({
        id: "task-root",
        scheduledStartAt: null,
        dueDate: cursor,
        recurrenceAnchorScheduledStartAt: null,
        recurrenceAnchorDueDate: cursor,
        recurrenceCursorScheduledStartAt: null,
        recurrenceCursorDueDate: cursor,
      } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      {
        id: "task-current", agentId: "agent-1", status: "PENDING", version: 3,
        scheduledStartAt: null, dueDate: new Date("2026-07-25T09:00:00.000Z"),
        recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: cursor,
        recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: cursor,
      },
      {
        id: "task-next", agentId: "agent-1", status: "PENDING", version: 1,
        scheduledStartAt: null, dueDate: new Date("2026-07-20T09:00:00.000Z"),
        recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: cursor,
        recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: nextCursor,
      },
    ] as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-current", "PUT", {
      title: "Updated series",
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params("task-current"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.changedIds).toEqual(["task-current", "task-next"])
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data).toMatchObject({
      recurrenceCursorDueDate: cursor,
    })
  })

  it("fails closed before writes when an until-only edit would strand a future occurrence", async () => {
    const january = new Date("2026-01-31T09:00:00.000Z")
    const february = new Date("2026-02-28T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: january,
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceTimezone: "UTC",
    }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", status: "PENDING", version: 3, scheduledStartAt: null, dueDate: january, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
      { id: "task-feb", agentId: "agent-1", status: "PENDING", version: 1, scheduledStartAt: null, dueDate: february, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
    ] as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      recurrenceUntil: "2026-02-15T23:59:59.000Z",
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("MTM_TASK_RECURRENCE_RANGE_CONFLICT")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("fails closed when THIS_AND_FUTURE would only mutate the visible part of a split-scope series", async () => {
    const currentDue = new Date("2026-08-01T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: currentDue,
      recurrenceRule: "DAILY",
      recurrenceInterval: 1,
      recurrenceTimezone: "UTC",
      recurrenceCursorDueDate: currentDue,
    }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      {
        id: "task-1", agentId: "agent-1", status: "PENDING", version: 3,
        scheduledStartAt: null, dueDate: currentDue,
        recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: currentDue,
        recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: currentDue,
      },
      {
        id: "task-hidden", agentId: "agent-2", status: "PENDING", version: 1,
        scheduledStartAt: null, dueDate: new Date("2026-08-02T09:00:00.000Z"),
        recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: currentDue,
        recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: new Date("2026-08-02T09:00:00.000Z"),
      },
    ] as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      title: "Series title",
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_RECURRENCE_SCOPE_CONFLICT")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("clears the complete recurrence tuple on every open future instance", async () => {
    const january = new Date("2026-01-31T09:00:00.000Z")
    const february = new Date("2026-02-28T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({
      dueDate: january,
      recurrenceRule: "MONTHLY",
      recurrenceInterval: 1,
      recurrenceUntil: new Date("2026-12-31T00:00:00.000Z"),
      recurrenceTimezone: "UTC",
    }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", status: "PENDING", version: 3, scheduledStartAt: null, dueDate: january, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
      // A prior THIS exception must not retain or receive orphan settings.
      { id: "task-feb", agentId: "agent-1", status: "PENDING", version: 1, scheduledStartAt: null, dueDate: february, recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null },
    ] as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateTask(request("/api/v1/mtm/tasks/task-1", "PUT", {
      recurrenceRule: null,
      editScope: "THIS_AND_FUTURE",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(200)
    for (const [call] of vi.mocked(prisma.mtmTask.updateMany).mock.calls) {
      expect(call.data).toMatchObject({
        recurrenceRule: null,
        recurrenceInterval: null,
        recurrenceUntil: null,
        recurrenceTimezone: null,
        recurrenceAnchorScheduledStartAt: null,
        recurrenceAnchorDueDate: null,
      })
    }
  })
})

describe("SWM-14 review, duplicate, evidence, and bulk contracts", () => {
  it("hydrates a factual document timeline and keeps review state independent of the 200-event window", async () => {
    const completedAt = new Date("2026-08-01T09:00:00.000Z")
    const documentEvent = {
      id: "event-doc",
      organizationId: "org-1",
      taskId: "task-1",
      agentId: "agent-1",
      type: "EVIDENCE_ADDED",
      occurredAt: new Date("2026-08-01T10:00:00.000Z"),
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      comment: null,
      evidence: { kind: "MTM_TASK_DOCUMENT", documentId: "doc-1", fileName: "spoofed.txt", actorAgentId: "agent-1" },
      agent: { id: "agent-1", name: "Agent" },
    }
    const reviewEvent = {
      ...documentEvent,
      id: "event-review",
      type: "EDITED",
      evidence: {
        kind: "MTM_TASK_REVIEW",
        action: "ACCEPT",
        completionCycle: completedAt.toISOString(),
        actorAgentId: null,
        actorRole: "ADMIN",
        actorName: "Admin User",
      },
    }
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(task({ status: "COMPLETED", completedAt }) as never)
    vi.mocked(prisma.mtmTaskEvent.findMany).mockResolvedValue([documentEvent] as never)
    vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue(reviewEvent as never)
    vi.mocked(prisma.mtmDocument.findMany).mockResolvedValue([{
      id: "doc-1",
      clientDocumentId: "document-123",
      title: "proof",
      fileName: "proof.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      checksumSha256: "hash",
      uploadedByAgentId: "agent-1",
      createdAt: new Date(),
    }] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent", role: "AGENT" },
      { id: "manager-1", name: "Manager", role: "MANAGER" },
    ] as never)

    const response = await getTask(request("/api/v1/mtm/tasks/task-1"), params())
    const body = await response.json()

    expect(body.data.timeline[0].document).toEqual({
      id: "doc-1",
      fileName: "proof.txt",
      downloadUrl: "/api/v1/mtm/tasks/task-1/documents/doc-1/download",
    })
    expect(body.data.reviewState.status).toBe("ACCEPTED")
    expect(body.data.reviewState.actor).toMatchObject({ id: null, name: "Admin User", role: "ADMIN" })
    expect(body.data.capabilities.canReview).toBe(false)
  })

  it("allows ACCEPT for a new completion cycle after an earlier RETURN", async () => {
    const firstCycle = new Date("2026-08-01T09:00:00.000Z")
    const secondCycle = new Date("2026-08-02T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task({ status: "COMPLETED", completedAt: firstCycle, version: 3 }) as never)
      .mockResolvedValueOnce(task({ status: "COMPLETED", completedAt: secondCycle, version: 5 }) as never)
    vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue(null as never)

    const returned = await reviewTask(request("/api/v1/mtm/tasks/task-1/review", "POST", { action: "RETURN", reason: "redo", expectedVersion: 3 }), params())
    const accepted = await reviewTask(request("/api/v1/mtm/tasks/task-1/review", "POST", { action: "ACCEPT", comment: "ok", expectedVersion: 5 }), params())

    expect(returned.status).toBe(200)
    expect(accepted.status).toBe(200)
    expect(vi.mocked(prisma.mtmTaskEvent.findFirst).mock.calls[1][0].where).toMatchObject({
      AND: expect.arrayContaining([{ evidence: { path: ["completionCycle"], equals: secondCycle.toISOString() } }]),
    })
  })

  it("rehydrates a raced review conflict only through current manager scope", async () => {
    const completedAt = new Date("2026-08-01T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task({ status: "COMPLETED", completedAt }) as never)
      .mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await reviewTask(request("/api/v1/mtm/tasks/task-1/review", "POST", {
      action: "ACCEPT",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(409)
    expect(vi.mocked(prisma.mtmTask.findFirst).mock.calls[1][0].where).toMatchObject({
      id: "task-1",
      organizationId: "org-1",
      agentId: { in: ["agent-1"] },
    })
  })

  it("replays an exact duplicate and rejects changed facts or a tombstone", async () => {
    const source = task()
    const duplicate = {
      id: "copy-1",
      agentId: "agent-1",
      copiedFromId: "task-1",
      dueDate: new Date("2026-08-20T12:00:00.000Z"),
      scheduledStartAt: null,
      deletedAt: null,
      title: "Call doctor",
      status: "PENDING",
      priority: "MEDIUM",
      version: 1,
    }
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValueOnce(source as never).mockResolvedValueOnce(duplicate as never)
    const exact = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-key-1", // gitleaks:allow -- synthetic test/public display literal
      expectedVersion: 3,
    }), params())
    expect(exact.status).toBe(200)
    expect((await exact.json()).data.idempotent).toBe(true)

    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValueOnce(source as never).mockResolvedValueOnce({ ...duplicate, dueDate: new Date("2026-08-21T12:00:00.000Z") } as never)
    const mismatch = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-key-1", // gitleaks:allow -- synthetic test/public display literal
      expectedVersion: 3,
    }), params())
    expect(mismatch.status).toBe(409)

    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValueOnce(source as never).mockResolvedValueOnce({ ...duplicate, deletedAt: new Date() } as never)
    const tombstone = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-key-1", // gitleaks:allow -- synthetic test/public display literal
      expectedVersion: 3,
    }), params())
    expect(tombstone.status).toBe(409)
  })

  it("does not disclose an idempotent duplicate that was reassigned outside manager scope", async () => {
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task() as never)
      .mockResolvedValueOnce({
        id: "copy-hidden",
        agentId: "agent-2",
        copiedFromId: "task-1",
        dueDate: new Date("2026-08-20T12:00:00.000Z"),
        scheduledStartAt: null,
        deletedAt: null,
        title: "Call doctor",
        status: "PENDING",
        priority: "MEDIUM",
        version: 4,
      } as never)

    const response = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-hidden-key",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(404)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("row-fences the exact source version before creating a duplicate", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValueOnce(task() as never).mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({ id: "copy-new", agentId: "agent-1", version: 1 } as never)

    const response = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-key-new",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(201)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task-1", organizationId: "org-1", version: 3 }),
      data: { version: { increment: 0 } },
    }))
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.mtmTask.create).mock.invocationCallOrder[0],
    )
  })

  it("rehydrates a duplicate CAS conflict without crossing manager scope", async () => {
    vi.mocked(prisma.mtmTask.findFirst)
      .mockResolvedValueOnce(task() as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await duplicateTask(request("/api/v1/mtm/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-20T12:00:00.000Z",
      idempotencyKey: "duplicate-race-key",
      expectedVersion: 3,
    }), params())

    expect(response.status).toBe(409)
    expect(vi.mocked(prisma.mtmTask.findFirst).mock.calls[2][0].where).toMatchObject({
      id: "task-1",
      organizationId: "org-1",
      agentId: { in: ["agent-1"] },
    })
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("replays a manager comment after reassignment without creating a duplicate", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-1", status: "PENDING" } as never)
    vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue({
      id: "comment-1",
      taskId: "task-1",
      type: "COMMENTED",
      occurredAt: new Date(),
      comment: "same comment",
      evidence: { kind: "MTM_TASK_COMMENT", actorAgentId: "manager-1", actorRole: "MANAGER" },
    } as never)

    const response = await commentTask(request("/api/v1/mtm/tasks/task-1/events", "POST", {
      clientEventId: "comment-retry-1",
      comment: "same comment",
    }), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmTaskEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", clientEventId: "comment-retry-1" },
    }))
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("does not append a comment after the task ownership/version fence is lost", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", agentId: "agent-1", status: "PENDING", version: 3,
    } as never)
    vi.mocked(prisma.mtmTaskEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await commentTask(request("/api/v1/mtm/tasks/task-1/events", "POST", {
      clientEventId: "comment-race-1",
      comment: "do not leak across reassignment",
    }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_SCOPE_CHANGED")
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("accepts late append-only evidence after completion and writes EVIDENCE_ADDED", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-1", status: "COMPLETED", version: 4 } as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmDocument.create).mockResolvedValue({
      id: "doc-1",
      clientDocumentId: "document-123",
      title: "proof",
      fileName: "proof.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      checksumSha256: "hash",
      uploadedByAgentId: "agent-1",
      uploadedByUserId: null,
      taskId: "task-1",
      storageKey: "a".repeat(48),
      createdAt: new Date(),
      deletedAt: null,
    } as never)
    const form = new FormData()
    form.append("file", new File(["proof"], "proof.txt", { type: "text/plain" }))
    form.append("clientDocumentId", "document-123")
    form.append("title", "proof")
    const response = await uploadTaskDocument(new NextRequest("http://localhost/api/v1/mtm/tasks/task-1/documents", { method: "POST", body: form }), params())

    expect(response.status).toBe(201)
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "EVIDENCE_ADDED", taskId: "task-1" }),
    }))
  })

  it("rejects document replay when task/file facts differ", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(agent as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-1", status: "COMPLETED", version: 4 } as never)
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue({
      id: "doc-other",
      clientDocumentId: "document-123",
      title: "proof",
      fileName: "proof.txt",
      mimeType: "text/plain",
      sizeBytes: 999,
      checksumSha256: "different",
      taskId: "task-2",
      storageKey: "a".repeat(48),
      deletedAt: null,
    } as never)
    const form = new FormData()
    form.append("file", new File(["proof"], "proof.txt", { type: "text/plain" }))
    form.append("clientDocumentId", "document-123")
    form.append("title", "proof")
    const response = await uploadTaskDocument(new NextRequest("http://localhost/api/v1/mtm/tasks/task-1/documents", { method: "POST", body: form }), params())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_DOCUMENT_REPLAY_MISMATCH")
  })

  it("keeps bulk reassignment all-or-nothing on a stale version", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-old", status: "PENDING", version: 2 },
      { id: "task-2", agentId: "agent-old", status: "PENDING", version: 4 },
    ] as never)
    const response = await bulkReassign(request("/api/v1/mtm/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1", "task-2"],
      agentId: "agent-1",
      expectedVersions: { "task-1": 2, "task-2": 3 },
    }))
    expect(response.status).toBe(409)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("unlinks a stale visit when a task is reassigned", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-old", visitId: "visit-old", status: "PENDING", version: 2 },
    ] as never)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await bulkReassign(request("/api/v1/mtm/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1"],
      agentId: "agent-1",
      expectedVersions: { "task-1": 2 },
    }))

    expect(response.status).toBe(200)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { agentId: "agent-1", visitId: null, acceptedAt: null, version: { increment: 1 } },
    }))
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        evidence: expect.objectContaining({ previousVisitId: "visit-old", visitUnlinked: true }),
      }),
    }))
  })
})
