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

import { POST } from "@/app/api/v1/mtm/mobile/tasks/[id]/duplicate/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const MANAGER = { orgId: ORG, agentId: "mgr-1", userId: "u-1", email: "m@x.co", name: "Mgr", role: "MANAGER" }
const DUPLICATE_BODY = {
  targetDueDate: "2026-08-04T12:00:00.000Z",
  targetScheduledStartAt: "2026-08-04T10:00:00.000Z",
  idempotencyKey: "duplicate-operation-1", // gitleaks:allow -- synthetic test/public display literal
  expectedVersion: 1,
}

function req(body: unknown = DUPLICATE_BODY) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/task-1/duplicate", {
    method: "POST",
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
    id: "task-1", organizationId: ORG, agentId: "agent-1", title: "Visit clinic", description: "d",
    priority: "HIGH", dueDate: null, customerId: "cus-1", version: 1,
  } as never)
  vi.mocked(prisma.mtmTask.create).mockResolvedValue({
    id: "task-copy", agentId: "agent-1", title: "Visit clinic", status: "PENDING", priority: "HIGH",
    scheduledStartAt: new Date(DUPLICATE_BODY.targetScheduledStartAt), dueDate: new Date(DUPLICATE_BODY.targetDueDate), version: 1,
  } as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("POST /api/v1/mtm/mobile/tasks/[id]/duplicate", () => {
  it("rejects an AGENT caller without TEAM_DECIDE", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...MANAGER, role: "AGENT" } as never)
    const res = await POST(req(), params())
    expect(res.status).toBe(403)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("duplicates an in-scope task as a fresh PENDING copy with provenance", async () => {
    const res = await POST(req(), params())
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ success: true, data: { id: "task-copy" } })
    const data = vi.mocked(prisma.mtmTask.create).mock.calls[0][0].data
    expect(data).toMatchObject({
      organizationId: ORG,
      agentId: "agent-1",
      customerId: "cus-1",
      title: "Visit clinic",
      priority: "HIGH",
      status: "PENDING",
      copiedFromId: "task-1",
      scheduledStartAt: new Date(DUPLICATE_BODY.targetScheduledStartAt),
      dueDate: new Date(DUPLICATE_BODY.targetDueDate),
    })
    expect(prisma.mtmTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task-1", organizationId: ORG, version: 1 }),
      data: { version: { increment: 0 } },
    }))
  })

  it("does not copy recurrence, result or completion onto the duplicate", async () => {
    await POST(req(), params())
    const data = vi.mocked(prisma.mtmTask.create).mock.calls[0][0].data
    expect(data).toMatchObject({
      visitId: null,
      recurrenceRule: null,
      recurrenceInterval: null,
      recurrenceUntil: null,
      recurrenceTimezone: null,
      recurrenceParentId: null,
    })
    expect(data).not.toHaveProperty("result")
    expect(data).not.toHaveProperty("completedAt")
  })

  it("forbids duplicating a task owned by an out-of-scope agent", async () => {
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["someone-else"] } as never)
    const res = await POST(req(), params())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_TASK_SCOPE_DENIED")
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("returns 404 when the source task does not exist", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    const res = await POST(req(), params())
    expect(res.status).toBe(404)
  })

  it("does not replay a duplicate that was reassigned outside current scope", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
        id: "task-copy",
        agentId: "agent-2",
        copiedFromId: "task-1",
        dueDate: new Date(DUPLICATE_BODY.targetDueDate),
        scheduledStartAt: new Date(DUPLICATE_BODY.targetScheduledStartAt),
        deletedAt: null,
        title: "Visit clinic",
        status: "PENDING",
        priority: "HIGH",
        version: 2,
      }] as never)

    const res = await POST(req(), params())

    expect(res.status).toBe(404)
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })
})
