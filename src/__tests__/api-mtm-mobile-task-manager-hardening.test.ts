import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))
vi.mock("@/lib/mtm/territory-scope", () => ({ resolveAgentScope: vi.fn() }))

import { PUT as editTask } from "@/app/api/v1/mtm/mobile/tasks/[id]/route"
import { POST as returnTask } from "@/app/api/v1/mtm/mobile/tasks/[id]/return/route"
import { POST as duplicateTask } from "@/app/api/v1/mtm/mobile/tasks/[id]/duplicate/route"
import { POST as bulkReassign } from "@/app/api/v1/mtm/mobile/tasks/bulk-reassign/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const MANAGER = {
  orgId: ORG,
  agentId: "manager-1",
  userId: "user-1",
  email: "manager@example.test",
  name: "Manager",
  role: "MANAGER",
}
const routeContext = (id = "task-1") => ({ params: Promise.resolve({ id }) })

function request(path: string, method: "POST" | "PUT", body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer valid" },
    body: JSON.stringify(body),
  })
}

function editableTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: ORG,
    agentId: "agent-1",
    customerId: "customer-1",
    title: "Visit clinic",
    description: "Discuss formulary",
    status: "PENDING",
    priority: "HIGH",
    scheduledStartAt: new Date("2026-08-04T10:00:00.000Z"),
    dueDate: new Date("2026-08-04T12:00:00.000Z"),
    completedAt: null,
    result: null,
    returnReason: null,
    recurrenceRule: null,
    recurrenceInterval: null,
    recurrenceUntil: null,
    recurrenceTimezone: null,
    recurrenceAnchorScheduledStartAt: null,
    recurrenceAnchorDueDate: null,
    version: 3,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "agent-2"] } as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask() as never)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmTask.create).mockResolvedValue({
    ...editableTask({ id: "task-copy", scheduledStartAt: new Date("2026-08-06T10:00:00.000Z"), dueDate: new Date("2026-08-06T12:00:00.000Z"), version: 1 }),
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2" } as never)
  vi.mocked(prisma.$queryRaw).mockReset()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
})

