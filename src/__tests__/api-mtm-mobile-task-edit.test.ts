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

import { PUT } from "@/app/api/v1/mtm/mobile/tasks/[id]/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const MANAGER = { orgId: ORG, agentId: "mgr-1", userId: "u-1", email: "m@x.co", name: "Mgr", role: "MANAGER" }

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/task-1", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer valid" },
    body: JSON.stringify(body),
  })
}
const params = (id = "task-1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
    id: "task-1", agentId: "agent-1", title: "Old", description: null, status: "PENDING", priority: "MEDIUM", dueDate: null,
    scheduledStartAt: null,
    recurrenceRule: null, recurrenceInterval: null, recurrenceUntil: null, recurrenceTimezone: null,
    recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null,
    recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: null,
    version: 1,
  } as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("PUT /api/v1/mtm/mobile/tasks/[id]", () => {
  it("rejects an AGENT caller without TEAM_DECIDE", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...MANAGER, role: "AGENT" } as never)
    const res = await PUT(req({ title: "New", expectedVersion: 1 }), params())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_MOBILE_CAPABILITY_REQUIRED")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("updates an in-scope task and maps editable fields", async () => {
    const res = await PUT(req({ title: "New title", description: "d", priority: "HIGH", dueDate: "2026-08-01T00:00:00.000Z", expectedVersion: 1 }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    const data = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data
    expect(data).toMatchObject({ title: "New title", description: "d", priority: "HIGH" })
    expect(data.dueDate).toBeInstanceOf(Date)
  })

  it("nulls description and dueDate when explicitly cleared", async () => {
    await PUT(req({ description: null, dueDate: null, expectedVersion: 1 }), params())
    const data = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data
    expect(data.description).toBeNull()
    expect(data.dueDate).toBeNull()
  })

  it("authors a recurrence rule with interval", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", agentId: "agent-1", title: "Old", description: null, status: "PENDING", priority: "MEDIUM",
      scheduledStartAt: null, dueDate: new Date("2026-08-01T09:00:00.000Z"),
      recurrenceRule: null, recurrenceInterval: null, recurrenceUntil: null, recurrenceTimezone: null,
      recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: null,
      recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: null,
      version: 1,
    } as never)
    const res = await PUT(req({ recurrenceRule: "WEEKLY", recurrenceInterval: 2, expectedVersion: 1 }), params())
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data
    expect(data).toMatchObject({ recurrenceRule: "WEEKLY", recurrenceInterval: 2 })
  })

  it("keeps a due-only edit as a THIS exception even when its visible date moves past series end", async () => {
    const occurrenceDue = new Date("2026-08-01T09:00:00.000Z")
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", agentId: "agent-1", title: "Old", description: null, status: "PENDING", priority: "MEDIUM",
      scheduledStartAt: null, dueDate: occurrenceDue,
      recurrenceRule: "DAILY", recurrenceInterval: 1,
      recurrenceUntil: new Date("2026-08-03T23:59:59.000Z"), recurrenceTimezone: "UTC",
      recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: occurrenceDue,
      recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: null,
      version: 1,
    } as never)

    const res = await PUT(req({ dueDate: "2026-08-05T09:00:00.000Z", expectedVersion: 1 }), params())

    expect(res.status).toBe(200)
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dueDate: new Date("2026-08-05T09:00:00.000Z"),
        recurrenceCursorDueDate: occurrenceDue,
      }),
    }))
  })

  it("fails closed when the legacy mobile editor tries to change an existing series rule", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", agentId: "agent-1", title: "Old", description: null, status: "PENDING", priority: "MEDIUM",
      scheduledStartAt: null, dueDate: new Date("2026-08-01T09:00:00.000Z"),
      recurrenceRule: "DAILY", recurrenceInterval: 1, recurrenceUntil: null, recurrenceTimezone: "UTC",
      recurrenceAnchorScheduledStartAt: null, recurrenceAnchorDueDate: new Date("2026-08-01T09:00:00.000Z"),
      recurrenceCursorScheduledStartAt: null, recurrenceCursorDueDate: new Date("2026-08-01T09:00:00.000Z"),
      version: 1,
    } as never)

    const res = await PUT(req({ recurrenceInterval: 2, expectedVersion: 1 }), params())

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("MTM_TASK_SERIES_EDIT_UNSUPPORTED")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("clears the recurrence series (rule null wipes interval + until)", async () => {
    await PUT(req({ recurrenceRule: null, expectedVersion: 1 }), params())
    const data = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0].data
    expect(data.recurrenceRule).toBeNull()
    expect(data.recurrenceInterval).toBeNull()
    expect(data.recurrenceUntil).toBeNull()
  })

  it("forbids editing a task owned by an out-of-scope agent", async () => {
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["someone-else"] } as never)
    const res = await PUT(req({ title: "New", expectedVersion: 1 }), params())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_TASK_SCOPE_DENIED")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("allows org-wide scope (agentIds null) to edit any task", async () => {
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: null } as never)
    const res = await PUT(req({ title: "New", expectedVersion: 1 }), params())
    expect(res.status).toBe(200)
  })

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    const res = await PUT(req({ title: "New", expectedVersion: 1 }), params())
    expect(res.status).toBe(404)
  })

  it("rejects an empty edit body", async () => {
    const res = await PUT(req({ expectedVersion: 1 }), params())
    expect(res.status).toBe(400)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })
})
