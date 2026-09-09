import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
  runWithRlsBypass: vi.fn((work: () => Promise<unknown>) => work()),
  withJobLease: vi.fn(),
  taskFindMany: vi.fn(),
  taskUpdate: vi.fn(),
  taskUpdateMany: vi.fn(),
  userFindMany: vi.fn(),
  createNotification: vi.fn(),
  deliverNotificationPush: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    task: {
      findMany: mocks.taskFindMany,
      update: mocks.taskUpdate,
      updateMany: mocks.taskUpdateMany,
    },
    user: { findMany: mocks.userFindMany },
  },
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: mocks.requireCronAuth }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: mocks.runWithRlsBypass }))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.withJobLease }))
vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
  deliverNotificationPush: mocks.deliverNotificationPush,
}))

import { POST } from "@/app/api/cron/commitment-escalation/route"

function request(search = "") {
  return new NextRequest(`http://localhost/api/cron/commitment-escalation${search}`, {
    method: "POST",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCronAuth.mockReturnValue(null)
  mocks.taskFindMany.mockResolvedValue([])
  mocks.taskUpdate.mockResolvedValue({ id: "task-1" })
  mocks.taskUpdateMany.mockResolvedValue({ count: 1 })
  mocks.userFindMany.mockResolvedValue([])
  mocks.createNotification.mockResolvedValue({ id: "notification-1" })
  mocks.deliverNotificationPush.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({
    task: { updateMany: mocks.taskUpdateMany },
  }))
  mocks.withJobLease.mockImplementation(async (
    _options: unknown,
    work: () => Promise<unknown>,
  ) => ({ status: "completed", value: await work() }))
})