describe("legacy mobile task manager mutation hardening", () => {
  it("requires optimistic-concurrency input on every manager mutation", async () => {
    const edit = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", { title: "Changed" }), routeContext())
    const returned = await returnTask(request("/api/v1/mtm/mobile/tasks/task-1/return", "POST", { reason: "Redo" }), routeContext())
    const duplicate = await duplicateTask(request("/api/v1/mtm/mobile/tasks/task-1/duplicate", "POST", {
      targetDueDate: "2026-08-06T12:00:00.000Z",
      idempotencyKey: "duplicate-operation-1", // gitleaks:allow -- synthetic test/public display literal
    }), routeContext())
    const bulk = await bulkReassign(request("/api/v1/mtm/mobile/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1"],
      agentId: "agent-2",
    }))

    expect([edit.status, returned.status, duplicate.status, bulk.status]).toEqual([400, 400, 400, 400])
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("CAS-fences metadata edits and records the authenticated manager in the timeline", async () => {
    const response = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", {
      title: "Changed",
      expectedVersion: 3,
      actorAgentId: "untrusted-client-value",
    }), routeContext())

    expect(response.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        agentId: "agent-1",
        status: "PENDING",
        version: 3,
      }),
      data: expect.objectContaining({ title: "Changed", version: { increment: 1 } }),
    }))
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: "task-1",
        evidence: expect.objectContaining({
          kind: "MTM_TASK_METADATA_EDIT",
          actorAgentId: "manager-1",
          expectedVersion: 3,
        }),
      }),
    }))
  })

  it("keeps terminal task core immutable on metadata edit", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask({ status: "COMPLETED" }) as never)

    const response = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", {
      title: "Changed",
      expectedVersion: 3,
    }), routeContext())

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_IMMUTABLE")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("rejects a stale manager edit before entering the transaction", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask({ version: 4 }) as never)

    const response = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", {
      title: "Changed",
      expectedVersion: 3,
    }), routeContext())

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_VERSION_CONFLICT")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects enabling recurrence without a planned start or due date", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask({
      scheduledStartAt: null,
      dueDate: null,
    }) as never)

    const response = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", {
      recurrenceRule: "DAILY",
      expectedVersion: 3,
    }), routeContext())

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe("MTM_TASK_RECURRENCE_DATE_REQUIRED")
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("pins the tenant timezone and exact schedule anchors when recurrence is enabled", async () => {
    const dueDate = new Date("2026-08-04T12:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask({
      scheduledStartAt: null,
      dueDate,
    }) as never)

    const response = await editTask(request("/api/v1/mtm/mobile/tasks/task-1", "PUT", {
      recurrenceRule: "MONTHLY",
      expectedVersion: 3,
    }), routeContext())

    expect(response.status).toBe(200)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recurrenceRule: "MONTHLY",
        recurrenceInterval: 1,
        recurrenceTimezone: "Asia/Baku",
        recurrenceAnchorScheduledStartAt: null,
        recurrenceAnchorDueDate: dueDate,
        version: { increment: 1 },
      }),
    }))
  })

  it("returns a completion cycle transactionally without overwriting its result evidence", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask({
      status: "COMPLETED",
      result: "Signed evidence",
      completedAt: new Date("2026-08-04T12:30:00.000Z"),
      version: 7,
    }) as never)

    const response = await returnTask(request("/api/v1/mtm/mobile/tasks/task-1/return", "POST", {
      reason: "Add the missing photo",
      expectedVersion: 7,
      actorAgentId: "untrusted-client-value",
    }), routeContext())

    expect(response.status).toBe(200)
    const update = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0]
    expect(update.data).not.toHaveProperty("result")
    expect(update.data).toMatchObject({
      status: "IN_PROGRESS",
      completedAt: null,
      returnReason: "Add the missing photo",
      version: { increment: 1 },
    })
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fromStatus: "COMPLETED",
        toStatus: "IN_PROGRESS",
        evidence: expect.objectContaining({
          kind: "MTM_TASK_REVIEW",
          action: "RETURN",
          completionCycle: "2026-08-04T12:30:00.000Z",
          actorAgentId: "manager-1",
          priorCompletionEvidencePreserved: true,
        }),
      }),
    }))
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
  })

  it("creates a duplicate-to-date as an idempotent one-off with actor evidence", async () => {
    const response = await duplicateTask(request("/api/v1/mtm/mobile/tasks/task-1/duplicate", "POST", {
      targetScheduledStartAt: "2026-08-06T10:00:00.000Z",
      targetDueDate: "2026-08-06T12:00:00.000Z",
      idempotencyKey: "duplicate-operation-1", // gitleaks:allow -- synthetic test/public display literal
      expectedVersion: 3,
      actorAgentId: "untrusted-client-value",
    }), routeContext())

    expect(response.status).toBe(201)
    expect(prisma.mtmTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        visitId: null,
        status: "PENDING",
        scheduledStartAt: new Date("2026-08-06T10:00:00.000Z"),
        dueDate: new Date("2026-08-06T12:00:00.000Z"),
        recurrenceRule: null,
        recurrenceInterval: null,
        recurrenceUntil: null,
        recurrenceTimezone: null,
        recurrenceParentId: null,
        copiedFromId: "task-1",
      }),
    }))
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "COPIED",
        evidence: expect.objectContaining({ actorAgentId: "manager-1", expectedVersion: 3 }),
      }),
    }))
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it("replays the same duplicate but refuses a deleted idempotency tombstone", async () => {
    const duplicateBody = {
      targetScheduledStartAt: "2026-08-06T10:00:00.000Z",
      targetDueDate: "2026-08-06T12:00:00.000Z",
      idempotencyKey: "duplicate-operation-1", // gitleaks:allow -- synthetic test/public display literal
      expectedVersion: 3,
    }
    const existing = {
      id: "task-copy",
      agentId: "agent-1",
      copiedFromId: "task-1",
      scheduledStartAt: new Date(duplicateBody.targetScheduledStartAt),
      dueDate: new Date(duplicateBody.targetDueDate),
      deletedAt: null,
      title: "Visit clinic",
      status: "PENDING",
      priority: "HIGH",
      version: 1,
    }
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([existing] as never)

    const replay = await duplicateTask(request("/api/v1/mtm/mobile/tasks/task-1/duplicate", "POST", duplicateBody), routeContext())
    expect(replay.status).toBe(200)
    expect((await replay.json()).data.idempotent).toBe(true)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "agent-2"] } as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(editableTask() as never)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ ...existing, deletedAt: new Date("2026-08-06T13:00:00.000Z") }] as never)

    const tombstone = await duplicateTask(request("/api/v1/mtm/mobile/tasks/task-1/duplicate", "POST", duplicateBody), routeContext())
    expect(tombstone.status).toBe(409)
    expect((await tombstone.json()).code).toBe("MTM_TASK_DUPLICATE_TOMBSTONED")
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("rejects the entire bulk batch when any requested task is outside scope", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", visitId: "visit-1", status: "PENDING", version: 3 },
    ] as never)

    const response = await bulkReassign(request("/api/v1/mtm/mobile/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1", "task-outside-scope"],
      agentId: "agent-2",
      expectedVersions: { "task-1": 3, "task-outside-scope": 2 },
    }))

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe("MTM_TASK_SCOPE_DENIED")
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("refuses to bulk-reassign a terminal task", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", visitId: "visit-1", status: "COMPLETED", version: 3 },
    ] as never)

    const response = await bulkReassign(request("/api/v1/mtm/mobile/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1"],
      agentId: "agent-2",
      expectedVersions: { "task-1": 3 },
    }))

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MTM_TASK_IMMUTABLE")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("bulk-reassigns all tasks with per-task CAS, unlinks old-agent visits, and emits events", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "task-1", agentId: "agent-1", visitId: "visit-1", status: "PENDING", version: 3 },
      { id: "task-2", agentId: "agent-1", visitId: null, status: "IN_PROGRESS", version: 4 },
    ] as never)

    const response = await bulkReassign(request("/api/v1/mtm/mobile/tasks/bulk-reassign", "POST", {
      taskIds: ["task-1", "task-2"],
      agentId: "agent-2",
      expectedVersions: { "task-1": 3, "task-2": 4 },
      actorAgentId: "untrusted-client-value",
    }))

    expect(response.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0]).toMatchObject({
      where: { id: "task-1", agentId: "agent-1", version: 3 },
      data: { agentId: "agent-2", visitId: null, acceptedAt: null, version: { increment: 1 } },
    })
    expect(prisma.mtmTaskEvent.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmTaskEvent.create).mock.calls[0][0]).toMatchObject({
      data: {
        taskId: "task-1",
        agentId: "agent-2",
        evidence: {
          kind: "MTM_TASK_REASSIGN",
          previousAgentId: "agent-1",
          agentId: "agent-2",
          actorAgentId: "manager-1",
          visitUnlinked: true,
          previousVisitId: "visit-1",
        },
      },
    })
  })
})
