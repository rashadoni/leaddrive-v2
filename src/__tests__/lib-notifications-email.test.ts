import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

const mocks = vi.hoisted(() => ({
  createNotificationRow: vi.fn(),
  findNotificationRow: vi.fn(),
  findUserUnique: vi.fn(),
  findUserFirst: vi.fn(),
  findPreference: vi.fn(),
  getOrgModuleContext: vi.fn(),
  sendPushToUser: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: mocks.createNotificationRow,
      findFirst: mocks.findNotificationRow,
    },
    user: { findUnique: mocks.findUserUnique, findFirst: mocks.findUserFirst },
    userPreference: { findUnique: mocks.findPreference },
  },
}))
vi.mock("@/lib/push-send", () => ({ sendPushToUser: mocks.sendPushToUser }))
vi.mock("@/lib/api-auth", () => ({ getOrgModuleContext: mocks.getOrgModuleContext }))
vi.mock("@/lib/notifications/taxonomy", () => ({ deriveSection: vi.fn(() => "crm") }))
vi.mock("@/lib/notifications/access", () => ({ canNotifyEntityType: vi.fn(() => true) }))
vi.mock("@/lib/notifications/prefs", () => ({ shouldPush: vi.fn(() => true) }))
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }))

import { createNotification } from "@/lib/notifications"