describe("POST /api/cron/commitment-escalation", () => {
  it("rejects an unauthenticated tick before entering the RLS bypass", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.taskFindMany).not.toHaveBeenCalled()
  })

  it("does not let smoke mode bypass cron authentication", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request("?smoke=1"))

    expect(response.status).toBe(401)
    expect(mocks.requireCronAuth).toHaveBeenCalledTimes(1)
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.taskFindMany).not.toHaveBeenCalled()
  })

  it("offers an authenticated side-effect-free deployment smoke", async () => {
    const response = await POST(request("?smoke=1"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { notified: 0, escalated: 0, scanned: 0, smoke: true },
    })
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.taskFindMany).not.toHaveBeenCalled()
    expect(mocks.createNotification).not.toHaveBeenCalled()
  })

  it("runs live ticks under one expiring singleton lease", async () => {
    mocks.withJobLease.mockResolvedValueOnce({ status: "skipped", reason: "already_running" })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { skipped: "already_running" },
    })
    expect(mocks.withJobLease).toHaveBeenCalledWith(
      { name: "commitment-escalation", ttlMs: 180_000 },
      expect.any(Function),
    )
    expect(mocks.taskFindMany).not.toHaveBeenCalled()
  })

  it("executes an authenticated live tick and durably stamps a delivered reminder", async () => {
    const dueDate = new Date(Date.now() - 60_000)
    const createdAt = new Date("2026-08-26T12:00:00.000Z")
    const updatedAt = new Date("2026-08-27T04:00:00.000Z")
    mocks.taskFindMany.mockResolvedValueOnce([{
      id: "task-1",
      organizationId: "org-1",
      title: "Callback",
      dueDate,
      assignedTo: "sales-1",
      relatedType: "lead",
      relatedId: "lead-1",
      completedAt: null,
      createdAt,
      updatedAt,
      customFields: { commitmentCallId: "call-1" },
    }])

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { notified: 1, escalated: 0, scanned: 1 },
    })
    expect(mocks.withJobLease).toHaveBeenCalledWith(
      { name: "commitment-escalation", ttlMs: 180_000 },
      expect.any(Function),
    )
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      userId: "sales-1",
      entityType: "task",
      entityId: "task-1",
      idempotencyKey: [
        "commitment-escalation:v1",
        "task-1",
        createdAt.toISOString(),
        dueDate.toISOString(),
        "assignee",
        "sales-1",
      ].join(":"),
      push: false,
      client: expect.any(Object),
    }))
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "task-1",
        organizationId: "org-1",
        updatedAt,
        dueDate,
        deletedAt: null,
        completedAt: null,
      }),
      data: {
        customFields: expect.objectContaining({
          commitmentCallId: "call-1",
          overdueNotifiedAt: expect.any(String),
        }),
      },
    })
    expect(mocks.deliverNotificationPush).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      userId: "sales-1",
      entityId: "task-1",
    }))
  })

  it("rolls the stamp back when durable notification creation fails", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([{
      id: "task-1",
      organizationId: "org-1",
      title: "Callback",
      dueDate: new Date(Date.now() - 60_000),
      assignedTo: "sales-1",
      relatedType: "lead",
      relatedId: "lead-1",
      completedAt: null,
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      customFields: { commitmentCallId: "call-1" },
    }])
    mocks.createNotification.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      notified: 0,
      escalated: 0,
      scanned: 1,
    })
    // The CAS is allowed to run first only inside the same transaction as the
    // notification. A failed durable row must make that transaction roll back,
    // leaving the task retryable without sending a false reminder.
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.taskUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.deliverNotificationPush).not.toHaveBeenCalled()
  })

  it("does not stamp manager escalation until every manager has a durable notification", async () => {
    const dueDate = new Date(Date.now() - 60 * 60_000)
    const createdAt = new Date("2026-08-26T12:00:00.000Z")
    mocks.taskFindMany.mockResolvedValueOnce([{
      id: "task-1",
      organizationId: "org-1",
      title: "Callback",
      dueDate,
      assignedTo: "sales-1",
      relatedType: "lead",
      relatedId: "lead-1",
      completedAt: null,
      createdAt,
      updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      customFields: {
        commitmentCallId: "call-1",
        overdueNotifiedAt: new Date(Date.now() - 59 * 60_000).toISOString(),
      },
    }])
    mocks.userFindMany.mockResolvedValueOnce([{ id: "manager-1" }, { id: "manager-2" }])
    mocks.createNotification
      .mockResolvedValueOnce({ id: "notification-manager-1" })
      .mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.createNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: "manager-1",
      idempotencyKey: [
        "commitment-escalation:v1",
        "task-1",
        createdAt.toISOString(),
        dueDate.toISOString(),
        "manager",
        "manager-1",
      ].join(":"),
    }))
    expect(mocks.createNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: "manager-2",
      idempotencyKey: [
        "commitment-escalation:v1",
        "task-1",
        createdAt.toISOString(),
        dueDate.toISOString(),
        "manager",
        "manager-2",
      ].join(":"),
    }))
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.taskUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.deliverNotificationPush).not.toHaveBeenCalled()
  })

  it("does not overwrite a callback that was rescheduled during delivery", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([{
      id: "task-1",
      organizationId: "org-1",
      title: "Callback",
      dueDate: new Date(Date.now() - 60_000),
      assignedTo: "sales-1",
      relatedType: "lead",
      relatedId: "lead-1",
      completedAt: null,
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      customFields: { commitmentCallId: "call-1" },
    }])
    mocks.taskUpdateMany.mockResolvedValueOnce({ count: 0 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ notified: 0, scanned: 1 })
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "task-1",
        organizationId: "org-1",
        updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      }),
    }))
    expect(mocks.createNotification).not.toHaveBeenCalled()
    expect(mocks.deliverNotificationPush).not.toHaveBeenCalled()
    expect(mocks.taskUpdate).not.toHaveBeenCalled()
  })

  it("does not alert managers when a callback was rescheduled before the escalation CAS", async () => {
    mocks.taskFindMany.mockResolvedValueOnce([{
      id: "task-1",
      organizationId: "org-1",
      title: "Callback",
      dueDate: new Date(Date.now() - 60 * 60_000),
      assignedTo: "sales-1",
      relatedType: "lead",
      relatedId: "lead-1",
      completedAt: null,
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      customFields: {
        commitmentCallId: "call-1",
        overdueNotifiedAt: new Date(Date.now() - 59 * 60_000).toISOString(),
      },
    }])
    mocks.userFindMany.mockResolvedValueOnce([{ id: "manager-1" }])
    mocks.taskUpdateMany.mockResolvedValueOnce({ count: 0 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ escalated: 0, scanned: 1 })
    expect(mocks.createNotification).not.toHaveBeenCalled()
    expect(mocks.deliverNotificationPush).not.toHaveBeenCalled()
  })
})