describe("a notification that also has to reach a mailbox", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createNotificationRow.mockResolvedValue({ id: "notif-1" })
    mocks.findNotificationRow.mockResolvedValue(null)
    mocks.findUserFirst.mockResolvedValue({ email: "seller@example.com" })
    mocks.findUserUnique.mockResolvedValue({ role: "sales" })
    mocks.findPreference.mockResolvedValue({ data: {} })
    mocks.getOrgModuleContext.mockResolvedValue({ modules: {} })
    mocks.sendPushToUser.mockResolvedValue(undefined)
    mocks.sendEmail.mockResolvedValue({ success: true })
  })

  it("emails the person who was handed the work, with a link to it", async () => {
    await createNotification({
      organizationId: "org-1",
      userId: "seller-1",
      title: "Вам назначен лид",
      message: "«Qobustone»",
      entityType: "lead",
      entityId: "lead-9",
      email: true,
    })

    await vi.waitFor(() => expect(mocks.sendEmail).toHaveBeenCalledTimes(1))
    const sent = mocks.sendEmail.mock.calls[0][0]
    expect(sent.to).toBe("seller@example.com")
    expect(sent.subject).toContain("назначен лид")
    // A link to the notifications page when the notification is ABOUT a lead is
    // a small lie the recipient pays for with a search.
    expect(sent.text).toContain("/leads/lead-9")
  })

  it("stays silent unless the call site asked for a mailbox", async () => {
    await createNotification({
      organizationId: "org-1",
      userId: "seller-1",
      title: "Смена статуса лида",
      message: "статус → contacted",
      entityType: "lead",
      entityId: "lead-9",
    })

    // Every notification by email is how a mailbox becomes a folder nobody
    // opens; the opt-in is the whole point.
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("still records the notification when the mail transport is down", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("smtp unavailable"))

    const result = await createNotification({
      organizationId: "org-1",
      userId: "seller-1",
      title: "Вам назначена задача",
      message: "Позвонить клиенту",
      entityType: "task",
      entityId: "task-3",
      email: true,
    })

    expect(mocks.createNotificationRow).toHaveBeenCalled()
    expect(result).toBeTruthy()
  })

  it("does not try to email a recipient the organisation does not have", async () => {
    mocks.findUserFirst.mockResolvedValue(null)

    await createNotification({
      organizationId: "org-1",
      userId: "ghost",
      title: "Вам назначен лид",
      message: "«Qobustone»",
      entityType: "lead",
      entityId: "lead-9",
      email: true,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("recovers a deterministic notification after a crash without redelivering side effects", async () => {
    let inserted: Record<string, unknown> | null = null
    mocks.createNotificationRow
      .mockImplementationOnce(async ({ data }) => {
        inserted = data
        return data
      })
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["id"] },
      }))
    mocks.findNotificationRow.mockImplementationOnce(async ({ where }) => ({
      ...(inserted ?? {}),
      id: where.id,
    }))

    const args = {
      organizationId: "org-1",
      userId: "sales-1",
      title: "Müştəriyə verilən söz gecikir",
      message: "Callback",
      entityType: "task",
      entityId: "task-1",
      push: true,
      awaitPush: true,
      email: true,
      idempotencyKey: "commitment-escalation:v1:task-1:created:due:assignee:sales-1",
    } as const

    const first = await createNotification(args)
    const replay = await createNotification(args)

    const createdId = mocks.createNotificationRow.mock.calls[0][0].data.id
    expect(createdId).toMatch(/^notif_idem_[a-f0-9]{64}$/)
    expect(createdId).not.toContain("task-1")
    expect(mocks.findNotificationRow).toHaveBeenCalledWith({
      where: {
        id: createdId,
        organizationId: "org-1",
        userId: "sales-1",
        entityType: "task",
        entityId: "task-1",
      },
    })
    expect(first).toEqual(expect.objectContaining({ id: createdId }))
    expect(replay).toEqual(expect.objectContaining({ id: createdId }))
    await vi.waitFor(() => expect(mocks.sendEmail).toHaveBeenCalledTimes(1))
    expect(mocks.sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it("scopes deterministic notification ids by tenant, recipient, and semantic key", async () => {
    mocks.createNotificationRow.mockImplementation(async ({ data }) => data)

    const calls = [
      ["org-1", "sales-1", "same-key"],
      ["org-2", "sales-1", "same-key"],
      ["org-1", "sales-2", "same-key"],
      ["org-1", "sales-1", "other-key"],
    ] as const
    for (const [organizationId, userId, idempotencyKey] of calls) {
      await createNotification({
        organizationId,
        userId,
        title: "Callback",
        message: "Callback",
        entityType: "task",
        entityId: "task-1",
        idempotencyKey,
      })
    }

    const ids = mocks.createNotificationRow.mock.calls.map(([arg]) => arg.data.id)
    expect(new Set(ids).size).toBe(4)
    expect(ids).toEqual(ids.map((id) => expect.stringMatching(/^notif_idem_[a-f0-9]{64}$/)))
    expect(ids.join(" ")).not.toContain("same-key")
  })

  it("re-reads a matching row after an ambiguous insert result", async () => {
    mocks.createNotificationRow.mockRejectedValueOnce(new Error("connection closed after write"))
    mocks.findNotificationRow.mockImplementationOnce(async ({ where }) => ({
      id: where.id,
      organizationId: "org-1",
      userId: "sales-1",
      entityType: "task",
      entityId: "task-1",
    }))

    const result = await createNotification({
      organizationId: "org-1",
      userId: "sales-1",
      title: "Callback",
      message: "Callback",
      entityType: "task",
      entityId: "task-1",
      idempotencyKey: "commitment-1",
    })

    expect(result).toEqual(expect.objectContaining({ organizationId: "org-1", userId: "sales-1" }))
    expect(mocks.findNotificationRow).toHaveBeenCalledTimes(1)
    expect(mocks.sendPushToUser).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("does not accept a unique-conflict row outside the requested notification identity", async () => {
    mocks.createNotificationRow.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["id"] },
    }))
    mocks.findNotificationRow.mockResolvedValueOnce(null)

    const result = await createNotification({
      organizationId: "org-1",
      userId: "sales-1",
      title: "Callback",
      message: "Callback",
      entityType: "task",
      entityId: "task-1",
      idempotencyKey: "commitment-1",
    })

    expect(result).toBeNull()
    expect(mocks.findNotificationRow).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "sales-1",
        entityType: "task",
        entityId: "task-1",
      }),
    })
  })
})
